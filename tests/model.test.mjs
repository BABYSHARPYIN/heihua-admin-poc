import test from "node:test";
import assert from "node:assert/strict";
import { APPS, CSV_HEADERS, compareEntries, definitionSummary, effectiveEntries, entriesToCsv, importRowsToEntries, migrateEntry, normalizeText, paginate, parseCsv, searchEntries, templateCsv, toCsv, validateBatch, validateEntry } from "../domain.mjs";
import { INITIAL_ENTRIES } from "../data.mjs";

const globalScope = { type: "global" };
const deviceScope = { type: "app", id: "app-device" };
const safetyScope = { type: "app", id: "app-safety" };
const candidate = (overrides = {}) => ({ id: "draft", name: "隔离开关", definition: "具有明显断开点的设备。", scopes: [globalScope], status: "enabled", ...overrides });

test("示例一条记录一个词条，次数有区分且所有记录合法", () => {
  for (const entry of INITIAL_ENTRIES) {
    assert.equal(validateEntry(entry, INITIAL_ENTRIES).valid, true, entry.name);
    assert.equal(entry.name.includes("、"), false);
    assert.ok(Number.isSafeInteger(entry.recallCount));
    assert.deepEqual(Object.keys(entry).sort(), ["id", "name", "definition", "scopes", "status", "recallCount", "operator", "createdAt", "updatedAt"].sort());
  }
  assert.ok(new Set(INITIAL_ENTRIES.map(entry => entry.recallCount)).size > 1);
});

test("默认次数降序，同次数更新时间降序", () => {
  const entries = [{ id: "old", recallCount: 10, updatedAt: "2026-11-17" }, { id: "high", recallCount: 50, updatedAt: "2026-11-16" }, { id: "new", recallCount: 10, updatedAt: "2026-11-19" }, { id: "zero", updatedAt: "2026-11-20" }];
  assert.deepEqual(entries.sort(compareEntries).map(entry => entry.id), ["high", "new", "old", "zero"]);
});

test("批量输入忽略空值，每个词条生成独立候选并共享本次配置", () => {
  const common = { definition: "共同释义", scopes: [globalScope, deviceScope], status: "disabled" };
  const result = validateBatch(["甲", "  ", "乙"], common, []);
  assert.equal(result.valid, true);
  assert.deepEqual(result.candidates.map(entry => entry.name), ["甲", "乙"]);
  for (const entry of result.candidates) {
    assert.equal(entry.definition, common.definition);
    assert.deepEqual(entry.scopes, common.scopes);
    assert.equal(entry.status, common.status);
  }
  assert.equal(validateBatch(["", "  "], common, []).valid, false);
});

test("已有与同批词条冲突阻止保存，规范化后重复也阻止", () => {
  const common = { definition: "释义", scopes: [globalScope], status: "enabled" };
  assert.equal(validateBatch(["隔离开关", "新词"], common, [candidate({ id: "existing" })]).valid, false);
  const duplicate = validateBatch(["ＣＴ", "ct"], common, []);
  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.conflicts.length, 1);
  assert.equal(normalizeText(" ＣＴ "), "ct");
  assert.equal(validateEntry(candidate({ name: "甲、乙" }), []).valid, false);
  assert.equal(validateEntry(candidate({ name: "甲\n乙" }), []).valid, false);
});

test("应用范围必填，混选去重与交集冲突保持", () => {
  for (const scopes of [[], undefined, "global", [null], [{ type: "kb", id: "kb-device" }], [{ type: "app", id: "missing" }]]) assert.ok(validateEntry(candidate({ scopes }), []).errors.scopes);
  const result = validateEntry(candidate({ scopes: [globalScope, deviceScope, deviceScope] }), []);
  assert.deepEqual(result.normalized.scopes, [globalScope, deviceScope]);
  const existing = candidate({ id: "existing", scopes: [deviceScope, safetyScope] });
  assert.equal(validateEntry(candidate({ scopes: [globalScope, deviceScope] }), [existing]).valid, false);
  assert.equal(validateEntry(candidate({ scopes: [globalScope] }), [existing]).valid, true);
  assert.equal(validateEntry(existing, [existing]).valid, true);
});

test("范围筛选取并集、空选和全选显示全部，搜索只匹配词条释义", () => {
  const entries = [candidate({ id: "global" }), candidate({ id: "device", name: "设备词", scopes: [deviceScope, safetyScope] }), candidate({ id: "safety", name: "安全词", scopes: [safetyScope] })];
  assert.equal(searchEntries(entries, { scopeKeys: [] }).length, 3);
  assert.deepEqual(searchEntries(entries, { scopeKeys: ["global", "app:app-device"] }).map(entry => entry.id), ["global", "device"]);
  assert.equal(searchEntries(entries, { scopeKeys: ["app:app-device", "app:app-safety"] }).length, 2);
  assert.equal(searchEntries(entries, { scopeKeys: ["global", ...APPS.map(app => `app:${app.id}`)] }).length, 3);
  assert.equal(searchEntries(entries, { keyword: "明显断开点" }).length, 3);
  assert.equal(searchEntries(entries, { keyword: "设备运维助手" }).length, 0);
  assert.equal(paginate(entries, 99, 2).page, 2);
});

