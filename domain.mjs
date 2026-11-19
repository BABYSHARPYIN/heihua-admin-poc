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

export const CSV_HEADERS = ["词条名称", "别名", "释义", "可扩展属性", "应用范围", "状态"];

export function normalizeText(value = "") {
  return String(value).normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

export function cleanText(value = "") {
  return String(value).normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeAliases(aliases) {
  const list = Array.isArray(aliases) ? aliases : String(aliases || "").split(/[|;；]/);
  const seen = new Set();
  const result = [];
  for (const raw of list) {
    const value = cleanText(raw);
    const key = normalizeText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
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
  const { code, scope, ...rest } = entry;
  const attributes = Array.isArray(entry.attributes) ? entry.attributes.map(item => ({ name: cleanText(item?.name), value: String(item?.value ?? "").trim() })) : [];
  if (code && !attributes.some(item => normalizeText(item.name) === "编码")) attributes.push({ name: "编码", value: String(code) });
  return { ...rest, scopes: normalizeScopes(scopes), attributes, aliases: normalizeAliases(entry.aliases), status: entry.status === "disabled" ? "disabled" : "enabled" };
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
  const attributes = Array.isArray(candidate?.attributes) ? candidate.attributes.map(item => ({ name: cleanText(item?.name), value: String(item?.value ?? "").trim() })) : [];
  const definition = cleanText(candidate?.definition);
  const aliases = normalizeAliases(candidate?.aliases);
  const scopes = entryScopes(candidate);
  const status = candidate?.status === "disabled" ? "disabled" : "enabled";

  if (!name) errors.name = "请填写词条名称";
  if (!definition) errors.definition = "请填写释义";
  if (!scopes.length) errors.scopes = "请选择应用范围";
  if (scopes.some(scope => scope.type !== "global" && !(scope.type === "app" && APPS.some(item => item.id === scope.id)))) errors.scopes = "请选择有效的应用范围";
  if (candidate?.scopes !== undefined && !Array.isArray(candidate.scopes)) errors.scopes = "请选择有效的应用范围";
  const propertyNames = new Set();
  if (candidate?.attributes !== undefined && !Array.isArray(candidate.attributes)) errors.attributes = "可扩展属性必须为属性数组";
  for (const attribute of attributes) {
    const key = normalizeText(attribute.name);
    if (!key || !attribute.value) errors.attributes = "每条属性必须填写属性名和属性值";
    else if (propertyNames.has(key)) errors.attributes = "属性名不能重复";
    propertyNames.add(key);
  }
  if (!["enabled", "disabled"].includes(candidate?.status)) errors.status = "请选择状态";

  const others = (entries || []).filter((entry) => entry.id !== candidate?.id);
  const keys = new Set(scopes.map(scopeKey));
  const sameScope = others.filter(entry => entryScopes(entry).some(scope => keys.has(scopeKey(scope))));
  const normalizedName = normalizeText(name);

  if (name) {
    const nameMatch = sameScope.find((entry) => normalizeText(entry.name) === normalizedName);
    if (nameMatch) {
      errors.name = `同范围已存在词条名称「${nameMatch.name}」`;
      conflicts.push({
        field: "name",
        kind: "duplicate-name",
        termId: nameMatch.id,
        termName: nameMatch.name,
        message: `同一应用范围内已存在词条名称「${nameMatch.name}」。`,
      });
    }
    const aliasOwner = sameScope.find((entry) =>
      normalizeAliases(entry.aliases).some((alias) => normalizeText(alias) === normalizedName),
    );
    if (aliasOwner && aliasOwner.id !== nameMatch?.id) {
      conflicts.push({
        field: "name",
        kind: "name-is-alias",
        termId: aliasOwner.id,
        termName: aliasOwner.name,
        message: `词条名称「${name}」与同范围词条「${aliasOwner.name}」的别名重复。`,
      });
    }
  }

  const aliasSeen = new Map();
  for (const alias of aliases) {
    const key = normalizeText(alias);
    if (!key) continue;
    if (key === normalizedName) {
      conflicts.push({
        field: "alias",
        kind: "alias-is-name",
        alias,
        termId: candidate?.id,
        termName: name || "当前词条",
        message: `别名「${alias}」与当前词条名称相同，无需重复添加。`,
      });
      continue;
    }
    if (aliasSeen.has(key)) {
      conflicts.push({
        field: "alias",
        kind: "duplicate-alias-input",
        alias,
        message: `别名「${aliasSeen.get(key)}」重复填写。`,
      });
      continue;
    }
    aliasSeen.set(key, alias);

    const owner = sameScope.find((entry) => {
      const entryKeys = [entry.name, ...normalizeAliases(entry.aliases)].map(normalizeText);
      return entryKeys.includes(key);
    });
    if (owner) {
      conflicts.push({
        field: "alias",
        kind: "alias-conflict",
        alias,
        termId: owner.id,
        termName: owner.name,
        message: `别名「${alias}」与同范围词条「${owner.name}」重复。`,
      });
    }
  }

  return {
    valid: Object.keys(errors).length === 0 && conflicts.length === 0,
    errors,
    conflicts,
    normalized: { name, attributes, aliases, definition, scopes, status },
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
    const haystack = [entry.name, entry.definition, ...(entry.aliases || []), ...(entry.attributes || []).flatMap(item => [item.name, item.value])]
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
  if (!rows.length) {
    return { rows: [], validCount: 0, invalidCount: 0, headersOk: false, error: "文件为空" };
  }
  const header = rows[0].map(value => cleanText(value).replace(/\u4f5c\u7528\u8303\u56f4/g, "应用范围"));
  const headerOk = ["词条名称", "别名", "释义", "应用范围", "状态"].every(name => header.includes(name)) && new Set(header).size === header.length;
  if (!headerOk) {
    return {
      rows: [],
      validCount: 0,
      invalidCount: 0,
      headersOk: false,
      error: `表头应包含：${CSV_HEADERS.join("、")}`,
    };
  }
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  const apps = options.apps || APPS;
  const existing = [...(options.entries || [])];
  const stagedEntries = [...existing];
  const preview = [];

  rows.slice(1).forEach((cells, position) => {
    const line = position + 2;
    const raw = {
      name: cells[index["词条名称"]] || "",
      attributes: cells[index["可扩展属性"]] || "[]",
      aliases: cells[index["别名"]] || "",
      definition: cells[index["释义"]] || "",
      scopeRaw: cells[index["应用范围"]] || "",
      targetRaw: cells[index["Agent名称"]] || "",
      statusRaw: cells[index["状态"]] || "",
    };
    const errors = [];
    if (cells.length !== header.length) errors.push(`列数应为 ${header.length} 列，实际 ${cells.length} 列`);
    if (!cleanText(raw.name)) errors.push("词条名称为空");
    if (!cleanText(raw.definition)) errors.push("释义为空");

    const rangeValues = raw.scopeRaw.split("|").map(cleanText).filter(Boolean);
    const legacyAgent = ["Agent", "指定 Agent"].includes(cleanText(raw.scopeRaw));
    if (legacyAgent) rangeValues.splice(0, rangeValues.length, cleanText(raw.targetRaw));
    const scopes = [];
    if (!rangeValues.length || rangeValues.some(value => !value)) errors.push("请选择应用范围");
    for (const value of rangeValues) {
      if (value === "全局") scopes.push({ type: "global" });
      else {
        const target = apps.find(item => item.id === value || item.name === value);
        if (!target) errors.push(`未找到 Agent「${value}」`);
        else scopes.push({ type: "app", id: target.id });
      }
    }

    const statusKey = cleanText(raw.statusRaw);
    let status = "";
    if (statusKey === "启用") status = "enabled";
    else if (statusKey === "停用") status = "disabled";
    else errors.push("状态应为：启用 / 停用");

    let attributes = [];
    try {
      attributes = JSON.parse(raw.attributes);
      if (!Array.isArray(attributes)) errors.push("可扩展属性必须为 JSON 数组");
    } catch {
      errors.push("可扩展属性必须为有效的 JSON 数组");
    }

    const candidate = {
      id: `import-${line}`,
      name: cleanText(raw.name),
      attributes: Array.isArray(attributes) ? attributes : [],
      aliases: normalizeAliases(raw.aliases),
      definition: cleanText(raw.definition),
      scopes,
      status: status || "enabled",
    };

    if (status) {
      const validation = validateEntry(candidate, stagedEntries);
      for (const message of Object.values(validation.errors)) errors.push(message);
      for (const conflict of validation.conflicts) errors.push(conflict.message);
      Object.assign(candidate, validation.normalized);
    }

    const uniqueErrors = [...new Set(errors)];
    const valid = uniqueErrors.length === 0;
    if (valid) stagedEntries.push(candidate);
    preview.push({ line, raw, candidate, errors: uniqueErrors, valid });
  });

  const validCount = preview.filter((row) => row.valid).length;
  return {
    rows: preview,
    validCount,
    invalidCount: preview.length - validCount,
    headersOk: true,
    error: "",
    allValid: preview.length > 0 && validCount === preview.length,
  };
}

export function entriesToCsv(entries, apps = APPS) {
  return toCsv([CSV_HEADERS, ...entries.map(entry => [
    entry.name,
    normalizeAliases(entry.aliases).join("|"),
    entry.definition,
    JSON.stringify(entry.attributes || []),
    entryScopes(entry).map(scope => scopeLabel(scope, apps)).join("|"),
    statusLabel(entry.status),
  ])]);
}

export function templateCsv() {
  return entriesToCsv([{ name: "示例：隔离开关", aliases: ["示例：刀闸"], definition: "示例词条，导入前请删除本行。", attributes: [{ name: "设备类型", value: "隔离设备" }], scopes: [{ type: "app", id: "app-device" }], status: "enabled" }]);
}
