import test from "node:test";
import assert from "node:assert/strict";
import { CSV_HEADERS, SCOPE_TYPES, entriesToCsv, importRowsToEntries, migrateEntry, normalizeAliases, normalizeText, paginate, parseCsv, resolveTerms, searchEntries, templateCsv, toCsv, validateEntry } from "../domain.mjs";
import { INITIAL_ENTRIES } from "../data.mjs";

const candidate = (overrides = {}) => ({ id: "draft", name: "隔离开关", aliases: ["刀闸"], definition: "具有明显断开点的设备。", attributes: [{ name: "设备类型", value: "隔离设备" }], scope: { type: "global" }, status: "enabled", ...overrides });
const entries = [candidate({ id: "global" }), candidate({ id: "device", name: "检修隔离开关", scope: { type: "app", id: "app-device" } }), candidate({ id: "other", name: "安全隔离设备", scope: { type: "app", id: "app-safety" } })];

test("初始数据符合通用模型且无同范围冲突", () => {
  for (const entry of INITIAL_ENTRIES) {
    assert.equal(validateEntry(entry, INITIAL_ENTRIES).valid, true, entry.name);
    assert.equal(Object.hasOwn(entry, "code"), false);
    assert.ok(["global", "app"].includes(entry.scope.type));
  }
});

test("通用模型没有必填编码，保留多条属性并规范化", () => {
  const result = validateEntry(candidate({ attributes: [{ name: " 电压 ", value: " 220kV " }, { name: "型号", value: "DS-1" }] }), []);
  assert.equal(result.valid, true);
  assert.equal(Object.hasOwn(result.normalized, "code"), false);
  assert.deepEqual(result.normalized.attributes, [{ name: "电压", value: "220kV" }, { name: "型号", value: "DS-1" }]);
  assert.equal(normalizeText(" ＣＴ 流变 "), "ct流变");
  assert.deepEqual(normalizeAliases(["刀闸", "刀 闸", "ＤＳ", "ds"]), ["刀闸", "DS"]);
});

test("只允许全局或真实 Agent，拒绝知识库、未知 Agent 和缺失范围", () => {
  assert.deepEqual(SCOPE_TYPES.map(item => item.value), ["global", "app"]);
  for (const scope of [{ type: "kb", id: "kb-device" }, { type: "app", id: "missing" }, { type: "app" }, { type: "invalid" }, undefined]) assert.equal(validateEntry(candidate({ scope }), []).valid, false);
  const result = validateEntry(candidate({ name: "", definition: "" }), []);
  assert.equal(result.errors.name, "请填写词条名称");
  assert.equal(result.errors.definition, "请填写释义");
});

test("属性成对填写且名称不能重复，属性值跨词条可重复", () => {
  for (const attributes of [[{ name: "电压", value: "" }], [{ name: "", value: "220kV" }], [{ name: "型号", value: "A" }, { name: "型 号", value: "B" }], "不是数组"]) assert.ok(validateEntry(candidate({ attributes }), []).errors.attributes);
  assert.equal(validateEntry(candidate({ scope: { type: "app", id: "app-service" } }), entries).valid, true);
});

test("同范围名称与别名冲突，不同 Agent 可同名且可覆盖全局", () => {
  assert.equal(validateEntry(candidate(), entries).valid, false);
  assert.equal(validateEntry(candidate({ name: "刀闸", aliases: [] }), entries).valid, false);
  assert.equal(validateEntry(candidate({ name: "其他设备" }), entries).valid, false);
  assert.equal(validateEntry(candidate({ scope: { type: "app", id: "app-service" } }), entries).valid, true);
  assert.equal(validateEntry({ ...entries[0] }, entries).valid, true);
});

test("搜索覆盖名称、别名和释义，不使用隐藏旧属性", () => {
  for (const keyword of ["刀闸", "明显断开点", "隔离设备"]) assert.ok(searchEntries(entries, { keyword }).length > 0);
  assert.equal(searchEntries(entries, { keyword: "设备类型" }).length, 0);
  assert.deepEqual(searchEntries(entries, { scopeId: "app-device" }).map(item => item.id), ["device"]);
  assert.deepEqual(searchEntries(entries, { scopeType: "global" }).map(item => item.id), ["global"]);
  assert.equal(paginate(entries, 99, 2).page, 2);
});

