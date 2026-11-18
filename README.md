# 智能问答平台 · 黑话管理 POC

一个可直接点击演示的知识库黑话配置后台。覆盖全局黑话管理、知识库范围内配置、专业 Agent「黑话增强」、导入导出、变更留痕和轻量权限切换。

**在线演示：** https://babysharpyin.github.io/heihua-admin-poc/

## 功能范围

- 全局黑话列表：搜索、作用范围/状态筛选、分页、新增、导入、导出。
- 单条维护：规范名、规范编码、多个别名、释义、作用范围和状态；保存后立即生效。
- 冲突校验：同范围规范名与别名共用冲突空间，规范编码全局唯一；冲突处理前不可保存。
- 知识库「黑话配置」：只展示并维护当前知识库范围，新增、编辑和导入时锁定范围。
- 专业 Agent「效果设置」：黑话增强默认开启；关闭后不调用黑话解析，并提供轻量命中演示。
- 停用、删除二次确认；CSV 导入先逐行预览校验，全部通过后原子写入。
- 变更记录与最近一次变更回滚。
- 身份演示：黑话管理 + 全局、仅本库可写、仅查看、无权限。

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

- `lint`：检查重复/缺失 DOM id、弹层目标、按钮类型、产品范围外文案、工具栏下拉约束和导入示例表头。
- `test`：覆盖规范化、冲突、分页、CSV、原子导入和范围优先级等领域规则。
- `test:ui`：使用 Playwright 点击主要流程，并生成终态截图到 `docs/screenshots/final/`。

## 截图

| 页面 | 截图 |
| --- | --- |
| 全局黑话管理 | `docs/screenshots/final/01-global-list.png` |
| 别名冲突校验 | `docs/screenshots/final/02-alias-conflict.png` |
| 停用确认 | `docs/screenshots/final/03-disable-confirm.png` |
| 导入预览 | `docs/screenshots/final/04-import-preview.png` |
| 知识库黑话配置 | `docs/screenshots/final/05-kb-black-config.png` |
| 本库范围锁定 | `docs/screenshots/final/06-kb-locked-drawer.png` |
| Agent 黑话增强 | `docs/screenshots/final/07-agent-effect.png` |
| 仅查看权限 | `docs/screenshots/final/08-view-only.png` |

## 发布

源码位于 `feat/heihua-config`，静态站点发布到 `gh-pages` 分支根目录，GitHub Pages 使用 legacy source（`gh-pages` / `/`）。
