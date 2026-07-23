import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBatchMessages,
  createSourceBatches,
  exportAnkiBasic,
  exportAnkiCloze,
  exportUniversalTsv,
  normalizeCard,
  parseGeneratedCards,
  parseInput,
} from "../public/core.js";
import { resolveChatEndpoint } from "../server.js";

test("解析 Socratopia 11 列 Anki TSV", () => {
  const row = [
    "渲染题面", "渲染答案", "", "ISA 是什么？", "输入系统", "指令集体系结构", "存储器", "编译器", "B",
    "指令集体系结构是软硬件分界线。", "Socratopia 计算机组成原理",
  ].join("\t");
  const input = ["#separator:tab", "#html:true", "#deck:Socratopia", "#tags column:11", row].join("\n");
  const parsed = parseInput(input, "deck.tsv");
  assert.equal(parsed.sources.length, 1);
  assert.equal(parsed.sources[0].title, "ISA 是什么？");
  assert.match(parsed.sources[0].material, /正确答案：指令集体系结构/);
  assert.deepEqual(parsed.sources[0].tags, ["Socratopia", "计算机组成原理"]);
  assert.equal(parsed.metadata.deck, "Socratopia");
});

test("解析带标题行和引号的通用 TSV", () => {
  const input = 'Question\tAnswer\tTags\n"带,逗号的问题"\t"第一行\n第二行"\t数学';
  const parsed = parseInput(input, "materials.tsv");
  assert.equal(parsed.sources.length, 1);
  assert.match(parsed.sources[0].material, /第一行\n第二行/);
  assert.deepEqual(parsed.sources[0].tags, ["数学"]);
});

test("严格校验不同卡型", () => {
  const judge = normalizeCard({ source_id: "S1", type: "judge", fields: { question: "陈述", answer: "是" }, tags: [] });
  assert.match(judge.issues.join(" "), /正确.*错误/);
  const cloze = normalizeCard({ source_id: "S2", type: "cloze", fields: { content: "ISA 是{{c1::软硬件分界线}}。" }, tags: [] });
  assert.deepEqual(cloze.issues, []);
  const choice = normalizeCard({ source_id: "S3", type: "choice", fields: { question: "问题", answer: "A", options: "一\n二\n三" }, tags: [] });
  assert.match(choice.issues.join(" "), /4 个选项/);
});

test("提取围栏包裹的模型 JSON", () => {
  const response = {
    choices: [{ message: { content: '```json\n{"cards":[{"source_id":"S1","type":"qa","fields":{"question":"为什么？","answer":"因为。"},"tags":["机制"]}]}\n```' } }],
  };
  const cards = parseGeneratedCards(response, ["qa"]);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].issues, []);
});

test("修复 JSON 字符串中的真实换行和尾随逗号", () => {
  const response = {
    choices: [{ message: { content: '{"cards":[{"source_id":"S1","type":"choice","fields":{"question":"问题","answer":"A","options":"一\n二\n三\n四",},"tags":[],},],}' } }],
  };
  const cards = parseGeneratedCards(response, ["choice"]);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].fields.options, ["一", "二", "三", "四"]);
  assert.deepEqual(cards[0].issues, []);
});

test("修复模型在 JSON 字符串中漏转义的双引号", () => {
  const response = {
    choices: [{ message: { content: '{"cards":[{"source_id":"S6","type":"qa","fields":{"question":"对阶为何采用"小阶向大阶看齐"原则？","answer":"避免高位丢失。"},"tags":[]}]}' } }],
  };
  const cards = parseGeneratedCards(response, ["qa"]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].fields.question, '对阶为何采用"小阶向大阶看齐"原则？');
  assert.deepEqual(cards[0].issues, []);
});

test("从额外说明中提取顶层卡片数组", () => {
  const response = {
    choices: [{ message: { content: '以下是结果：\n[{"source_id":"S1","type":"qa","fields":{"question":"Q","answer":"A"},"tags":[]}]\n完成。' } }],
  };
  const cards = parseGeneratedCards(response, ["qa"]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].sourceId, "S1");
});

test("批处理提示词包含来源编号和允许卡型", () => {
  const messages = buildBatchMessages({
    sources: [{ id: "S9", tags: ["测试"], material: "材料" }],
    prompt: "系统提示",
    allowedTypes: ["qa", "cloze"],
    cardsPerSource: 2,
    preference: "balanced",
  });
  assert.match(messages[0].content, /qa, cloze/);
  assert.match(messages[0].content, /2 张卡/);
  assert.match(messages[1].content, /"source_id": "S9"/);
});

test("AI 自主决定卡片数量时不要求固定张数", () => {
  const messages = buildBatchMessages({
    sources: [{ id: "S1", tags: [], material: "材料" }],
    prompt: "系统提示",
    allowedTypes: ["qa"],
    cardsPerSource: "auto",
    preference: "balanced",
  });
  assert.match(messages[0].content, /知识密度自主决定卡片数量/);
  assert.match(messages[0].content, /不得为了增加数量/);
});

test("自动分批同时限制材料长度和条数", () => {
  const sources = Array.from({ length: 10 }, (_, index) => ({ id: `S${index + 1}`, material: "x".repeat(1200) }));
  const batches = createSourceBatches(sources, "auto", { targetChars: 3000, maxItems: 8 });
  assert.deepEqual(batches.map((batch) => batch.length), [2, 2, 2, 2, 2]);
  assert.deepEqual(createSourceBatches(sources, "3").map((batch) => batch.length), [3, 3, 3, 1]);
});

test("导出通用、Basic 和 Cloze TSV", () => {
  const cards = [
    normalizeCard({ source_id: "S1", type: "qa", fields: { question: "Q", answer: "A" }, tags: ["t"] }),
    normalizeCard({ source_id: "S2", type: "cloze", fields: { content: "X 是{{c1::Y}}。", remark: "R" }, tags: ["t"] }),
  ];
  assert.match(exportUniversalTsv(cards), /Type\tQuestion\tContent/);
  assert.match(exportAnkiBasic(cards), /#notetype:Basic/);
  assert.doesNotMatch(exportAnkiBasic(cards), /X 是/);
  assert.match(exportAnkiCloze(cards), /#notetype:Cloze/);
  assert.match(exportAnkiCloze(cards), /\{\{c1::Y}}/);
});

test("规范化 OpenAI 兼容接口地址", () => {
  assert.equal(resolveChatEndpoint("https://api.example.com"), "https://api.example.com/v1/chat/completions");
  assert.equal(resolveChatEndpoint("https://api.example.com/v1/"), "https://api.example.com/v1/chat/completions");
  assert.equal(resolveChatEndpoint("https://relay.example.com/openai/v1"), "https://relay.example.com/openai/v1/chat/completions");
  assert.equal(resolveChatEndpoint("https://relay.example.com/v1beta/openai/chat/completions/"), "https://relay.example.com/v1beta/openai/chat/completions");
  assert.equal(resolveChatEndpoint("https://relay.example.com/openai/v1/chat/completions?x=1"), "https://relay.example.com/openai/v1/chat/completions");
  assert.throws(() => resolveChatEndpoint("file:///tmp/key"), /http/);
});
