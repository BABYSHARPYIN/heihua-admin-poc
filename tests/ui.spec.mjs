import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importRowsToEntries } from "../domain.mjs";

const screenshotDir = resolve(process.cwd(), "docs/screenshots/delivery");
mkdirSync(screenshotDir, { recursive: true });

async function open(page) {
  const errors = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/", { waitUntil: "networkidle" });
  return errors;
}

async function terms(page) {
  await page.getByRole("button", { name: "词条管理", exact: true }).click();
}

async function shot(page, name) {
  await page.screenshot({ path: resolve(screenshotDir, name), fullPage: true, animations: "disabled", caret: "hide" });
}

async function picker(page, id) {
  const root = page.locator(`#${id}`);
  await root.locator(".scope-picker-trigger").click();
  return root;
}

test("现网知识库设置保持原样，Agent 效果说明与同区样式一致", async ({ page }) => {
  const errors = await open(page);
  const nav = await page.getByRole("navigation", { name: "主导航" }).boundingBox();
  expect(nav.y).toBeLessThan(60);
  expect(nav.width).toBeGreaterThan(nav.height * 3);
  await expect(page.locator(".knowledge-card")).toHaveCount(3);
  await page.locator('[data-open-kb="kb-device"]').first().click();
  await expect(page.locator("[data-kb-tab]")).toHaveText(["基本信息", "公开性设置", "文件更新"]);
  await expect(page.locator("#basic-kb-name")).toHaveValue("设备运维知识库");
  expect(await page.locator(".kb-tab.active").evaluate(element => getComputedStyle(element).color)).toBe("rgb(23, 23, 23)");
  await shot(page, "01-knowledge-basic.png");
  await page.getByRole("tab", { name: "公开性设置" }).click();
  await expect(page.locator("#kb-panel-visibility th")).toHaveText(["账号", "姓名", "角色", "操作"]);
  await page.getByRole("tab", { name: "文件更新" }).click();
  await page.getByRole("button", { name: "配置更新策略" }).click();
  await expect(page.getByLabel("数据源", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "专业 Agent", exact: true }).click();
  await expect(page.locator(".agent-card")).toHaveCount(3);
  await page.locator('[data-agent-id="app-device"]').click();
  await page.getByRole("tab", { name: "Agent配置", exact: true }).click();
  const switchSize = await page.locator("#switch-black").boundingBox();
  expect(switchSize.width).toBe(28);
  expect(switchSize.height).toBe(16);
  const note = page.locator("#row-black-enhance .effect-description");
  await expect(note).toHaveText("开启后，问答将依据已配置词条理解专业用语。");
  const style = element => ({ color: getComputedStyle(element).color, fontSize: getComputedStyle(element).fontSize });
  expect(await note.evaluate(style)).toEqual(await page.locator(".followup-row small").evaluate(style));
  expect((await note.boundingBox()).y).toBeGreaterThan((await page.locator("#switch-black").boundingBox()).y);
  await expect(page.locator("#page-agent")).not.toContainText("关联知识库");
  await expect(page.locator("#page-agent")).not.toContainText("召回");
  await shot(page, "02-agent-effect.png");
  await page.locator("#switch-black").click();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "专业 Agent", exact: true }).click();
  await page.locator('[data-agent-id="app-device"]').click();
  await page.getByRole("tab", { name: "Agent配置", exact: true }).click();
  await expect(page.locator("#switch-black")).toHaveAttribute("aria-checked", "false");
  expect(errors).toEqual([]);
});

