import test from "node:test";
import assert from "node:assert/strict";
import { APPS, CSV_HEADERS, entriesToCsv, entryScopes, importRowsToEntries, migrateEntry, normalizeAliases, normalizeText, paginate, parseCsv, scopeKey, searchEntries, templateCsv, toCsv, validateEntry } from "../domain.mjs";
import { INITIAL_ENTRIES } from "../data.mjs";

const globalScope = { type: "global" };
const deviceScope = { type: "app", id: "app-device" };
const safetyScope = { type: "app", id: "app-safety" };
const serviceScope = { type: "app", id: "app-service" };
const candidate = (overrides = {}) => ({ id: "draft", name: "隔离开关", aliases: ["刀闸"], definition: "具有明显断开点的设备。", attributes: [], scopes: [globalScope], status: "enabled", ...overrides });

test("初始数据迁移为多范围，字段和同范围冲突校验正确", () => {
  const entries = INITIAL_ENTRIES.map(migrateEntry);
  for (const entry of entries) {
    assert.equal(validateEntry(entry, entries).valid, true, entry.name);
    assert.equal(Object.hasOwn(entry, "scope"), false);
    assert.equal(Object.hasOwn(entry, "code"), false);
    assert.ok(entry.scopes.length > 0);
  }
});

test("应用范围支持全局、多 Agent 及混合，重复范围归一", () => {
  for (const scopes of [[globalScope], [deviceScope, safetyScope], [globalScope, deviceScope, safetyScope]]) {
    const result = validateEntry(candidate({ scopes }), []);
    assert.equal(result.valid, true);
    assert.deepEqual(result.normalized.scopes, scopes);
  }
  assert.deepEqual(validateEntry(candidate({ scopes: [deviceScope, deviceScope, globalScope] }), []).normalized.scopes, [deviceScope, globalScope]);
});

test("应用范围必填，拒绝知识库、无效 Agent 和畸形数据", () => {
  for (const scopes of [[], undefined, "global", [null], [{ type: "kb", id: "kb-device" }], [{ type: "app", id: "missing" }], [{ type: "invalid" }]]) assert.ok(validateEntry(candidate({ scopes }), []).errors.scopes);
  const result = validateEntry(candidate({ name: "", definition: "" }), []);
  assert.equal(result.errors.name, "请填写词条名称");
  assert.equal(result.errors.definition, "请填写释义");
});

test("多个范围有交集时校验名称别名冲突，无交集可同名", () => {
  const existing = candidate({ id: "existing", scopes: [deviceScope, safetyScope] });
  for (const scopes of [[deviceScope], [globalScope, safetyScope], [serviceScope, safetyScope]]) {
    assert.equal(validateEntry(candidate({ scopes }), [existing]).valid, false);
    assert.equal(validateEntry(candidate({ name: "刀闸", aliases: [], scopes }), [existing]).valid, false);
    assert.equal(validateEntry(candidate({ name: "其他设备", scopes }), [existing]).valid, false);
  }
  assert.equal(validateEntry(candidate({ scopes: [serviceScope] }), [existing]).valid, true);
  assert.equal(validateEntry(candidate({ scopes: [globalScope] }), [existing]).valid, true);
  assert.equal(validateEntry(existing, [existing]).valid, true);
});

test("通用属性成对填写、名称不可重复，内容规范化", () => {
  for (const attributes of [[{ name: "电压", value: "" }], [{ name: "", value: "220kV" }], [{ name: "型号", value: "A" }, { name: "型 号", value: "B" }], "不是数组"]) assert.ok(validateEntry(candidate({ attributes }), []).errors.attributes);
  const result = validateEntry(candidate({ attributes: [{ name: " 型号 ", value: " A-100 " }] }), []);
  assert.equal(result.valid, true);
  assert.deepEqual(result.normalized.attributes, [{ name: "型号", value: "A-100" }]);
  assert.equal(normalizeText(" ＣＴ 流变 "), "ct流变");
  assert.deepEqual(normalizeAliases(["刀闸", "刀 闸", "ＤＳ", "ds"]), ["刀闸", "DS"]);
});

