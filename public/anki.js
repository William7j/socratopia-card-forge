const CARD_ENHANCEMENT_SCRIPT = `
<script>
(() => {
  if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise();
})();
</script>`;

const SINGLE_CHOICE_SCRIPT = `
<script>
(() => {
  const container = document.getElementById('socratopia-options');
  if (!container) return;
  const options = container.innerHTML.split(/<br\\s*\\/?\\s*>/i).filter(Boolean);
  container.innerHTML = '';
  options.forEach((option) => {
    const button = document.createElement('button');
    button.className = 'sf-option';
    button.innerHTML = option;
    button.addEventListener('click', () => pycmd('ans'));
    container.appendChild(button);
  });
})();
</script>`;

const MULTI_CHOICE_SCRIPT = `
<script>
(() => {
  const container = document.getElementById('socratopia-options');
  if (!container) return;
  const options = container.innerHTML.split(/<br\\s*\\/?\\s*>/i).filter(Boolean);
  container.innerHTML = '';
  options.forEach((option) => {
    const button = document.createElement('button');
    button.className = 'sf-option';
    button.innerHTML = option;
    button.addEventListener('click', () => button.classList.toggle('is-selected'));
    container.appendChild(button);
  });
})();
</script>`;

export const ANKI_BASE_CSS = `
.card {
  margin: 0;
  padding: 28px;
  color: #171a1f;
  background: #f4f5f2;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 20px;
  line-height: 1.58;
  text-align: left;
}
.sf-shell { max-width: 760px; margin: 0 auto; padding: 28px; border: 1px solid #dfe2e5; border-top: 5px solid var(--accent); border-radius: 6px; background: #fff; }
.sf-qa { --accent: #2f6fed; }.sf-cloze { --accent: #8eb800; }.sf-judge { --accent: #e0ad00; }.sf-choice { --accent: #ff6a4d; }.sf-multichoice { --accent: #8b63c7; }
.sf-kicker { margin-bottom: 20px; color: var(--accent); font-size: 11px; font-weight: 800; text-transform: uppercase; }
.sf-question, .sf-content { font-weight: 650; }
.sf-answer { margin-top: 24px; padding-top: 20px; border-top: 1px solid #dfe2e5; }
.sf-answer::before { content: "答案"; display: block; margin-bottom: 8px; color: var(--accent); font-size: 11px; font-weight: 800; }
.sf-note { margin-top: 18px; padding: 14px 16px; border-left: 3px solid var(--accent); background: #f7f8f6; color: #61666d; font-size: 15px; }
.sf-options { display: grid; gap: 10px; margin-top: 22px; }
.sf-option, .sf-show-answer { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid #c9cdd1; border-radius: 5px; background: #fff; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.sf-option:hover, .sf-option.is-selected { border-color: var(--accent); background: #f3f6ed; }
.sf-show-answer { margin-top: 12px; border-color: #171a1f; background: #171a1f; color: #fff; text-align: center; }
.sf-judge-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 22px; }
.sf-judge-actions .sf-option { text-align: center; }
pre { margin: 16px 0; padding: 14px; overflow-x: auto; border-radius: 5px; background: #f0f2f3; }
pre, code { font-family: "Cascadia Code", Consolas, monospace; }
code { font-size: .88em; }
@media (max-width: 520px) { .card { padding: 12px; font-size: 18px; } .sf-shell { padding: 20px; } }
@media (prefers-color-scheme: dark) {
  .card { color: #e5e7eb; background: #111317; }
  .sf-shell { border-color: #3f454d; background: #1b1f25; }
  .sf-answer { border-color: #3f454d; }
  .sf-note { background: #252a31; color: #afb5bd; }
  .sf-option { border-color: #555c66; background: #1b1f25; }
  .sf-option:hover, .sf-option.is-selected { background: #293129; }
  pre { background: #0e1013; }
}`.trim();

function frontShell(type, label, content, extra = "") {
  return `<div class="sf-shell sf-${type}"><div class="sf-kicker">${label}</div>${content}${extra}</div>${CARD_ENHANCEMENT_SCRIPT}`;
}

function backShell(type, label, content) {
  return `<div class="sf-shell sf-${type}"><div class="sf-kicker">${label}</div>${content}{{#Note}}<div class="sf-note">{{Note}}</div>{{/Note}}</div>${CARD_ENHANCEMENT_SCRIPT}`;
}

