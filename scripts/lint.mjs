import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const app = readFileSync(resolve(root, "app.js"), "utf8");
const css = readFileSync(resolve(root, "style.css"), "utf8");
const liveCss = readFileSync(resolve(root, "live.css"), "utf8");
const domain = readFileSync(resolve(root, "domain.mjs"), "utf8");
const picker = readFileSync(resolve(root, "scope-picker.mjs"), "utf8");

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

check(!/优先于全局|同问法优先|本演示|无审核环节|全局仅查询全局词条/.test(html + app), "交付界面不得包含实现规则、演示说明或流程解释；保留字段、校验及操作反馈");
check(!/normalize-preview|词条预览/.test(html), "词条表单不得增加重复预览");
check(html.includes('id="term-attributes"'), "通用属性编辑必须保留");
check(!/recall|resolveTerms|召回/.test(html + app + domain + liveCss + css + picker), "交付版本不得保留查询演示入口、交互、实现或样式");
check(!/terms-meta|全局\s*\$\{|指定 Agent\s*\$\{/.test(html + app), "不得展示范围统计说明");
check(!/\u9ed1\u8bdd|\u4f5c\u7528\u8303\u56f4/.test(html + app + domain), "产品文案必须统一为词条管理、词条增强和应用范围");
const termForm = html.match(/<form id="term-form"[\s\S]*?<\/form>/)?.[0] || "";
check(!/操作人|更新人|创建人/.test(termForm), "词条表单不得收集人员信息");

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
check(duplicateIds.length === 0, `index.html 存在重复 id：${duplicateIds.join("、")}`);

const knownIds = new Set(ids);
const referencedIds = [...app.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
const missingIds = [...new Set(referencedIds.filter((id) => !knownIds.has(id)))];
check(missingIds.length === 0, `app.js 引用了 HTML 中不存在的 id：${missingIds.join("、")}`);

const closeTargets = [...html.matchAll(/data-close="([^"]+)"/g)].map((match) => match[1]);
const missingCloseTargets = [...new Set(closeTargets.filter((id) => !knownIds.has(id)))];
check(missingCloseTargets.length === 0, `data-close 指向不存在的弹层：${missingCloseTargets.join("、")}`);

const buttonsWithoutType = [...html.matchAll(/<button\b[^>]*>/g)]
  .map((match) => match[0])
  .filter((tag) => !/\btype="button"/.test(tag));
check(buttonsWithoutType.length === 0, `存在未声明 type=\"button\" 的按钮：${buttonsWithoutType.slice(0, 3).join(" | ")}`);

const requiredNavigation = ["知识库", "专业 Agent", "词条管理"];
for (const label of requiredNavigation) {
  check(html.includes(`>${label}<`) || html.includes(`>${label}</span>`), `缺少一级入口：${label}`);
}
const requiredKbTabs = ["基本信息", "公开性设置", "文件更新"];
for (const label of requiredKbTabs) {
  check(html.includes(`>${label}</button>`), `缺少知识库设置页签：${label}`);
}

const forbiddenWords = ["子管理员", "流程解析节点", "Workflow", "Agent 工具"];
for (const word of forbiddenWords) {
  check(!html.includes(word) && !app.includes(word), `出现产品范围外文案：${word}`);
}

const localAssets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1].split("?")[0])
  .filter((value) => !/^(?:https?:|data:|#|\/)/.test(value));
for (const asset of localAssets) {
  check(existsSync(resolve(root, asset)), `页面引用了不存在的本地资源：${asset}`);
}
for (const source of [app, picker]) {
  for (const match of source.matchAll(/from "\.\/([^"?]+)(?:\?[^"\n]*)?"/g)) {
    check(existsSync(resolve(root, match[1])), `模块引用了不存在的资源：${match[1]}`);
  }
}

const filterRule = css.match(/\.toolbar select\.filter-select\s*\{([^}]+)\}/)?.[1] || "";
check(/width:\s*auto/.test(filterRule), "工具栏筛选下拉必须显式 width:auto，避免被 .input 的 100% 覆盖");
check(/max-width:\s*180px/.test(filterRule), "工具栏筛选下拉缺少 max-width，可能再次把工具栏撑成竖排");
check(/flex:\s*0 0 auto/.test(filterRule), "工具栏筛选下拉缺少禁止拉伸规则");

check(/function importSampleForScope\(\)[\s\S]*?return entriesToCsv/.test(app), "导入示例必须复用通用 CSV 导出结构");
check(domain.includes('export const CSV_HEADERS'), "domain.mjs 必须统一维护 CSV 表头");
check(app.includes("confirmImport") && app.includes("importRowsToEntries"), "导入流程必须经过预览校验和确认写入");
check(app.includes("canViewTerms") && app.includes("canWriteGlobal"), "词条查看和管理权限必须生效");
check(!/kb-panel-(?:terms|blacktalk)|kb-black-|data-kb-tab="(?:terms|blacktalk)"/.test(html + app), "知识库不得保留词条页签或知识库级词条能力");
check(!/agent-demo|agent-kb-name|demo-query/.test(html + app), "Agent 详情仅保留词条增强配置");
check(!/规范名|规范编码|指定知识库/.test(html + app), "界面不得残留专用字段或知识库词条范围");
check(!/scope:\s*\{\s*type:\s*"kb"/.test(readFileSync(resolve(root, "data.mjs"), "utf8")), "示例词条不得关联知识库");
check(app.includes("data-open-agent"), "应用范围中的 Agent 应支持跳转");
check(html.includes('id="list-scope-picker"') && html.includes('id="term-scope-picker"'), "列表和表单必须复用应用范围多选组件");
check(html.includes("开启后，问答将依据已配置词条理解专业用语。"), "词条增强说明文案必须保留");
check(!html.includes('class="sidebar"'), "现网主导航为顶部横向导航，不得恢复全局侧栏");
check(/src="app\.js\?v=/.test(html), "静态发布入口必须带资源版本号，避免新 HTML 与旧 JS 混用");
check(html.includes('class="knowledge-grid"') && html.includes('class="agent-grid"'), "知识库和专业 Agent 必须保留现网卡片列表");
check(html.includes('>Agent配置</button>') && html.includes('>权限设置</button>'), "Agent 必须沿用现网页签名称");
check(/\.kb-tab\.active\s*\{[^}]*color:\s*#171717/.test(liveCss), "知识库设置选中页签必须使用现网黑色文字和底线");
check(/\.switch\s*\{[^}]*width:\s*28px;[^}]*height:\s*16px/.test(liveCss), "效果设置开关必须为现网 28×16px");
check(/table\.data th\s*\{[^}]*padding:\s*12px 8px/.test(liveCss), "表格单元格应沿用现网 12px 8px 内边距");
check(!/monavi|Agent 正在操作|接管/.test(html + liveCss), "不得把浏览器扩展辅助界面复刻到产品中");
for (const asset of [...liveCss.matchAll(/url\("([^"]+)"\)/g)].map(match => match[1])) {
  check(existsSync(resolve(root, asset)), `现网样式引用了不存在的资源：${asset}`);
}

if (failures.length) {
  console.error("Lint failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Lint passed: ${ids.length} ids, ${referencedIds.length} DOM references, ${localAssets.length} local assets.`);
}