test("范围筛选取并集、空选和全选显示全部，词条不重复", () => {
  const entries = [candidate({ id: "global" }), candidate({ id: "device", scopes: [deviceScope, serviceScope] }), candidate({ id: "safety", scopes: [safetyScope] })];
  assert.deepEqual(searchEntries(entries, { scopeKeys: [] }).map(item => item.id), ["global", "device", "safety"]);
  assert.deepEqual(searchEntries(entries, { scopeKeys: ["global", "app:app-device"] }).map(item => item.id), ["global", "device"]);
  assert.deepEqual(searchEntries(entries, { scopeKeys: ["app:app-service", "app:app-device"] }).map(item => item.id), ["device"]);
  assert.equal(searchEntries(entries, { scopeKeys: ["global", ...APPS.map(app => `app:${app.id}`)] }).length, 3);
  assert.equal(paginate(entries, 99, 2).page, 2);
});

test("搜索和状态筛选覆盖名称、别名、释义与属性", () => {
  const entries = [candidate({ attributes: [{ name: "型号", value: "A-100" }] })];
  for (const keyword of ["隔离开关", "刀闸", "明显断开点", "A-100", "型号"]) assert.equal(searchEntries(entries, { keyword }).length, 1);
  assert.equal(searchEntries(entries, { status: "disabled" }).length, 0);
});

test("CSV 多范围与多属性完整往返，模板与表头一致", () => {
  const source = candidate({ scopes: [globalScope, deviceScope, safetyScope], definition: '含逗号,引号"与\n换行', attributes: [{ name: "补充", value: 'A,B"C\nD' }] });
  const csv = entriesToCsv([source]);
  const parsed = importRowsToEntries(`\uFEFF${csv}`);
  assert.equal(parsed.allValid, true);
  assert.deepEqual(parsed.rows[0].candidate.scopes, source.scopes);
  assert.deepEqual(parsed.rows[0].candidate.attributes, source.attributes);
  assert.deepEqual(parseCsv(csv)[0], CSV_HEADERS);
  assert.deepEqual(parseCsv(templateCsv())[0], CSV_HEADERS);
  assert.deepEqual(CSV_HEADERS, ["词条名称", "别名", "释义", "可扩展属性", "应用范围", "状态"]);
});

test("CSV 范围错误、属性错误及同批交集冲突阻止全部导入", () => {
  const rows = [CSV_HEADERS, ["新词条", "", "释义", "not-json", "全局", "启用"], ["新词条", "", "释义", "[]", "未知Agent", "启用"], ["新词条", "", "释义", "[]", "", "启用"]];
  assert.equal(importRowsToEntries(toCsv(rows)).invalidCount, 3);
  const duplicate = importRowsToEntries(entriesToCsv([candidate({ scopes: [deviceScope, safetyScope] }), candidate({ scopes: [safetyScope] })]));
  assert.equal(duplicate.validCount, 1);
  assert.equal(duplicate.allValid, false);
  assert.equal(importRowsToEntries("旧表头,旧编码\n测试,A").headersOk, false);
});

test("旧文件和单范围数据迁移，不扩大未知范围或丢失编码", () => {
  const oldHeader = ["词条名称", "别名", "释义", "\u4f5c\u7528\u8303\u56f4", "Agent名称", "状态"];
  const parsed = importRowsToEntries(toCsv([oldHeader, ["旧设备", "旧别名", "释义", "指定 Agent", "设备运维助手", "启用"]]));
  assert.equal(parsed.allValid, true);
  assert.deepEqual(parsed.rows[0].candidate.scopes, [deviceScope]);
  const migrated = migrateEntry({ id: "old", name: "旧设备", aliases: [], definition: "释义", code: "OLD-1", scope: { type: "kb", id: "kb-device" } });
  assert.deepEqual(migrated.scopes, [deviceScope]);
  assert.deepEqual(migrated.attributes, [{ name: "编码", value: "OLD-1" }]);
  assert.deepEqual(entryScopes(migrated), [deviceScope]);
  assert.equal(migrateEntry({ scope: { type: "kb", id: "unknown" } }), null);
  assert.equal(scopeKey(globalScope), "global");
});