export const ANKI_NOTE_DEFINITIONS = Object.freeze({
  qa: {
    modelName: "Socratopia::QA",
    fields: ["Question", "Answer", "Note"],
    isCloze: false,
    templates: [{
      Name: "QA",
      Front: frontShell("qa", "问答", '<div class="sf-question">{{Question}}</div>'),
      Back: backShell("qa", "问答", '<div class="sf-question">{{Question}}</div><div class="sf-answer">{{Answer}}</div>'),
    }],
  },
  cloze: {
    modelName: "Socratopia::Cloze",
    fields: ["Text", "Note"],
    isCloze: true,
    templates: [{
      Name: "Cloze",
      Front: frontShell("cloze", "填空", '<div class="sf-content">{{cloze:Text}}</div>'),
      Back: backShell("cloze", "填空", '<div class="sf-content">{{cloze:Text}}</div>'),
    }],
  },
  judge: {
    modelName: "Socratopia::Judge",
    fields: ["Question", "Answer", "Note"],
    isCloze: false,
    templates: [{
      Name: "Judge",
      Front: frontShell("judge", "判断", '<div class="sf-question">{{Question}}</div>', '<div class="sf-judge-actions"><button class="sf-option" onclick="pycmd(\'ans\')">正确</button><button class="sf-option" onclick="pycmd(\'ans\')">错误</button></div>'),
      Back: backShell("judge", "判断", '<div class="sf-question">{{Question}}</div><div class="sf-answer">{{Answer}}</div>'),
    }],
  },
  choice: {
    modelName: "Socratopia::SingleChoice",
    fields: ["Question", "Options", "Answer", "Note"],
    isCloze: false,
    templates: [{
      Name: "Single Choice",
      Front: frontShell("choice", "单选", '<div class="sf-question">{{Question}}</div><div class="sf-options" id="socratopia-options">{{Options}}</div>', SINGLE_CHOICE_SCRIPT),
      Back: backShell("choice", "单选", '<div class="sf-question">{{Question}}</div><div class="sf-options">{{Options}}</div><div class="sf-answer">{{Answer}}</div>'),
    }],
  },
  multichoice: {
    modelName: "Socratopia::MultipleChoice",
    fields: ["Question", "Options", "Answer", "Note"],
    isCloze: false,
    templates: [{
      Name: "Multiple Choice",
      Front: frontShell("multichoice", "多选", '<div class="sf-question">{{Question}}</div><div class="sf-options" id="socratopia-options">{{Options}}</div>', `${MULTI_CHOICE_SCRIPT}<button class="sf-show-answer" onclick="pycmd('ans')">显示答案</button>`),
      Back: backShell("multichoice", "多选", '<div class="sf-question">{{Question}}</div><div class="sf-options">{{Options}}</div><div class="sf-answer">{{Answer}}</div>'),
    }],
  },
});

function htmlEscape(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

export function ankiHtml(value = "") {
  const source = String(value);
  const chunks = [];
  let cursor = 0;
  const codeFence = /```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g;
  for (const match of source.matchAll(codeFence)) {
    chunks.push(htmlEscape(source.slice(cursor, match.index)).replace(/\r?\n/g, "<br>"));
    const language = match[1] ? ` class="language-${htmlEscape(match[1].toLowerCase())}"` : "";
    chunks.push(`<pre><code${language}>${htmlEscape(match[2])}</code></pre>`);
    cursor = match.index + match[0].length;
  }
  chunks.push(htmlEscape(source.slice(cursor)).replace(/\r?\n/g, "<br>"));
  return chunks.join("");
}

function normalizeTag(value) {
  return String(value || "").trim().replace(/\s+/g, "_");
}

export function ankiFieldsForCard(card) {
  const fields = card.fields;
  const common = { Note: ankiHtml(fields.remark) };
  if (card.type === "cloze") return { Text: ankiHtml(fields.content), ...common };
  if (["choice", "multichoice"].includes(card.type)) {
    const options = fields.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`);
    return {
      Question: ankiHtml(fields.question),
      Options: options.map(ankiHtml).join("<br>"),
      Answer: ankiHtml(fields.answer),
      ...common,
    };
  }
  return { Question: ankiHtml(fields.question), Answer: ankiHtml(fields.answer), ...common };
}

export function modelFieldMigrationActions(definition, currentFields) {
  const fields = new Set(currentFields || []);
  if (fields.has("Remark") && fields.has("Note")) {
    throw new Error(`${definition.modelName} 同时包含 Remark 和 Note，无法自动合并，请先在 Anki 中处理这两个字段`);
  }
  if (!fields.has("Remark") && !fields.has("Note")) {
    throw new Error(`${definition.modelName} 缺少 Note 字段，无法自动迁移`);
  }

  const actions = [];
  if (fields.has("Remark")) {
    actions.push({
      action: "modelFieldRename",
      params: { modelName: definition.modelName, oldFieldName: "Remark", newFieldName: "Note" },
    });
  }
  if (fields.has("Source")) {
    actions.push({
      action: "modelFieldRemove",
      params: { modelName: definition.modelName, fieldName: "Source" },
    });
  }
  return actions;
}

export function buildAnkiNote(card, deckName) {
  const definition = ANKI_NOTE_DEFINITIONS[card.type];
  if (!definition) throw new Error(`不支持的 Anki 卡型：${card.type}`);
  const tags = [...new Set(["socratopia", `socratopia::type::${card.type}`, ...(card.tags || [])].map(normalizeTag).filter(Boolean))];
  return {
    deckName: String(deckName || "").trim(),
    modelName: definition.modelName,
    fields: ankiFieldsForCard(card),
    tags,
    options: { allowDuplicate: false },
  };
}

export function createModelParams(definition) {
  return {
    modelName: definition.modelName,
    inOrderFields: [...definition.fields],
    css: ANKI_BASE_CSS,
    isCloze: definition.isCloze,
    cardTemplates: definition.templates.map((template) => ({ ...template })),
  };
}

export function updateTemplateParams(definition) {
  return {
    name: definition.modelName,
    templates: Object.fromEntries(definition.templates.map((template) => [
      template.Name,
      { Front: template.Front, Back: template.Back },
    ])),
  };
}
