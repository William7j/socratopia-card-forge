import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const PORT = Number(process.env.APP_PORT || 4173);
const HOST = "127.0.0.1";
const ANKI_CONNECT_URL = process.env.ANKI_CONNECT_URL || "http://127.0.0.1:8765";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ANKI_ACTIONS = new Set([
  "version",
  "deckNames",
  "modelNames",
  "modelFieldNames",
  "modelFieldRename",
  "modelFieldRemove",
  "createModel",
  "updateModelStyling",
  "updateModelTemplates",
  "createDeck",
  "canAddNotes",
  "addNotes",
]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export function resolveChatEndpoint(input) {
  let url;
  try {
    url = new URL(String(input || "").trim());
  } catch {
    throw new Error("API 地址不是有效 URL");
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("API 地址仅支持 http 或 https");
  }

  const cleanPath = url.pathname.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(cleanPath)) {
    url.pathname = cleanPath;
  } else if (/\/v1$/i.test(cleanPath)) {
    url.pathname = `${cleanPath}/chat/completions`;
  } else {
    url.pathname = `${cleanPath}/v1/chat/completions`.replace(/^\/\//, "/");
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function sendJson(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function describeUpstreamError(status, payload, endpoint) {
  const rawMessage = payload?.error?.message || payload?.error?.detail || payload?.message || payload?.detail || "";
  const hints = {
    401: "请检查 API Key 是否有效。",
    403: "请检查 API Key 权限和中转站的访问策略。",
    404: "接口路径可能不正确，请填写中转站基础地址、/v1 或完整 /chat/completions 地址。",
    429: "请求受限，请检查中转站额度、并发限制或稍后重试。",
  };
  const hint = hints[status] || (status >= 500 ? "中转站服务暂时异常，请稍后重试。" : "请检查中转站配置。");
  const detail = rawMessage ? ` ${rawMessage}` : "";
  return `上游 API 返回 HTTP ${status}。${hint}${detail}（请求地址：${endpoint}）`;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("请求不是合法 JSON");
  }
}

async function proxyCompletion(request, response) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return sendJson(response, 400, { error: { message: error.message } });
  }

  const { baseUrl, apiKey, model, messages, temperature = 0.2, responseFormat } = body;
  if (!baseUrl || !apiKey || !model || !Array.isArray(messages)) {
    return sendJson(response, 400, { error: { message: "缺少 API 地址、密钥、模型或消息" } });
  }

  let endpoint;
  try {
    endpoint = resolveChatEndpoint(baseUrl);
  } catch (error) {
    return sendJson(response, 400, { error: { message: error.message } });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  const upstreamBody = { model, messages, temperature, stream: false };
  if (responseFormat === "json_object") {
    upstreamBody.response_format = { type: "json_object" };
  }

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    });
    const raw = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = upstream.ok
        ? { error: { message: "上游返回了非 JSON 内容" } }
        : { error: { message: raw.slice(0, 1000) || `上游错误 ${upstream.status}` } };
    }
    if (!upstream.ok) {
      return sendJson(response, upstream.status, {
        error: { message: describeUpstreamError(upstream.status, payload, endpoint) },
      });
    }
    sendJson(response, 200, payload);
  } catch (error) {
    const reason = error.cause?.code || error.cause?.message || error.message;
    const message = error.name === "AbortError"
      ? `请求超时（180 秒）：${endpoint}`
      : `无法连接上游 API。请检查中转站地址、网络、代理或 TLS 证书。${reason ? ` (${reason})` : ""}（请求地址：${endpoint}）`;
    sendJson(response, 502, { error: { message } });
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyAnkiConnect(request, response, endpoint = ANKI_CONNECT_URL) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return sendJson(response, 400, { error: error.message, result: null });
  }
  const action = String(body.action || "");
  if (!ANKI_ACTIONS.has(action)) {
    return sendJson(response, 400, { error: "不支持的 AnkiConnect 操作", result: null });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params: body.params || {} }),
      signal: controller.signal,
    });
    const raw = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return sendJson(response, 502, { error: "AnkiConnect 返回了无效内容", result: null });
    }
    if (!upstream.ok) {
      return sendJson(response, upstream.status, { error: payload.error || `AnkiConnect HTTP ${upstream.status}`, result: null });
    }
    if (!payload || !("result" in payload) || !("error" in payload)) {
      return sendJson(response, 502, { error: "AnkiConnect 返回格式无效", result: null });
    }
    return sendJson(response, 200, payload);
  } catch (error) {
    const message = error.name === "AbortError"
      ? "连接 AnkiConnect 超时"
      : "无法连接 AnkiConnect。请确认 Anki 已打开且已安装 AnkiConnect 插件。";
    return sendJson(response, 502, { error: message, result: null });
  } finally {
    clearTimeout(timeout);
  }
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || HOST}`);
  const pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  const absolutePath = resolve(ROOT, `.${pathname}`);
  if (!absolutePath.startsWith(ROOT.endsWith(sep) ? ROOT : `${ROOT}${sep}`)) {
    return sendJson(response, 403, { error: { message: "禁止访问" } });
  }
  try {
    const body = await readFile(absolutePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(absolutePath)] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  } catch (error) {
    sendJson(response, error.code === "ENOENT" ? 404 : 500, {
      error: { message: error.code === "ENOENT" ? "页面不存在" : "读取页面失败" },
    });
  }
}

export function createAppServer({ ankiConnectUrl = ANKI_CONNECT_URL } = {}) {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/api/health") {
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === "POST" && request.url === "/api/generate") {
      return proxyCompletion(request, response);
    }
    if (request.method === "POST" && request.url === "/api/anki") {
      return proxyAnkiConnect(request, response, ankiConnectUrl);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return sendJson(response, 405, { error: { message: "不支持的请求方法" } });
    }
    return serveStatic(request, response);
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  createAppServer().listen(PORT, HOST, () => {
    console.log(`Socratopia 卡片工坊运行于 http://${HOST}:${PORT}`);
  });
}
