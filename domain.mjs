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

export const SCOPE_TYPES = [
  { value: "global", label: "全局" },
  { value: "app", label: "指定应用" },
  { value: "kb", label: "指定知识库" },
];

export const STATUS_OPTIONS = [
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "停用" },
];

export const CSV_HEADERS = ["规范名", "规范编码", "别名", "释义", "作用范围", "范围名称", "状态"];

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

export function normalizeScope(scope) {
  const type = scope?.type || "global";
  if (type === "global") return { type: "global" };
  return { type, id: scope?.id || "" };
}

export function scopeKey(scope) {
  const normalized = normalizeScope(scope);
  return normalized.type === "global" ? "global" : `${normalized.type}:${normalized.id}`;
}

export function scopeTypeLabel(type) {
  return SCOPE_TYPES.find((item) => item.value === type)?.label || "全局";
}

export function targetName(scope, apps = APPS, kbs = KNOWLEDGE_BASES) {
  const normalized = normalizeScope(scope);
  if (normalized.type === "app") return apps.find((item) => item.id === normalized.id)?.name || "未选择应用";
  if (normalized.type === "kb") return kbs.find((item) => item.id === normalized.id)?.name || "未选择知识库";
  return "";
}

export function scopeLabel(scope, apps = APPS, kbs = KNOWLEDGE_BASES) {
  const normalized = normalizeScope(scope);
  if (normalized.type === "global") return "全局";
  const name = targetName(normalized, apps, kbs);
  return `${normalized.type === "app" ? "应用" : "知识库"}：${name}`;
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

export function validateEntry(candidate, entries, options = {}) {
  const errors = {};
  const conflicts = [];
  const name = cleanText(candidate?.name);
  const code = cleanText(candidate?.code);
  const definition = cleanText(candidate?.definition);
  const aliases = normalizeAliases(candidate?.aliases);
  const scope = normalizeScope(candidate?.scope);
  const status = candidate?.status === "disabled" ? "disabled" : "enabled";

  if (!name) errors.name = "请填写规范名";
  if (!code) errors.code = "请填写规范编码";
  if (!definition) errors.definition = "请填写释义";
  if (!["global", "app", "kb"].includes(scope.type)) errors.scope = "请选择作用范围";
  if (scope.type !== "global" && !scope.id) errors.scope = "请选择范围对象";
  if (options.kbLockedId && (scope.type !== "kb" || scope.id !== options.kbLockedId)) {
    errors.scope = "知识库页签只能维护当前知识库的词条";
  }
  if (!["enabled", "disabled"].includes(candidate?.status)) errors.status = "请选择状态";

  const others = (entries || []).filter((entry) => entry.id !== candidate?.id);
  const sameScope = others.filter((entry) => scopeKey(entry.scope) === scopeKey(scope));
  const normalizedName = normalizeText(name);
  const normalizedCode = normalizeText(code);

  if (name && code) {
    const codeMatch = others.find((entry) => normalizeText(entry.code) === normalizedCode);
    if (codeMatch) {
      errors.code = `规范编码已被「${codeMatch.name}」使用`;
      conflicts.push({
        field: "code",
        kind: "duplicate-code",
        termId: codeMatch.id,
        termName: codeMatch.name,
        message: `规范编码「${code}」与已有词条「${codeMatch.name}」重复。`,
      });
    }
  }

  if (name) {
    const nameMatch = sameScope.find((entry) => normalizeText(entry.name) === normalizedName);
    if (nameMatch) {
      errors.name = `同范围已存在规范名「${nameMatch.name}」`;
      conflicts.push({
        field: "name",
        kind: "duplicate-name",
        termId: nameMatch.id,
        termName: nameMatch.name,
        message: `同一作用范围内已存在规范名「${nameMatch.name}」。`,
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
        message: `规范名「${name}」与同范围词条「${aliasOwner.name}」的别名重复。`,
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
        message: `别名「${alias}」与当前规范名相同，无需重复添加。`,
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
    normalized: { name, code, aliases, definition, scope, status },
  };
}

export function searchEntries(entries, filters = {}) {
  const keyword = normalizeText(filters.keyword || "");
  const scopeType = filters.scopeType || "all";
  const status = filters.status || "all";
  return (entries || []).filter((entry) => {
    if (scopeType !== "all" && entry.scope?.type !== scopeType) return false;
    if (status !== "all" && entry.status !== status) return false;
    if (!keyword) return true;
    const haystack = [entry.name, entry.code, entry.definition, ...(entry.aliases || [])]
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

function scopeSpecificity(scope, context = {}) {
  const normalized = normalizeScope(scope);
  if (normalized.type === "kb") return context.kbId && normalized.id === context.kbId ? 3 : 0;
  if (normalized.type === "app") return context.appId && normalized.id === context.appId ? 2 : 0;
  return 1;
}

export function resolveTerms(query, entries, context = {}) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];
  const byKeyword = new Map();

  for (const entry of entries || []) {
    if (entry.status !== "enabled") continue;
    const specificity = scopeSpecificity(entry.scope, context);
    if (!specificity) continue;
    for (const keyword of [entry.name, ...normalizeAliases(entry.aliases)]) {
      const normalizedKeyword = normalizeText(keyword);
      if (!normalizedKeyword || !normalizedQuery.includes(normalizedKeyword)) continue;
      const previous = byKeyword.get(normalizedKeyword);
      if (!previous || specificity > previous.specificity) {
        byKeyword.set(normalizedKeyword, { keyword, entry, specificity });
      }
    }
  }

  const seen = new Set();
  return [...byKeyword.values()]
    .sort((a, b) => b.specificity - a.specificity || b.keyword.length - a.keyword.length)
    .filter((hit) => {
      if (seen.has(hit.entry.id)) return false;
      seen.add(hit.entry.id);
      return true;
    });
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

function parseScopeType(value) {
  const key = cleanText(value);
  if (key === "全局") return "global";
  if (key === "指定应用" || key === "应用") return "app";
  if (key === "指定知识库" || key === "知识库") return "kb";
  return "";
}

function findScopeTarget(type, value, apps = APPS, kbs = KNOWLEDGE_BASES) {
  const raw = cleanText(value);
  const pool = type === "app" ? apps : kbs;
  return pool.find((item) => item.id === raw || item.name === raw) || null;
}

export function importRowsToEntries(text, options = {}) {
  const rows = parseCsv(text);
  if (!rows.length) {
    return { rows: [], validCount: 0, invalidCount: 0, headersOk: false, error: "文件为空" };
  }
  const header = rows[0].map(cleanText);
  const headerOk = CSV_HEADERS.every((name) => header.includes(name));
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
  const kbs = options.kbs || KNOWLEDGE_BASES;
  const existing = [...(options.entries || [])];
  const stagedEntries = [...existing];
  const preview = [];

  rows.slice(1).forEach((cells, position) => {
    const line = position + 2;
    const raw = {
      name: cells[index["规范名"]] || "",
      code: cells[index["规范编码"]] || "",
      aliases: cells[index["别名"]] || "",
      definition: cells[index["释义"]] || "",
      scopeRaw: cells[index["作用范围"]] || "",
      targetRaw: cells[index["范围名称"]] || "",
      statusRaw: cells[index["状态"]] || "",
    };
    const errors = [];
    if (cells.length !== header.length) errors.push(`列数应为 ${header.length} 列，实际 ${cells.length} 列`);
    if (!cleanText(raw.name)) errors.push("规范名为空");
    if (!cleanText(raw.code)) errors.push("规范编码为空");
    if (!cleanText(raw.definition)) errors.push("释义为空");

    const type = parseScopeType(raw.scopeRaw);
    let scope = null;
    if (!type) {
      errors.push("作用范围应为：全局 / 指定应用 / 指定知识库");
    } else if (type === "global") {
      scope = { type: "global" };
    } else {
      const target = findScopeTarget(type, raw.targetRaw, apps, kbs);
      if (!target) errors.push(`未找到${type === "app" ? "应用" : "知识库"}「${cleanText(raw.targetRaw)}」`);
      else scope = { type, id: target.id };
    }

    const statusKey = cleanText(raw.statusRaw);
    let status = "";
    if (statusKey === "启用") status = "enabled";
    else if (statusKey === "停用") status = "disabled";
    else errors.push("状态应为：启用 / 停用");

    if (options.kbLockedId) {
      if (type && type !== "kb") errors.push("当前知识库页签只能导入本库词条");
      else if (scope && scope.type === "kb" && scope.id !== options.kbLockedId) {
        errors.push("导入范围不能超出当前知识库");
      }
    }

    const candidate = {
      id: `import-${line}`,
      name: cleanText(raw.name),
      code: cleanText(raw.code),
      aliases: normalizeAliases(raw.aliases),
      definition: cleanText(raw.definition),
      scope: scope || { type: "global" },
      status: status || "enabled",
    };

    if (scope && status) {
      const validation = validateEntry(candidate, stagedEntries, { kbLockedId: options.kbLockedId });
      for (const message of Object.values(validation.errors)) errors.push(message);
      for (const conflict of validation.conflicts) errors.push(conflict.message);
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

export function entriesToCsv(entries, apps = APPS, kbs = KNOWLEDGE_BASES) {
  const rows = [CSV_HEADERS];
  for (const entry of entries) {
    rows.push([
      entry.name,
      entry.code,
      normalizeAliases(entry.aliases).join("|"),
      entry.definition,
      scopeTypeLabel(entry.scope?.type),
      entry.scope?.type === "global" ? "" : targetName(entry.scope, apps, kbs),
      statusLabel(entry.status),
    ]);
  }
  return toCsv(rows);
}

export function templateCsv() {
  return toCsv([
    CSV_HEADERS,
    ["示例：刀闸", "IMP-DS-001", "示例：隔离刀闸|示例：刀开关", "示例词条，导入前请删除本行。", "指定应用", "设备运维助手", "启用"],
  ]);
}