test("召回全局或指定 Agent，Agent 优先且停用不召回", () => {
  assert.deepEqual(resolveTerms("刀闸", entries).map(hit => hit.entry.id), ["global"]);
  assert.deepEqual(resolveTerms("刀闸", entries, { appId: "app-device" }).map(hit => hit.entry.id), ["device"]);
  assert.deepEqual(resolveTerms("刀闸", entries, { appId: "app-safety" }).map(hit => hit.entry.id), ["other"]);
  assert.deepEqual(resolveTerms("刀闸", entries.map(item => ({ ...item, status: "disabled" })), { appId: "app-device" }), []);
  assert.deepEqual(resolveTerms("无匹配内容", entries), []);
  assert.deepEqual(resolveTerms("刀闸", [candidate({ scope: { type: "kb", id: "kb-device" } })], { kbId: "kb-device" }), []);
});

test("CSV 仅保留六列，释义逗号引号换行往返，模板表头一致", () => {
  const source = candidate({ definition: '含逗号,引号"与\n换行', attributes: [{ name: "扩展说明", value: 'A,B"C\nD' }] });
  const csv = entriesToCsv([source]);
  const parsed = importRowsToEntries(`\uFEFF${csv}`);
  assert.equal(parsed.allValid, true);
  assert.deepEqual(parsed.rows[0].candidate.attributes, []);
  assert.equal(parsed.rows[0].candidate.definition, '含逗号,引号"与 换行');
  assert.deepEqual(parseCsv(csv)[0], CSV_HEADERS);
  assert.deepEqual(parseCsv(templateCsv())[0], CSV_HEADERS);
  assert.deepEqual(CSV_HEADERS, ["词条名称", "别名", "释义", "作用范围", "Agent名称", "状态"]);
});

test("导入校验属性、Agent、同批冲突及旧结构，错误不可原子导入", () => {
  const rows = [["词条名称", "别名", "释义", "可扩展属性", "作用范围", "Agent名称", "状态"], ["新词条", "", "释义", "not-json", "全局", "", "启用"], ["新词条", "", "释义", "[]", "指定 Agent", "missing", "启用"], ["新词条", "", "释义", "[]", "指定知识库", "设备运维知识库", "启用"]];
  assert.equal(importRowsToEntries(toCsv(rows)).invalidCount, 3);
  const duplicate = importRowsToEntries(entriesToCsv([candidate(), candidate()]));
  assert.equal(duplicate.validCount, 1);
  assert.equal(duplicate.allValid, false);
  assert.equal(importRowsToEntries("旧表头,旧编码\n测试,A").headersOk, false);
});

test("旧七列文件仍可导入，历史属性不丢失", () => {
  const csv = toCsv([["词条名称", "别名", "释义", "可扩展属性", "作用范围", "Agent名称", "状态"], ["旧设备", "", "旧释义", '[{"name":"编码","value":"OLD-1"}]', "全局", "", "启用"]]);
  const parsed = importRowsToEntries(csv);
  assert.equal(parsed.allValid, true);
  assert.deepEqual(parsed.rows[0].candidate.attributes, [{name: "编码", value: "OLD-1"}]);
});

test("迁移编码为普通属性，已知旧范围转原对应 Agent，未知范围不扩大权限", () => {
  const migrated = migrateEntry({ ...candidate(), code: "EQ-1", scope: { type: "kb", id: "kb-device" } });
  assert.equal(Object.hasOwn(migrated, "code"), false);
  assert.deepEqual(migrated.attributes, [{ name: "设备类型", value: "隔离设备" }, { name: "编码", value: "EQ-1" }]);
  assert.deepEqual(migrated.scope, { type: "app", id: "app-device" });
  assert.equal(migrateEntry(candidate({ scope: { type: "kb", id: "unknown" } })), null);
});
