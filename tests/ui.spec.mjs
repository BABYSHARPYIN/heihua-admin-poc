import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importRowsToEntries } from "../domain.mjs";

const screenshotDir = resolve(process.cwd(), "docs/screenshots/records-final");
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

async function selectScopes(page, names) {
  const root = await picker(page, "term-scope-picker");
  for (const name of names) await root.getByRole("checkbox", { name, exact: true }).check();
  await page.keyboard.press("Escape");
}

test("新增批量拆为独立记录，空值忽略，单条编辑保留次数", async ({ page }) => {
  const errors = await open(page);
  await terms(page);
  await page.locator("#btn-black-add").click();
  await expect(page.locator("#term-name")).toBeFocused();
  await expect(page.locator("#term-form > .form-row")).toHaveCount(4);
  await expect(page.locator("#term-form")).not.toContainText(/操作人|更新人|创建人/);
  await page.locator("#btn-term-save").click();
  await expect(page.locator("#err-term-name")).toHaveText("请填写词条");
  await page.locator("#term-name").fill("现场甲");
  await page.locator("#btn-add-term").click();
  await page.locator("[data-term-input]").nth(1).fill("现场乙");
  await page.locator("#btn-add-term").click();
  await page.locator("[data-term-input]").nth(2).fill("待删除");
  await page.getByRole("button", { name: "删除词条 3", exact: true }).click();
  await page.locator("#btn-add-term").click();
  await page.locator("#term-definition").fill("本次共享释义");
  await selectScopes(page, ["全局", "设备运维助手", "安全规程助手"]);
  await page.locator('input[name="term-status"][value="disabled"]').check();
  await shot(page, "05-batch-create.png");
  await page.locator("#btn-term-save").click();
  await page.locator("#black-search").fill("本次共享释义");
  const rows = page.locator("#black-tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.locator("td:first-child")).toHaveText(["现场甲", "现场乙"]);
  for (const row of await rows.all()) {
    await expect(row).toContainText("本次共享释义");
    await expect(row.locator("td").nth(2)).toHaveText("全局、设备运维助手、安全规程助手");
    await expect(row.locator("td").nth(4)).toHaveText("0");
    await expect(row.locator(".status-disabled")).toBeVisible();
  }
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem("heihua-admin-poc-state-v2")).entries.filter(entry => entry.name.startsWith("现场")));
  expect(new Set(records.map(entry => entry.id)).size).toBe(2);
  await rows.first().getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator("#term-name")).toBeFocused();
  await expect(page.locator("[data-term-input]")).toHaveCount(1);
  await expect(page.locator("#btn-add-term")).toBeHidden();
  await expect(page.locator("[data-remove-term]")).toHaveCount(0);
  await page.locator("#term-name").fill("合并甲、合并乙");
  await page.locator("#btn-term-save").click();
  await expect(page.locator("#err-term-name")).toHaveText("每项只能填写一个词条");
  await page.locator("#term-name").fill("现场甲更新");
  await page.locator("#term-definition").fill("单条更新释义");
  await shot(page, "06-single-edit.png");
  await page.locator("#btn-term-save").click();
  await page.reload({ waitUntil: "networkidle" });
  await terms(page);
  await page.locator("#black-search").fill("现场甲更新");
  await expect(rows).toHaveCount(1);
  await page.locator("#black-search").fill("现场乙");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("本次共享释义");
  expect(errors).toEqual([]);
});

test("单条变更记录按ID隔离，同名不同范围也不会混入", async ({ page }) => {
  await page.addInitScript(() => {
    const entries = [
      { id: "audit-a", name: "相同用语", definition: "甲释义", scopes: [{ type: "global" }], status: "enabled", recallCount: 100, operator: "工程师甲" },
      { id: "audit-b", name: "相同用语", definition: "乙释义", scopes: [{ type: "app", id: "app-device" }], status: "enabled", recallCount: 90, operator: "工程师乙" },
    ];
    const audit = entries.map((entry, index) => ({ id: "audit-" + index, termId: entry.id, termName: entry.name, action: index ? "导入" : "新增", at: "2026-11-19T00:00:00Z", scopes: entry.scopes, operator: entry.operator, before: null, after: entry }));
    localStorage.setItem("heihua-admin-poc-state-v2", JSON.stringify({ entries, audit, identity: "full" }));
  });
  const errors = await open(page);
  await terms(page);
  await page.locator("#black-tbody tr").first().getByRole("button", { name: "变更记录", exact: true }).click();
  await expect(page.locator("#audit-content tbody tr")).toHaveCount(1);
  await expect(page.locator("#audit-content tbody tr td").nth(4)).toHaveText("admin");
  await expect(page.locator("#audit-content tbody tr td").nth(1)).toHaveText("新增");
  await expect(page.locator("#audit-content th")).toHaveText(["时间", "操作", "词条", "应用范围", "操作人"]);
  await expect(page.locator("#audit-content button, #audit-content a")).toHaveCount(0);
  await shot(page, "12-record-history.png");
  await page.keyboard.press("Escape");
  await page.locator("#black-tbody tr").nth(1).getByRole("button", { name: "变更记录", exact: true }).click();
  await expect(page.locator("#audit-content tbody tr")).toHaveCount(1);
  await expect(page.locator("#audit-content tbody tr td").nth(4)).toHaveText("admin");
  await expect(page.locator("#audit-content tbody tr td").nth(1)).toHaveText("导入");
  await expect(page.locator("#audit-content button, #audit-content a")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("释义摘要准确显示200字并追加三个英文点，完整内容仍可编辑", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("heihua-admin-poc-state-v2", JSON.stringify({ identity: "full", entries: [{ id: "long", name: "长释义词条", definition: "测".repeat(201), scopes: [{ type: "global" }], status: "enabled", recallCount: 66, operator: "admin" }] })));
  const errors = await open(page);
  await terms(page);
  await expect(page.locator(".definition-cell")).toHaveText("测".repeat(200) + "...");
  await expect(page.locator("#black-tbody td").nth(6)).toHaveText("admin");
  await page.locator("#black-tbody").getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator("#term-definition")).toHaveValue("测".repeat(201));
  expect(errors).toEqual([]);
});

