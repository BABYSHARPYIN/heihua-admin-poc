# 智能问答平台 · 词条管理 POC

词条与知识库并列作为 Agent 的信息源。词条只关联全局或指定 Agent；知识库保留原有设置能力，Agent 侧仅增加「词条增强」开关。

**在线演示：** https://babysharpyin.github.io/heihua-admin-poc/

## 功能范围

- 词条列表：名称、别名、释义、应用范围、状态、更新时间；范围以纯文本展示，不跳转 Agent。
- 单条维护：词条名称、多个别名、释义、全局或指定 Agent 范围、状态；不提供补充属性或重复预览，保存后立即生效。
- 校验：名称、释义必填，同范围名称与别名共用冲突空间。
- 词条管理内召回：选择全局或具体 Agent；全局只查全局，Agent 合并自身及全局词条，同问法 Agent 优先，停用词条不召回。
- 专业 Agent「效果设置」：词条增强默认开启；详情内没有词条召回演示或关联知识库关系区。
- 停用、删除二次确认；CSV 导入先逐行预览校验，全部通过后原子写入。
- 变更记录与最近一次变更回滚。
- 身份演示：词条查看/词条管理、仅查看、无权限，入口位于右上角用户菜单。

CSV 字段：词条名称、别名、释义、作用范围、Agent名称、状态。别名以 `|` 分隔。下载模板与导出均使用六列结构；旧七列文件仍可导入，历史属性保留在本地存储，不在界面展示或编辑，也不进入新导出文件。

旧浏览器数据在首次加载时迁移：原编码变成普通「编码」属性；原知识库范围转为先前示例对应的 Agent，不认识的旧范围不扩大成全局；旧本库可写身份降为仅查看。旧数据仍保留在旧存储键中，新操作使用 v2 存储。

本仓库是纯前端 POC，数据保存在浏览器 `localStorage`，不包含服务端和真实鉴权。

## 本地运行

```bash
npm install
npm run serve
```

打开 http://127.0.0.1:4173/。

## 验证

```bash
npm run lint
npm test
npm run test:ui
```

- `lint`：检查重复/缺失 DOM id、弹层目标、按钮类型、产品范围外文案、工具栏下拉约束、现网布局令牌、图标资源和导入示例表头。
- `test`：覆盖规范化、冲突、分页、CSV、原子导入和范围优先级等领域规则。
- `test:ui`：仅对本地 POC 使用 Playwright 回归主要流程，在 1429×878 视口生成本轮终态截图到 `docs/screenshots/terms-final/`。现网只使用用户本机 Chrome 的 Monavi。

## 现网对照

走查页面、视觉令牌和环境差异见 `docs/live-reference.md`；190 现网截图在 `docs/screenshots/live/190/`，同视口对照在 `docs/screenshots/comparison/`。实现沿用现网顶部导航、卡片列表、知识库侧栏/设置页签、Agent 双栏配置、表格、控件与弹层样式。权限演示在右上角用户菜单内。

## 截图

| 页面 | 截图 |
| --- | --- |
| 词条管理 | `docs/screenshots/terms-final/01-global-list.png` |
| 别名冲突校验 | `docs/screenshots/terms-final/02-alias-conflict.png` |
| 导入预览 | `docs/screenshots/terms-final/04-import-preview.png` |
| 精简编辑 | `docs/screenshots/terms-final/05-simple-editor.png` |
| 指定 Agent 召回 | `docs/screenshots/terms-final/06-recall-agent.png` |
| Agent 词条增强 | `docs/screenshots/terms-final/14-agent-config.png` |
| 具体 Agent 筛选 | `docs/screenshots/terms-final/15-agent-scope-filter.png` |

之前 `docs/screenshots/final/` 和历史设计文档仅用于记录前轮方案；本轮产品口径及验收以 `docs/term-model.md` 和 `design-qa.md` 为准。

## 发布

源码位于 `feat/heihua-config`，静态站点发布到 `gh-pages` 分支根目录，GitHub Pages 使用 legacy source（`gh-pages` / `/`）。
