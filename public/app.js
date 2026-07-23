import {
  CARD_TYPES,
  DEFAULT_PROMPT,
  TYPE_LABELS,
  buildBatchMessages,
  buildJsonRepairMessages,
  cardFingerprint,
  createSourceBatches,
  exportAnkiBasic,
  exportAnkiCloze,
  exportCardsJson,
  exportUniversalTsv,
  extractCompletionContent,
  normalizeCard,
  parseGeneratedCards,
  parseInput,
} from "./core.js";
import {
  ANKI_BASE_CSS,
  ANKI_NOTE_DEFINITIONS,
  buildAnkiNote,
  createModelParams,
  modelFieldMigrationActions,
  updateTemplateParams,
} from "./anki.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const SOURCE_PAGE_SIZE = 24;
const RESULT_PAGE_SIZE = 16;

const state = {
  filename: "",
  metadata: {},
  sources: [],
  sourcePage: 1,
  sourceSearch: "",
  results: [],
  resultPage: 1,
  resultSearch: "",
  resultFilter: "all",
  run: null,
  lastFailedBatches: [],
  anki: { connected: false, importing: false, modelNames: new Set(), modelFields: new Map(), deckNames: [] },
};

const dom = {
  stageTabs: $$(".stage-tab"),
  stagePanels: $$(".stage-panel"),
  fileInput: $("#fileInput"),
  dropzone: $("#dropzone"),
  fileState: $("#fileState"),
  continueButton: $("#continueButton"),
  sampleButton: $("#sampleButton"),
  sourceMetrics: $("#sourceMetrics"),
  sourceSection: $("#sourceSection"),
  metricSources: $("#metricSources"),
  metricSelected: $("#metricSelected"),
  metricFormat: $("#metricFormat"),
  metricDeck: $("#metricDeck"),
  sourceCountLabel: $("#sourceCountLabel"),
  sourceRows: $("#sourceRows"),
  sourcePageLabel: $("#sourcePageLabel"),
  sourcePrev: $("#sourcePrev"),
  sourceNext: $("#sourceNext"),
  sourceSearch: $("#sourceSearch"),
  toggleAllSources: $("#toggleAllSources"),
  generateSelectionState: $("#generateSelectionState"),
  baseUrl: $("#baseUrl"),
  apiKey: $("#apiKey"),
  model: $("#model"),
  jsonMode: $("#jsonMode"),
  rememberKey: $("#rememberKey"),
  forgetKeyButton: $("#forgetKeyButton"),
  toggleKey: $("#toggleKey"),
  testApiButton: $("#testApiButton"),
  apiStatus: $("#apiStatus"),
  promptEditor: $("#promptEditor"),
  promptLength: $("#promptLength"),
  resetPrompt: $("#resetPrompt"),
  preference: $("#preference"),
  cardsPerSource: $("#cardsPerSource"),
  batchSize: $("#batchSize"),
  concurrency: $("#concurrency"),
  startButton: $("#startButton"),
  pauseButton: $("#pauseButton"),
  stopButton: $("#stopButton"),
  runTitle: $("#runTitle"),
  runCompleted: $("#runCompleted"),
  runTotal: $("#runTotal"),
  runProgress: $("#runProgress"),
  runCards: $("#runCards"),
  runWarnings: $("#runWarnings"),
  runFailed: $("#runFailed"),
  runLog: $("#runLog"),
  runIndicator: $("#runIndicator"),
  resultState: $("#resultState"),
  validCards: $("#validCards"),
  validRate: $("#validRate"),
  distribution: $("#distribution"),
  resultFilters: $("#resultFilters"),
  resultSearch: $("#resultSearch"),
  emptyResults: $("#emptyResults"),
  resultList: $("#resultList"),
  resultPagination: $("#resultPagination"),
  resultPageLabel: $("#resultPageLabel"),
  resultPrev: $("#resultPrev"),
  resultNext: $("#resultNext"),
  exportMenu: $("#exportMenu"),
  cardDialog: $("#cardDialog"),
  cardForm: $("#cardForm"),
  editCardId: $("#editCardId"),
  editType: $("#editType"),
  editQuestion: $("#editQuestion"),
  editContent: $("#editContent"),
  editAnswer: $("#editAnswer"),
  editOptions: $("#editOptions"),
  editRemark: $("#editRemark"),
  editTags: $("#editTags"),
  dialogIssues: $("#dialogIssues"),
  ankiDialog: $("#ankiDialog"),
  ankiConnectionDot: $("#ankiConnectionDot"),
  ankiConnectionTitle: $("#ankiConnectionTitle"),
  ankiConnectionDetail: $("#ankiConnectionDetail"),
  ankiRefreshButton: $("#ankiRefreshButton"),
  ankiDeck: $("#ankiDeck"),
  ankiDeckOptions: $("#ankiDeckOptions"),
  ankiCardCount: $("#ankiCardCount"),
  ankiExcludedCount: $("#ankiExcludedCount"),
  ankiModelList: $("#ankiModelList"),
  ankiSyncTemplates: $("#ankiSyncTemplates"),
  ankiProgress: $("#ankiProgress"),
  ankiProgressText: $("#ankiProgressText"),
  ankiProgressCount: $("#ankiProgressCount"),
  ankiProgressBar: $("#ankiProgressBar"),
  ankiIssues: $("#ankiIssues"),
  ankiImportButton: $("#ankiImportButton"),
  toastRegion: $("#toastRegion"),
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function toast(message, kind = "info") {
  const item = document.createElement("div");
  item.className = `toast${kind === "error" ? " is-error" : ""}`;
  item.textContent = message;
  dom.toastRegion.append(item);
  setTimeout(() => item.remove(), 3600);
}

function setStage(stage) {
  dom.stageTabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.stage === stage));
  dom.stagePanels.forEach((panel) => panel.classList.toggle("is-active", panel.id === `stage-${stage}`));
  if (stage === "generate") updateRunPanel();
  if (stage === "results") renderResults();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function selectedSources() {
  return state.sources.filter((source) => source.selected);
}

