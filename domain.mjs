export const APPS = [
  { id: "app-device", name: "设备运维助手" },
  { id: "app-safety", name: "安全规程助手" },
  { id: "app-service", name: "客户服务助手" },
];

export const KNOWLEDGE_BASES = [
  { id: "kb-device", name: "设备运维知识库", code: "KB-DEVICE", description: "设备台账、检修计划与故障处置口径。" },
  { id: "kb-safety", name: "安全规程知识库", code: "KB-SAFETY", description: "电力安全工作规程、工作票与操作票。" },
  { id: "kb-service", name: "客户服务知识库", code: "KB-SERVICE", description: "服务话术、业务办理与投诉处理。" },
];

export const STATUS_OPTIONS = [
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "停用" },
];

export const CSV_HEADERS = ["词条", "释义", "应用范围", "状态"];

export function normalizeText(value = "") {
  return String(value).normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

export function cleanText(value = "") {
  return String(value).normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function scopeKey(scope) {
  return scope?.type === "global" ? "global" : `${scope?.type}:${scope?.id || ""}`;
}

export function scopeLabel(scope, apps = APPS) {
  return scope?.type === "global" ? "全局" : apps.find(item => item.id === scope?.id)?.name || "未选择 Agent";
}

export function normalizeScopes(scopes) {
  if (!Array.isArray(scopes)) return [];
  const unique = new Map();
  for (const scope of scopes) {
    if (!scope || typeof scope !== "object") continue;
    const normalized = scope.type === "global" ? { type: "global" } : { type: scope.type, id: scope.id || "" };
    unique.set(scopeKey(normalized), normalized);
  }
  return [...unique.values()];
}

export function entryScopes(entry) {
  return normalizeScopes(entry?.scopes ?? (entry?.scope ? [entry.scope] : []));
}

export function scopesLabel(scopes, apps = APPS) {
  return normalizeScopes(scopes).map(scope => scopeLabel(scope, apps)).join("、");
}

export function migrateEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const legacyTargets = { "kb-device": "app-device", "kb-safety": "app-safety", "kb-service": "app-service" };
  const scopes = entryScopes(entry).map(scope => scope.type === "kb" && legacyTargets[scope.id] ? { type: "app", id: legacyTargets[scope.id] } : scope);
  if (!scopes.length || scopes.some(scope => scope.type !== "global" && !(scope.type === "app" && APPS.some(item => item.id === scope.id)))) return null;
  return {
    id: entry.id,
    name: cleanText(entry.name),
    definition: cleanText(entry.definition),
    scopes: normalizeScopes(scopes),
    status: entry.status === "disabled" ? "disabled" : "enabled",
    recallCount: Number.isSafeInteger(entry.recallCount) && entry.recallCount >= 0 ? entry.recallCount : 0,
    operator: "admin",
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export function compareEntries(first, second) {
  return (second.recallCount || 0) - (first.recallCount || 0)
    || (Date.parse(second.updatedAt) || 0) - (Date.parse(first.updatedAt) || 0);
}

export function definitionSummary(definition = "") {
  const characters = Array.from(String(definition));
  return characters.length > 200 ? characters.slice(0, 200).join("") + "..." : characters.join("");
}

export function effectiveEntries(entries, appId, enhancementEnabled) {
  if (!enhancementEnabled || !APPS.some(app => app.id === appId)) return [];
  const selected = new Map();
  for (const entry of entries) {
    if (entry.status !== "enabled") continue;
    const scopes = entryScopes(entry);
    const direct = scopes.some(scope => scope.type === "app" && scope.id === appId);
    if (!direct && !scopes.some(scope => scope.type === "global")) continue;
    const key = normalizeText(entry.name);
    const previous = selected.get(key);
    if (!previous || direct && !previous.direct) selected.set(key, { entry, direct });
  }
  return [...selected.values()].map(item => item.entry);
}

export function statusLabel(status) {
  return status === "disabled" ? "停用" : "启用";
}

export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function validateEntry(candidate, entries) {
  const errors = {};
  const conflicts = [];
  const name = cleanText(candidate?.name);
  const definition = cleanText(candidate?.definition);
  const scopes = entryScopes(candidate);
  const status = candidate?.status === "disabled" ? "disabled" : "enabled";

  if (!name) errors.name = "请填写词条";
  else if (/[、\r\n]/.test(String(candidate.name))) errors.name = "每项只能填写一个词条";
  else if (name.length > 60) errors.name = "词条不能超过 60 个字符";
  if (!definition) errors.definition = "请填写释义";
  if (!scopes.length) errors.scopes = "请选择应用范围";
  if (scopes.some(scope => scope.type === "global") && scopes.some(scope => scope.type === "app")) errors.scopes = "全局与具体 Agent 不能同时选择";
  if (scopes.some(scope => scope.type !== "global" && !(scope.type === "app" && APPS.some(item => item.id === scope.id)))) errors.scopes = "请选择有效的应用范围";
  if (candidate?.scopes !== undefined && !Array.isArray(candidate.scopes)) errors.scopes = "请选择有效的应用范围";
  if (!["enabled", "disabled"].includes(candidate?.status)) errors.status = "请选择状态";

  const others = (entries || []).filter((entry) => entry.id !== candidate?.id);
  const keys = new Set(scopes.map(scopeKey));
  const sameScope = others.filter(entry => entryScopes(entry).some(scope => keys.has(scopeKey(scope))));
  const normalizedName = normalizeText(name);

  if (name) {
    const nameMatch = sameScope.find((entry) => normalizeText(entry.name) === normalizedName);
    if (nameMatch) {
      errors.name = `同范围已存在词条「${nameMatch.name}」`;
      conflicts.push({
        field: "name",
        kind: "duplicate-name",
        termId: nameMatch.id,
        termName: nameMatch.name,
        message: `同一应用范围内已存在词条「${nameMatch.name}」。`,
      });
    }
  }

  return {
    valid: Object.keys(errors).length === 0 && conflicts.length === 0,
    errors,
    conflicts,
    normalized: { name, definition, scopes, status },
  };
}

export function validateBatch(names, common, entries = []) {
  const values = names.map(value => String(value ?? "")).filter(value => cleanText(value));
  const staged = [...entries];
  const results = (values.length ? values : [""]).map((name, index) => {
    const candidate = { ...common, name, id: common.id || `draft-batch-${index}` };
    const result = validateEntry(candidate, staged);
    staged.push({ ...result.normalized, id: candidate.id });
    return result;
  });
  return {
    valid: results.every(result => result.valid),
    errors: Object.assign({}, ...results.map(result => result.errors)),
    conflicts: results.flatMap(result => result.conflicts),
    candidates: values.length ? results.map(result => result.normalized) : [],
  };
}

export function searchEntries(entries, filters = {}) {
  const keyword = normalizeText(filters.keyword || "");
  const selected = new Set((filters.scopeKeys || []).map(String));
  const status = filters.status || "all";
  return (entries || []).filter((entry) => {
    if (selected.size && !entryScopes(entry).some(scope => selected.has(scopeKey(scope)))) return false;
    if (status !== "all" && entry.status !== status) return false;
    if (!keyword) return true;
    const haystack = [entry.name, entry.definition]
      .map(normalizeText)
      .join("\n");
    return haystack.includes(keyword);
  });
}

export function paginate(items, page, pageSize) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const start = (current - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: current, pages, total };
}

export function parseCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (quoted) throw new Error("CSV 存在未闭合的引号");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ""));
}

