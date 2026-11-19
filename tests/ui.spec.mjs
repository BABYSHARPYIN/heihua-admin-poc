import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importRowsToEntries } from "../domain.mjs";

const screenshotDir = resolve(process.cwd(), "docs/screenshots/terms-final");
mkdirSync(screenshotDir, { recursive: true });

async function open(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto("/", { waitUntil: "networkidle" });
  return errors;
}

async function shot(page, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(screenshotDir, name), fullPage: true });
}

test("现网外壳、卡片、设置页签与效果开关保持统一", async ({ page }) => {
  const errors = await open(page);
  const nav = page.getByRole("navigation", { name: "主导航" });
  const navBox = await nav.boundingBox();
  expect(navBox.y).toBeLessThan(60);
  expect(navBox.width).toBeGreaterThan(navBox.height * 3);
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.locator(".knowledge-card")).toHaveCount(3);
  await shot(page, "09-knowledge-list.png");
  await page.locator('[data-open-kb="kb-device"]').first().click();
  await expect(page.getByRole("tab", { name: "基本信息", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#basic-kb-name")).toHaveValue("设备运维知识库");
  const tabColor = await page.locator('.kb-tab.active').evaluate(el => getComputedStyle(el).color);
  expect(tabColor).toBe("rgb(23, 23, 23)");
  await expect(page.locator("[data-kb-tab]")).toHaveText(["基本信息", "公开性设置", "文件更新"]);
  await shot(page, "10-knowledge-basic.png");
  await page.getByRole("tab", { name: "公开性设置" }).click();
  await expect(page.locator("#kb-panel-visibility table th")).toHaveText(["账号", "姓名", "角色", "操作"]);
  await shot(page, "11-knowledge-visibility.png");
  await page.getByRole("tab", { name: "文件更新" }).click();
  await expect(page.getByText("暂未配置", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "配置更新策略" }).click();
  await expect(page.getByLabel("数据源", { exact: true })).toBeVisible();
  await shot(page, "12-knowledge-file-update.png");
  await page.getByRole("button", { name: "专业 Agent", exact: true }).click();
  await expect(page.locator(".agent-card")).toHaveCount(3);
  await shot(page, "13-agent-list.png");
  await page.locator('[data-agent-id="app-device"]').click();
  await page.getByRole("tab", { name: "Agent配置", exact: true }).click();
  const switchSize = await page.locator("#switch-black").boundingBox();
  expect(switchSize.width).toBe(28);
  expect(switchSize.height).toBe(16);
  expect(await page.locator('.switch-list').evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(245, 245, 245)");
  expect(await page.locator('#row-black-enhance').evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  await expect(page.locator("#switch-black")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".agent-preview")).toBeVisible();
  await expect(page.locator("#page-agent")).not.toContainText("关联知识库");
  await expect(page.locator("#page-agent")).not.toContainText("召回");
  await shot(page, "14-agent-config.png");
  expect(errors).toEqual([]);
});

test("全局列表布局、分页、搜索和筛选", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "词条管理" }).click();
  await expect(page.locator("#black-tbody tr")).toHaveCount(8);
  await expect(page.locator("#black-footer-count")).toContainText("第 1 / 3 页");

  const scopeBox = await page.locator("#black-scope").boundingBox();
  const statusBox = await page.locator("#black-status").boundingBox();
  const actionBox = await page.locator("#btn-black-audit").boundingBox();
  expect(scopeBox.width).toBeLessThanOrEqual(190);
  expect(statusBox.width).toBeLessThanOrEqual(190);
  expect(Math.abs(scopeBox.y - statusBox.y)).toBeLessThan(2);
  expect(Math.abs(scopeBox.y - actionBox.y)).toBeLessThan(2);
  await expect(page.locator("#black-tbody .tag, #black-tbody label")).toHaveCount(0);
  await expect(page.locator("#black-scope option")).toHaveText(["全部作用范围", "全局", "指定 Agent"]);
  await shot(page, "01-global-list.png");

  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.locator("#black-footer-count")).toContainText("第 2 / 3 页");
  await page.locator("#black-search").fill("不存在的词条");
  await expect(page.locator("#black-empty")).toBeVisible();
  await page.locator("#black-search").fill("");
  await page.locator("#black-status").selectOption("disabled");
  await expect(page.locator("#black-tbody .status-disabled").first()).toBeVisible();
  expect(await page.locator("#black-tbody .status-enabled").count()).toBe(0);
  expect(errors).toEqual([]);
});