function filteredSources() {
  const needle = state.sourceSearch.trim().toLowerCase();
  if (!needle) return state.sources;
  return state.sources.filter((source) => [source.title, source.material, ...source.tags].join(" ").toLowerCase().includes(needle));
}

function renderSourceMetrics() {
  const selected = selectedSources().length;
  dom.metricSources.textContent = state.sources.length.toLocaleString("zh-CN");
  dom.metricSelected.textContent = selected.toLocaleString("zh-CN");
  dom.metricFormat.textContent = state.sources[0]?.sourceType || "—";
  dom.metricDeck.textContent = state.metadata.deck || "未指定";
  dom.generateSelectionState.textContent = `${selected} 条材料待处理`;
  dom.continueButton.disabled = selected === 0;
}

function renderSources() {
  const filtered = filteredSources();
  const pages = Math.max(1, Math.ceil(filtered.length / SOURCE_PAGE_SIZE));
  state.sourcePage = Math.min(Math.max(1, state.sourcePage), pages);
  const start = (state.sourcePage - 1) * SOURCE_PAGE_SIZE;
  const visible = filtered.slice(start, start + SOURCE_PAGE_SIZE);
  dom.sourceRows.innerHTML = visible.map((source) => `
    <tr>
      <td class="check-cell"><input type="checkbox" data-source-id="${escapeHtml(source.id)}" ${source.selected ? "checked" : ""} aria-label="选择材料 ${source.index}"></td>
      <td><div class="source-title" title="${escapeHtml(source.title)}">${escapeHtml(source.title)}</div><div class="source-subtitle">${escapeHtml(source.material.replace(/\n/g, " · "))}</div></td>
      <td><div class="tag-list">${source.tags.slice(0, 4).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("") || '<span class="tag">无标签</span>'}</div></td>
      <td class="index-cell">${source.id}</td>
    </tr>`).join("");
  dom.sourceCountLabel.textContent = state.sourceSearch ? `${filtered.length} 条匹配` : `${filtered.length} 条`;
  dom.sourcePageLabel.textContent = `${state.sourcePage} / ${pages}`;
  dom.sourcePrev.disabled = state.sourcePage <= 1;
  dom.sourceNext.disabled = state.sourcePage >= pages;
  const allFilteredSelected = filtered.length > 0 && filtered.every((source) => source.selected);
  dom.toggleAllSources.textContent = allFilteredSelected ? "取消全选" : "选择全部";
  renderSourceMetrics();
}

function applyParsedInput(parsed, filename) {
  state.filename = filename;
  state.metadata = parsed.metadata;
  state.sources = parsed.sources;
  state.sourcePage = 1;
  state.sourceSearch = "";
  dom.sourceSearch.value = "";
  dom.fileState.textContent = `${filename} · ${state.sources.length} 条`;
  dom.sourceMetrics.hidden = false;
  dom.sourceSection.hidden = false;
  renderSources();
  toast(`已载入 ${state.sources.length} 条材料`);
}

async function importFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    applyParsedInput(parseInput(text, file.name), file.name);
  } catch (error) {
    toast(error.message || "文件解析失败", "error");
  } finally {
    dom.fileInput.value = "";
  }
}

function loadSample() {
  const rows = [
    ["什么是存储程序思想？", "程序像数据一样预先存入存储器并自动取指执行。", "计算机组成原理"],
    ["ENIAC 是否属于存储程序计算机？", "不属于；它通过人工插拔电线和开关编程。", "计算机史"],
    ["ISA 在计算机系统中处于什么位置？", "ISA 是软件与硬件的分界线，相同 ISA 保证机器语言程序兼容。", "体系结构"],
    ["数列收敛的必要条件是什么？", "若数列收敛，则它必有界。", "微积分"],
    ["函数的自然定义域是什么？", "使函数表达式有意义的最大输入集合。", "函数"],
  ];
  const text = ["Question\tAnswer\tTags", ...rows.map((row) => row.join("\t"))].join("\n");
  applyParsedInput(parseInput(text, "socratopia-sample.tsv"), "socratopia-sample.tsv");
}

function allowedTypes() {
  return $$("#typePicker input:checked").map((input) => input.value);
}

function currentConfig() {
  return {
    baseUrl: dom.baseUrl.value.trim(),
    apiKey: dom.apiKey.value.trim(),
    model: dom.model.value.trim(),
    responseFormat: dom.jsonMode.checked ? "json_object" : undefined,
  };
}

function validateApiConfig() {
  const config = currentConfig();
  if (!config.baseUrl) throw new Error("请填写 API 地址");
  if (!config.apiKey) throw new Error("请填写 API Key");
  if (!config.model) throw new Error("请填写模型名称");
  return config;
}

function validateGeneration() {
  const config = validateApiConfig();
  if (!selectedSources().length) throw new Error("请先选择学习材料");
  if (!allowedTypes().length) throw new Error("至少选择一种卡型");
  if (!dom.promptEditor.value.trim()) throw new Error("生成提示词不能为空");
  return config;
}

