export const CARD_TYPES = ["qa", "cloze", "judge", "choice", "multichoice"];

export const TYPE_LABELS = {
  qa: "问答",
  cloze: "填空",
  judge: "判断",
  choice: "单选",
  multichoice: "多选",
};

export const DEFAULT_PROMPT = [
  "# Anki 高质量闪卡生成器",
  "",
  "## 角色",
  "你是精通 SuperMemo 20 条知识公式化规则的间隔重复记忆专家。你的任务是从材料中提炼适合记忆的最小知识单元。",
  "",
  "## 核心原则",
  "1. 一张卡只测试一个知识点；集合和枚举必须拆成独立卡片。",
  "2. 跳过过渡语、重复表述和琐碎细节，只保留高价值知识。",
  "3. 定义、术语、数字、日期和人名优先生成 `cloze`；因果和机制用 `qa`；明确对错的陈述用 `judge`；需要区分干扰项时才用 `choice` 或 `multichoice`。",
  "4. `judge` 的 answer 只能为“正确”或“错误”。`choice` 必须恰有 4 个选项，`multichoice` 必须恰有 5 个选项；选项逐行输出。",
  "5. 问题必须简短；相似问题要写明领域或上下文。",
  "6. `cloze` 的 `content` 必须使用 Anki 原生挖空，例如 `胰岛素由{{c1::胰岛 β 细胞}}分泌。`。",
  "7. 保留材料中的 LaTeX 数学式，使用行内或块级 LaTeX 标记；代码使用三反引号包围并标明语言。",
  "8. 易混淆卡片必须加入领域、条件或比较对象，避免相似问法互相干扰。",
  "9. 可以使用材料中的具体例子替代抽象提问，但不得引入材料外事实。",
  "10. 关键知识允许从不同角度生成少量冗余卡片；禁止生成同义重复卡片。",
  "11. 优先核心概念、机制、结论和高频考点，跳过过渡句、修饰语和低价值细节。",
  "",
  "## 输出格式",
  "仅输出一个合法 JSON 对象，禁止 Markdown 代码块和额外说明。对象必须包含 `cards` 数组。",
  "每张卡的结构为：type、fields、tags，并额外返回它对应的 source_id。",
  "type 只能为 qa、cloze、choice、multichoice、judge。",
  "fields 中 question 仅 qa/choice/multichoice/judge 使用，content 仅 cloze 使用；answer 除 cloze 外必填；options 仅 choice/multichoice 使用且逐行列出；remark 可选。",
  "",
  "## 输出前自检",
  "- 每张卡是否只测试一个知识点？",
  "- 是否拆分了集合、列表和并列结论？",
  "- 相似卡片是否有足够的区分线索？",
  "- 是否只保留了高价值信息，且 JSON 格式合法？",
].join("\n");

const ENTITY_MAP = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function stripHtml(value = "") {
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
      const lower = entity.toLowerCase();
      if (ENTITY_MAP[lower]) return ENTITY_MAP[lower];
      if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
      return `&${entity};`;
    })
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseDelimited(text, delimiter = "\t") {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field.replace(/\r$/, ""));
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function extractPreamble(text) {
  const metadata = {};
  let offset = 0;
  const matcher = /.*(?:\r?\n|$)/g;
  for (const match of text.matchAll(matcher)) {
    const line = match[0].replace(/\r?\n$/, "");
    if (!line.startsWith("#")) break;
    const colon = line.indexOf(":");
    if (colon > 1) metadata[line.slice(1, colon).toLowerCase()] = line.slice(colon + 1);
    offset = match.index + match[0].length;
  }
  return { metadata, data: text.slice(offset) };
}

function separatorFromMetadata(value) {
  const separators = { tab: "\t", comma: ",", semicolon: ";", pipe: "|", space: " " };
  return separators[String(value || "").toLowerCase()] || null;
}

function inferSeparator(data, filename) {
  if (/\.csv$/i.test(filename)) return ",";
  const firstLine = data.split(/\r?\n/, 1)[0] || "";
  const candidates = ["\t", ",", ";", "|"];
  return candidates.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
}