test("新增校验、别名冲突、编辑、停用确认与删除确认", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "词条管理" }).click();
  await page.locator("#btn-black-add").click();

  await page.locator("#btn-term-save").click();
  await expect(page.locator("#err-term-name")).toHaveText("请填写词条名称");
  await page.fill("#term-name", "隔离设备");
  await page.fill("#term-definition", "用于验证新增与编辑流程的测试设备。");
  await page.locator("#term-scope-type").selectOption("app");
  await page.locator("#term-scope-target").selectOption("app-device");
  await page.fill("#alias-input", "刀闸");
  await page.locator("#alias-input").press("Enter");
  await expect(page.locator("#term-conflict-list")).toContainText("别名「刀闸」");
  await expect(page.locator("#btn-term-save")).toBeDisabled();
  await shot(page, "02-alias-conflict.png");

  await page.locator('#term-conflict-list [data-conflict-remove-alias]').click();
  await page.fill("#alias-input", "测试隔离设备");
  await page.locator("#alias-input").press("Enter");
  await expect(page.locator("#preview-result")).toContainText("隔离设备");
  await expect(page.locator("#btn-term-save")).toBeEnabled();
  await page.locator("#btn-term-save").click();
  await expect(page.locator("#modal-term")).not.toHaveClass(/show/);
  const row = page.locator("#black-tbody tr", { hasText: "隔离设备" }).first();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "编辑" }).click();
  await page.fill("#term-name", "隔离设备（编辑）");
  await expect(page.locator("#preview-result")).toContainText("隔离设备(编辑)");
  await page.locator("#btn-term-save").click();
  const editedRow = page.locator("#black-tbody tr", { hasText: "隔离设备(编辑)" }).first();
  await expect(editedRow).toBeVisible();

  await editedRow.getByRole("button", { name: "停用" }).click();
  await expect(page.locator("#confirm-title")).toHaveText("停用词条");
  await shot(page, "03-disable-confirm.png");
  await page.locator("#btn-confirm-ok").click();
  await expect(editedRow.locator(".status-disabled")).toBeVisible();

  await editedRow.getByRole("button", { name: "删除" }).click();
  await expect(page.locator("#confirm-title")).toHaveText("删除词条");
  await page.locator("#btn-confirm-ok").click();
  await expect(page.locator("#black-tbody tr", { hasText: "隔离设备(编辑)" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("通用属性导入先校验后原子写入", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "词条管理", exact: true }).click();
  await page.locator("#btn-black-import").click();
  await page.locator("#btn-fill-import-sample").click();
  await expect(page.locator("#import-text")).toHaveValue(/^词条名称,别名,释义,可扩展属性,作用范围,Agent名称,状态/);
  await page.locator("#btn-preview-import").click();
  await expect(page.locator("#import-summary")).toContainText("通过 1 行");
  await shot(page, "04-import-preview.png");
  await page.locator("#btn-import-confirm").click();
  await expect(page.locator("#black-tbody tr", { hasText: "油色谱异常" })).toContainText("分类：运维");
  await page.locator("#btn-black-import").click();
  await page.locator("#import-text").fill('词条名称,别名,释义,可扩展属性,作用范围,Agent名称,状态\n错误属性,,释义,{},全局,,启用');
  await page.locator("#btn-preview-import").click();
  await expect(page.locator("#btn-import-confirm")).toBeDisabled();
  await expect(page.locator("#import-preview-body")).toContainText("JSON 数组");
  expect(errors).toEqual([]);
});

