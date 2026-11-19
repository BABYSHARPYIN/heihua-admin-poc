import {
  APPS,
  KNOWLEDGE_BASES,
  cleanText,
  entriesToCsv,
  formatDateTime,
  importRowsToEntries,
  migrateEntry,
  normalizeText,
  paginate,
  scopeKey,
  scopesLabel,
  searchEntries,
  statusLabel,
  templateCsv,
  validateBatch,
  compareEntries,
  definitionSummary,
} from "./domain.mjs?v=20261119-exclusive";
import { INITIAL_ENTRIES } from "./data.mjs?v=20261119-exclusive";
import { createScopePicker } from "./scope-picker.mjs?v=20261119-exclusive";

const STORAGE_KEY = "heihua-admin-poc-state-v2";
const LEGACY_STORAGE_KEY = "heihua-admin-poc-state-v1";
const DEFAULT_VISIBILITY = { "kb-device": "restricted", "kb-safety": "restricted", "kb-service": "public" };
const DEFAULT_KB_UPDATED = { "kb-device": "", "kb-safety": "", "kb-service": "2026-11-12T09:20:00+08:00" };
const DEFAULT_FILE_MODE = { "kb-device": "manual", "kb-safety": "manual", "kb-service": "auto" };
const IDENTITY_LABELS = {
  full: "词条管理 + 全局",
  view: "仅查看",
  none: "无权限",
};
const AGENT_CONTEXT = {
  "app-device": "kb-device",
  "app-safety": "kb-safety",
  "app-service": "kb-service",
};
const AGENT_DESCRIPTIONS = {
  "app-device": "面向设备巡检、缺陷处置与检修场景的专业 Agent。",
  "app-safety": "面向工作票、操作票与现场安全措施的专业 Agent。",
  "app-service": "面向客户咨询、业务办理与投诉处理的专业 Agent。",
};
const GLOBAL_PAGE_SIZE = 8;
const CURRENT_OPERATOR = "admin";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultSwitches() {
  return {
    followup: Object.fromEntries(APPS.map((app) => [app.id, true])),
    upload: Object.fromEntries(APPS.map((app) => [app.id, true])),
    black: Object.fromEntries(APPS.map((app) => [app.id, true])),
  };
}

const state = {
  entries: INITIAL_ENTRIES.map(migrateEntry).filter(Boolean),
  audit: [],
  auditTermId: null,
  identity: "full",
  visibility: { ...DEFAULT_VISIBILITY },
  fileMode: { ...DEFAULT_FILE_MODE },
  switches: defaultSwitches(),
  currentPage: "kb-list",
  currentKbId: "kb-device",
  kbTab: "basic",
  agentId: "app-device",
  agentTab: "effect",
  kbSearch: "",
  kbVisibilityFilter: "all",
  fileConfigured: {},
  agentSearch: "",
  memberContext: "kb",
  globalFilters: { keyword: "", scopeKeys: [], status: "all", page: 1 },
  term: null,
  import: null,
  confirmAction: null,
  importResult: null,
  lastFocus: null,
};

let listScopePicker;
let termScopePicker;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved.entries)) {
      state.entries = saved.entries.map(entry => migrateEntry({ ...entry, recallCount: entry.recallCount ?? INITIAL_ENTRIES.find(item => item.id === entry.id)?.recallCount ?? 0 })).filter(Boolean);
    }
    if (Array.isArray(saved.audit)) state.audit = saved.audit.map(log => {
      const before = log.before ? migrateEntry(log.before) : null;
      const after = log.after ? migrateEntry(log.after) : null;
      const migrated = migrateEntry({ scopes: log.scopes, scope: log.scope });
      const { scope, ...rest } = log;
      return migrated ? { ...rest, operator: CURRENT_OPERATOR, scopes: migrated.scopes, before, after } : null;
    }).filter(Boolean);
    if (Array.isArray(saved.knowledgeBases)) {
      for (const kb of KNOWLEDGE_BASES) {
        const savedKb = saved.knowledgeBases.find(item => item.id === kb.id);
        if (savedKb?.name) { kb.name = cleanText(savedKb.name); kb.description = cleanText(savedKb.description); }
      }
    }
    if (IDENTITY_LABELS[saved.identity]) state.identity = saved.identity;
    else if (saved.identity === "kb") state.identity = "view";
    if (saved.visibility && typeof saved.visibility === "object") {
      state.visibility = { ...DEFAULT_VISIBILITY, ...saved.visibility };
    }
    if (saved.fileMode && typeof saved.fileMode === "object") {
      state.fileMode = { ...DEFAULT_FILE_MODE, ...saved.fileMode };
    }
    if (saved.fileConfigured && typeof saved.fileConfigured === "object") state.fileConfigured = saved.fileConfigured;
    if (saved.switches) {
      const defaults = defaultSwitches();
      for (const key of Object.keys(defaults)) {
        for (const app of APPS) {
          if (typeof saved.switches[key]?.[app.id] === "boolean") {
            defaults[key][app.id] = saved.switches[key][app.id];
          }
        }
      }
      state.switches = defaults;
    }
    if (KNOWLEDGE_BASES.some((kb) => kb.id === saved.currentKbId)) state.currentKbId = saved.currentKbId;
  } catch (error) {
    console.warn("读取演示数据失败，已使用初始数据。", error);
  }
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        entries: state.entries,
        knowledgeBases: KNOWLEDGE_BASES,
        audit: state.audit,
        identity: state.identity,
        visibility: state.visibility,
        fileMode: state.fileMode,
        fileConfigured: state.fileConfigured,
        switches: state.switches,
        currentKbId: state.currentKbId,
      }),
    );
  } catch (error) {
    console.warn("保存演示数据失败。", error);
  }
}