function splitTags(value) {
  if (Array.isArray(value)) return [...new Set(value.map(String).map((tag) => tag.trim()).filter(Boolean))];
  return [...new Set(String(value || "").split(/[\s,，]+/).map((tag) => tag.trim()).filter(Boolean))];
}

function looksLikeHeader(row) {
  const names = new Set(["front", "back", "question", "answer", "content", "options", "remark", "tags", "题目", "问题", "答案", "内容", "标签"]);
  const matches = row.filter((cell) => names.has(stripHtml(cell).trim().toLowerCase())).length;
  return matches >= Math.min(2, row.length);
}

function chooseCorrectOption(row) {
  const key = stripHtml(row[8] || "").trim().toUpperCase();
  const optionIndex = /^[A-D]$/.test(key) ? key.charCodeAt(0) - 65 + 4 : -1;
  return optionIndex >= 4 ? stripHtml(row[optionIndex]) : key;
}

function buildUnifiedSource(row, index) {
  const question = stripHtml(row[3] || row[0]);
  const answer = chooseCorrectOption(row);
  const explanation = stripHtml(row[9] || row[1]);
  const parts = [`题干：${question}`, `正确答案：${answer}`];
  if (explanation && !explanation.startsWith(answer)) parts.push(`解释：${explanation}`);
  else if (explanation) parts.push(`解释：${explanation}`);
  return {
    id: `S${index + 1}`,
    index: index + 1,
    title: question || `材料 ${index + 1}`,
    material: parts.join("\n"),
    tags: splitTags(row[10]),
    sourceType: "Socratopia 统一选择题",
    raw: row,
    selected: true,
  };
}

function buildGenericSource(row, index, headers, tagColumn) {
  const pairs = row
    .map((cell, cellIndex) => ({ name: headers?.[cellIndex] || `字段 ${cellIndex + 1}`, value: stripHtml(cell) }))
    .filter((item) => item.value && item.name.toLowerCase() !== "tags" && item.name !== "标签");
  const material = pairs.map((item) => `${item.name}：${item.value}`).join("\n");
  return {
    id: `S${index + 1}`,
    index: index + 1,
    title: pairs[0]?.value.slice(0, 100) || `材料 ${index + 1}`,
    material,
    tags: splitTags(row[tagColumn] || ""),
    sourceType: "通用表格",
    raw: row,
    selected: true,
  };
}

function chunkPlainText(text, maxLength = 5000) {
  const paragraphs = text.replace(/\r/g, "").split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
  const chunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxLength) {
      chunks.push(paragraph);
      continue;
    }
    for (let start = 0; start < paragraph.length; start += maxLength) {
      chunks.push(paragraph.slice(start, start + maxLength));
    }
  }
  return chunks;
}