test("Agent 词条增强开关与身份权限表现", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "专业 Agent" }).click();
  await page.locator('[data-agent-id="app-device"]').click();
  await page.getByRole("tab", { name: "Agent配置" }).click();
  await expect(page.locator("#switch-black")).toHaveClass(/on/);
  await shot(page, "07-agent-effect.png");

  await page.locator("#switch-black").click();
  await expect(page.locator("#switch-black")).not.toHaveClass(/on/);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "专业 Agent" }).click();
  await page.locator('[data-agent-id="app-device"]').click();
  await page.getByRole("tab", { name: "Agent配置" }).click();
  await expect(page.locator("#switch-black")).not.toHaveClass(/on/);

  await page.locator(".demo-account summary").click();
  await page.locator("#identity-select").selectOption("view");
  await page.locator(".demo-account summary").click();
  await expect(page.locator("#switch-black")).toBeDisabled();
  await page.getByRole("button", { name: "词条管理" }).click();
  await expect(page.locator("#btn-black-add")).toBeHidden();
  await expect(page.locator("#btn-black-import")).toBeHidden();
  await expect(page.locator("#black-tbody tr").first().getByRole("button", { name: "查看" })).toBeVisible();
  await page.locator("#black-tbody tr").first().getByRole("button", { name: "查看" }).click();
  await expect(page.locator("#btn-term-save")).toBeHidden();
  await page.keyboard.press("Escape");
  await shot(page, "08-view-only.png");

  await page.locator(".demo-account summary").click();
  await page.locator("#identity-select").selectOption("none");
  await page.locator(".demo-account summary").click();
  await expect(page.locator("#nav-terms")).toBeHidden();
  await page.getByRole("button", { name: "知识库", exact: true }).click();
  await page.locator(".knowledge-card").first().click();
  await expect(page.locator("[data-kb-tab]")).toHaveText(["基本信息", "公开性设置", "文件更新"]);
  expect(errors).toEqual([]);
});

test("导出、变更留痕与回滚保持可用", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "词条管理", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#btn-black-export").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const exported = importRowsToEntries(readFileSync(await download.path(), "utf8"));
  expect(exported.allValid).toBe(true);
  expect(exported.rows.every(row => !Object.hasOwn(row.candidate, "code"))).toBe(true);
  const firstRow = page.locator("#black-tbody tr").first();
  const name = await firstRow.locator(".cell-main").innerText();
  await firstRow.getByRole("button", { name: "停用", exact: true }).click();
  await page.locator("#btn-confirm-ok").click();
  await page.locator("#btn-black-audit").click();
  await expect(page.locator("#audit-content")).toContainText(name);
  await page.locator("[data-rollback-log]").first().click();
  await page.locator("#btn-confirm-ok").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#black-tbody tr", { hasText: name }).locator(".status-enabled")).toBeVisible();
  expect(errors).toEqual([]);
});

test("可扩展属性增删、校验、持久化及范围跳转", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "词条管理", exact: true }).click();
  await page.locator("#btn-black-add").click();
  await page.locator("#term-name").fill("通用设备词条");
  await page.locator("#term-definition").fill("用于验证通用属性和范围跳转。");
  await page.locator("#term-scope-type").selectOption("app");
  await page.locator("#term-scope-target").selectOption("app-service");
  await page.locator("#btn-add-attribute").click();
  await page.getByRole("textbox", { name: "属性名", exact: true }).fill("型号");
  await page.locator("#btn-term-save").click();
  await expect(page.locator("#err-term-attributes")).toContainText("属性值");
  await page.getByRole("textbox", { name: "属性值", exact: true }).fill("A-100");
  await page.locator("#btn-add-attribute").click();
  await page.getByRole("textbox", { name: "属性名", exact: true }).nth(1).fill("地区");
  await page.getByRole("textbox", { name: "属性值", exact: true }).nth(1).fill("华东");
  await expect(page.locator("#err-term-attributes")).not.toHaveClass(/show/);
  await shot(page, "05-generic-attributes.png");
  await page.locator("#btn-term-save").click();
  const row = page.locator("#black-tbody tr", { hasText: "通用设备词条" });
  await expect(row).toContainText("型号：A-100；地区：华东");
  await expect(row.locator(".tag")).toHaveCount(0);
  await row.getByRole("button", { name: "客户服务助手", exact: true }).click();
  await expect(page.locator("#agent-title")).toHaveText("客户服务助手");
  await page.reload();
  await page.getByRole("button", { name: "词条管理", exact: true }).click();
  await page.locator("#black-search").fill("A-100");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "删除属性" }).last().click();
  await page.locator("#btn-term-save").click();
  await expect(row).not.toContainText("华东");
  expect(errors).toEqual([]);
});