test("同批与已有冲突阻止保存，处理后简化停用删除确认可用", async ({ page }) => {
  const errors = await open(page);
  await terms(page);
  await page.locator("#btn-black-add").click();
  await expect(page.locator("#term-name")).toBeFocused();
  await page.locator("#term-name").fill("五防");
  await page.locator("#term-definition").fill("测试释义");
  await selectScopes(page, ["全局"]);
  await expect(page.locator("#term-conflicts")).toContainText("五防");
  await expect(page.locator("#btn-term-save")).toBeDisabled();
  await page.locator("#term-name").fill("待测甲");
  await page.locator("#btn-add-term").click();
  await page.locator("[data-term-input]").nth(1).fill("待测甲");
  await expect(page.locator("#term-conflicts")).toContainText("待测甲");
  await expect(page.locator("#btn-term-save")).toBeDisabled();
  await shot(page, "07-batch-conflict.png");
  await page.getByRole("button", { name: "删除词条 2", exact: true }).click();
  await expect(page.locator("#btn-term-save")).toBeEnabled();
  await page.locator("#btn-term-save").click();
  await page.locator("#black-search").fill("待测甲");
  const row = page.locator("#black-tbody tr");
  await row.getByRole("button", { name: "停用", exact: true }).click();
  await expect(page.locator("#modal-confirm .modal-body")).toHaveText("确认停用 「待测甲」？");
  await expect(page.locator("#confirm-extra, #modal-confirm .confirm-warning")).toHaveCount(0);
  await expect(page.locator("#btn-confirm-ok")).toHaveClass("btn btn-primary");
  await shot(page, "08-disable-confirm.png");
  await page.locator("#btn-confirm-ok").click();
  await expect(row.locator(".status-disabled")).toBeVisible();
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator("#modal-confirm .modal-body")).toHaveText("确认删除 「待测甲」？");
  await shot(page, "09-delete-confirm.png");
  await page.locator("#btn-confirm-ok").click();
  await expect(row).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("导入顿号拆成独立记录，导出每条一行，冲突时原子阻止写入", async ({ page }) => {
  const errors = await open(page);
  await terms(page);
  await page.locator("#btn-black-import").click();
  await page.locator("#import-text").fill('词条,释义,应用范围,状态\n导入甲、、导入乙,共同释义,全局|设备运维助手,启用');
  await page.locator("#btn-preview-import").click();
  await expect(page.locator("#import-summary")).toContainText("通过 1 行");
  await shot(page, "10-import-preview.png");
  await page.locator("#btn-import-confirm").click();
  await page.locator("#black-search").fill("导入");
  await expect(page.locator("#black-tbody tr")).toHaveCount(2);
  await expect(page.locator("#black-tbody td:first-child")).toHaveText(["导入甲", "导入乙"]);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#btn-black-export").click();
  const download = await downloadPromise;
  const csv = readFileSync(await download.path(), "utf8");
  const parsed = importRowsToEntries(csv);
  expect(csv.split(/\r?\n/)).toHaveLength(3);
  expect(parsed.entries.map(entry => entry.name)).toEqual(["导入甲", "导入乙"]);
  expect(parsed.entries.every(entry => entry.scopes.length === 2 && entry.recallCount === 0)).toBe(true);
  await page.locator("#btn-black-import").click();
  for (const value of ['词条,释义,应用范围,状态\n导入甲、新词,释义,全局,启用', '词条,释义,应用范围,状态\n新词、新词,释义,全局,启用']) {
    await page.locator("#import-text").fill(value);
    await page.locator("#btn-preview-import").click();
    await expect(page.locator("#btn-import-confirm")).toBeDisabled();
  }
  await page.keyboard.press("Escape");
  await page.locator("#black-search").fill("新词");
  await expect(page.locator("#black-tbody tr")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("编辑保留次数，变更记录只读，查看身份禁止写入", async ({ page }) => {
  const errors = await open(page);
  await terms(page);
  const first = page.locator("#black-tbody tr").first();
  const count = await first.locator("td").nth(4).innerText();
  await first.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator("#term-name")).toBeFocused();
  await page.locator("#term-definition").fill("更新后释义");
  await page.locator("#btn-term-save").click();
  await expect(first.locator("td").nth(4)).toHaveText(count);
  await first.getByRole("button", { name: "变更记录", exact: true }).click();
  await expect(page.locator("#audit-content tbody tr")).toHaveCount(1);
  await expect(page.locator("#audit-content tbody td").nth(4)).toHaveText("admin");
  await expect(page.locator("#audit-content button, #audit-content a")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(first).toContainText("更新后释义");
  await page.locator(".demo-account summary").click();
  await page.locator("#identity-select").selectOption("view");
  await page.locator(".demo-account summary").click();
  await expect(page.locator("#btn-black-add")).toBeHidden();
  await first.getByRole("button", { name: "查看", exact: true }).click();
  await expect(page.locator("#btn-term-save")).toBeHidden();
  await expect(page.locator("#term-name")).toHaveAttribute("readonly", "");
  await expect(page.locator("#term-scope-picker .scope-picker-trigger")).toBeDisabled();
  await shot(page, "11-readonly.png");
  expect(errors).toEqual([]);
});

test("旧浏览器数据精简迁移，保留原模块设置和合法次数", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("heihua-admin-poc-state-v2")) return;
    localStorage.setItem("heihua-admin-poc-state-v1", '{"identity":"full","entries":[{"id":"old","name":"旧词","aliases":["obsolete"],"attributes":[{"name":"removed","value":"OLD-1"}],"definition":"原释义","scope":{"type":"app","id":"app-device"},"status":"enabled","recallCount":27}],"switches":{"black":{"app-device":false}}}');
  });
  const errors = await open(page);
  await terms(page);
  await expect(page.locator("#black-tbody tr")).toContainText("旧词");
  await expect(page.locator("#black-tbody tr td:nth-child(5)")).toHaveText("27");
  await page.locator("#black-tbody").getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator("#term-name")).toBeFocused();
  await page.locator("#term-definition").fill("新释义");
  await page.locator("#btn-term-save").click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("heihua-admin-poc-state-v2")));
  expect(Object.keys(saved.entries[0]).sort()).toEqual(["id", "name", "definition", "scopes", "status", "recallCount", "operator", "updatedAt"].sort());
  expect(saved.entries[0].recallCount).toBe(27);
  expect(saved.switches.black["app-device"]).toBe(false);
  expect(errors).toEqual([]);
});

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

