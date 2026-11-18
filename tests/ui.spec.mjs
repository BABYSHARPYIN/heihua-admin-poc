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

  await page.getByRole("button", { name: "知识库" }).click();
  await page.locator("#kb-list-tbody tr", { hasText: "设备运维知识库" }).getByRole("button", { name: "设置" }).click();
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
  await expect(page.locator("#demo-result")).toContainText("识别到");
  await expect(page.locator("#switch-black")).toHaveClass(/on/);
  await shot(page, "07-agent-effect.png");

  await page.locator("#switch-black").click();
  await expect(page.locator("#demo-result")).toContainText("黑话增强已关闭");
  await expect(page.locator("#switch-black")).not.toHaveClass(/on/);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "专业 Agent" }).click();
  await expect(page.locator("#switch-black")).not.toHaveClass(/on/);

  await page.locator("#identity-select").selectOption("view");
  await expect(page.locator("#switch-black")).toBeDisabled();
  await page.getByRole("button", { name: "黑话管理" }).click();
  await expect(page.locator("#btn-black-add")).toBeHidden();
  await expect(page.locator("#btn-black-import")).toBeHidden();
  await expect(page.locator("#black-tbody tr").first().getByRole("button", { name: "查看" })).toBeVisible();
  await page.locator("#black-tbody tr").first().getByRole("button", { name: "查看" }).click();
  await expect(page.locator("#btn-term-save")).toBeHidden();
  await page.keyboard.press("Escape");
  await shot(page, "08-view-only.png");

  await page.locator("#identity-select").selectOption("none");
  await expect(page.locator("#nav-blacktalk")).toBeHidden();
  await page.getByRole("button", { name: "知识库" }).click();
  await page.locator("#kb-list-tbody tr").first().getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("tab", { name: "黑话配置" })).toBeHidden();

  await page.locator("#identity-select").selectOption("kb");
  await expect(page.getByRole("tab", { name: "黑话配置" })).toBeVisible();
  await page.getByRole("tab", { name: "黑话配置" }).click();
  await expect(page.locator("#btn-kb-black-add")).toBeVisible();
  await page.getByRole("button", { name: "黑话管理" }).click();
  await expect(page.locator("#btn-black-add")).toBeHidden();
  await expect(page.locator("#btn-black-import")).toBeHidden();
  expect(errors).toEqual([]);
});