function escapeCsvValue(value) {
  const string = String(value ?? "");
  if (/[",\n\r]/.test(string)) return `"${string.replace(/"/g, '""')}"`;
  return string;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsvValue).join(",")).join("\r\n");
}

export function importRowsToEntries(text, options = {}) {
  const rows = parseCsv(text);
  const header = rows[0]?.map(cleanText) || [];
  if (header.length !== CSV_HEADERS.length || !CSV_HEADERS.every(name => header.includes(name)) || new Set(header).size !== header.length) {
    return { rows: [], validCount: 0, invalidCount: 0, headersOk: false, allValid: false, error: '表头应为：' + CSV_HEADERS.join('、') };
  }
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  const apps = options.apps || APPS;
  const staged = [...(options.entries || [])];
  const preview = [];
  rows.slice(1).forEach((cells, position) => {
    const line = position + 2;
    const errors = [];
    if (cells.length !== header.length) errors.push('列数应为 ' + header.length + ' 列，实际 ' + cells.length + ' 列');
    const scopes = [];
    const rangeValues = (cells[index['应用范围']] || '').split('|').map(cleanText).filter(Boolean);
    for (const value of rangeValues) {
      if (value === '全局') scopes.push({ type: 'global' });
      else {
        const target = apps.find(app => app.id === value || app.name === value);
        if (!target) errors.push('未找到 Agent「' + value + '」');
        else scopes.push({ type: 'app', id: target.id });
      }
    }
    const statusText = cleanText(cells[index['状态']]);
    const status = statusText === '启用' ? 'enabled' : statusText === '停用' ? 'disabled' : '';
    if (!status) errors.push('状态应为：启用 / 停用');
    const names = String(cells[index['词条']] || '').split('、').map(cleanText).filter(Boolean);
    const common = { definition: cells[index['释义']] || '', scopes, status };
    const batch = validateBatch(names, common, staged);
    const candidates = batch.candidates.map((candidate, itemIndex) => ({ ...candidate, id: 'import-' + line + '-' + itemIndex, recallCount: 0 }));
    const uniqueErrors = [...new Set([...errors, ...Object.values(batch.errors), ...batch.conflicts.map(conflict => conflict.message)])];
    staged.push(...candidates);
    preview.push({ line, names, candidates, definition: cleanText(common.definition), scopes: normalizeScopes(scopes), status, errors: uniqueErrors, valid: uniqueErrors.length === 0 });
  });
  const validCount = preview.filter(row => row.valid).length;
  return { rows: preview, validCount, invalidCount: preview.length - validCount, headersOk: true, error: '', allValid: preview.length > 0 && validCount === preview.length, entries: preview.flatMap(row => row.candidates) };
}

export function entriesToCsv(entries, apps = APPS) {
  return toCsv([CSV_HEADERS, ...entries.map(entry => [entry.name, entry.definition, scopesLabel(entryScopes(entry), apps).split('、').join('|'), statusLabel(entry.status)])]);
}

export function templateCsv() {
  return entriesToCsv([{ name: '示例：隔离开关', definition: '示例词条，导入前请删除本行。', scopes: [{ type: 'app', id: 'app-device' }], status: 'enabled' }]);
}
