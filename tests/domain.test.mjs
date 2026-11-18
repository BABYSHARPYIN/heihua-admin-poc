import test from "node:test";
import assert from "node:assert/strict";
import {
  CSV_HEADERS,
  entriesToCsv,
  importRowsToEntries,
  normalizeAliases,
  normalizeText,
  paginate,
  parseCsv,
  resolveTerms,
  searchEntries,
  templateCsv,
  validateEntry,
} from "../domain.mjs";

const baseEntries = [
  {
    id: "global-1",
    name: "设备缺陷",
    code: "OPS-DF-001",
    aliases: ["缺陷"],
    definition: "设备运行中出现的异常状态。",
    scope: { type: "global" },
    status: "enabled",
  },
  {
    id: "app-1",
    name: "隔离开关",
    code: "EQ-DS-001",
    aliases: ["刀闸"],
    definition: "具有明显断开点的开关设备。",
    scope: { type: "app", id: "app-device" },
    status: "enabled",
  },
  {
    id: "kb-1",
    name: "计量用电流互感器",
    code: "KB-DEV-CT-01",
    aliases: ["计量流变"],
    definition: "用于计量回路的电流互感器。",
    scope: { type: "kb", id: "kb-device" },
    status: "enabled",
  },
];

function candidate(overrides = {}) {
  return {
    id: "draft",
    name: "新词条",
    code: "NEW-001",
    aliases: [],
    definition: "新词条释义。",
    scope: { type: "global" },
    status: "enabled",
    ...overrides,
  };
}

test("文本与别名规范化：全半角、大小写、空白和重复别名", () => {
  assert.equal(normalizeText("  ＣＴ　流变 "), "ct流变");
  assert.deepEqual(normalizeAliases([" 刀闸 ", "刀 闸", "ＤＳ", "ds", ""]), ["刀闸", "DS"]);
});

test("必填字段和作用范围必须完整", () => {
  const result = validateEntry(candidate({ name: "", code: "", definition: "", scope: { type: "app", id: "" } }), baseEntries);
  assert.equal(result.valid, false);
  assert.equal(result.errors.name, "请填写规范名");
  assert.equal(result.errors.code, "请填写规范编码");
  assert.equal(result.errors.definition, "请填写释义");
  assert.equal(result.errors.scope, "请选择范围对象");
});

test("规范编码在整个平台内唯一，同范围规范名唯一，跨范围同名允许", () => {
  const codeConflict = validateEntry(candidate({ code: "ops-df-001" }), baseEntries);
  assert.equal(codeConflict.valid, false);
  assert.match(codeConflict.errors.code, /已被/);

  const scopeConflict = validateEntry(candidate({ name: "设备缺陷", code: "NEW-002" }), baseEntries);
  assert.equal(scopeConflict.valid, false);
  assert.ok(scopeConflict.conflicts.some((item) => item.kind === "duplicate-name"));

  const crossScope = validateEntry(
    candidate({ name: "设备缺陷", code: "NEW-003", scope: { type: "app", id: "app-device" } }),
    baseEntries,
  );
  assert.equal(crossScope.valid, true);
});

test("别名与同范围规范名/别名共用冲突空间，并阻止保存", () => {
  const aliasConflict = validateEntry(
    candidate({ name: "隔离设备", code: "EQ-DS-002", aliases: ["刀闸"], scope: { type: "app", id: "app-device" } }),
    baseEntries,
  );
  assert.equal(aliasConflict.valid, false);
  assert.ok(aliasConflict.conflicts.some((item) => item.kind === "alias-conflict"));

  const nameIsAlias = validateEntry(
    candidate({ name: "刀闸", code: "EQ-DS-003", scope: { type: "app", id: "app-device" } }),
    baseEntries,
  );
  assert.ok(nameIsAlias.conflicts.some((item) => item.kind === "name-is-alias"));
});

test("知识库锁定范围内拒绝越界新增", () => {
  const result = validateEntry(
    candidate({ name: "越界词条", code: "KB-X-001", scope: { type: "app", id: "app-device" } }),
    baseEntries,
    { kbLockedId: "kb-device" },
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.scope, /当前知识库/);
});