async function callApi(messages, signal) {
  const config = currentConfig();
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...config, messages, temperature: 0.2 }),
    signal,
  });
  const payload = await response.json().catch(() => ({ error: { message: `请求失败 (${response.status})` } }));
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `请求失败 (${response.status})`);
  return payload;
}

async function testApi() {
  try {
    validateApiConfig();
  } catch (error) {
    dom.apiStatus.textContent = error.message;
    return;
  }
  dom.testApiButton.disabled = true;
  dom.apiStatus.textContent = "连接中…";
  try {
    await callApi([
      { role: "system", content: "只输出合法 JSON。" },
      { role: "user", content: '输出 {"cards":[]}' },
    ]);
    dom.apiStatus.textContent = "连接成功";
    toast("API 连接成功");
  } catch (error) {
    dom.apiStatus.textContent = error.message;
    toast(error.message, "error");
  } finally {
    dom.testApiButton.disabled = false;
  }
}

function timeLabel() {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
}

function logRun(message) {
  if (dom.runLog.textContent.includes("任务尚未开始")) dom.runLog.innerHTML = "";
  const item = document.createElement("p");
  const time = document.createElement("time");
  const text = document.createElement("span");
  time.textContent = timeLabel();
  text.textContent = message;
  item.append(time, text);
  dom.runLog.append(item);
  dom.runLog.scrollTop = dom.runLog.scrollHeight;
}

function updateRunPanel() {
  const run = state.run;
  const selected = selectedSources().length;
  dom.generateSelectionState.textContent = `${selected} 条材料待处理`;
  if (!run) {
    dom.runTotal.textContent = "0";
    dom.runCompleted.textContent = "0";
    dom.runProgress.style.width = "0%";
    dom.runCards.textContent = state.results.length;
    dom.runWarnings.textContent = state.results.filter((card) => card.issues.length).length;
    dom.runFailed.textContent = state.lastFailedBatches.length;
    return;
  }
  const finished = run.completed + run.failed.length;
  const percent = run.batches.length ? Math.round((finished / run.batches.length) * 100) : 0;
  dom.runCompleted.textContent = finished;
  dom.runTotal.textContent = run.batches.length;
  dom.runProgress.style.width = `${percent}%`;
  dom.runCards.textContent = state.results.length;
  dom.runWarnings.textContent = state.results.filter((card) => card.issues.length).length;
  dom.runFailed.textContent = run.failed.length;
  dom.runIndicator.classList.toggle("is-running", run.active && !run.paused);
  dom.runTitle.textContent = run.cancelled ? "任务已停止" : run.paused ? "任务已暂停" : run.active ? "正在生成卡片" : run.failed.length ? "部分批次失败" : "生成已完成";
  dom.startButton.disabled = run.active;
  dom.pauseButton.disabled = !run.active;
  dom.stopButton.disabled = !run.active;
  dom.pauseButton.textContent = run.paused ? "继续" : "暂停";
  if (!run.active) dom.startButton.textContent = run.failed.length ? `重试 ${run.failed.length} 批` : "再次生成";
  else dom.startButton.textContent = "生成中";
}

function mergeGeneratedCards(cards, batchSources) {
  const sourceMap = new Map(batchSources.map((source) => [source.id, source]));
  const existing = new Set(state.results.map(cardFingerprint));
  for (const card of cards) {
    const source = sourceMap.get(card.sourceId);
    if (source) card.tags = [...new Set([...card.tags, ...source.tags])];
    const fingerprint = cardFingerprint(card);
    if (existing.has(fingerprint)) card.issues.push("疑似重复卡片");
    existing.add(fingerprint);
    state.results.push(card);
  }
}

function sourceRange(sources) {
  return `${sources[0].id}—${sources.at(-1).id}`;
}

function responseWasTruncated(response) {
  const reason = String(response?.choices?.[0]?.finish_reason || response?.status || "").toLowerCase();
  return ["length", "max_tokens", "incomplete"].includes(reason);
}

async function generateCardsForSources(sources, signal, types, workerIndex) {
  const messages = buildBatchMessages({
    sources,
    prompt: dom.promptEditor.value,
    allowedTypes: types,
    cardsPerSource: dom.cardsPerSource.value,
    preference: dom.preference.value,
  });
  const response = await callApi(messages, signal);
  const truncated = responseWasTruncated(response);

  if (!truncated) {
    try {
      return parseGeneratedCards(response, types);
    } catch (error) {
      if (error.code !== "MODEL_OUTPUT_INVALID") throw error;
      logRun(`${sourceRange(sources)}：JSON 格式异常，正在自动修复`);
      try {
        const repaired = await callApi(buildJsonRepairMessages(extractCompletionContent(response)), signal);
        if (!responseWasTruncated(repaired)) return parseGeneratedCards(repaired, types);
      } catch (repairError) {
        if (repairError.name === "AbortError") throw repairError;
        if (repairError.code !== "MODEL_OUTPUT_INVALID") throw repairError;
      }
    }
  } else {
    logRun(`${sourceRange(sources)}：模型输出被截断，正在缩小批次`);
  }

  if (sources.length === 1) {
    throw new Error(truncated ? "单条材料的模型输出仍被截断" : "JSON 自动修复失败");
  }
  const midpoint = Math.ceil(sources.length / 2);
  const groups = [sources.slice(0, midpoint), sources.slice(midpoint)];
  logRun(`工作流 ${workerIndex + 1}：将 ${sourceRange(sources)} 拆为 ${groups.map(sourceRange).join("、")}`);
  const cards = [];
  for (const group of groups) {
    cards.push(...await generateCardsForSources(group, signal, types, workerIndex));
  }
  return cards;
}

