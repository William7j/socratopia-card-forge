import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  ANKI_BASE_CSS,
  ANKI_NOTE_DEFINITIONS,
  ankiFieldsForCard,
  buildAnkiNote,
  createModelParams,
  modelFieldMigrationActions,
  updateTemplateParams,
} from "../public/anki.js";
import { normalizeCard } from "../public/core.js";
import { createAppServer } from "../server.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("五种卡型使用独立的 Socratopia 笔记类型", () => {
  assert.deepEqual(Object.keys(ANKI_NOTE_DEFINITIONS), ["qa", "cloze", "judge", "choice", "multichoice"]);
  const names = Object.values(ANKI_NOTE_DEFINITIONS).map((definition) => definition.modelName);
  assert.equal(new Set(names).size, 5);
  assert.ok(names.every((name) => name.startsWith("Socratopia::")));
  assert.equal(ANKI_NOTE_DEFINITIONS.cloze.isCloze, true);
  assert.match(ANKI_NOTE_DEFINITIONS.choice.templates[0].Front, /socratopia-options/);
  assert.match(ANKI_NOTE_DEFINITIONS.multichoice.templates[0].Front, /显示答案/);
});

test("Anki 字段映射转义 HTML、渲染代码并标注选项", () => {
  const card = normalizeCard({
    source_id: "S8",
    type: "choice",
    fields: {
      question: "<script>alert(1)</script>",
      options: ["第一项", "第二项", "第三项", "第四项"],
      answer: "第一项",
      remark: "```js\nconst x = 1;\n```",
    },
    tags: ["测试 标签"],
  });
  const fields = ankiFieldsForCard(card);
  assert.match(fields.Question, /&lt;script&gt;/);
  assert.match(fields.Options, /^A\. 第一项<br>B\. 第二项/);
  assert.match(fields.Note, /<pre><code class="language-js">/);
  const note = buildAnkiNote(card, "Socratopia");
  assert.equal(note.modelName, "Socratopia::SingleChoice");
  assert.equal("Source" in note.fields, false);
  assert.equal("Remark" in note.fields, false);
  assert.ok(note.tags.includes("测试_标签"));
  assert.equal(note.options.allowDuplicate, false);
});

test("模板创建与更新参数符合 AnkiConnect v6", () => {
  const definition = ANKI_NOTE_DEFINITIONS.qa;
  const create = createModelParams(definition);
  assert.equal(create.modelName, "Socratopia::QA");
  assert.deepEqual(create.inOrderFields, ["Question", "Answer", "Note"]);
  assert.equal(create.css, ANKI_BASE_CSS);
  const update = updateTemplateParams(definition);
  assert.equal(update.name, "Socratopia::QA");
  assert.ok(update.templates.QA.Front);
  assert.ok(update.templates.QA.Back);
  assert.match(update.templates.QA.Back, /\{\{Note}}/);
  assert.doesNotMatch(update.templates.QA.Back, /Remark|Source/);
});

test("旧版 Anki 字段迁移为 Note 并移除 Source", () => {
  const definition = ANKI_NOTE_DEFINITIONS.qa;
  assert.deepEqual(modelFieldMigrationActions(definition, ["Question", "Answer", "Remark", "Source"]), [
    {
      action: "modelFieldRename",
      params: { modelName: "Socratopia::QA", oldFieldName: "Remark", newFieldName: "Note" },
    },
    {
      action: "modelFieldRemove",
      params: { modelName: "Socratopia::QA", fieldName: "Source" },
    },
  ]);
  assert.deepEqual(modelFieldMigrationActions(definition, ["Question", "Answer", "Note"]), []);
  assert.throws(
    () => modelFieldMigrationActions(definition, ["Question", "Answer", "Remark", "Note"]),
    /无法自动合并/,
  );
});

test("本地代理转发允许的 AnkiConnect 动作并拒绝其他动作", async () => {
  const calls = [];
  const mockAnki = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    calls.push(payload);
    const body = JSON.stringify({ result: payload.action === "deckNames" ? ["Default", "学习"] : null, error: null });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(body);
  });
  const ankiPort = await listen(mockAnki);
  const app = createAppServer({ ankiConnectUrl: `http://127.0.0.1:${ankiPort}` });
  const appPort = await listen(app);
  try {
    const allowed = await fetch(`http://127.0.0.1:${appPort}/api/anki`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deckNames", params: {} }),
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { result: ["Default", "学习"], error: null });
    assert.equal(calls[0].version, 6);

    const denied = await fetch(`http://127.0.0.1:${appPort}/api/anki`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deleteDecks", params: {} }),
    });
    assert.equal(denied.status, 400);
    assert.match((await denied.json()).error, /不支持/);
    assert.equal(calls.length, 1);
  } finally {
    await close(app);
    await close(mockAnki);
  }
});
