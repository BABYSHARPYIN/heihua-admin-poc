import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const screenshotDir = resolve(process.cwd(), "docs/screenshots/final");
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
  await shot(page, "14-agent-config.png");
  expect(errors).toEqual([]);
});

test("全局列表布局、分页、搜索和筛选", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "黑话管理" }).click();
  await expect(page.locator("#black-tbody tr")).toHaveCount(8);
  await expect(page.locator("#black-footer-count")).toContainText("第 1 / 3 页");

  const scopeBox = await page.locator("#black-scope").boundingBox();
  const statusBox = await page.locator("#black-status").boundingBox();
  const actionBox = await page.locator("#btn-black-audit").boundingBox();
  expect(scopeBox.width).toBeLessThanOrEqual(190);
  expect(statusBox.width).toBeLessThanOrEqual(190);
  expect(Math.abs(scopeBox.y - statusBox.y)).toBeLessThan(2);
  expect(Math.abs(scopeBox.y - actionBox.y)).toBeLessThan(2);
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
  await page.getByRole("button", { name: "黑话管理" }).click();
  await page.locator("#btn-black-add").click();

  await page.locator("#btn-term-save").click();
  await expect(page.locator("#err-term-name")).toHaveText("请填写规范名");
  await page.fill("#term-name", "隔离设备");
  await page.fill("#term-code", "EQ-TEST-901");
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
  await expect(page.locator("#preview-result")).toContainText("隔离设备（EQ-TEST-901）");
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

test("导入先预览后写入，知识库页签锁定当前库", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "黑话管理" }).click();
  await page.locator("#btn-black-import").click();
  await page.locator("#btn-fill-import-sample").click();
  await expect(page.locator("#import-text")).toHaveValue(/^规范名,规范编码,别名,释义,作用范围,范围名称,状态/);
  await page.locator("#btn-preview-import").click();
  await expect(page.locator("#import-summary")).toContainText("通过 1 行");
  await expect(page.locator("#btn-import-confirm")).toBeEnabled();
  await shot(page, "04-import-preview.png");
  await page.locator("#btn-import-confirm").click();
  await expect(page.locator("#black-tbody tr", { hasText: "油色谱异常" })).toBeVisible();

  await page.getByRole("button", { name: "知识库", exact: true }).click();
  await page.locator('.knowledge-card[data-open-kb="kb-device"]').click();
  await page.getByRole("tab", { name: "黑话配置" }).click();
  await expect(page.locator("#kb-locked-note")).toContainText("设备运维知识库");
  await expect(page.locator("#kb-black-tbody tr")).toHaveCount(3);
  await shot(page, "05-kb-black-config.png");

  await page.locator("#btn-kb-black-add").click();
  await expect(page.locator("#scope-editor")).toBeHidden();
  await expect(page.locator("#scope-locked-box")).toContainText("指定知识库：设备运维知识库");
  await shot(page, "06-kb-locked-drawer.png");
  await page.keyboard.press("Escape");

  await page.locator("#btn-kb-black-import").click();
  await page.locator("#btn-fill-import-sample").click();
  await page.locator("#btn-preview-import").click();
  await expect(page.locator("#import-summary")).toContainText("通过 1 行");
  await page.locator("#btn-import-confirm").click();
  await expect(page.locator("#kb-black-tbody tr", { hasText: "端子箱受潮" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Agent 黑话增强开关与身份权限表现", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "专业 Agent" }).click();
  await page.locator('[data-agent-id="app-device"]').click();
  await page.getByRole("tab", { name: "Agent配置" }).click();
  await page.locator(".agent-demo-details summary").click();
  await expect(page.locator("#demo-result")).toContainText("识别到");
  await expect(page.locator("#switch-black")).toHaveClass(/on/);
  await shot(page, "07-agent-effect.png");

  await page.locator("#switch-black").click();
  await expect(page.locator("#demo-result")).toContainText("黑话增强已关闭");
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
  await page.getByRole("button", { name: "黑话管理" }).click();
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
  await expect(page.locator("#nav-blacktalk")).toBeHidden();
  await page.getByRole("button", { name: "知识库", exact: true }).click();
  await page.locator(".knowledge-card").first().click();
  await expect(page.getByRole("tab", { name: "黑话配置" })).toBeHidden();

  await page.locator(".demo-account summary").click();
  await page.locator("#identity-select").selectOption("kb");
  await page.locator(".demo-account summary").click();
  await expect(page.getByRole("tab", { name: "黑话配置" })).toBeVisible();
  await page.getByRole("tab", { name: "黑话配置" }).click();
  await expect(page.locator("#btn-kb-black-add")).toBeVisible();
  await page.getByRole("button", { name: "黑话管理" }).click();
  await expect(page.locator("#btn-black-add")).toBeHidden();
  await expect(page.locator("#btn-black-import")).toBeHidden();
  expect(errors).toEqual([]);
});

test("导出、变更留痕与回滚保持可用", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "黑话管理", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#btn-black-export").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
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