test("按具体 Agent 筛选，范围跳转到对应 Agent", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "词条管理", exact: true }).click();
  await page.locator("#black-scope").selectOption("app");
  await page.locator("#list-agent").selectOption("app-safety");
  const links = page.locator("#black-tbody .scope-link");
  expect(await links.count()).toBeGreaterThan(0);
  for (const link of await links.all()) await expect(link).toHaveText("安全规程助手");
  await shot(page, "15-agent-scope-filter.png");
  await links.first().click();
  await expect(page.locator("#agent-title")).toHaveText("安全规程助手");
  expect(errors).toEqual([]);
});

test("旧本地数据迁移为通用属性，旧知识库写身份不升级为全局写权限", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("heihua-admin-poc-state-v1", JSON.stringify({ identity: "kb", entries: [{ id: "legacy", name: "旧设备", code: "OLD-1", aliases: ["旧别名"], definition: "旧释义", scope: { type: "kb", id: "kb-device" }, status: "enabled" }] }));
  });
  const errors = await open(page);
  await page.getByRole("button", { name: "词条管理", exact: true }).click();
  await expect(page.locator("#black-tbody")).toContainText("编码：OLD-1");
  await expect(page.locator("#black-tbody .scope-link")).toHaveText("设备运维助手");
  await expect(page.locator("#btn-black-add")).toBeHidden();
  await page.locator("#black-tbody").getByRole("button", { name: "查看", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "属性值", exact: true })).toHaveValue("OLD-1");
  await expect(page.locator("#btn-add-attribute")).toBeHidden();
  expect(errors).toEqual([]);
});

test("词条管理召回：全局与 Agent 范围、切换清空结果、停用后回退", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "词条管理", exact: true }).click();
  await page.locator("#btn-recall-open").click();
  await page.locator("#recall-query").fill("CT");
  await page.locator("#btn-recall-run").click();
  await expect(page.locator("#recall-result")).toContainText("电流互感器");
  await expect(page.locator("#recall-result")).not.toContainText("计量用电流互感器");
  await page.locator("#recall-scope").selectOption("app-device");
  await expect(page.locator("#recall-result")).toContainText("请重新查询");
  await page.locator("#btn-recall-run").click();
  await expect(page.locator("#recall-result")).toContainText("计量用电流互感器");
  await shot(page, "06-recall-agent.png");
  await page.locator("#recall-result").getByRole("button", { name: "设备运维助手", exact: true }).click();
  await expect(page.locator("#agent-title")).toHaveText("设备运维助手");
  await page.getByRole("button", { name: "词条管理", exact: true }).click();
  await page.locator("#black-search").fill("计量用电流互感器");
  await page.locator("#black-tbody tr").getByRole("button", { name: "停用", exact: true }).click();
  await page.locator("#btn-confirm-ok").click();
  await page.locator("#btn-recall-open").click();
  await page.locator("#btn-recall-run").click();
  await expect(page.locator("#recall-result")).not.toContainText("计量用电流互感器");
  await expect(page.locator("#recall-result")).toContainText("电流互感器");
  await page.locator("#recall-query").fill("没有匹配项");
  await page.locator("#btn-recall-run").click();
  await expect(page.locator("#recall-result")).toContainText("未召回");
  expect(errors).toEqual([]);
});