function permissions() {
  return {
    canViewTerms: state.identity !== "none",
    canWriteGlobal: state.identity === "full",
    canWriteKb: state.identity === "full",
    canWriteAgent: state.identity === "full",
  };
}

function currentKb() {
  return KNOWLEDGE_BASES.find((kb) => kb.id === state.currentKbId) || KNOWLEDGE_BASES[0];
}

function currentAgent() {
  return APPS.find((app) => app.id === state.agentId) || APPS[0];
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusBadge(status) {
  return status === "disabled" ? '<span class="status-disabled">停用</span>' : '<span class="status-enabled">启用</span>';
}

function toast(message, type = "success", timeout = 2800) {
  const wrap = document.getElementById("toast-wrap");
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  wrap.appendChild(node);
  window.setTimeout(() => {
    node.style.opacity = "0";
    node.style.transition = "opacity .18s ease";
    window.setTimeout(() => node.remove(), 200);
  }, timeout);
}

function openModal(id) {
  state.lastFocus = document.activeElement;
  document.getElementById(id)?.classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal?.classList.contains("show")) return;
  modal.classList.remove("show");
  if (!document.querySelector(".modal-mask.show")) document.body.style.overflow = "";
  if (id === "modal-term") { state.term = null; termScopePicker.close(); }
  if (id === "modal-import") {
    state.import = null;
    const confirm = document.getElementById("btn-import-confirm");
    if (confirm) confirm.disabled = true;
  }
  if (id === "modal-confirm") state.confirmAction = null;
}

function closeTopModal() {
  const open = [...document.querySelectorAll(".modal-mask.show")];
  if (open.length) closeModal(open[open.length - 1].id);
}

function openConfirm({ title, textHtml, confirmText = "确定", onConfirm }) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-text").innerHTML = textHtml;
  const button = document.getElementById("btn-confirm-ok");
  button.textContent = confirmText;
  button.className = "btn btn-primary";
  state.confirmAction = onConfirm;
  openModal("modal-confirm");
  window.setTimeout(() => button.focus(), 30);
}

function applyPermissions() {
  const perms = permissions();
  const navBlack = document.getElementById("nav-terms");
  navBlack.hidden = !perms.canViewTerms;
  document.querySelectorAll("[data-global-write]").forEach((node) => {
    node.hidden = !perms.canWriteGlobal;
  });
  document.querySelectorAll("[data-kb-settings-write]").forEach((node) => {
    node.disabled = !perms.canWriteKb;
    node.title = perms.canWriteKb ? "" : "当前身份无知识库设置写权限";
  });
  document.querySelectorAll(".switch").forEach((node) => {
    node.disabled = !perms.canWriteAgent;
  });

}

function updateBreadcrumb() {
  const breadcrumb = document.getElementById("breadcrumb");
  let html = "";
  if (state.currentPage === "kb-list") {
    html = '<span class="current">知识库</span>';
  } else if (state.currentPage === "kb-settings") {
    html = `<span>知识库</span><span class="sep">/</span><span>${escapeHtml(currentKb().name)}</span><span class="sep">/</span><span class="current">设置</span>`;
  } else if (state.currentPage === "agent" || state.currentPage === "agent-list") {
    html = '<span>专业 Agent</span><span class="sep">/</span><span class="current">Agent配置</span>';
  } else {
    html = '<span class="current">词条管理</span>';
  }
  breadcrumb.innerHTML = html;
}

function setPage(page, options = {}) {
  const perms = permissions();
  if (page === "terms" && !perms.canViewTerms) {
    toast("当前身份无词条查看权限", "error");
    return;
  }
  state.currentPage = page;
  document.querySelectorAll(".page").forEach((node) => node.classList.toggle("active", node.id === `page-${page}`));
  document.querySelectorAll(".nav-item[data-page]").forEach((node) => {
    const target = node.dataset.page;
    const active = target === page || (page === "kb-settings" && target === "kb-list") || (page === "agent" && target === "agent-list");
    node.classList.toggle("active", active);
  });
  updateBreadcrumb();
  if (!options.skipRender) renderCurrentPage();
}

function renderCurrentPage() {
  if (state.currentPage === "kb-list") renderKbList();
  else if (state.currentPage === "kb-settings") renderKbSettings();
  else if (state.currentPage === "agent") renderAgent();
  else if (state.currentPage === "agent-list") renderAgentList();
  else if (state.currentPage === "terms") renderBlackTable();
}

function renderPager(container, page, pages, onChange) {
  const safePages = Math.max(1, pages);
  const pageNumbers = Array.from({ length: safePages }, (_, index) => index + 1);
  container.innerHTML = "";
  const create = (label, target, disabled = false, active = false, ariaLabel = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
    button.disabled = disabled;
    button.classList.toggle("active", active);
    if (!disabled && !active) button.addEventListener("click", () => onChange(target));
    container.appendChild(button);
  };
  create("‹", page - 1, page <= 1, false, "上一页");
  for (const number of pageNumbers) create(String(number), number, false, number === page, `第 ${number} 页`);
  create("›", page + 1, page >= safePages, false, "下一页");
}