async function processBatch(batch, run, workerIndex) {
  const controller = new AbortController();
  run.controllers.add(controller);
  const types = allowedTypes();
  try {
    logRun(`工作流 ${workerIndex + 1}：处理 ${sourceRange(batch.sources)}`);
    const cards = await generateCardsForSources(batch.sources, controller.signal, types, workerIndex);
    mergeGeneratedCards(cards, batch.sources);
    run.completed += 1;
    logRun(`${sourceRange(batch.sources)}：生成 ${cards.length} 张`);
  } catch (error) {
    if (!run.cancelled) {
      run.failed.push(batch);
      logRun(`${sourceRange(batch.sources)}：${error.message}`);
    }
  } finally {
    run.controllers.delete(controller);
    updateRunPanel();
  }
}

async function worker(run, workerIndex) {
  while (!run.cancelled) {
    while (run.paused && !run.cancelled) await new Promise((resolve) => setTimeout(resolve, 180));
    if (run.cancelled) return;
    const batchIndex = run.nextIndex;
    run.nextIndex += 1;
    if (batchIndex >= run.batches.length) return;
    await processBatch(run.batches[batchIndex], run, workerIndex);
  }
}

async function startRun() {
  let config;
  try {
    config = validateGeneration();
  } catch (error) {
    toast(error.message, "error");
    return;
  }
  void config;
  const retry = state.lastFailedBatches.length > 0 && state.run && !state.run.active;
  const batches = retry
    ? state.lastFailedBatches
    : createSourceBatches(selectedSources(), dom.batchSize.value).map((sources, index) => ({ id: index + 1, sources }));
  state.lastFailedBatches = [];
  const run = {
    active: true,
    paused: false,
    cancelled: false,
    batches,
    nextIndex: 0,
    completed: 0,
    failed: [],
    controllers: new Set(),
  };
  state.run = run;
  dom.runLog.innerHTML = "";
  logRun(retry ? `重试 ${batches.length} 个失败批次` : `开始处理 ${selectedSources().length} 条材料`);
  updateRunPanel();
  persistSettings();
  const count = Math.min(Number(dom.concurrency.value), batches.length);
  await Promise.all(Array.from({ length: count }, (_, index) => worker(run, index)));
  run.active = false;
  state.lastFailedBatches = [...run.failed];
  updateRunPanel();
  renderResults();
  if (run.cancelled) {
    logRun("任务已停止");
    toast("生成任务已停止");
  } else {
    logRun(run.failed.length ? `任务结束，${run.failed.length} 个批次失败` : "全部批次处理完成");
    toast(run.failed.length ? `完成，${run.failed.length} 个批次待重试` : `已生成 ${state.results.length} 张卡片`, run.failed.length ? "error" : "info");
    setStage("results");
  }
}

function togglePause() {
  if (!state.run?.active) return;
  state.run.paused = !state.run.paused;
  logRun(state.run.paused ? "暂停派发新批次" : "继续生成");
  updateRunPanel();
}

function stopRun() {
  if (!state.run?.active) return;
  state.run.cancelled = true;
  state.run.controllers.forEach((controller) => controller.abort());
  updateRunPanel();
}

function filteredResults() {
  const needle = state.resultSearch.trim().toLowerCase();
  return state.results.filter((card) => {
    const filterMatches = state.resultFilter === "all"
      || card.type === state.resultFilter
      || (state.resultFilter === "warning" && card.issues.length > 0);
    const haystack = [card.fields.question, card.fields.content, card.fields.answer, card.fields.remark, ...card.fields.options, ...card.tags].join(" ").toLowerCase();
    return filterMatches && (!needle || haystack.includes(needle));
  });
}

function renderDistribution() {
  const total = state.results.length;
  dom.distribution.innerHTML = CARD_TYPES.map((type) => {
    const count = state.results.filter((card) => card.type === type).length;
    const width = total ? Math.round((count / total) * 100) : 0;
    return `<div class="dist-item"><span>${TYPE_LABELS[type]} <b>${count}</b></span><div class="dist-bar"><i style="width:${width}%"></i></div></div>`;
  }).join("");
}

function resultCardHtml(card) {
  const prompt = card.type === "cloze" ? card.fields.content : card.fields.question;
  const answer = card.type === "cloze" ? card.fields.remark : card.fields.answer;
  const options = ["choice", "multichoice"].includes(card.type) && card.fields.options.length
    ? `<ol class="result-options">${card.fields.options.map((option) => `<li>${escapeHtml(option)}</li>`).join("")}</ol>` : "";
  return `<article class="result-card" data-card-id="${escapeHtml(card.id)}">
    <div class="result-type"><b>${escapeHtml(card.type)}</b><span>${escapeHtml(card.sourceId || "NO SOURCE")}</span></div>
    <div class="result-main"><h3>${escapeHtml(prompt || "未填写")}</h3><p>${escapeHtml(answer || "")}${answer && card.fields.remark && card.type !== "cloze" ? " · " : ""}${card.type !== "cloze" ? escapeHtml(card.fields.remark) : ""}</p>${options}</div>
    <div class="result-tags">${card.tags.slice(0, 6).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
    <div class="result-actions"><button class="icon-button" data-action="edit" title="编辑卡片" aria-label="编辑卡片">✎</button><button class="icon-button" data-action="delete" title="删除卡片" aria-label="删除卡片">×</button></div>
    ${card.issues.length ? `<div class="result-warning">${escapeHtml(card.issues.join(" · "))}</div>` : ""}
  </article>`;
}

