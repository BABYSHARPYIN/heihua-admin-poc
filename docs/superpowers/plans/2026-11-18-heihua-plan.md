# 黑话配置实施计划

**Goal:** 完成可演示的知识库级别黑话配置并公开发布 GitHub Pages。
**Architecture:** 原生 HTML/CSS/JS 静态应用，domain.mjs 独立负责校验、CSV、范围解析；app.js 负责视图、本地持久化和交互。
**Tech Stack:** 原生浏览器 API、Node test、Playwright（开发验证）。
**Spec:** docs/superpowers/specs/2026-11-18-heihua-design.md

## 全局约束
当前目录 /Users/rio/Desktop/Project/heihua-admin-poc；仅 BABYSHARPYIN/heihua-admin-poc 可写远程；发布 gh-pages 根目录；中文；复用参考皮肤；不做流程解析节点、Workflow、Agent 工具。

### Task 1: 数据规则
- [ ] 先编写领域行为测试，运行确认因实现缺失而失败。
- [ ] 实现 domain.mjs：normalization、同范围冲突校验、CSV 编解码、原子导入校验、作用范围覆盖解析、16 条行业样本。
- [ ] 运行 node --test tests/domain.test.mjs，通过后集成。

### Task 2: 页面与交互
- [ ] 从参考 HTML 提取 CSS 变量和组件样式写入 style.css，补少量设置页及适配样式。
- [ ] 实现 index.html 和 app.js：列表查询/筛选/分页、词条弹层、停用删除确认、导入导出、知识库设置、Agent 开关、身份切换、留痕回滚。
- [ ] 使用浏览器覆盖真实表单、冲突、导入确认、范围锁定、权限、关闭解析；截图核验。

### Task 3: 复核和发布
- [ ] 独立代码审查，修复发现的问题并重新验证。
- [ ] 写 README、操作与已知边界，提交并创建公开仓库。
- [ ] 推送 main 和 gh-pages，调用 Pages API 设置 gh-pages /。
- [ ] 等待线上 HTTP 200，浏览器加载预期新应用并验证关键流程；记录仓库、Pages URL 和原仓库未变证据。