/* ——— 知识库列表 ——— */
function renderKbList() {
  const keyword = normalizeText(state.kbSearch);
  const rows = KNOWLEDGE_BASES.filter((kb) => {
    if (state.kbVisibilityFilter !== "all" && state.visibility[kb.id] !== state.kbVisibilityFilter) return false;
    if (!keyword) return true;
    return [kb.name, kb.code, kb.description].map(normalizeText).join("\n").includes(keyword);
  }).map((kb) => {
    return { ...kb, updatedAt: DEFAULT_KB_UPDATED[kb.id] };
  });

  const tbody = document.getElementById("kb-list-tbody");
  tbody.innerHTML = rows
    .map(
      (kb) => `
      <article class="knowledge-card" data-open-kb="${kb.id}" tabindex="0" role="button" aria-label="打开${escapeHtml(kb.name)}">
        <div class="resource-card-header"><span class="resource-icon"><span class="nav-icon nav-icon-books" aria-hidden="true"></span></span><div class="resource-card-title"><h3>${escapeHtml(kb.name)}</h3><small>创建者：演示用户</small></div>${state.visibility[kb.id] === "public" ? '<span class="tag tag-blue">公开</span>' : '<span class="tag tag-orange">私有</span>'}</div>
        <p class="resource-card-description truncate-2">${escapeHtml(kb.description)}</p>
        <div class="resource-card-tags"><span class="tag tag-plain">${escapeHtml(kb.code)}</span></div>
        <div class="resource-card-footer"><span>文件数：${kb.id === "kb-device" ? 20 : 12}</span><span>应用数：1</span><button class="btn-link resource-settings" type="button" data-open-kb="${kb.id}" aria-label="设置">···</button></div>
      </article>`,
    )
    .join("");

  document.getElementById("kb-list-empty").hidden = rows.length > 0;
  document.getElementById("kb-list-count").innerHTML = `共 <strong>${rows.length}</strong> 个知识库`;
  document.getElementById("kb-list-footer-count").textContent = `共 ${rows.length} 个知识库`;
  document.getElementById("kb-list-meta").textContent = "";
}

function openKbSettings(kbId, tab = "basic") {
  state.currentKbId = kbId;
  state.kbTab = tab;
  saveState();
  setPage("kb-settings");
}

function kbLastUpdated(kbId) {
  return DEFAULT_KB_UPDATED[kbId];
}

/* ——— 知识库设置 ——— */
function renderKbSettings() {
  const kb = currentKb();
  const perms = permissions();

  document.getElementById("settings-kb-name").textContent = kb.name;
  document.getElementById("settings-kb-description").textContent = kb.description;
  document.getElementById("settings-kb-code").textContent = kb.code;
  document.getElementById("settings-title").textContent = `${kb.name} · 设置`;
  document.getElementById("basic-kb-name").value = kb.name;
  document.getElementById("basic-kb-code").textContent = kb.code;
  document.getElementById("basic-kb-description").value = kb.description;
  document.getElementById("kb-associated-app").textContent = APPS.find(item => AGENT_CONTEXT[item.id] === kb.id)?.name || "暂无数据";
  document.querySelector(".settings-head").hidden = state.kbTab === "documents";
  document.getElementById("btn-kb-files").classList.toggle("active", state.kbTab === "documents");
  document.getElementById("btn-kb-settings").classList.toggle("active", state.kbTab !== "documents");
  document.getElementById("basic-kb-updated").textContent = formatDateTime(kbLastUpdated(kb.id));
  document.getElementById("files-last-updated").textContent = formatDateTime(kbLastUpdated(kb.id));

  document.querySelectorAll("[data-kb-tab]").forEach((button) => {
    const active = button.dataset.kbTab === state.kbTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".kb-tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `kb-panel-${state.kbTab}`);
  });

  const visibility = state.visibility[kb.id] || "restricted";
  document.querySelectorAll('input[name="kb-visibility"]').forEach((input) => {
    input.checked = input.value === visibility;
  });
  const fileMode = state.fileMode[kb.id] || "manual";
  document.getElementById("file-update-empty").hidden = Boolean(state.fileConfigured[kb.id]);
  document.getElementById("file-update-form").hidden = !state.fileConfigured[kb.id];
  document.getElementById("file-path").value = state.fileConfigured[kb.id]?.path || "";
  document.querySelectorAll('input[name="file-update"]').forEach((input) => {
    input.checked = input.value === fileMode;
  });
  document.querySelectorAll("[data-kb-settings-write]").forEach((button) => {
    button.disabled = !perms.canWriteKb;
    button.title = perms.canWriteKb ? "" : "当前身份无知识库设置写权限";
  });

}

/* ——— 词条列表 ——— */
function renderBlackTable() {
  const filtered = searchEntries(state.entries, state.globalFilters).sort(compareEntries);
  const paged = paginate(filtered, state.globalFilters.page, GLOBAL_PAGE_SIZE);
  state.globalFilters.page = paged.page;
  const tbody = document.getElementById("black-tbody");

  tbody.innerHTML = paged.items
    .map(
      (entry) => `
      <tr>
        <td>
          <div class="cell-main">${escapeHtml(entry.name)}</div>
        </td>
        <td><div class="definition-cell">${escapeHtml(definitionSummary(entry.definition))}</div></td>
        <td>${escapeHtml(scopesLabel(entry.scopes))}</td>
        <td>${statusBadge(entry.status)}</td>
        <td class="nowrap">${entry.recallCount || 0}</td>
        <td class="nowrap">${escapeHtml(formatDateTime(entry.updatedAt))}</td>
        <td>${escapeHtml(entry.operator || CURRENT_OPERATOR)}</td>
        <td class="action-cell">${termActions(entry, "global")}</td>
      </tr>`,
    )
    .join("");

  document.getElementById("black-empty").hidden = paged.items.length > 0;
  document.getElementById("black-result-count").innerHTML = `共 <strong>${paged.total}</strong> 条`;
  document.getElementById("black-footer-count").textContent = `第 ${paged.page} / ${paged.pages} 页 · 每页 ${GLOBAL_PAGE_SIZE} 条`;
  document.querySelectorAll("[data-global-write]").forEach((node) => {
    node.hidden = !permissions().canWriteGlobal;
  });
  renderPager(document.getElementById("black-pager"), paged.page, paged.pages, (page) => {
    state.globalFilters.page = page;
    renderBlackTable();
  });
}