function renderResults() {
  const total = state.results.length;
  const valid = state.results.filter((card) => !card.issues.length).length;
  const warnings = total - valid;
  dom.resultState.textContent = `${total} 张卡片`;
  dom.validCards.textContent = valid;
  dom.validRate.textContent = total ? `通过率 ${Math.round((valid / total) * 100)}% · ${warnings} 条告警` : "通过率 —";
  renderDistribution();

  const counts = Object.fromEntries(CARD_TYPES.map((type) => [type, state.results.filter((card) => card.type === type).length]));
  $$("button", dom.resultFilters).forEach((button) => {
    const filter = button.dataset.filter;
    const count = filter === "all" ? total : filter === "warning" ? warnings : counts[filter] || 0;
    $("b", button).textContent = count;
    button.classList.toggle("is-active", filter === state.resultFilter);
  });

  const filtered = filteredResults();
  const pages = Math.max(1, Math.ceil(filtered.length / RESULT_PAGE_SIZE));
  state.resultPage = Math.min(Math.max(1, state.resultPage), pages);
  const start = (state.resultPage - 1) * RESULT_PAGE_SIZE;
  dom.resultList.innerHTML = filtered.slice(start, start + RESULT_PAGE_SIZE).map(resultCardHtml).join("");
  dom.emptyResults.hidden = total > 0;
  dom.resultList.hidden = total === 0;
  dom.resultPagination.hidden = filtered.length <= RESULT_PAGE_SIZE;
  dom.resultPageLabel.textContent = `${state.resultPage} / ${pages}`;
  dom.resultPrev.disabled = state.resultPage <= 1;
  dom.resultNext.disabled = state.resultPage >= pages;
}

function updateEditFields() {
  const type = dom.editType.value;
  $(".edit-question", dom.cardForm).hidden = type === "cloze";
  $(".edit-content", dom.cardForm).hidden = type !== "cloze";
  $(".edit-answer", dom.cardForm).hidden = type === "cloze";
  $(".edit-options", dom.cardForm).hidden = !["choice", "multichoice"].includes(type);
}

function openEditor(card) {
  dom.editCardId.value = card.id;
  dom.editType.value = card.type;
  dom.editQuestion.value = card.fields.question;
  dom.editContent.value = card.fields.content;
  dom.editAnswer.value = card.fields.answer;
  dom.editOptions.value = card.fields.options.join("\n");
  dom.editRemark.value = card.fields.remark;
  dom.editTags.value = card.tags.join(" ");
  dom.dialogIssues.style.display = card.issues.length ? "block" : "none";
  dom.dialogIssues.textContent = card.issues.join(" · ");
  updateEditFields();
  dom.cardDialog.showModal();
}

function saveEditedCard(event) {
  event.preventDefault();
  const index = state.results.findIndex((card) => card.id === dom.editCardId.value);
  if (index < 0) return;
  const original = state.results[index];
  const updated = normalizeCard({
    id: original.id,
    source_id: original.sourceId,
    type: dom.editType.value,
    fields: {
      question: dom.editQuestion.value,
      content: dom.editContent.value,
      answer: dom.editAnswer.value,
      options: dom.editOptions.value,
      remark: dom.editRemark.value,
    },
    tags: dom.editTags.value,
  });
  state.results[index] = updated;
  dom.cardDialog.close();
  renderResults();
  updateRunPanel();
  toast(updated.issues.length ? "卡片已保存，仍有质量告警" : "卡片已保存");
}

function deleteCard(cardId) {
  const index = state.results.findIndex((card) => card.id === cardId);
  if (index < 0) return;
  state.results.splice(index, 1);
  renderResults();
  updateRunPanel();
  toast("卡片已删除");
}

function safeFilename(value) {
  return String(value || "socratopia-rich").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "-");
}