test("列表无功能演示或范围统计，表格保持纯文本，搜索分页可用", async ({ page }) => {
  const errors = await open(page);
  await terms(page);
  await expect(page.locator("#black-tbody tr")).toHaveCount(8);
  await expect(page.locator("#page-terms th")).toHaveText(["词条名称", "别名", "释义", "可扩展属性", "应用范围", "状态", "更新时间", "操作"]);
  await expect(page.locator("#terms-meta, #modal-recall, #btn-recall-open")).toHaveCount(0);
  await expect(page.locator("#page-terms")).not.toContainText(/全局\s*\d|指定 Agent|召回/);
  await expect(page.locator("#black-tbody label, #black-tbody .tag, #black-tbody .status")).toHaveCount(0);
  const filterBox = await page.locator("#list-scope-picker").boundingBox();
  const actionBox = await page.locator("#btn-black-audit").boundingBox();
  expect(Math.abs(filterBox.y - actionBox.y)).toBeLessThan(2);
  await shot(page, "03-term-list.png");
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.locator("#black-footer-count")).toContainText("第 2 / 3 页");
  await page.locator("#black-search").fill("不存在的词条");
  await expect(page.locator("#black-empty")).toBeVisible();
  await page.locator("#black-search").fill("SAFE-WF-008");
  await expect(page.locator("#black-tbody tr")).toHaveCount(1);
  await page.locator("#black-search").fill("");
  await page.locator("#black-status").selectOption("disabled");
  await expect(page.locator("#black-tbody .status-enabled")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("范围筛选可搜索、多选、混选和全选，搜索不改变全选含义", async ({ page }) => {
  const errors = await open(page);
  await terms(page);
  const root = await picker(page, "list-scope-picker");
  await root.getByRole("checkbox", { name: "全局", exact: true }).check();
  await expect(page.locator("#black-result-count")).toHaveText("共 8 条");
  await root.getByRole("checkbox", { name: "全局", exact: true }).uncheck();
  await root.getByRole("searchbox").fill("安全");
  await root.getByRole("checkbox", { name: "安全规程助手", exact: true }).check();
  await expect(page.locator("#black-result-count")).toHaveText("共 4 条");
  await root.getByRole("searchbox").fill("客户");
  await root.getByRole("checkbox", { name: "客户服务助手", exact: true }).check();
  await root.getByRole("searchbox").fill("");
  await root.getByRole("checkbox", { name: "全局", exact: true }).check();
  await expect(page.locator("#black-result-count")).toHaveText("共 12 条");
  await shot(page, "04-scope-filter.png");
  await root.getByRole("searchbox").fill("安全");
  await root.getByRole("checkbox", { name: "全选", exact: true }).check();
  await expect(page.locator("#black-result-count")).toHaveText("共 21 条");
  await root.getByRole("searchbox").fill("");
  for (const checkbox of await root.getByRole("checkbox").all()) await expect(checkbox).toBeChecked();
  await root.getByRole("checkbox", { name: "全选", exact: true }).uncheck();
  await expect(root.locator(".scope-picker-trigger")).toHaveText("全部应用范围⌄");
  await expect(page.locator("#black-result-count")).toHaveText("共 21 条");
  await root.getByRole("searchbox").fill("不存在的Agent");
  await expect(root.locator(".scope-picker-empty")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(root.locator(".scope-picker-panel")).toBeHidden();
  await expect(root.locator(".scope-picker-trigger")).toBeFocused();
  expect(errors).toEqual([]);
});

test("表单必选应用范围，混合多选及属性保存持久化，具体 Agent 可跳转", async ({ page }) => {
  const errors = await open(page);
  await terms(page);
  await page.locator("#btn-black-add").click();
  await expect(page.locator("#term-name")).toBeFocused();
  await expect(page.locator("#term-form")).not.toContainText(/操作人|创建人|更新人/);
  await page.locator("#term-name").fill("现场设备词条");
  await page.locator("#term-definition").fill("现场设备的专业含义。");
  await page.locator("#btn-term-save").click();
  await expect(page.locator("#err-term-scopes")).toHaveText("请选择应用范围");
  const root = await picker(page, "term-scope-picker");
  await root.getByRole("checkbox", { name: "全局", exact: true }).check();
  await root.getByRole("searchbox").fill("运维");
  await root.getByRole("checkbox", { name: "设备运维助手", exact: true }).check();
  await root.getByRole("searchbox").fill("安全");
  await root.getByRole("checkbox", { name: "安全规程助手", exact: true }).check();
  await root.getByRole("searchbox").fill("");
  await shot(page, "11-editor-scope-picker.png");
  await page.keyboard.press("Escape");
  await expect(page.locator("#modal-term")).toHaveClass(/show/);
  await page.locator("#alias-input").fill("现场简称");
  await page.locator("#alias-input").press("Enter");
  await page.locator("#btn-add-attribute").click();
  await page.getByRole("textbox", { name: "属性名", exact: true }).fill("型号");
  await page.locator("#btn-term-save").click();
  await expect(page.locator("#err-term-attributes")).toContainText("属性值");
  await page.getByRole("textbox", { name: "属性值", exact: true }).fill("A-100");
  await page.locator("#btn-add-attribute").click();
  await page.getByRole("textbox", { name: "属性名", exact: true }).nth(1).fill("分类");
  await page.getByRole("textbox", { name: "属性值", exact: true }).nth(1).fill("设备");
  await shot(page, "05-term-editor.png");
  await page.locator("#btn-term-save").click();
  await page.reload({ waitUntil: "networkidle" });
  await terms(page);
  await page.locator("#black-search").fill("A-100");
  const row = page.locator("#black-tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("全局、设备运维助手、安全规程助手");
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator("#term-name")).toBeFocused();
  const editRoot = await picker(page, "term-scope-picker");
  for (const name of ["全局", "设备运维助手", "安全规程助手"]) await expect(editRoot.getByRole("checkbox", { name, exact: true })).toBeChecked();
  await expect(editRoot.getByRole("checkbox", { name: "客户服务助手", exact: true })).not.toBeChecked();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "删除属性", exact: true }).last().click();
  await page.locator("#btn-term-save").click();
  await expect(row).not.toContainText("分类：设备");
  await row.getByRole("button", { name: "设备运维助手", exact: true }).click();
  await expect(page.locator("#agent-title")).toHaveText("设备运维助手");
  expect(errors).toEqual([]);
});

test("多范围交集冲突与简化停用删除确认", async ({ page }) => {
  const errors = await open(page);
  await terms(page);
  await page.locator("#btn-black-add").click();
  await expect(page.locator("#term-name")).toBeFocused();
  await page.locator("#term-name").fill("新隔离设备");
  await page.locator("#term-definition").fill("隔离设备释义。");
  const root = await picker(page, "term-scope-picker");
  await root.getByRole("checkbox", { name: "设备运维助手", exact: true }).check();
  await root.getByRole("checkbox", { name: "客户服务助手", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.locator("#alias-input").fill("刀闸");
  await page.locator("#alias-input").press("Enter");
  await expect(page.locator("#term-conflicts")).toContainText("别名「刀闸」");
  await expect(page.locator("#btn-term-save")).toBeDisabled();
  await shot(page, "06-alias-conflict.png");
  await page.locator("[data-conflict-remove-alias]").click();
  await page.locator("#btn-term-save").click();
  const row = page.locator("#black-tbody tr", { hasText: "新隔离设备" });
  await row.getByRole("button", { name: "停用", exact: true }).click();
  await expect(page.locator("#confirm-title")).toHaveText("停用词条");
  await expect(page.locator("#modal-confirm .modal-body")).toHaveText("确认停用 「新隔离设备」？");
  await expect(page.locator("#confirm-extra, #modal-confirm .confirm-warning")).toHaveCount(0);
  await expect(page.locator("#btn-confirm-ok")).toHaveClass("btn btn-primary");
  await shot(page, "07-disable-confirm.png");
  await page.locator("#btn-confirm-ok").click();
  await expect(row.locator(".status-disabled")).toBeVisible();
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator("#modal-confirm .modal-body")).toHaveText("确认删除 「新隔离设备」？");
  await shot(page, "08-delete-confirm.png");
  await page.locator("#btn-confirm-ok").click();
  await expect(row).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("多范围属性导入导出、错误阻止写入、最近变更回滚", async ({ page }) => {
  const errors = await open(page);
  await terms(page);
  await page.locator("#btn-black-import").click();
  await page.locator("#import-text").fill('词条名称,别名,释义,可扩展属性,应用范围,状态\n跨范围设备,测试简称,测试释义,[],全局|设备运维助手|客户服务助手,启用');
  await page.locator("#btn-preview-import").click();
  await expect(page.locator("#import-summary")).toContainText("通过 1 行");
  await shot(page, "09-import-preview.png");
  await page.locator("#btn-import-confirm").click();
  await page.locator("#black-search").fill("跨范围设备");
  await expect(page.locator("#black-tbody tr")).toContainText("全局、设备运维助手、客户服务助手");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#btn-black-export").click();
  const download = await downloadPromise;
  const parsed = importRowsToEntries(readFileSync(await download.path(), "utf8"));
  expect(parsed.allValid).toBe(true);
  expect(parsed.rows[0].candidate.scopes).toHaveLength(3);
  await page.locator("#btn-black-import").click();
  await page.locator("#import-text").fill('词条名称,别名,释义,可扩展属性,应用范围,状态\n错误范围,,释义,[],未知Agent,启用');
  await page.locator("#btn-preview-import").click();
  await expect(page.locator("#btn-import-confirm")).toBeDisabled();
  await expect(page.locator("#import-preview-body")).toContainText("未找到 Agent");
  await page.keyboard.press("Escape");
  await page.locator("#btn-black-audit").click();
  await page.locator("[data-rollback-log]").first().click();
  await page.locator("#btn-confirm-ok").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#black-tbody tr")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("只读身份禁用多选与属性编辑，无权限身份隐藏入口", async ({ page }) => {
  const errors = await open(page);
  await terms(page);
  await page.locator(".demo-account summary").click();
  await page.locator("#identity-select").selectOption("view");
  await page.locator(".demo-account summary").click();
  await expect(page.locator("#btn-black-add")).toBeHidden();
  await expect(page.locator("#btn-black-import")).toBeHidden();
  await page.locator("#black-tbody tr").first().getByRole("button", { name: "查看", exact: true }).click();
  await expect(page.locator("#btn-term-save")).toBeHidden();
  await expect(page.locator("#term-scope-picker .scope-picker-trigger")).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "属性名", exact: true }).first()).toHaveAttribute("readonly", "");
  await shot(page, "10-view-only.png");
  await page.keyboard.press("Escape");
  await page.locator(".demo-account summary").click();
  await page.locator("#identity-select").selectOption("none");
  await expect(page.locator("#nav-terms")).toBeHidden();
  expect(errors).toEqual([]);
});

test("旧单范围与变更快照迁移，编辑多范围后可回滚", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("heihua-admin-poc-state-v2")) return;
    localStorage.setItem("heihua-admin-poc-state-v1", JSON.stringify({ identity: "full", entries: [{ id: "old", name: "旧设备", code: "OLD-1", aliases: [], definition: "原释义", scope: { type: "app", id: "app-device" }, status: "enabled" }] }));
  });
  const errors = await open(page);
  await terms(page);
  const row = page.locator("#black-tbody tr");
  await expect(row).toContainText("编码：OLD-1");
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator("#term-name")).toBeFocused();
  const root = await picker(page, "term-scope-picker");
  await expect(root.getByRole("checkbox", { name: "设备运维助手", exact: true })).toBeChecked();
  await root.getByRole("checkbox", { name: "全局", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.locator("#btn-term-save").click();
  await page.reload({ waitUntil: "networkidle" });
  await terms(page);
  await expect(row).toContainText("全局、设备运维助手");
  await page.locator("#btn-black-audit").click();
  await page.locator("[data-rollback-log]").first().click();
  await page.locator("#btn-confirm-ok").click();
  await page.keyboard.press("Escape");
  await expect(row.locator("td").nth(4)).toHaveText("设备运维助手");
  await expect(row).toContainText("编码：OLD-1");
  expect(errors).toEqual([]);
});