export function parseInput(text, filename = "materials.txt") {
  const cleanText = String(text || "").replace(/^\uFEFF/, "");
  if (!cleanText.trim()) throw new Error("文件内容为空");
  if (/\.(md|markdown|txt)$/i.test(filename) && !cleanText.startsWith("#separator:")) {
    const chunks = chunkPlainText(cleanText);
    return {
      metadata: { format: "plain-text" },
      sources: chunks.map((material, index) => ({
        id: `S${index + 1}`,
        index: index + 1,
        title: material.split("\n")[0].replace(/^#+\s*/, "").slice(0, 100) || `材料 ${index + 1}`,
        material,
        tags: [],
        sourceType: "纯文本",
        raw: [material],
        selected: true,
      })),
    };
  }

  const { metadata, data } = extractPreamble(cleanText);
  const separator = separatorFromMetadata(metadata.separator) || inferSeparator(data, filename);
  let rows = parseDelimited(data, separator).filter((row) => row.some((cell) => stripHtml(cell)));
  if (!rows.length) throw new Error("没有识别到可转换的记录");

  const unified = rows.filter((row) => row.length >= 11).length >= Math.ceil(rows.length * 0.8);
  let headers = null;
  if (!unified && looksLikeHeader(rows[0])) headers = rows.shift().map((cell) => stripHtml(cell).trim());
  const tagColumnFromMeta = Number.parseInt(metadata["tags column"], 10) - 1;
  const tagColumnFromHeader = headers?.findIndex((header) => ["tags", "标签"].includes(header.toLowerCase())) ?? -1;
  const tagColumn = Number.isInteger(tagColumnFromMeta) && tagColumnFromMeta >= 0
    ? tagColumnFromMeta
    : tagColumnFromHeader;

  const sources = rows.map((row, index) => unified
    ? buildUnifiedSource(row, index)
    : buildGenericSource(row, index, headers, tagColumn));
  return { metadata: { ...metadata, separator }, sources };
}

export function createSourceBatches(sources, batchSize = "auto", { targetChars = 8000, maxItems = 8 } = {}) {
  if (batchSize !== "auto") {
    const size = Number(batchSize);
    if (!Number.isInteger(size) || size < 1) throw new Error("每批材料数量无效");
    const batches = [];
    for (let index = 0; index < sources.length; index += size) batches.push(sources.slice(index, index + size));
    return batches;
  }

  const batches = [];
  let current = [];
  let currentChars = 0;
  for (const source of sources) {
    const sourceChars = String(source.material || "").length;
    if (current.length && (current.length >= maxItems || currentChars + sourceChars > targetChars)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(source);
    currentChars += sourceChars;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function buildBatchMessages({ sources, prompt, allowedTypes, cardsPerSource = "auto", preference = "balanced" }) {
  const selectedTypes = allowedTypes.filter((type) => CARD_TYPES.includes(type));
  const preferenceText = {
    balanced: "在允许卡型之间保持多样；qa、cloze、judge 为主，choice 与 multichoice 合计不超过本批次卡片的 20%。",
    understanding: "优先 qa 和 judge，只有确实需要辨析干扰项时才使用 choice 或 multichoice。",
    memory: "优先 cloze，其次 qa；数字、术语、日期、人名应尽量使用 cloze。",
    custom: "严格使用允许的卡型，并根据材料性质选择最合适的类型。",
  }[preference] || "根据材料性质选择最合适的类型。";

  const quantityRule = cardsPerSource === "auto"
    ? "根据每条材料的知识密度自主决定卡片数量：简单材料通常生成 1 张；包含多个独立且高价值的知识点时拆成多张；没有记忆价值时可以跳过。不得为了增加数量生成低价值或同义重复卡片。"
    : `每条输入材料生成 ${cardsPerSource} 张卡；除非材料没有可记忆的高价值事实，此时可以跳过。`;

  const runtimeRules = [
    `本批次允许的卡型：${selectedTypes.join(", ")}。禁止输出其他卡型。`,
    quantityRule,
    preferenceText,
    "为保证 JSON 稳定，choice 和 multichoice 的 fields.options 优先输出为 JSON 字符串数组；不要在 JSON 字符串中写未转义的真实换行。",
    "每张卡根对象必须包含 source_id，值必须与输入中的 source_id 完全一致。",
    "只根据输入材料生成，不得使用外部知识补全。",
  ].join("\n");
  const payload = sources.map((source) => ({
    source_id: source.id,
    tags: source.tags,
    material: source.material,
  }));

  return [
    { role: "system", content: `${prompt.trim()}\n\n## 本次运行约束\n${runtimeRules}` },
    { role: "user", content: `请处理以下学习材料：\n${JSON.stringify(payload, null, 2)}` },
  ];
}

function contentToString(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || part?.content || "").join("");
  return String(content || "");
}

export function extractCompletionContent(response) {
  const content = response?.choices?.[0]?.message?.content ?? response?.output_text;
  if (!content) throw new Error("API 响应中没有找到模型输出");
  return contentToString(content);
}

function modelOutputError(message) {
  const error = new Error(message);
  error.code = "MODEL_OUTPUT_INVALID";
  return error;
}

function extractBalancedJson(source, opening, closing) {
  const start = source.indexOf(opening);
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === opening) depth += 1;
    else if (char === closing) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return "";
}

function escapeControlCharactersInStrings(source) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (const char of source) {
    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }
    if (escaped) {
      if (char === "\n") output += "n";
      else if (char === "\r") output += "r";
      else if (char === "\t") output += "t";
      else output += char;
      escaped = false;
    } else if (char === "\\") {
      output += char;
      escaped = true;
    } else if (char === '"') {
      output += char;
      inString = false;
    } else if (char === "\n") output += "\\n";
    else if (char === "\r") output += "\\r";
    else if (char === "\t") output += "\\t";
    else output += char;
  }
  return output;
}