function downloadText(filename, content, type) {
  const blob = new Blob(["\uFEFF", content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportResults(format) {
  const validCards = state.results.filter((card) => !card.issues.length);
  if (format === "anki") {
    if (!validCards.length) {
      toast("没有可导入 Anki 的无告警卡片", "error");
      return;
    }
    dom.exportMenu.open = false;
    openAnkiDialog();
    return;
  }
  if (!validCards.length) {
    toast("没有可导出的无告警卡片", "error");
    return;
  }
  const base = `${safeFilename(state.filename)}-rich`;
  const exporters = {
    json: { filename: `${base}.json`, content: () => exportCardsJson(validCards), mime: "application/json" },
    universal: { filename: `${base}-unified.tsv`, content: () => exportUniversalTsv(validCards), mime: "text/tab-separated-values" },
    basic: { filename: `${base}-basic.tsv`, content: () => exportAnkiBasic(validCards), mime: "text/tab-separated-values", count: validCards.filter((card) => card.type !== "cloze").length },
    cloze: { filename: `${base}-cloze.tsv`, content: () => exportAnkiCloze(validCards), mime: "text/tab-separated-values", count: validCards.filter((card) => card.type === "cloze").length },
  };
  const selected = exporters[format];
  if (!selected) return;
  if (selected.count === 0) {
    toast(format === "cloze" ? "没有可导出的填空卡" : "没有可导出的非填空卡", "error");
    return;
  }
  downloadText(selected.filename, selected.content(), selected.mime);
  dom.exportMenu.open = false;
  const excluded = state.results.length - validCards.length;
  toast(excluded ? `导出完成，已排除 ${excluded} 张告警卡` : "导出完成");
}

function validResultCards() {
  return state.results.filter((card) => !card.issues.length);
}

async function invokeAnki(action, params = {}) {
  const response = await fetch("/api/anki", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  const payload = await response.json().catch(() => ({ error: `AnkiConnect 请求失败 (${response.status})`, result: null }));
  if (!response.ok || payload.error) throw new Error(payload.error || `AnkiConnect 请求失败 (${response.status})`);
  return payload.result;
}

function setAnkiConnection(kind, title, detail) {
  dom.ankiConnectionDot.className = kind === "connected" ? "is-connected" : kind === "error" ? "is-error" : "";
  dom.ankiConnectionTitle.textContent = title;
  dom.ankiConnectionDetail.textContent = detail;
}

function showAnkiIssue(message = "") {
  dom.ankiIssues.textContent = message;
  dom.ankiIssues.style.display = message ? "block" : "none";
}

function renderAnkiModels() {
  dom.ankiModelList.innerHTML = Object.values(ANKI_NOTE_DEFINITIONS).map((definition) => {
    if (!state.anki.modelNames.has(definition.modelName)) {
      return `<div class="anki-model-row"><span>${escapeHtml(definition.modelName)}</span><b>待创建</b></div>`;
    }
    let label = "已就绪";
    try {
      if (modelFieldMigrationActions(definition, state.anki.modelFields.get(definition.modelName)).length) label = "待同步";
    } catch {
      label = "需处理";
    }
    return `<div class="anki-model-row"><span>${escapeHtml(definition.modelName)}</span><b class="${label === "已就绪" ? "is-ready" : ""}">${label}</b></div>`;
  }).join("");
}

function updateAnkiImportButton() {
  dom.ankiImportButton.disabled = !state.anki.connected
    || state.anki.importing
    || !dom.ankiDeck.value.trim()
    || validResultCards().length === 0;
}

async function refreshAnkiConnection() {
  state.anki.connected = false;
  dom.ankiRefreshButton.disabled = true;
  dom.ankiSyncTemplates.disabled = true;
  setAnkiConnection("pending", "正在检测 Anki", "127.0.0.1:8765");
  showAnkiIssue();
  updateAnkiImportButton();
  try {
    const version = await invokeAnki("version");
    const [deckNames, modelNames] = await Promise.all([invokeAnki("deckNames"), invokeAnki("modelNames")]);
    state.anki.connected = true;
    state.anki.deckNames = Array.isArray(deckNames) ? deckNames.sort((a, b) => a.localeCompare(b, "zh-CN")) : [];
    state.anki.modelNames = new Set(Array.isArray(modelNames) ? modelNames : []);
    state.anki.modelFields = new Map(await Promise.all(
      Object.values(ANKI_NOTE_DEFINITIONS)
        .filter((definition) => state.anki.modelNames.has(definition.modelName))
        .map(async (definition) => [
          definition.modelName,
          await invokeAnki("modelFieldNames", { modelName: definition.modelName }),
        ]),
    ));
    dom.ankiDeckOptions.innerHTML = state.anki.deckNames.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
    setAnkiConnection("connected", "AnkiConnect 已连接", `API ${version} · ${state.anki.deckNames.length} 个牌组`);
    dom.ankiSyncTemplates.disabled = false;
    renderAnkiModels();
  } catch (error) {
    state.anki.modelNames = new Set();
    state.anki.modelFields = new Map();
    setAnkiConnection("error", "无法连接 AnkiConnect", "请打开 Anki 并确认插件正在运行");
    showAnkiIssue(error.message);
    renderAnkiModels();
  } finally {
    dom.ankiRefreshButton.disabled = false;
    updateAnkiImportButton();
  }
}

function openAnkiDialog() {
  const valid = validResultCards();
  dom.ankiCardCount.textContent = valid.length;
  dom.ankiExcludedCount.textContent = state.results.length - valid.length;
  dom.ankiProgress.hidden = true;
  dom.ankiProgressBar.style.width = "0%";
  showAnkiIssue();
  if (!dom.ankiDeck.value) {
    dom.ankiDeck.value = localStorage.getItem("socratopia-anki-deck")
      || state.metadata.deck
      || "Socratopia Rich";
  }
  state.anki.modelNames = new Set();
  state.anki.modelFields = new Map();
  renderAnkiModels();
  dom.ankiDialog.showModal();
  refreshAnkiConnection();
}

async function ensureAnkiModels(updateExisting = false) {
  const existing = new Set(await invokeAnki("modelNames"));
  const definitions = Object.values(ANKI_NOTE_DEFINITIONS);
  const fieldPlans = new Map();

  // Validate every existing model before changing any of them, so a conflict
  // cannot leave a partially migrated set of Socratopia note types.
  for (const definition of definitions) {
    if (!existing.has(definition.modelName)) continue;
    const currentFields = await invokeAnki("modelFieldNames", { modelName: definition.modelName });
    const migrations = modelFieldMigrationActions(definition, currentFields);
    fieldPlans.set(definition.modelName, { currentFields, migrations });
    if (migrations.length && !updateExisting) {
      throw new Error(`${definition.modelName} 仍使用旧字段，请先点击“同步模板”完成字段迁移`);
    }
  }

  let created = 0;
  let updated = 0;
  for (const definition of definitions) {
    if (!existing.has(definition.modelName)) {
      await invokeAnki("createModel", createModelParams(definition));
      existing.add(definition.modelName);
      state.anki.modelFields.set(definition.modelName, [...definition.fields]);
      created += 1;
    } else {
      const { currentFields, migrations } = fieldPlans.get(definition.modelName);
      if (updateExisting) {
        for (const migration of migrations.filter(({ action }) => action === "modelFieldRename")) {
          await invokeAnki(migration.action, migration.params);
        }
        await invokeAnki("updateModelStyling", { model: { name: definition.modelName, css: ANKI_BASE_CSS } });
        await invokeAnki("updateModelTemplates", { model: updateTemplateParams(definition) });
        for (const migration of migrations.filter(({ action }) => action === "modelFieldRemove")) {
          await invokeAnki(migration.action, migration.params);
        }
        state.anki.modelFields.set(definition.modelName, [...definition.fields]);
        updated += 1;
      } else {
        state.anki.modelFields.set(definition.modelName, currentFields);
      }
    }
  }
  state.anki.modelNames = existing;
  renderAnkiModels();
  return { created, updated };
}

async function syncAnkiTemplates() {
  if (!state.anki.connected || state.anki.importing) return;
  const confirmed = window.confirm("这会覆盖现有 Socratopia 笔记类型的模板和 CSS，将 Remark 重命名为 Note，并删除 Source 字段及其中的现有内容。是否继续？");
  if (!confirmed) return;
  dom.ankiSyncTemplates.disabled = true;
  showAnkiIssue();
  try {
    const result = await ensureAnkiModels(true);
    toast(`模板同步完成：新建 ${result.created} 个，更新 ${result.updated} 个`);
  } catch (error) {
    showAnkiIssue(error.message);
  } finally {
    dom.ankiSyncTemplates.disabled = false;
  }
}

function setAnkiProgress(completed, total, label = "正在导入") {
  dom.ankiProgress.hidden = false;
  dom.ankiProgressText.textContent = label;
  dom.ankiProgressCount.textContent = `${completed} / ${total}`;
  dom.ankiProgressBar.style.width = `${total ? Math.round((completed / total) * 100) : 0}%`;
}

async function importCardsToAnki() {
  if (!state.anki.connected || state.anki.importing) return;
  const deckName = dom.ankiDeck.value.trim();
  const cards = validResultCards();
  if (!deckName || !cards.length) return;
  state.anki.importing = true;
  dom.ankiRefreshButton.disabled = true;
  dom.ankiSyncTemplates.disabled = true;
  updateAnkiImportButton();
  showAnkiIssue();
  setAnkiProgress(0, cards.length, "准备笔记类型");
  try {
    await ensureAnkiModels(false);
    await invokeAnki("createDeck", { deck: deckName });
    const notes = cards.map((card) => buildAnkiNote(card, deckName));
    let added = 0;
    let skipped = 0;
    let failed = 0;
    const chunkSize = 100;
    for (let start = 0; start < notes.length; start += chunkSize) {
      const chunk = notes.slice(start, start + chunkSize);
      const canAdd = await invokeAnki("canAddNotes", { notes: chunk });
      if (!Array.isArray(canAdd) || canAdd.length !== chunk.length) throw new Error("Anki 未返回有效的去重结果");
      const addable = chunk.filter((_, index) => canAdd[index]);
      skipped += chunk.length - addable.length;
      if (addable.length) {
        const noteIds = await invokeAnki("addNotes", { notes: addable });
        if (!Array.isArray(noteIds) || noteIds.length !== addable.length) throw new Error("Anki 未返回有效的导入结果");
        added += noteIds.filter((id) => Number.isInteger(id)).length;
        failed += noteIds.filter((id) => !Number.isInteger(id)).length;
      }
      setAnkiProgress(Math.min(start + chunk.length, notes.length), notes.length);
    }
    localStorage.setItem("socratopia-anki-deck", deckName);
    setAnkiProgress(cards.length, cards.length, "导入完成");
    const summary = `已导入 ${added} 张，跳过 ${skipped} 张${failed ? `，失败 ${failed} 张` : ""}`;
    setAnkiConnection("connected", "Anki 导入完成", summary);
    toast(summary, failed ? "error" : "info");
  } catch (error) {
    showAnkiIssue(error.message);
    setAnkiConnection("error", "Anki 导入失败", error.message);
  } finally {
    state.anki.importing = false;
    dom.ankiRefreshButton.disabled = false;
    dom.ankiSyncTemplates.disabled = !state.anki.connected;
    updateAnkiImportButton();
  }
}

function persistSettings() {
  const settings = {
    version: 3,
    baseUrl: dom.baseUrl.value.trim(),
    apiKey: dom.rememberKey.checked ? dom.apiKey.value.trim() : "",
    rememberKey: dom.rememberKey.checked,
    model: dom.model.value.trim(),
    jsonMode: dom.jsonMode.checked,
    preference: dom.preference.value,
    cardsPerSource: dom.cardsPerSource.value,
    batchSize: dom.batchSize.value,
    concurrency: dom.concurrency.value,
    prompt: dom.promptEditor.value,
    types: allowedTypes(),
  };
  localStorage.setItem("socratopia-card-forge-settings", JSON.stringify(settings));
}

function restoreSettings() {
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem("socratopia-card-forge-settings") || "{}"); } catch { settings = {}; }
  dom.baseUrl.value = settings.baseUrl || dom.baseUrl.value;
  dom.rememberKey.checked = settings.rememberKey !== false;
  dom.apiKey.value = dom.rememberKey.checked ? (settings.apiKey || "") : "";
  dom.model.value = settings.model || dom.model.value;
  dom.jsonMode.checked = Boolean(settings.jsonMode);
  dom.preference.value = settings.preference || "balanced";
  const currentSettings = settings.version >= 2;
  dom.cardsPerSource.value = currentSettings ? (settings.cardsPerSource || "auto") : "auto";
  dom.batchSize.value = currentSettings ? (settings.batchSize || "auto") : "auto";
  dom.concurrency.value = settings.concurrency || "2";
  dom.promptEditor.value = settings.prompt || DEFAULT_PROMPT;
  if (Array.isArray(settings.types) && settings.types.length) {
    $$("#typePicker input").forEach((input) => { input.checked = settings.types.includes(input.value); });
  }
  dom.promptLength.textContent = `${dom.promptEditor.value.length} 字符`;
}

function forgetApiKey() {
  dom.apiKey.value = "";
  dom.rememberKey.checked = false;
  persistSettings();
  dom.apiStatus.textContent = "已清除本机保存的 Key";
  toast("已清除本机保存的 Key");
}

function bindEvents() {
  dom.stageTabs.forEach((tab) => tab.addEventListener("click", () => setStage(tab.dataset.stage)));
  $$('[data-go-stage]').forEach((button) => button.addEventListener("click", () => setStage(button.dataset.goStage)));
  dom.continueButton.addEventListener("click", () => setStage("generate"));
  dom.sampleButton.addEventListener("click", loadSample);
  dom.fileInput.addEventListener("change", () => importFile(dom.fileInput.files[0]));
  ["dragenter", "dragover"].forEach((eventName) => dom.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dom.dropzone.classList.add("is-dragging");
  }));
  ["dragleave", "drop"].forEach((eventName) => dom.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dom.dropzone.classList.remove("is-dragging");
  }));
  dom.dropzone.addEventListener("drop", (event) => importFile(event.dataTransfer.files[0]));
  dom.sourceRows.addEventListener("change", (event) => {
    const input = event.target.closest("[data-source-id]");
    if (!input) return;
    const source = state.sources.find((item) => item.id === input.dataset.sourceId);
    if (source) source.selected = input.checked;
    renderSources();
  });
  dom.sourceSearch.addEventListener("input", () => { state.sourceSearch = dom.sourceSearch.value; state.sourcePage = 1; renderSources(); });
  dom.toggleAllSources.addEventListener("click", () => {
    const sources = filteredSources();
    const select = !sources.every((source) => source.selected);
    sources.forEach((source) => { source.selected = select; });
    renderSources();
  });
  dom.sourcePrev.addEventListener("click", () => { state.sourcePage -= 1; renderSources(); });
  dom.sourceNext.addEventListener("click", () => { state.sourcePage += 1; renderSources(); });
  dom.toggleKey.addEventListener("click", () => { dom.apiKey.type = dom.apiKey.type === "password" ? "text" : "password"; });
  [dom.baseUrl, dom.apiKey, dom.model].forEach((input) => input.addEventListener("input", persistSettings));
  dom.jsonMode.addEventListener("change", persistSettings);
  dom.rememberKey.addEventListener("change", persistSettings);
  dom.forgetKeyButton.addEventListener("click", forgetApiKey);
  dom.testApiButton.addEventListener("click", testApi);
  dom.promptEditor.addEventListener("input", () => { dom.promptLength.textContent = `${dom.promptEditor.value.length} 字符`; });
  dom.resetPrompt.addEventListener("click", () => { dom.promptEditor.value = DEFAULT_PROMPT; dom.promptLength.textContent = `${DEFAULT_PROMPT.length} 字符`; });
  dom.startButton.addEventListener("click", startRun);
  dom.pauseButton.addEventListener("click", togglePause);
  dom.stopButton.addEventListener("click", stopRun);
  dom.resultFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.resultFilter = button.dataset.filter;
    state.resultPage = 1;
    renderResults();
  });
  dom.resultSearch.addEventListener("input", () => { state.resultSearch = dom.resultSearch.value; state.resultPage = 1; renderResults(); });
  dom.resultPrev.addEventListener("click", () => { state.resultPage -= 1; renderResults(); });
  dom.resultNext.addEventListener("click", () => { state.resultPage += 1; renderResults(); });
  dom.ankiRefreshButton.addEventListener("click", refreshAnkiConnection);
  dom.ankiDeck.addEventListener("input", updateAnkiImportButton);
  dom.ankiSyncTemplates.addEventListener("click", syncAnkiTemplates);
  dom.ankiImportButton.addEventListener("click", importCardsToAnki);
  $$('[data-close-anki]').forEach((button) => button.addEventListener("click", () => {
    if (!state.anki.importing) dom.ankiDialog.close();
  }));
  dom.resultList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    const cardElement = event.target.closest("[data-card-id]");
    if (!button || !cardElement) return;
    const card = state.results.find((item) => item.id === cardElement.dataset.cardId);
    if (!card) return;
    if (button.dataset.action === "edit") openEditor(card);
    if (button.dataset.action === "delete") deleteCard(card.id);
  });
  dom.editType.addEventListener("change", updateEditFields);
  dom.cardForm.addEventListener("submit", saveEditedCard);
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => dom.cardDialog.close()));
  $$("[data-export]").forEach((button) => button.addEventListener("click", () => exportResults(button.dataset.export)));
  window.addEventListener("beforeunload", persistSettings);
}

function initialize() {
  dom.editType.innerHTML = CARD_TYPES.map((type) => `<option value="${type}">${TYPE_LABELS[type]}</option>`).join("");
  restoreSettings();
  bindEvents();
  renderSourceMetrics();
  renderResults();
  updateRunPanel();
}

initialize();