function termActions(entry, context) {
  const perms = permissions();
  const writable = perms.canWriteGlobal;
  const history = `<button class="btn-link" type="button" data-term-action="history" data-term-id="${escapeHtml(entry.id)}">变更记录</button>`;
  if (!writable) return `<button class="btn-link" type="button" data-term-action="view" data-term-id="${entry.id}">查看</button>` + history;
  const toggleLabel = entry.status === "enabled" ? "停用" : "启用";
  return [
    `<button class="btn-link" type="button" data-term-action="edit" data-term-id="${entry.id}">编辑</button>`,
    `<button class="btn-link" type="button" data-term-action="toggle" data-term-id="${entry.id}">${toggleLabel}</button>`,
    `<button class="btn-link danger" type="button" data-term-action="delete" data-term-id="${entry.id}">删除</button>`,
    history,
  ].join("");
}

/* ——— 留痕 ——— */
function pushAudit({ action, termId, termName, scopes, before, after }) {
  state.audit.unshift({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    action,
    termId,
    termName,
    scopes: clone(scopes || []),
    identity: state.identity,
    operator: CURRENT_OPERATOR,
    before: before ? clone(before) : null,
    after: after ? clone(after) : null,
  });
  state.audit = state.audit.slice(0, 80);
}

function setTermStatus(termId, nextStatus) {
  const index = state.entries.findIndex((entry) => entry.id === termId);
  if (index < 0) return;
  const before = clone(state.entries[index]);
  const after = { ...before, status: nextStatus, operator: CURRENT_OPERATOR, updatedAt: new Date().toISOString() };
  state.entries[index] = after;
  pushAudit({
    action: nextStatus === "enabled" ? "启用" : "停用",
    termId: after.id,
    termName: after.name,
    scopes: after.scopes,
    before,
    after,
  });
  saveState();
  renderCurrentPage();
  if (document.getElementById("modal-audit").classList.contains("show")) renderAudit();
  toast(nextStatus === "enabled" ? `已启用「${after.name}」` : `已停用「${after.name}」`);
}

function handleTermAction(action, termId) {
  const entry = state.entries.find((item) => item.id === termId);
  if (!entry) return;
  const perms = permissions();
  const source = "global";
  const canWrite = perms.canWriteGlobal;
  if (action === "history") {
    if (perms.canViewTerms) openAudit(entry.id);
    return;
  }
  if (action === "view" || !canWrite) {
    openTermEditor({ id: entry.id, readOnly: true, source });
    return;
  }
  if (action === "edit") {
    openTermEditor({ id: entry.id, source });
  } else if (action === "toggle") {
    if (entry.status === "disabled") {
      setTermStatus(entry.id, "enabled");
    } else {
      openConfirm({
        title: "停用词条",
        textHtml: `确认停用 <strong>「${escapeHtml(entry.name)}」</strong>？`,
        confirmText: "停用",
        onConfirm: () => setTermStatus(entry.id, "disabled"),
      });
    }
  } else if (action === "delete") {
    openConfirm({
      title: "删除词条",
      textHtml: `确认删除 <strong>「${escapeHtml(entry.name)}」</strong>？`,
      confirmText: "删除",
      onConfirm: () => {
        const current = state.entries.find((item) => item.id === entry.id);
        if (!current) return;
        const before = clone(current);
        state.entries = state.entries.filter((item) => item.id !== entry.id);
        pushAudit({
          action: "删除",
          termId: before.id,
          termName: before.name,
          scopes: before.scopes,
          before,
          after: null,
        });
        saveState();
        renderCurrentPage();
        toast(`已删除「${before.name}」`);
      },
    });
  }
}

/* ——— 词条抽屉 ——— */
function renderTermInputs(values, readOnly = false) {
  const multiple = !state.term?.id && !readOnly;
  document.getElementById('term-inputs').innerHTML = values.map((value, index) => '<div class="term-input-row"><input class="input" ' + (index === 0 ? 'id="term-name" ' : '') + 'data-term-input maxlength="60" aria-label="词条 ' + (index + 1) + '" placeholder="例如：隔离开关" value="' + escapeHtml(value) + '" ' + (readOnly ? 'readonly' : '') + ' />' + (multiple ? '<button class="btn-link danger" type="button" data-remove-term aria-label="删除词条 ' + (index + 1) + '">删除</button>' : '') + '</div>').join('');
  document.getElementById('btn-add-term').hidden = !multiple;
}

function readTermInputs() {
  return [...document.querySelectorAll('[data-term-input]')].map(input => input.value);
}

function clearTermFieldErrors() {
  for (const field of ["name", "definition", "scopes", "status"]) {
    const error = document.getElementById(`err-term-${field}`);
    if (error) {
      error.textContent = "";
      error.classList.remove("show");
    }
  }
  for (const input of document.querySelectorAll("#term-form .input, #term-form .textarea")) {
    input.classList.remove("error");
  }
}

function setTermFieldError(field, message) {
  const error = document.getElementById(`err-term-${field}`);
  if (!error) return;
  error.textContent = message;
  error.classList.add("show");
  const input =
    field === "scopes"
        ? document.querySelector("#term-scope-picker button")
        : document.getElementById(`term-${field}`);
  input?.classList.add("error");
}

function getTermCandidate() {
  return {
    id: state.term?.id,
    definition: document.getElementById('term-definition').value,
    scopes: termScopePicker.value(),
    status: document.querySelector('input[name="term-status"]:checked')?.value || 'enabled',
  };
}

function renderTermConflicts(validation) {
  const box = document.getElementById('term-conflicts');
  box.hidden = !validation.conflicts.length;
  document.getElementById('term-conflict-list').innerHTML = validation.conflicts.map(conflict => '<div class="conflict-item">' + escapeHtml(conflict.message) + '</div>').join('');
}