test("列表搜索覆盖规范名、编码、别名和释义，并可组合筛选", () => {
  assert.deepEqual(searchEntries(baseEntries, { keyword: "刀闸" }).map((item) => item.id), ["app-1"]);
  assert.deepEqual(searchEntries(baseEntries, { keyword: "EQ-DS" }).map((item) => item.id), ["app-1"]);
  assert.deepEqual(searchEntries(baseEntries, { scopeType: "kb", status: "enabled" }).map((item) => item.id), ["kb-1"]);
});

test("分页会夹紧越界页并返回稳定总数", () => {
  const items = Array.from({ length: 17 }, (_, index) => index);
  const page = paginate(items, 99, 8);
  assert.equal(page.page, 3);
  assert.equal(page.pages, 3);
  assert.equal(page.total, 17);
  assert.deepEqual(page.items, [16]);
});

test("子范围优先于全局，停用词条不参与解析", () => {
  const entries = [
    ...baseEntries,
    {
      id: "app-disabled",
      name: "断路器",
      code: "EQ-CB-001",
      aliases: ["开关"],
      definition: "开关设备。",
      scope: { type: "app", id: "app-device" },
      status: "disabled",
    },
  ];
  const hits = resolveTerms("先看计量流变和刀闸，再检查开关", entries, { appId: "app-device", kbId: "kb-device" });
  assert.deepEqual(hits.map((hit) => hit.entry.id), ["kb-1", "app-1"]);
  assert.equal(hits[0].specificity, 3);
  assert.equal(hits[1].specificity, 2);
});

test("CSV 正确处理引号、逗号、换行与 BOM 往返", () => {
  const entries = [candidate({ definition: '含逗号, 引号"与\n换行', aliases: ["A|B"] })];
  const csv = `\uFEFF${entriesToCsv(entries)}`;
  const parsed = importRowsToEntries(csv, { entries: [] });
  assert.equal(parsed.allValid, true);
  assert.match(parsed.rows[0].candidate.definition, /含逗号, 引号"与\s+换行/);
  assert.deepEqual(parsed.rows[0].candidate.aliases, ["A", "B"]);
  assert.deepEqual(parseCsv('a,b\n"含逗号,和换行\n仍在同一单元格",c'), [
    ["a", "b"],
    ["含逗号,和换行\n仍在同一单元格", "c"],
  ]);
});

test("模板与导出字段一致", () => {
  const template = templateCsv().split(/\r?\n/)[0].split(",");
  assert.deepEqual(template, CSV_HEADERS);
  const exported = entriesToCsv(baseEntries).split(/\r?\n/)[0].split(",");
  assert.deepEqual(exported, CSV_HEADERS);
});

test("导入逐行预览，任一错误都不会被标为可原子写入", () => {
  const csv = [
    CSV_HEADERS.join(","),
    "设备缺陷,NEW-001,,重复编码,全局,,启用",
    "新词条,NEW-002,,有效释义,指定应用,不存在的应用,启用",
  ].join("\n");
  const parsed = importRowsToEntries(csv, { entries: baseEntries });
  assert.equal(parsed.validCount, 0);
  assert.equal(parsed.invalidCount, 2);
  assert.equal(parsed.allValid, false);
});

test("知识库锁定导入只接受当前知识库范围", () => {
  const csv = [
    CSV_HEADERS.join(","),
    "本库词条,NEW-KB-001,,释义,指定知识库,设备运维知识库,启用",
    "应用词条,NEW-APP-001,,释义,指定应用,设备运维助手,启用",
  ].join("\n");
  const parsed = importRowsToEntries(csv, { entries: baseEntries, kbLockedId: "kb-device" });
  assert.equal(parsed.rows[0].valid, true);
  assert.equal(parsed.rows[1].valid, false);
  assert.match(parsed.rows[1].errors.join(" "), /只能导入本库词条/);
});