test('列表列与次数排序、范围纯文本、搜索分页', async ({ page }) => {
  const errors = await open(page);
  await terms(page);
  await expect(page.locator('#page-terms th')).toHaveText(['词条', '释义', '应用范围', '状态', '召回次数', '更新时间', '操作人', '操作']);
  await expect(page.locator('#page-terms .toolbar').getByRole('button', { name: '变更记录', exact: true })).toHaveCount(0);
  const historyBox = await page.locator('#black-tbody tr').first().getByRole('button', { name: '变更记录', exact: true }).boundingBox();
  expect(historyBox.x + historyBox.width).toBeLessThanOrEqual(1429);
  await expect(page.locator('#black-tbody tr')).toHaveCount(8);
  const counts = await page.locator('#black-tbody tr td:nth-child(5)').allTextContents();
  expect(counts.map(Number)).toEqual([...counts.map(Number)].sort((first, second) => second - first));
  await expect(page.locator('#black-tbody tr').first()).toContainText('五防');
  await expect(page.locator('#black-tbody tr').nth(1)).toContainText('隔离开关');
  const tied = page.locator('#black-tbody tr').filter({ hasText: '310' });
  await expect(tied).toHaveCount(2);
  await expect(tied.first()).toContainText('断路器');
  await expect(page.locator('#black-tbody td:nth-child(3) button, #black-tbody td:nth-child(3) a, #black-tbody label, #black-tbody .tag')).toHaveCount(0);
  await page.locator('#black-tbody td:nth-child(3)').nth(1).click();
  await expect(page.locator('#page-terms')).toBeVisible();
  await expect(page.locator('#page-terms')).not.toContainText(/全局\s*\d|指定 Agent|词条召回/);
  await expect(page.locator('#modal-recall, #btn-recall-open, #terms-meta')).toHaveCount(0);
  await shot(page, '03-term-list.png');
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('#black-footer-count')).toContainText('第 2 / 3 页');
  await page.locator('#black-search').fill('明显断开点');
  await expect(page.locator('#black-tbody tr')).toHaveCount(1);
  await page.locator('#black-search').fill('SAFE-WF-008');
  await expect(page.locator('#black-empty')).toBeVisible();
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