function refreshTermValidation({ showErrors = false } = {}) {
  if (!state.term) return null;
  const candidate = getTermCandidate();
  const validation = validateBatch(readTermInputs(), candidate, state.entries);
  if (showErrors || document.querySelector("#term-form .field-error.show")) {
    clearTermFieldErrors();
    for (const [field, message] of Object.entries(validation.errors)) setTermFieldError(field, message);
  }
  renderTermConflicts(validation);
  const save = document.getElementById("btn-term-save");
  save.disabled = state.term.readOnly || validation.conflicts.length > 0;
  return validation;
}

function openTermEditor({ id = null, readOnly = false, source = "global" } = {}) {
  const entry = id ? state.entries.find((item) => item.id === id) : null;
  if (id && !entry) {
    toast("未找到该词条", "error");
    return;
  }
  if (readOnly && !permissions().canViewTerms) return;

  state.term = {
    id: entry?.id || null,
    readOnly,
    source,
  };

  document.getElementById("term-title").textContent = readOnly ? "查看词条" : entry ? "编辑词条" : "新增词条";
  document.getElementById("term-id").value = entry?.id || "";
  renderTermInputs([entry?.name || ""], readOnly);
  document.getElementById("term-definition").value = entry?.definition || "";
  for (const radio of document.querySelectorAll('input[name="term-status"]')) {
    radio.checked = radio.value === (entry?.status || "enabled");
  }

  termScopePicker.set(entry?.scopes || [], readOnly);

  const drawer = document.querySelector("#modal-term .drawer");
  drawer.classList.toggle("drawer-readonly", readOnly);
  document.getElementById("term-name").readOnly = readOnly;
  document.getElementById("term-definition").readOnly = readOnly;
  for (const radio of document.querySelectorAll('input[name="term-status"]')) radio.disabled = readOnly;

  const footerButtons = document.querySelectorAll("#modal-term .modal-footer .btn");
  const cancelButton = [...footerButtons].find((button) => button.id !== "btn-term-save");
  if (cancelButton) cancelButton.textContent = readOnly ? "关闭" : "取消";
  document.getElementById("btn-term-save").hidden = readOnly;

  clearTermFieldErrors();
  refreshTermValidation({ showErrors: false });
  openModal("modal-term");
  window.setTimeout(() => {
    if (!readOnly) document.getElementById("term-name").focus();
    else document.querySelector("#modal-term [data-close]")?.focus();
  }, 30);
}

function commitTerm() {
  if (!state.term || state.term.readOnly || !permissions().canWriteGlobal) return;
  const validation = refreshTermValidation({ showErrors: true });
  if (!validation.valid) {
    if (validation.conflicts.length) toast('请先处理重复词条', 'error');
    else if (validation.errors.scopes) document.querySelector('#term-scope-picker button').focus();
    else document.getElementById(validation.errors.name ? 'term-name' : 'term-definition').focus();
    return;
  }
  const now = new Date().toISOString();
  if (state.term.id) {
    const index = state.entries.findIndex(entry => entry.id === state.term.id);
    const before = clone(state.entries[index]);
    const after = { ...before, ...validation.candidates[0], operator: CURRENT_OPERATOR, updatedAt: now };
    state.entries[index] = after;
    pushAudit({ action: '编辑', termId: after.id, termName: after.name, scopes: after.scopes, before, after });
    toast('已保存「' + after.name + '」');
  } else {
    const added = validation.candidates.map(candidate => ({ ...candidate, id: 't-' + crypto.randomUUID(), operator: CURRENT_OPERATOR, recallCount: 0, createdAt: now, updatedAt: now }));
    for (const after of added) {
      state.entries.push(after);
      pushAudit({ action: '新增', termId: after.id, termName: after.name, scopes: after.scopes, before: null, after });
    }
    toast('已新增 ' + added.length + ' 条词条');
  }
  saveState();
  closeModal('modal-term');
  renderCurrentPage();
}

/* ——— 专业 Agent ——— */
function renderAgentList() {
  const keyword = normalizeText(state.agentSearch);
  const agents = APPS.filter(item => normalizeText(item.name + AGENT_DESCRIPTIONS[item.id]).includes(keyword));
  document.getElementById("agent-list").innerHTML = agents.map(item => `
    <button class="agent-card" type="button" data-agent-id="${item.id}">
      <span class="resource-card-header"><img class="agent-card-icon" src="assets/agent.svg" alt="" /><span class="resource-card-title"><strong>${escapeHtml(item.name)}</strong><small>创建者：演示用户</small></span><span class="agent-running">运行中</span></span>
      <span class="agent-card-description">${escapeHtml(AGENT_DESCRIPTIONS[item.id])}</span>
      <span class="resource-card-footer"><span>受限</span><span>···</span></span>
    </button>`).join("");
  document.getElementById("agent-list-empty").hidden = agents.length > 0;
}

function renderAgent() {
  const agent = currentAgent();
  const canWrite = permissions().canWriteAgent;

  document.getElementById("agent-title").textContent = agent.name;
  document.getElementById("preview-agent-name").textContent = agent.name;
  document.getElementById("agent-description").textContent = AGENT_DESCRIPTIONS[agent.id];
  document.getElementById("agent-basic-name").value = agent.name;
  document.getElementById("agent-basic-description").value = AGENT_DESCRIPTIONS[agent.id];

  const switchMap = {
    followup: "switch-followup",
    upload: "switch-upload",
    black: "switch-black",
  };
  for (const [key, id] of Object.entries(switchMap)) {
    const button = document.getElementById(id);
    const enabled = state.switches[key][agent.id] !== false;
    button.classList.toggle("on", enabled);
    button.setAttribute("aria-checked", enabled ? "true" : "false");
    button.disabled = !canWrite;
    button.title = canWrite ? "" : "当前身份无 Agent 配置写权限";
  }
  const writeNote = document.getElementById("agent-write-note");
  writeNote.hidden = canWrite;
  writeNote.textContent = "无修改权限";

  document.querySelectorAll("[data-agent-tab]").forEach((button) => {
    const active = button.dataset.agentTab === state.agentTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".agent-tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `agent-panel-${state.agentTab}`);
  });

}