function removeTrailingCommas(source) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ",") {
      let next = index + 1;
      while (/\s/.test(source[next] || "")) next += 1;
      if (["}", "]"].includes(source[next])) continue;
    }
    output += char;
  }
  return output;
}

function normalizeParsedJson(value) {
  if (Array.isArray(value)) return { cards: value };
  return value;
}

export function parseJsonObject(content) {
  const raw = String(content || "").replace(/^\uFEFF/, "").trim();
  const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```[\s\S]*$/i, "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() || "";
  const balancedCandidates = [
    { index: clean.indexOf("{"), value: extractBalancedJson(clean, "{", "}") },
    { index: clean.indexOf("["), value: extractBalancedJson(clean, "[", "]") },
  ].filter((item) => item.index >= 0 && item.value).sort((a, b) => a.index - b.index).map((item) => item.value);
  const candidates = [
    clean,
    fenced,
    ...balancedCandidates,
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    const escaped = escapeControlCharactersInStrings(candidate);
    const attempts = [candidate, escaped, removeTrailingCommas(candidate), removeTrailingCommas(escaped)];
    for (const attempt of [...new Set(attempts)]) {
      try {
        return normalizeParsedJson(JSON.parse(attempt));
      } catch {
        // Try the next conservative repair.
      }
    }
  }
  throw modelOutputError("模型输出不是合法 JSON");
}

export function buildJsonRepairMessages(content) {
  const raw = String(content || "").slice(0, 60_000);
  return [
    {
      role: "system",
      content: "你是 JSON 格式修复器。只修复语法和结构，不新增事实、不改写卡片含义。仅输出一个合法 JSON 对象，根字段必须是 cards 数组；删除无法恢复的残缺卡片。禁止 Markdown 代码块和额外说明。",
    },
    {
      role: "user",
      content: `请修复以下模型输出。保留每张卡的 source_id、type、fields 和 tags；options 可以改为 JSON 字符串数组：\n\n${raw}`,
    },
  ];
}

function normalizeOptions(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  return items
    .map(String)
    .map((item) => item.trim().replace(/^[A-E][.、:]\s*/i, ""))
    .filter(Boolean);
}

export function normalizeCard(raw, allowedTypes = CARD_TYPES) {
  const type = String(raw?.type || "").toLowerCase().trim();
  const fields = raw?.fields && typeof raw.fields === "object" ? raw.fields : {};
  const card = {
    id: raw?.id || globalThis.crypto?.randomUUID?.() || `card-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sourceId: String(raw?.source_id || raw?.sourceId || "").trim(),
    type,
    fields: {
      question: String(fields.question || "").trim(),
      content: String(fields.content || "").trim(),
      answer: String(fields.answer || "").trim(),
      options: normalizeOptions(fields.options),
      remark: String(fields.remark || "").trim(),
    },
    tags: splitTags(raw?.tags),
    issues: [],
  };

  if (!CARD_TYPES.includes(type)) card.issues.push("未知卡型");
  else if (!allowedTypes.includes(type)) card.issues.push("卡型不在本次允许范围内");
  if (!card.sourceId) card.issues.push("缺少 source_id");

  if (type === "cloze") {
    if (!card.fields.content) card.issues.push("缺少填空内容");
    if (!/{{c\d+::.+?}}/s.test(card.fields.content)) card.issues.push("未使用 Anki 原生挖空");
  } else if (CARD_TYPES.includes(type)) {
    if (!card.fields.question) card.issues.push("缺少问题");
    if (!card.fields.answer) card.issues.push("缺少答案");
  }
  if (type === "judge" && !["正确", "错误"].includes(card.fields.answer)) {
    card.issues.push("判断题答案必须是“正确”或“错误”");
  }
  if (type === "choice" && card.fields.options.length !== 4) {
    card.issues.push("单选题必须有 4 个选项");
  }
  if (type === "multichoice" && card.fields.options.length !== 5) {
    card.issues.push("多选题必须有 5 个选项");
  }
  return card;
}