test("CSV 四列，单元格多个词条展开成独立记录，空项忽略", () => {
  const parsed = importRowsToEntries(toCsv([CSV_HEADERS, ["甲、、乙、", "共享释义", "全局|设备运维助手", "停用"]]));
  assert.equal(parsed.allValid, true);
  assert.deepEqual(parsed.entries.map(entry => entry.name), ["甲", "乙"]);
  assert.equal(new Set(parsed.entries.map(entry => entry.id)).size, 2);
  assert.ok(parsed.entries.every(entry => entry.definition === "共享释义" && entry.scopes.length === 2 && entry.status === "disabled" && entry.recallCount === 0));
  assert.deepEqual(CSV_HEADERS, ["词条", "释义", "应用范围", "状态"]);
});

test("CSV 逐条导出和往返，模板一致，保留逗号引号换行", () => {
  const source = [candidate({ name: "甲", definition: '含逗号,引号"与\n换行' }), candidate({ id: "other", name: "乙", scopes: [deviceScope] })];
  const csv = entriesToCsv(source);
  assert.equal(parseCsv(csv).length, 3);
  assert.deepEqual(parseCsv(csv)[0], CSV_HEADERS);
  assert.deepEqual(parseCsv(templateCsv())[0], CSV_HEADERS);
  const parsed = importRowsToEntries(`\uFEFF${csv}`);
  assert.equal(parsed.allValid, true);
  assert.deepEqual(parsed.entries.map(entry => entry.name), ["甲", "乙"]);
  assert.equal(parsed.entries[0].definition, '含逗号,引号"与 换行');
});

test("导入现有冲突、同单元格及跨行冲突、无效范围全部阻止", () => {
  for (const rows of [
    [["甲、甲", "释义", "全局", "启用"]],
    [["甲", "释义", "全局", "启用"], ["甲", "释义", "全局", "启用"]],
    [["隔离开关、乙", "释义", "全局", "启用"]],
    [["甲", "释义", "未知Agent", "启用"]],
  ]) assert.equal(importRowsToEntries(toCsv([CSV_HEADERS, ...rows]), { entries: [candidate()] }).allValid, false);
  assert.equal(importRowsToEntries("不支持的表头\n甲").headersOk, false);
});

test("旧浏览器记录转换为精简结构，保留次数、范围和更新时间", () => {
  const raw = JSON.parse('{"id":"old","name":"旧词","definition":"释义","aliases":["obsolete"],"attributes":[{"name":"removed","value":"OLD-1"}],"code":"OLD","scope":{"type":"kb","id":"kb-device"},"recallCount":8,"updatedAt":"2026-11-19"}');
  const migrated = migrateEntry(raw);
  assert.deepEqual(Object.keys(migrated).sort(), ["id", "name", "definition", "scopes", "status", "recallCount", "operator", "createdAt", "updatedAt"].sort());
  assert.equal(migrated.recallCount, 8);
  assert.deepEqual(migrated.scopes, [deviceScope]);
  assert.equal(migrateEntry({ ...raw, scope: { type: "kb", id: "unknown" } }), null);
  assert.equal(migrateEntry({ ...raw, recallCount: -1 }).recallCount, 0);
});

test("释义摘要按字符截断200字，使用三个英文点结尾", () => {
  assert.equal(definitionSummary("甲".repeat(200)), "甲".repeat(200));
  assert.equal(definitionSummary("甲".repeat(201)), "甲".repeat(200) + "...");
  assert.equal(definitionSummary("😀".repeat(201)), "😀".repeat(200) + "...");
});

test("启用状态与Agent开关共同决定生效，同词Agent配置优先", () => {
  const entries = [candidate({ id: "global" }), candidate({ id: "direct", scopes: [deviceScope] }), candidate({ id: "disabled", name: "停用项", status: "disabled" })];
  assert.deepEqual(effectiveEntries(entries, "app-device", false), []);
  assert.deepEqual(effectiveEntries(entries, "app-device", true).map(entry => entry.id), ["direct"]);
  assert.deepEqual(effectiveEntries(entries.map(entry => entry.id === "direct" ? { ...entry, status: "disabled" } : entry), "app-device", true).map(entry => entry.id), ["global"]);
  assert.deepEqual(effectiveEntries(entries, "app-safety", true).map(entry => entry.id), ["global"]);
});