/* ——— 导入 / 导出 ——— */
function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function exportEntries(entries, filenamePrefix) {
  if (!entries.length) {
    toast("当前筛选范围没有可导出的词条", "error");
    return;
  }
  downloadText(`${filenamePrefix}-${dateStamp()}.csv`, `\uFEFF${entriesToCsv(entries)}`);
  toast(`已导出 ${entries.length} 条词条`);
}

function downloadTemplate() {
  downloadText("词条导入模板.csv", `\uFEFF${templateCsv()}`);
  toast("CSV 模板已下载");
}

function resetImportPreview() {
  state.importResult = null;
  document.getElementById("import-preview").hidden = true;
  document.getElementById("import-preview-body").innerHTML = "";
  document.getElementById("import-summary").textContent = "";
  document.getElementById("import-preview-status").innerHTML = "";
  const confirm = document.getElementById("btn-import-confirm");
  confirm.disabled = true;
  const error = document.getElementById("import-error");
  error.hidden = true;
  error.textContent = "";
}

function openImport() {
  const perms = permissions();
  if (!perms.canWriteGlobal) {
    toast("当前身份无导入权限", "error");
    return;
  }
  document.getElementById("import-text").value = "";
  document.getElementById("import-file").value = "";
  resetImportPreview();
  openModal("modal-import");
}

function importSampleForScope() {
  return entriesToCsv([{ name: "油色谱异常", definition: "油中溶解气体分析发现的设备异常。", scopes: [{ type: "global" }], status: "enabled" }]);
}

function previewImport() {
  const text = document.getElementById("import-text").value.trim();
  const errorBox = document.getElementById("import-error");
  resetImportPreview();
  if (!text) {
    errorBox.textContent = "请先选择 CSV 文件或粘贴 CSV 内容。";
    errorBox.hidden = false;
    return;
  }

  let parsed;
  try {
    parsed = importRowsToEntries(text, {
      entries: state.entries,
    });
  } catch (error) {
    errorBox.textContent = `解析失败：${error.message}`;
    errorBox.hidden = false;
    return;
  }
  if (!parsed.headersOk) {
    errorBox.textContent = parsed.error;
    errorBox.hidden = false;
    return;
  }

  state.importResult = parsed;
  document.getElementById("import-preview").hidden = false;
  document.getElementById("import-summary").innerHTML =
    parsed.rows.length
      ? `共 <strong>${parsed.rows.length}</strong> 行，通过 <strong>${parsed.validCount}</strong> 行，失败 <strong>${parsed.invalidCount}</strong> 行`
      : "文件中没有可导入的数据行";
  document.getElementById("import-preview-status").innerHTML = parsed.allValid
    ? '<span class="import-status ok">校验通过，可导入</span>'
    : '<span class="import-status bad">存在错误，暂不可导入</span>';
  document.getElementById("import-preview-body").innerHTML = parsed.rows.map((row) => `
    <tr class="${row.valid ? "" : "row-invalid"}">
      <td class="mono">${row.line}</td>
      <td>${escapeHtml(row.names.join("、") || "—")}</td>
      <td>${escapeHtml(scopesLabel(row.scopes))}</td>
      <td class="nowrap">${escapeHtml(statusLabel(row.status))}</td>
      <td>${row.valid ? '<span class="import-status ok">通过</span>' : `<div class="import-errors">${row.errors.map(escapeHtml).join("<br>")}</div>`}</td>
    </tr>`).join("");
  const confirm = document.getElementById("btn-import-confirm");
  confirm.disabled = !parsed.allValid;
  if (!parsed.allValid) {
    errorBox.textContent = "请修正导入错误";
    errorBox.hidden = false;
  }
}

