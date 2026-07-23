# Socratopia 卡片工坊

本地运行的 Anki 卡片转换工具。它可以读取 Socratopia 统一选择题 TSV、普通 TSV/CSV 和 TXT/Markdown，通过 OpenAI 兼容接口生成 `qa`、`cloze`、`judge`、`choice`、`multichoice` 五种卡型。

## 模型建议

本项目使用 DeepSeek V4 Pro 进行测试，效果良好。

工具兼容 OpenAI 风格接口；如需中转站，可尝试以下服务：

- [云雾 AI](https://yunwu.ai/register?aff=5qjp7u)
- [GOAI Store](https://goaistore.ccwu.cc/register?aff=PSLY5XJ6SFVX)

## 启动

```powershell
npm start
```

打开 `http://127.0.0.1:4173`。项目无第三方运行时依赖，Node.js 20 或更高版本即可。

## 导入 Anki

1. 打开 Anki，并安装、启用 AnkiConnect 插件（默认端口 `8765`）。
2. 在工具中完成卡片生成与检查。
3. 在顶部“导出 / 导入”菜单中选择“导入到 Anki”，选择现有牌组或输入新牌组名称。
4. 工具会创建 `Socratopia::QA`、`Socratopia::Cloze`、`Socratopia::Judge`、`Socratopia::SingleChoice` 和 `Socratopia::MultipleChoice` 五种笔记类型，然后去重并批量导入。

页面顶部的“导出 / 导入”是统一操作入口：可直接导入 Anki，也可导出 JSON、通用 TSV、Anki Basic TSV 或 Anki Cloze TSV。

普通导入只创建缺失模板；“同步模板”会覆盖现有 `Socratopia::*` 模板和 CSS，但不会改动其他笔记类型。

五种笔记类型均不包含 `Source` 字段，补充说明统一写入 `Note` 字段。旧版笔记类型首次同步时会将 `Remark` 重命名为 `Note`，并删除 `Source` 字段及其已有内容；执行前会再次确认。

## API

支持填写中转站基础地址、带 `/v1` 的地址或完整 `/chat/completions` 地址。请求通过本机服务转发，并会显示 401/403 鉴权、404 路径、429 限额和网络连接等具体错误。

默认启用“本机记住 Key”：地址、模型和 Key 仅保存到此电脑上 `http://127.0.0.1:4173` 的浏览器本地存储，不会发给本机服务之外的任何位置。可随时点击“忘记 Key”清除。

## 导出

- `JSON`：严格的 `cards` 对象，适合继续处理。
- `通用 TSV`：保留卡型、全部字段、标签和来源编号。
- `Anki Basic TSV`：导出问答、判断、单选和多选，使用 Anki 内置 Basic 笔记类型。
- `Anki Cloze TSV`：单独导出填空卡，使用 Anki 内置 Cloze 笔记类型。

存在质量告警的卡片不会导出；可在结果页编辑修正后再导出。

## 测试

```powershell
npm test
```