export function parseGeneratedCards(response, allowedTypes = CARD_TYPES) {
  const object = parseJsonObject(extractCompletionContent(response));
  if (!Array.isArray(object?.cards)) throw modelOutputError("JSON 对象缺少 cards 数组");
  return object.cards.map((card) => normalizeCard(card, allowedTypes));
}

function htmlEscape(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function richText(value = "") {
  return htmlEscape(value).replace(/\r?\n/g, "<br>");
}

function tsvCell(value = "") {
  return String(value).replace(/\t/g, "    ").replace(/\r?\n/g, "<br>");
}

function cardTags(card) {
  return [...new Set([...(card.tags || []), `socratopia::type::${card.type}`])].join(" ");
}

function basicFront(card) {
  const question = `<div class="sf-question">${richText(card.fields.question)}</div>`;
  if (!["choice", "multichoice"].includes(card.type)) return question;
  const options = card.fields.options.map((option, index) => `<li><b>${String.fromCharCode(65 + index)}.</b> ${richText(option)}</li>`).join("");
  return `${question}<ol class="sf-options">${options}</ol>`;
}

function basicBack(card) {
  const answer = `<div class="sf-answer"><b>答案：</b>${richText(card.fields.answer)}</div>`;
  const remark = card.fields.remark ? `<hr><div class="sf-remark">${richText(card.fields.remark)}</div>` : "";
  return `${answer}${remark}`;
}

export function exportCardsJson(cards) {
  return JSON.stringify({
    cards: cards.map((card) => ({
      type: card.type,
      fields: {
        ...(card.type === "cloze" ? { content: card.fields.content } : { question: card.fields.question, answer: card.fields.answer }),
        ...(["choice", "multichoice"].includes(card.type) ? { options: card.fields.options.join("\n") } : {}),
        ...(card.fields.remark ? { remark: card.fields.remark } : {}),
      },
      tags: card.tags,
    })),
  }, null, 2);
}

export function exportUniversalTsv(cards) {
  const header = ["#separator:tab", "#html:true", "Type\tQuestion\tContent\tAnswer\tOptions\tRemark\tTags\tSourceId"];
  const rows = cards.map((card) => [
    card.type,
    card.fields.question,
    card.fields.content,
    card.fields.answer,
    card.fields.options.join("\n"),
    card.fields.remark,
    cardTags(card),
    card.sourceId,
  ].map(tsvCell).join("\t"));
  return [...header, ...rows].join("\n");
}

export function exportAnkiBasic(cards, deck = "Socratopia Rich") {
  const compatible = cards.filter((card) => card.type !== "cloze");
  const header = ["#separator:tab", "#html:true", "#notetype:Basic", `#deck:${deck}`, "#tags column:3"];
  const rows = compatible.map((card) => [basicFront(card), basicBack(card), cardTags(card)].map(tsvCell).join("\t"));
  return [...header, ...rows].join("\n");
}

export function exportAnkiCloze(cards, deck = "Socratopia Rich") {
  const compatible = cards.filter((card) => card.type === "cloze");
  const header = ["#separator:tab", "#html:true", "#notetype:Cloze", `#deck:${deck}`, "#tags column:3"];
  const rows = compatible.map((card) => [richText(card.fields.content), richText(card.fields.remark), cardTags(card)].map(tsvCell).join("\t"));
  return [...header, ...rows].join("\n");
}

export function cardFingerprint(card) {
  const prompt = card.type === "cloze" ? card.fields.content : card.fields.question;
  return `${card.type}:${prompt}`.toLowerCase().replace(/\s+/g, "").replace(/[，。！？,.!?]/g, "");
}