function confirmImport() {
  const parsed = state.importResult;
  if (!parsed?.allValid) return;
  const canWrite = permissions().canWriteGlobal;
  if (!canWrite) {
    toast("当前身份无导入权限", "error");
    return;
  }

  const now = new Date().toISOString();
  const added = parsed.entries.map((entry, index) => ({
    ...entry,
    operator: CURRENT_OPERATOR,
    id: `t-import-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: now,
    updatedAt: now,
  }));
  for (const entry of added) {
    state.entries.push(entry);
    pushAudit({
      action: "导入",
      termId: entry.id,
      termName: entry.name,
      scopes: entry.scopes,
      before: null,
      after: entry,
    });
  }
  saveState();
  closeModal("modal-import");
  renderCurrentPage();
  toast(`已导入 ${added.length} 条词条`);
}

/* ——— 变更记录 ——— */

function renderAudit() {
  const logs = state.audit.filter(log => log.termId === state.auditTermId);
  const content = document.getElementById("audit-content");
  document.getElementById("audit-title").textContent = "变更记录";
  if (!logs.length) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="ico">◷</div>
        <div>暂无变更记录</div>
        <p>新增、编辑、停用、删除与导入都会记录在这里。</p>
      </div>`;
    return;
  }

  content.innerHTML = `
    <div class="audit-scroll">
      <table class="audit-table">
        <thead><tr><th>时间</th><th>操作</th><th>词条</th><th>应用范围</th><th>操作人</th></tr></thead>
        <tbody>${logs.map((log) => `
          <tr>
            <td class="nowrap">${escapeHtml(formatDateTime(log.at))}</td>
            <td><span class="audit-action">${escapeHtml(log.action)}</span></td>
            <td><div class="audit-term">${escapeHtml(log.termName || "—")}</div></td>
            <td>${escapeHtml(scopesLabel(log.scopes))}</td>
            <td>${escapeHtml(log.operator || CURRENT_OPERATOR)}</td>
          </tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function openAudit(termId) {
  if (!state.entries.some(entry => entry.id === termId)) return;
  state.auditTermId = termId;
  renderAudit();
  openModal("modal-audit");
}


/* ——— 事件绑定与初始化 ——— */
function updateIdentity(identity) {
  state.identity = identity;
  if (!permissions().canViewTerms && state.currentPage === "terms") {
    state.currentPage = "kb-list";
    setPage("kb-list", { skipRender: true });
  }
  applyPermissions();
  saveState();
  renderCurrentPage();

  const messages = {
    full: "已切换到词条管理 + 全局",
    view: "已切换到仅查看，写操作已隐藏",
    none: "已切换到无权限，词条入口已隐藏",
  };
  toast(messages[identity], "info");
}

function bindEvents() {
  document.querySelectorAll(".nav-item[data-page]").forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.page));
  });

  document.getElementById("identity-select").addEventListener("change", (event) => {
    updateIdentity(event.target.value);
  });

  document.getElementById("kb-list-search").addEventListener("input", (event) => {
    state.kbSearch = event.target.value;
    renderKbList();
  });
  document.querySelectorAll("[data-kb-visibility]").forEach(button => {
    button.addEventListener("click", () => {
      state.kbVisibilityFilter = button.dataset.kbVisibility;
      document.querySelectorAll("[data-kb-visibility]").forEach(item => item.classList.toggle("active", item === button));
      renderKbList();
    });
  });
  document.getElementById("kb-list-tbody").addEventListener("keydown", event => {
    if (event.key === "Enter" && event.target.matches(".knowledge-card")) openKbSettings(event.target.dataset.openKb);
  });
  document.getElementById("btn-kb-files").addEventListener("click", () => { state.kbTab = "documents"; renderKbSettings(); });
  document.getElementById("btn-kb-settings").addEventListener("click", () => { state.kbTab = "basic"; renderKbSettings(); });
  document.getElementById("btn-reset-kb-basic").addEventListener("click", renderKbSettings);
  document.getElementById("btn-save-kb-basic").addEventListener("click", () => {
    if (!permissions().canWriteKb) return;
    const name = document.getElementById("basic-kb-name").value.trim();
    if (!name || /\s/.test(name)) { toast("知识库名称不能为空或包含空格", "error"); return; }
    currentKb().name = name;
    currentKb().description = document.getElementById("basic-kb-description").value.trim();
    saveState();
    renderKbSettings();
    toast("已保存");
  });
  document.getElementById("btn-configure-file-update").addEventListener("click", () => {
    document.getElementById("file-update-empty").hidden = true;
    document.getElementById("file-update-form").hidden = false;
  });
  document.getElementById("btn-reset-file-rule").addEventListener("click", () => {
    document.getElementById("file-path").value = "";
    document.querySelector('input[name="file-update"][value="manual"]').checked = true;
  });
  document.querySelectorAll('input[name="kb-visibility"]').forEach(input => input.addEventListener("change", () => {
    document.getElementById("btn-save-visibility").click();
  }));
  document.querySelectorAll("[data-demo-message]").forEach(button => button.addEventListener("click", () => toast(`${button.dataset.demoMessage}暂不可用`, "info")));
  document.getElementById("btn-create-kb").addEventListener("click", () => toast("创建知识库暂不可用", "info"));
  for (const context of ["kb", "agent"]) {
    document.getElementById(`btn-${context}-add-member`).addEventListener("click", () => {
      state.memberContext = context;
      document.getElementById("member-error").classList.remove("show");
      openModal("modal-member");
    });
  }
  document.getElementById("btn-member-confirm").addEventListener("click", () => {
    const account = document.getElementById("member-account").value;
    const role = document.getElementById("member-role").value;
    const allowed = state.memberContext === "kb" ? permissions().canWriteKb : permissions().canWriteAgent;
    if (!allowed) { toast("当前身份无修改权限", "error"); return; }
    if (!account || !role) { document.getElementById("member-error").classList.add("show"); return; }
    closeModal("modal-member");
    toast("成员添加暂不可用");
  });
  document.getElementById("kb-list-tbody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-kb]");
    if (button) openKbSettings(button.dataset.openKb, "basic");
  });

  document.getElementById("btn-back-kb-list").addEventListener("click", () => setPage("kb-list"));
  document.querySelectorAll("[data-kb-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.kbTab;
      state.kbTab = tab;
      renderKbSettings();
    });
  });
  document.getElementById("btn-save-visibility").addEventListener("click", () => {
    if (!permissions().canWriteKb) return;
    const value = document.querySelector('input[name="kb-visibility"]:checked')?.value || "restricted";
    state.visibility[state.currentKbId] = value;
    saveState();
    renderKbList();
    renderKbSettings();
    toast("公开性设置已保存");
  });
  document.getElementById("btn-save-file-rule").addEventListener("click", () => {
    if (!permissions().canWriteKb) return;
    state.fileMode[state.currentKbId] = document.querySelector('input[name="file-update"]:checked')?.value || "manual";
    state.fileConfigured[state.currentKbId] = { path: document.getElementById("file-path").value.trim() };
    saveState();
    toast("文件更新设置已保存");
  });

  const globalSearch = document.getElementById("black-search");
  const statusFilter = document.getElementById("black-status");
  globalSearch.addEventListener("input", (event) => {
    state.globalFilters.keyword = event.target.value;
    state.globalFilters.page = 1;
    renderBlackTable();
  });
  statusFilter.addEventListener("change", (event) => {
    state.globalFilters.status = event.target.value;
    state.globalFilters.page = 1;
    renderBlackTable();
  });
  document.getElementById("black-tbody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-term-action]");
    if (button) handleTermAction(button.dataset.termAction, button.dataset.termId);
  });
  listScopePicker = createScopePicker(document.getElementById("list-scope-picker"), {
    label: "应用范围筛选",
    placeholder: "全部应用范围",
    onChange(scopes) {
      state.globalFilters.scopeKeys = scopes.map(scopeKey);
      state.globalFilters.page = 1;
      renderBlackTable();
    },
  });
  termScopePicker = createScopePicker(document.getElementById("term-scope-picker"), {
    label: "应用范围",
    placeholder: "请选择应用范围",
    exclusiveGlobal: true,
    onChange() { refreshTermValidation(); },
  });
  document.getElementById("btn-black-add").addEventListener("click", () => openTermEditor({ source: "global" }));
  document.getElementById("btn-black-import").addEventListener("click", openImport);
  document.getElementById("btn-black-export").addEventListener("click", () => {
    const entries = searchEntries(state.entries, state.globalFilters).sort(compareEntries);
    exportEntries(entries, "词条");
  });

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.close));
  });
  document.querySelectorAll(".modal-mask").forEach((mask) => {
    mask.addEventListener("click", (event) => {
      if (event.target === mask) closeModal(mask.id);
    });
  });
  document.getElementById("btn-confirm-ok").addEventListener("click", () => {
    const action = state.confirmAction;
    closeModal("modal-confirm");
    action?.();
  });

  document.getElementById('btn-add-term').addEventListener('click', () => {
    renderTermInputs([...readTermInputs(), '']);
    document.querySelector('#term-inputs .term-input-row:last-child input').focus();
  });
  document.getElementById('term-inputs').addEventListener('input', () => refreshTermValidation());
  document.getElementById('term-inputs').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-term]');
    if (!button || state.term?.id || state.term?.readOnly) return;
    const values = readTermInputs();
    values.splice([...document.querySelectorAll('[data-remove-term]')].indexOf(button), 1);
    renderTermInputs(values.length ? values : ['']);
    refreshTermValidation();
  });
  document.getElementById('term-inputs').addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
  document.getElementById('term-definition').addEventListener('input', () => refreshTermValidation());
  document.querySelectorAll('input[name="term-status"]').forEach(input => input.addEventListener('change', () => refreshTermValidation()));
  document.getElementById("term-form").addEventListener("submit", (event) => {
    event.preventDefault();
    commitTerm();
  });
  document.getElementById("btn-term-save").addEventListener("click", commitTerm);

  document.getElementById("btn-download-template").addEventListener("click", downloadTemplate);
  document.getElementById("btn-fill-import-sample").addEventListener("click", () => {
    document.getElementById("import-text").value = importSampleForScope();
    resetImportPreview();
  });
  document.getElementById("import-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      document.getElementById("import-text").value = await file.text();
      resetImportPreview();
    } catch (error) {
      const errorBox = document.getElementById("import-error");
      errorBox.textContent = `读取文件失败：${error.message}`;
      errorBox.hidden = false;
    }
  });
  document.getElementById("btn-preview-import").addEventListener("click", previewImport);
  document.getElementById("btn-import-confirm").addEventListener("click", confirmImport);

  document.getElementById("agent-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-agent-id]");
    if (!button) return;
    state.agentId = button.dataset.agentId;
    state.agentTab = "basic";
    setPage("agent");
  });
  document.getElementById("agent-search").addEventListener("input", event => { state.agentSearch = event.target.value; renderAgentList(); });
  document.getElementById("btn-back-agent-list").addEventListener("click", () => setPage("agent-list"));
  document.getElementById("btn-agent-cancel").addEventListener("click", () => setPage("agent-list"));
  document.getElementById("btn-agent-save").addEventListener("click", () => { saveState(); toast("已保存并更新"); });
  document.getElementById("switch-scenario").addEventListener("click", event => {
    const enabled = event.currentTarget.getAttribute("aria-checked") !== "true";
    event.currentTarget.setAttribute("aria-checked", String(enabled));
    event.currentTarget.classList.toggle("on", enabled);
  });
  document.getElementById("agent-intro").addEventListener("input", event => {
    document.getElementById("preview-agent-intro").textContent = event.target.value || "产品介绍将会作为副标题在此处展示";
  });
  document.querySelectorAll("[data-agent-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.agentTab = button.dataset.agentTab;
      renderAgent();
    });
  });
  for (const key of ["followup", "upload", "black"]) {
    document.getElementById(`switch-${key}`).addEventListener("click", () => {
      if (!permissions().canWriteAgent) {
        toast("当前身份无 Agent 配置写权限", "error");
        return;
      }
      const enabled = !state.switches[key][state.agentId];
      state.switches[key][state.agentId] = enabled;
      saveState();
      renderAgent();
      const labels = { followup: "追问推荐", upload: "上传文件", black: "词条增强" };
      toast(`${labels[key]}已${enabled ? "开启" : "关闭"}`);
    });
  }
  document.getElementById("btn-reset-demo").addEventListener("click", () => {
    openConfirm({
      title: "重置演示数据",
      textHtml: "确认清除本地演示中的词条、开关和变更记录？",
      confirmText: "重置",
      onConfirm: () => {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        window.location.reload();
      },
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTopModal();
  });
}

function init() {
  loadState();
  document.getElementById("identity-select").value = state.identity;
  document.getElementById("black-search").value = state.globalFilters.keyword;
  document.getElementById("black-status").value = state.globalFilters.status;
  bindEvents();
  applyPermissions();
  if (!permissions().canViewTerms && state.currentPage === "terms") state.currentPage = "kb-list";
  setPage(state.currentPage);
}

init();
