import {
  APPS,
  CSV_HEADERS,
  KNOWLEDGE_BASES,
  cleanText,
  entriesToCsv,
  formatDateTime,
  importRowsToEntries,
  normalizeAliases,
  normalizeText,
  paginate,
  resolveTerms,
  scopeLabel,
  searchEntries,
  statusLabel,
  templateCsv,
  validateEntry,
} from "./domain.mjs";
import { INITIAL_ENTRIES } from "./data.mjs";

const STORAGE_KEY = "heihua-admin-poc-state-v1";
const DEFAULT_VISIBILITY = { "kb-device": "restricted", "kb-safety": "restricted", "kb-service": "public" };
const DEFAULT_KB_UPDATED = { "kb-device": "", "kb-safety": "", "kb-service": "2026-11-12T09:20:00+08:00" };
const DEFAULT_FILE_MODE = { "kb-device": "manual", "kb-safety": "manual", "kb-service": "auto" };
const IDENTITY_LABELS = {
  full: "黑话管理 + 全局",
  kb: "仅本库可写",
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
const KB_PAGE_SIZE = 6;

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
  entries: clone(INITIAL_ENTRIES),
  audit: [],
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
  globalFilters: { keyword: "", scopeType: "all", status: "all", page: 1 },
  kbFilters: { keyword: "", status: "all", page: 1 },
  term: null,
  import: null,
  confirmAction: null,
  auditContext: "global",
  importContext: "global",
  importLockedKbId: null,
  importResult: null,
  agentQuery: "CT 二次回路异常，先核对计量流变和刀闸位置",
  lastFocus: null,
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved.entries)) {
      state.entries = saved.entries.map((entry) => ({
        ...entry,
        aliases: normalizeAliases(entry.aliases || []),
        status: entry.status === "disabled" ? "disabled" : "enabled",
        scope: entry.scope?.type === "global" ? { type: "global" } : { type: entry.scope?.type || "global", id: entry.scope?.id },
      }));
    }
    if (Array.isArray(saved.audit)) state.audit = saved.audit;
    if (Array.isArray(saved.knowledgeBases)) {
      for (const kb of KNOWLEDGE_BASES) {
        const savedKb = saved.knowledgeBases.find(item => item.id === kb.id);
        if (savedKb?.name) { kb.name = cleanText(savedKb.name); kb.description = cleanText(savedKb.description); }
      }
    }
    if (IDENTITY_LABELS[saved.identity]) state.identity = saved.identity;
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
    canViewBlack: state.identity !== "none",
    canWriteGlobal: state.identity === "full",
    canWriteKb: state.identity === "full" || state.identity === "kb",
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

function byUpdatedDesc(a, b) {
  return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
}

function scopeTag(scope, extraClass = "") {
  const normalized = scope?.type || "global";
  return `<span class="tag scope-tag scope-${normalized} ${extraClass}">${escapeHtml(scopeLabel(scope))}</span>`;
}

function aliasTags(aliases) {
  const list = normalizeAliases(aliases || []);
  if (!list.length) return '<span class="muted">—</span>';
  const visible = list.slice(0, 3).map((alias) => `<span class="tag">${escapeHtml(alias)}</span>`).join("");
  const more = list.length > 3 ? `<span class="tag tag-plain" title="${escapeHtml(list.slice(3).join("、"))}">+${list.length - 3}</span>` : "";
  return visible + more;
}

function statusBadge(status) {
  return status === "disabled"
    ? '<span class="status status-disabled">停用</span>'
    : '<span class="status status-enabled">启用</span>';
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
  if (id === "modal-term") state.term = null;
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

function openConfirm({ title, textHtml, extraHtml = "", confirmText = "确定", tone = "danger", onConfirm }) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-text").innerHTML = textHtml;
  document.getElementById("confirm-extra").innerHTML = extraHtml;
  const button = document.getElementById("btn-confirm-ok");
  button.textContent = confirmText;
  button.className = tone === "primary" ? "btn btn-primary" : "btn btn-danger-solid";
  state.confirmAction = onConfirm;
  openModal("modal-confirm");
  window.setTimeout(() => button.focus(), 30);
}

function applyPermissions() {
  const perms = permissions();
  const navBlack = document.getElementById("nav-blacktalk");
  const tabBlack = document.getElementById("kb-tab-blacktalk");
  navBlack.hidden = !perms.canViewBlack;
  tabBlack.hidden = !perms.canViewBlack;
  document.querySelectorAll("[data-global-write]").forEach((node) => {
    node.hidden = !perms.canWriteGlobal;
  });
  document.querySelectorAll("[data-kb-write]").forEach((node) => {
    node.hidden = !perms.canWriteKb;
  });
  document.querySelectorAll("[data-kb-settings-write]").forEach((node) => {
    node.disabled = !perms.canWriteKb;
    node.title = perms.canWriteKb ? "" : "当前身份无知识库设置写权限";
  });
  document.querySelectorAll(".switch").forEach((node) => {
    node.disabled = !perms.canWriteAgent;
  });
  if (!perms.canViewBlack && state.kbTab === "blacktalk") {
    state.kbTab = "basic";
  }
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
    html = '<span class="current">黑话管理</span>';
  }
  breadcrumb.innerHTML = html;
}

function setPage(page, options = {}) {
  const perms = permissions();
  if (page === "blacktalk" && !perms.canViewBlack) {
    toast("当前身份无黑话查看权限", "error");
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
  else if (state.currentPage === "blacktalk") renderBlackTable();
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
    const terms = state.entries.filter((entry) => entry.scope?.type === "kb" && entry.scope.id === kb.id);
    const updated = terms.length
      ? terms.map((entry) => entry.updatedAt).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
      : DEFAULT_KB_UPDATED[kb.id];
    return { ...kb, termCount: terms.length, updatedAt: updated };
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
  document.getElementById("kb-list-footer-count").textContent = `共 ${rows.length} 个知识库 · 黑话词条 ${state.entries.length} 条`;
  document.getElementById("kb-list-meta").textContent = "子范围优先于全局";
}

function openKbSettings(kbId, tab = "basic") {
  state.currentKbId = kbId;
  state.kbTab = tab;
  state.kbFilters = { keyword: "", status: "all", page: 1 };
  if (tab === "blacktalk" && !permissions().canViewBlack) state.kbTab = "basic";
  saveState();
  setPage("kb-settings");
}

function kbLastUpdated(kbId) {
  const terms = state.entries.filter((entry) => entry.scope?.type === "kb" && entry.scope.id === kbId);
  const latest = terms.map((entry) => entry.updatedAt).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  return latest || DEFAULT_KB_UPDATED[kbId];
}

/* ——— 知识库设置 ——— */
function renderKbSettings() {
  const kb = currentKb();
  const perms = permissions();
  if (state.kbTab === "blacktalk" && !perms.canViewBlack) state.kbTab = "basic";

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
  document.getElementById("kb-locked-name").textContent = kb.name;
  document.getElementById("scope-locked-name").textContent = kb.name;

  document.querySelectorAll("[data-kb-tab]").forEach((button) => {
    const active = button.dataset.kbTab === state.kbTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.hidden = button.dataset.kbTab === "blacktalk" && !perms.canViewBlack;
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

  if (state.kbTab === "blacktalk") renderKbBlackTable();
}

function renderKbBlackTable() {
  const kb = currentKb();
  const perms = permissions();
  const scoped = state.entries
    .filter((entry) => entry.scope?.type === "kb" && entry.scope.id === kb.id)
    .sort(byUpdatedDesc);
  const filtered = searchEntries(scoped, { keyword: state.kbFilters.keyword, status: state.kbFilters.status });
  const paged = paginate(filtered, state.kbFilters.page, KB_PAGE_SIZE);
  state.kbFilters.page = paged.page;
  const tbody = document.getElementById("kb-black-tbody");

  tbody.innerHTML = paged.items
    .map(
      (entry) => `
      <tr>
        <td>
          <div class="cell-main">${escapeHtml(entry.name)}</div>
          <div class="cell-sub">${escapeHtml(entry.code)}</div>
        </td>
        <td>${aliasTags(entry.aliases)}</td>
        <td><div class="definition-cell truncate-2" title="${escapeHtml(entry.definition)}">${escapeHtml(entry.definition)}</div></td>
        <td>${statusBadge(entry.status)}</td>
        <td class="nowrap">${escapeHtml(formatDateTime(entry.updatedAt))}</td>
        <td class="action-cell">${termActions(entry, "kb")}</td>
      </tr>`,
    )
    .join("");

  document.getElementById("kb-black-empty").hidden = paged.items.length > 0;
  document.getElementById("kb-black-count").innerHTML = `共 <strong>${paged.total}</strong> 条`;
  document.getElementById("kb-black-footer-count").textContent = `第 ${paged.page} / ${paged.pages} 页 · 每页 ${KB_PAGE_SIZE} 条`;
  document.querySelectorAll("[data-kb-write]").forEach((node) => {
    node.hidden = !perms.canWriteKb;
  });
  renderPager(document.getElementById("kb-black-pager"), paged.page, paged.pages, (page) => {
    state.kbFilters.page = page;
    renderKbBlackTable();
  });
}

/* ——— 全局黑话列表 ——— */
function renderBlackTable() {
  const filtered = searchEntries(state.entries, state.globalFilters).sort(byUpdatedDesc);
  const paged = paginate(filtered, state.globalFilters.page, GLOBAL_PAGE_SIZE);
  state.globalFilters.page = paged.page;
  const tbody = document.getElementById("black-tbody");

  tbody.innerHTML = paged.items
    .map(
      (entry) => `
      <tr>
        <td>
          <div class="cell-main">${escapeHtml(entry.name)}</div>
          <div class="cell-sub">${escapeHtml(entry.code)}</div>
        </td>
        <td>${aliasTags(entry.aliases)}</td>
        <td><div class="definition-cell truncate-2" title="${escapeHtml(entry.definition)}">${escapeHtml(entry.definition)}</div></td>
        <td>${scopeTag(entry.scope)}</td>
        <td>${statusBadge(entry.status)}</td>
        <td class="nowrap">${escapeHtml(formatDateTime(entry.updatedAt))}</td>
        <td class="action-cell">${termActions(entry, "global")}</td>
      </tr>`,
    )
    .join("");

  document.getElementById("black-empty").hidden = paged.items.length > 0;
  document.getElementById("black-result-count").innerHTML = `共 <strong>${paged.total}</strong> 条`;
  document.getElementById("black-footer-count").textContent = `第 ${paged.page} / ${paged.pages} 页 · 每页 ${GLOBAL_PAGE_SIZE} 条`;
  document.getElementById("black-scope-note").textContent = "子范围优先于全局";
  const counts = { global: 0, app: 0, kb: 0 };
  for (const entry of state.entries) counts[entry.scope?.type || "global"] += 1;
  document.getElementById("blacktalk-meta").textContent = `全局 ${counts.global} · 应用 ${counts.app} · 知识库 ${counts.kb}`;
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
  const writable = context === "global" ? perms.canWriteGlobal : perms.canWriteKb;
  if (!writable) {
    return `<button class="btn-link" type="button" data-term-action="view" data-term-id="${entry.id}">查看</button>`;
  }
  const toggleLabel = entry.status === "enabled" ? "停用" : "启用";
  return [
    `<button class="btn-link" type="button" data-term-action="edit" data-term-id="${entry.id}">编辑</button>`,
    `<button class="btn-link" type="button" data-term-action="toggle" data-term-id="${entry.id}">${toggleLabel}</button>`,
    `<button class="btn-link danger" type="button" data-term-action="delete" data-term-id="${entry.id}">删除</button>`,
  ].join("");
}

/* ——— 留痕 ——— */
function pushAudit({ action, termId, termName, scope, before, after }) {
  state.audit.unshift({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    action,
    termId,
    termName,
    scope: clone(scope || { type: "global" }),
    identity: state.identity,
    before: before ? clone(before) : null,
    after: after ? clone(after) : null,
  });
  state.audit = state.audit.slice(0, 80);
}

function setTermStatus(termId, nextStatus) {
  const index = state.entries.findIndex((entry) => entry.id === termId);
  if (index < 0) return;
  const before = clone(state.entries[index]);
  const after = { ...before, status: nextStatus, updatedAt: new Date().toISOString() };
  state.entries[index] = after;
  pushAudit({
    action: nextStatus === "enabled" ? "启用" : "停用",
    termId: after.id,
    termName: after.name,
    scope: after.scope,
    before,
    after,
  });
  saveState();
  renderCurrentPage();
  if (document.getElementById("modal-audit").classList.contains("show")) renderAudit();
  toast(nextStatus === "enabled" ? `已启用「${after.name}」，立即生效` : `已停用「${after.name}」，新请求不再命中`);
}

function handleTermAction(action, termId) {
  const entry = state.entries.find((item) => item.id === termId);
  if (!entry) return;
  const perms = permissions();
  const inKbTab = state.currentPage === "kb-settings" && state.kbTab === "blacktalk";
  const source = inKbTab ? "kb" : "global";
  const canWrite = inKbTab ? perms.canWriteKb : perms.canWriteGlobal;
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
        extraHtml: '<div class="confirm-note">停用后，新请求将不再命中该词条；历史变更记录会保留。</div>',
        confirmText: "停用",
        tone: "danger",
        onConfirm: () => setTermStatus(entry.id, "disabled"),
      });
    }
  } else if (action === "delete") {
    openConfirm({
      title: "删除词条",
      textHtml: `确认删除 <strong>「${escapeHtml(entry.name)}」</strong>？`,
      extraHtml: '<div class="confirm-warning">删除后立即失效。该操作会记录在变更记录中，若为最近一次变更可尝试回滚。</div>',
      confirmText: "删除",
      tone: "danger",
      onConfirm: () => {
        const current = state.entries.find((item) => item.id === entry.id);
        if (!current) return;
        const before = clone(current);
        state.entries = state.entries.filter((item) => item.id !== entry.id);
        pushAudit({
          action: "删除",
          termId: before.id,
          termName: before.name,
          scope: before.scope,
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
function populateScopeTarget(type, selectedId = "") {
  const target = document.getElementById("term-scope-target");
  const pool = type === "app" ? APPS : type === "kb" ? KNOWLEDGE_BASES : [];
  target.hidden = type === "global";
  target.innerHTML = pool.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
  if (pool.length) target.value = pool.some((item) => item.id === selectedId) ? selectedId : pool[0].id;
}

function renderAliasChips() {
  const chips = document.getElementById("alias-chips");
  const readOnly = Boolean(state.term?.readOnly);
  chips.innerHTML = (state.term?.aliases || [])
    .map(
      (alias, index) =>
        `<span class="alias-chip">${escapeHtml(alias)}${readOnly ? "" : `<button type="button" data-remove-alias-index="${index}" aria-label="移除别名 ${escapeHtml(alias)}">✕</button>`}</span>`,
    )
    .join("");
}

function addAliasFromInput() {
  if (!state.term || state.term.readOnly) return;
  const input = document.getElementById("alias-input");
  const values = input.value.split(/[，,]/).map((value) => value.trim()).filter(Boolean);
  input.value = "";
  if (!values.length) return;
  const existing = new Set(state.term.aliases.map(normalizeText));
  for (const value of values) {
    const cleaned = normalizeAliases([value])[0];
    if (!cleaned) continue;
    const key = normalizeText(cleaned);
    if (existing.has(key)) continue;
    existing.add(key);
    state.term.aliases.push(cleaned);
  }
  renderAliasChips();
  refreshTermValidation({ showErrors: false });
}

function clearTermFieldErrors() {
  for (const field of ["name", "code", "aliases", "definition", "scope", "status"]) {
    const error = document.getElementById(`err-term-${field}`);
    if (error) {
      error.textContent = "";
      error.classList.remove("show");
    }
  }
  for (const input of document.querySelectorAll("#term-form .input, #term-form .textarea, #alias-editor")) {
    input.classList.remove("error");
  }
}

function setTermFieldError(field, message) {
  const error = document.getElementById(`err-term-${field}`);
  if (!error) return;
  error.textContent = message;
  error.classList.add("show");
  const input =
    field === "aliases"
      ? document.getElementById("alias-editor")
      : field === "scope"
        ? document.getElementById("term-scope-type")
        : document.getElementById(`term-${field}`);
  input?.classList.add("error");
}

function getTermCandidate() {
  const lockedKbId = state.term?.lockedKbId;
  const type = lockedKbId ? "kb" : document.getElementById("term-scope-type").value;
  let scope = { type: "global" };
  if (lockedKbId) {
    scope = { type: "kb", id: lockedKbId };
  } else if (type !== "global") {
    scope = { type, id: document.getElementById("term-scope-target").value };
  }
  return {
    id: state.term?.id || "draft-term",
    name: document.getElementById("term-name").value,
    code: document.getElementById("term-code").value,
    aliases: state.term?.aliases || [],
    definition: document.getElementById("term-definition").value,
    scope,
    status: document.querySelector('input[name="term-status"]:checked')?.value || "enabled",
  };
}

function refreshTermPreview() {
  if (!state.term) return;
  const candidate = getTermCandidate();
  const aliases = normalizeAliases(candidate.aliases);
  const name = cleanText(candidate.name);
  const code = cleanText(candidate.code);
  document.getElementById("preview-aliases").textContent = aliases.length
    ? aliases.map((alias) => `「${alias}」`).join(" ")
    : "未设置别名";
  document.getElementById("preview-result").textContent = name || code ? `${name || "（未填规范名）"}（${code || "（未填规范编码）"}）` : "填写规范名和规范编码后显示";
  const scopeText =
    candidate.scope.type === "global"
      ? "全局"
      : candidate.scope.id
        ? scopeLabel(candidate.scope)
        : "请选择范围对象";
  document.getElementById("preview-scope").textContent = scopeText;
  document.getElementById("preview-effect").textContent =
    candidate.status === "disabled" ? "状态为停用，不会命中" : "保存后立即生效，无审核";
}

function canOpenConflictEntry(termId) {
  const entry = state.entries.find((item) => item.id === termId);
  if (!entry) return false;
  if (!state.term?.lockedKbId) return true;
  return entry.scope?.type === "kb" && entry.scope.id === state.term.lockedKbId;
}

function renderTermConflicts(validation) {
  const box = document.getElementById("term-conflicts");
  const list = document.getElementById("term-conflict-list");
  if (!validation.conflicts.length) {
    box.hidden = true;
    list.innerHTML = "";
    return;
  }
  box.hidden = false;
  list.innerHTML = validation.conflicts
    .map((conflict) => {
      const actions = [];
      if (["alias-conflict", "duplicate-alias-input", "alias-is-name"].includes(conflict.kind) && conflict.alias) {
        actions.push(
          `<button class="btn-link" type="button" data-conflict-remove-alias="${escapeHtml(conflict.alias)}">移除别名</button>`,
        );
      }
      if (conflict.termId && canOpenConflictEntry(conflict.termId)) {
        actions.push(
          `<button class="btn-link" type="button" data-conflict-open="${escapeHtml(conflict.termId)}">打开已有词条</button>`,
        );
      }
      return `<div class="conflict-item"><span>${escapeHtml(conflict.message)}</span><div class="conflict-actions">${actions.join("")}</div></div>`;
    })
    .join("");
}

function refreshTermValidation({ showErrors = false } = {}) {
  if (!state.term) return null;
  const candidate = getTermCandidate();
  const validation = validateEntry(candidate, state.entries, {
    kbLockedId: state.term.lockedKbId || undefined,
  });
  if (showErrors) {
    clearTermFieldErrors();
    for (const [field, message] of Object.entries(validation.errors)) setTermFieldError(field, message);
  }
  renderTermConflicts(validation);
  const save = document.getElementById("btn-term-save");
  save.disabled = state.term.readOnly || validation.conflicts.length > 0;
  if (validation.conflicts.length) {
    document.getElementById("preview-effect").textContent = "存在冲突，处理后才能保存";
  }
  refreshTermPreview();
  if (validation.conflicts.length) {
    document.getElementById("preview-effect").textContent = "存在冲突，处理后才能保存";
  }
  return validation;
}

function openTermEditor({ id = null, lockedKbId = null, readOnly = false, source = "global" } = {}) {
  const entry = id ? state.entries.find((item) => item.id === id) : null;
  if (id && !entry) {
    toast("未找到该词条", "error");
    return;
  }
  if (readOnly && !permissions().canViewBlack) return;

  const inferredLocked =
    lockedKbId ||
    (source === "kb" || (state.currentPage === "kb-settings" && state.kbTab === "blacktalk") ? state.currentKbId : null);
  state.term = {
    id: entry?.id || null,
    aliases: entry ? normalizeAliases(entry.aliases) : [],
    lockedKbId: inferredLocked,
    readOnly,
    source,
  };

  document.getElementById("term-title").textContent = readOnly ? "查看词条" : entry ? "编辑词条" : "新增词条";
  document.getElementById("term-subtitle").textContent = readOnly
    ? "当前为只读查看；如需修改，请切换到有写权限的身份。"
    : "保存后立即生效，无审核环节";
  document.getElementById("term-id").value = entry?.id || "";
  document.getElementById("term-name").value = entry?.name || "";
  document.getElementById("term-code").value = entry?.code || "";
  document.getElementById("term-definition").value = entry?.definition || "";
  document.getElementById("alias-input").value = "";
  for (const radio of document.querySelectorAll('input[name="term-status"]')) {
    radio.checked = radio.value === (entry?.status || "enabled");
  }

  const editor = document.getElementById("scope-editor");
  const lockedBox = document.getElementById("scope-locked-box");
  if (inferredLocked) {
    editor.hidden = true;
    lockedBox.hidden = false;
    document.getElementById("scope-locked-name").textContent = currentKb().name;
  } else {
    editor.hidden = false;
    lockedBox.hidden = true;
    const type = entry?.scope?.type || "global";
    document.getElementById("term-scope-type").value = type;
    populateScopeTarget(type, entry?.scope?.id || "");
  }

  const drawer = document.querySelector("#modal-term .drawer");
  drawer.classList.toggle("drawer-readonly", readOnly);
  document.getElementById("term-name").readOnly = readOnly;
  document.getElementById("term-code").readOnly = readOnly;
  document.getElementById("term-definition").readOnly = readOnly;
  document.getElementById("alias-input").disabled = readOnly;
  document.getElementById("alias-input").placeholder = readOnly ? "只读" : "例如：刀闸";
  document.getElementById("term-scope-type").disabled = readOnly;
  document.getElementById("term-scope-target").disabled = readOnly;
  for (const radio of document.querySelectorAll('input[name="term-status"]')) radio.disabled = readOnly;

  const footerButtons = document.querySelectorAll("#modal-term .modal-footer .btn");
  const cancelButton = [...footerButtons].find((button) => button.id !== "btn-term-save");
  if (cancelButton) cancelButton.textContent = readOnly ? "关闭" : "取消";
  document.getElementById("btn-term-save").hidden = readOnly;

  renderAliasChips();
  clearTermFieldErrors();
  refreshTermValidation({ showErrors: false });
  openModal("modal-term");
  window.setTimeout(() => {
    if (!readOnly) document.getElementById("term-name").focus();
    else document.querySelector("#modal-term [data-close]")?.focus();
  }, 30);
}

function commitTerm() {
  if (!state.term || state.term.readOnly) return;
  addAliasFromInput();
  const validation = refreshTermValidation({ showErrors: true });
  if (!validation.valid) {
    if (validation.conflicts.length) {
      toast("请先处理别名或重复词条冲突", "error");
    } else {
      const first = ["name", "code", "definition", "scope", "status"].find((field) => validation.errors[field]);
      if (first === "aliases") document.getElementById("alias-input").focus();
      else document.getElementById(first === "scope" ? "term-scope-type" : `term-${first}`)?.focus();
    }
    return;
  }

  const now = new Date().toISOString();
  const normalized = validation.normalized;
  if (state.term.id) {
    const index = state.entries.findIndex((entry) => entry.id === state.term.id);
    const before = clone(state.entries[index]);
    const after = { ...before, ...normalized, updatedAt: now };
    state.entries[index] = after;
    pushAudit({
      action: "编辑",
      termId: after.id,
      termName: after.name,
      scope: after.scope,
      before,
      after,
    });
    toast(`已保存「${after.name}」，立即生效`);
  } else {
    const after = {
      ...normalized,
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: now,
      updatedAt: now,
    };
    state.entries.push(after);
    pushAudit({
      action: "新增",
      termId: after.id,
      termName: after.name,
      scope: after.scope,
      before: null,
      after,
    });
    toast(`已新增「${after.name}」，立即生效`);
  }
  saveState();
  closeModal("modal-term");
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
  const kb = KNOWLEDGE_BASES.find((item) => item.id === AGENT_CONTEXT[agent.id]) || KNOWLEDGE_BASES[0];
  const canWrite = permissions().canWriteAgent;

  document.getElementById("agent-title").textContent = agent.name;
  document.getElementById("preview-agent-name").textContent = agent.name;
  document.getElementById("agent-description").textContent = AGENT_DESCRIPTIONS[agent.id];
  document.getElementById("agent-basic-name").value = agent.name;
  document.getElementById("agent-basic-description").value = AGENT_DESCRIPTIONS[agent.id];
  document.getElementById("agent-kb-name").textContent = kb.name;
  document.getElementById("agent-kb-code").textContent = kb.code;
  document.getElementById("agent-kb-description").textContent = kb.description;
  document.getElementById("agent-context-tag").textContent = `关联：${kb.name}`;

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
  document.getElementById("agent-kb-black-state").textContent = state.switches.black[agent.id]
    ? "已开启，按作用范围解析黑话"
    : "已关闭，不调用黑话解析";
  const writeNote = document.getElementById("agent-write-note");
  writeNote.hidden = canWrite;
  writeNote.textContent = "当前身份无 Agent 配置写权限，开关仅展示当前配置。";

  document.querySelectorAll("[data-agent-tab]").forEach((button) => {
    const active = button.dataset.agentTab === state.agentTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".agent-tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `agent-panel-${state.agentTab}`);
  });

  document.getElementById("demo-query").value = state.agentQuery;
  if (state.agentTab === "effect") renderAgentDemo();
}

function renderAgentDemo() {
  const result = document.getElementById("demo-result");
  const agent = currentAgent();
  if (!state.switches.black[agent.id]) {
    result.innerHTML = '<div class="demo-off"><strong>黑话增强已关闭。</strong> 该应用不会调用黑话解析，用户原话会直接进入后续问答链路。</div>';
    return;
  }

  const query = state.agentQuery.trim();
  if (!query) {
    result.innerHTML = '<span class="muted">输入问法后点击「试解析」。</span>';
    return;
  }
  const hits = resolveTerms(query, state.entries, {
    appId: agent.id,
    kbId: AGENT_CONTEXT[agent.id],
  });
  if (!hits.length) {
    result.innerHTML = '<span class="muted">未命中已启用的黑话词条，原文保持不变。</span>';
    return;
  }

  result.innerHTML = `
    <div>识别到 <strong>${hits.length}</strong> 个词条，按子范围优先解析：</div>
    <div class="mt-8">${hits.map(({ keyword, entry, specificity }) => `
      <div class="demo-hit">
        <span class="tag">${escapeHtml(keyword)}</span>
        <span class="muted">→</span>
        <strong>${escapeHtml(entry.name)}</strong>
        <span class="mono muted">${escapeHtml(entry.code)}</span>
        <span class="tag ${specificity === 3 ? "tag-orange" : specificity === 2 ? "tag-blue" : "tag-purple"}">${escapeHtml(scopeLabel(entry.scope))}</span>
      </div>`).join("")}</div>`;
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
  downloadText("黑话词条导入模板.csv", `\uFEFF${templateCsv()}`);
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

function openImport({ context = "global", lockedKbId = null } = {}) {
  const perms = permissions();
  if (context === "kb" ? !perms.canWriteKb : !perms.canWriteGlobal) {
    toast("当前身份无导入权限", "error");
    return;
  }
  state.importContext = context;
  state.importLockedKbId = lockedKbId;
  document.getElementById("import-text").value = "";
  document.getElementById("import-file").value = "";
  const scopeNote = document.getElementById("import-scope-note");
  scopeNote.innerHTML = lockedKbId
    ? `当前从知识库页签导入，所有数据行必须填写「指定知识库 / ${escapeHtml(currentKb().name)}」，越出当前库的行将被拒绝。`
    : "全局黑话管理支持导入全局、指定应用和指定知识库范围的词条；规范编码在整个平台内不可重复。";
  resetImportPreview();
  openModal("modal-import");
}

function importSampleForScope() {
  if (state.importLockedKbId) {
    return `${CSV_HEADERS.join(",")}\n端子箱受潮,EQ-TB-022,端子受潮|箱体凝露,接线端子箱内部出现凝露或进水，可能引起二次回路绝缘下降。,指定知识库,${currentKb().name},启用`;
  }
  return `${CSV_HEADERS.join(",")}\n油色谱异常,OPS-OIL-021,油色|油色谱超标,通过油中溶解气体分析发现设备内部过热或放电等异常。,全局,,启用`;
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
      kbLockedId: state.importLockedKbId || undefined,
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
      <td><div class="cell-main">${escapeHtml(row.candidate.name || "—")}</div><div class="cell-sub">${escapeHtml(row.candidate.code || "—")}</div></td>
      <td class="nowrap">${escapeHtml(scopeLabel(row.candidate.scope))}</td>
      <td class="nowrap">${escapeHtml(statusLabel(row.candidate.status))}</td>
      <td>${row.valid ? '<span class="import-status ok">通过</span>' : `<div class="import-errors">${row.errors.map(escapeHtml).join("<br>")}</div>`}</td>
    </tr>`).join("");
  const confirm = document.getElementById("btn-import-confirm");
  confirm.disabled = !parsed.allValid;
  if (!parsed.allValid) {
    errorBox.textContent = "请先修正预览中的错误；本演示采用全部通过后再写入的方式。";
    errorBox.hidden = false;
  }
}

function confirmImport() {
  const parsed = state.importResult;
  if (!parsed?.allValid) return;
  const canWrite = state.importLockedKbId ? permissions().canWriteKb : permissions().canWriteGlobal;
  if (!canWrite) {
    toast("当前身份无导入权限", "error");
    return;
  }

  const now = new Date().toISOString();
  const added = parsed.rows.map((row, index) => ({
    ...row.candidate,
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
      scope: entry.scope,
      before: null,
      after: entry,
    });
  }
  saveState();
  closeModal("modal-import");
  renderCurrentPage();
  toast(`已导入 ${added.length} 条词条，立即生效`);
}

/* ——— 变更记录 ——— */
function auditInContext(log) {
  if (state.auditContext === "global") return true;
  return log.scope?.type === "kb" && log.scope.id === state.currentKbId;
}

function canRollback(log) {
  const perms = permissions();
  if (state.audit[0]?.id !== log.id || log.action === "回滚" || !log.termId) return false;
  if (state.identity === "full") return true;
  if (state.identity === "kb") return log.scope?.type === "kb" && log.scope.id === state.currentKbId;
  return false;
}

function renderAudit() {
  const logs = state.audit.filter(auditInContext);
  const content = document.getElementById("audit-content");
  document.getElementById("audit-title").textContent = state.auditContext === "kb"
    ? `变更记录 · ${currentKb().name}`
    : "变更记录";
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
        <thead><tr><th>时间</th><th>操作</th><th>词条</th><th>作用范围</th><th>身份</th><th>操作</th></tr></thead>
        <tbody>${logs.map((log) => `
          <tr>
            <td class="nowrap">${escapeHtml(formatDateTime(log.at))}</td>
            <td><span class="audit-action">${escapeHtml(log.action)}</span></td>
            <td><div class="audit-term">${escapeHtml(log.termName || "—")}</div><div class="audit-sub mono">${escapeHtml(log.termId || "")}</div></td>
            <td class="nowrap">${escapeHtml(scopeLabel(log.scope))}</td>
            <td class="nowrap">${escapeHtml(IDENTITY_LABELS[log.identity] || log.identity || "—")}</td>
            <td class="nowrap">${canRollback(log) ? `<button class="btn-link" type="button" data-rollback-log="${escapeHtml(log.id)}">回滚</button>` : log.id === state.audit[0]?.id ? '<span class="muted">最近一次</span>' : '<span class="muted">—</span>'}</td>
          </tr>`).join("")}</tbody>
      </table>
    </div>
    <p class="form-hint mt-12">仅最近一次变更可回滚；回滚会恢复该词条的上一版本，并新增一条回滚记录。</p>`;
}

function openAudit(context = "global") {
  state.auditContext = context;
  renderAudit();
  openModal("modal-audit");
}

function rollbackAudit(logId) {
  const log = state.audit.find((item) => item.id === logId);
  if (!log || !canRollback(log)) return;
  const current = state.entries.find((item) => item.id === log.termId) || null;
  const before = log.before ? clone(log.before) : null;
  const actionText = before
    ? `恢复「${before.name}」到变更前版本`
    : `移除本次新增的「${log.termName}」`;
  openConfirm({
    title: "回滚最近一次变更",
    textHtml: `确认${actionText}？`,
    extraHtml: '<div class="confirm-note">回滚后立即生效，并保留原有变更与本次回滚记录。</div>',
    confirmText: "确认回滚",
    tone: "primary",
    onConfirm: () => {
      if (before) {
        const index = state.entries.findIndex((item) => item.id === log.termId);
        if (index >= 0) state.entries[index] = clone(before);
        else state.entries.push(clone(before));
      } else {
        state.entries = state.entries.filter((item) => item.id !== log.termId);
      }
      pushAudit({
        action: "回滚",
        termId: log.termId,
        termName: before?.name || current?.name || log.termName,
        scope: before?.scope || log.scope,
        before: current,
        after: before,
      });
      saveState();
      renderCurrentPage();
      renderAudit();
      toast("已回滚最近一次变更");
    },
  });
}

/* ——— 事件绑定与初始化 ——— */
function updateIdentity(identity) {
  state.identity = identity;
  if (!permissions().canViewBlack && state.currentPage === "blacktalk") {
    state.currentPage = "kb-list";
    setPage("kb-list", { skipRender: true });
  }
  applyPermissions();
  saveState();
  renderCurrentPage();

  const messages = {
    full: "已切换到黑话管理 + 全局",
    kb: `已切换到仅本库可写（${currentKb().name}）`,
    view: "已切换到仅查看，写操作已隐藏",
    none: "已切换到无权限，黑话入口已隐藏",
  };
  toast(messages[identity], "info");
}

function removeAliasByValue(alias) {
  if (!state.term) return;
  const key = normalizeText(alias);
  state.term.aliases = state.term.aliases.filter((item) => normalizeText(item) !== key);
  renderAliasChips();
  refreshTermValidation({ showErrors: false });
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
  document.querySelectorAll("[data-demo-message]").forEach(button => button.addEventListener("click", () => toast(`${button.dataset.demoMessage}仅展示现网入口，本演示聚焦黑话配置`, "info")));
  document.getElementById("btn-create-kb").addEventListener("click", () => toast("创建入口沿用现网，本演示可配置现有知识库", "info"));
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
    toast("已添加演示成员，权限演示可在用户菜单中切换");
  });
  document.getElementById("kb-list-tbody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-kb]");
    if (button) openKbSettings(button.dataset.openKb, "basic");
  });

  document.getElementById("btn-back-kb-list").addEventListener("click", () => setPage("kb-list"));
  document.querySelectorAll("[data-kb-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.kbTab;
      if (tab === "blacktalk" && !permissions().canViewBlack) return;
      state.kbTab = tab;
      if (tab === "blacktalk") state.kbFilters = { keyword: "", status: "all", page: 1 };
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
  const scopeFilter = document.getElementById("black-scope");
  const statusFilter = document.getElementById("black-status");
  globalSearch.addEventListener("input", (event) => {
    state.globalFilters.keyword = event.target.value;
    state.globalFilters.page = 1;
    renderBlackTable();
  });
  scopeFilter.addEventListener("change", (event) => {
    state.globalFilters.scopeType = event.target.value;
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
  document.getElementById("btn-black-add").addEventListener("click", () => openTermEditor({ source: "global" }));
  document.getElementById("btn-black-import").addEventListener("click", () => openImport({ context: "global" }));
  document.getElementById("btn-black-export").addEventListener("click", () => {
    const entries = searchEntries(state.entries, state.globalFilters).sort(byUpdatedDesc);
    exportEntries(entries, "黑话词条-全局");
  });
  document.getElementById("btn-black-audit").addEventListener("click", () => openAudit("global"));

  document.getElementById("kb-black-search").addEventListener("input", (event) => {
    state.kbFilters.keyword = event.target.value;
    state.kbFilters.page = 1;
    renderKbBlackTable();
  });
  document.getElementById("kb-black-status").addEventListener("change", (event) => {
    state.kbFilters.status = event.target.value;
    state.kbFilters.page = 1;
    renderKbBlackTable();
  });
  document.getElementById("kb-black-tbody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-term-action]");
    if (button) handleTermAction(button.dataset.termAction, button.dataset.termId);
  });
  document.getElementById("btn-kb-black-add").addEventListener("click", () => {
    openTermEditor({ lockedKbId: state.currentKbId, source: "kb" });
  });
  document.getElementById("btn-kb-black-import").addEventListener("click", () => {
    openImport({ context: "kb", lockedKbId: state.currentKbId });
  });
  document.getElementById("btn-kb-black-export").addEventListener("click", () => {
    const entries = searchEntries(
      state.entries.filter((entry) => entry.scope?.type === "kb" && entry.scope.id === state.currentKbId),
      { keyword: state.kbFilters.keyword, status: state.kbFilters.status },
    ).sort(byUpdatedDesc);
    exportEntries(entries, `黑话词条-${currentKb().name}`);
  });
  document.getElementById("btn-kb-black-audit").addEventListener("click", () => openAudit("kb"));

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

  document.getElementById("term-scope-type").addEventListener("change", (event) => {
    populateScopeTarget(event.target.value);
    refreshTermValidation({ showErrors: false });
  });
  document.getElementById("term-scope-target").addEventListener("change", () => refreshTermValidation({ showErrors: false }));
  for (const id of ["term-name", "term-code", "term-definition"]) {
    document.getElementById(id).addEventListener("input", () => refreshTermValidation({ showErrors: false }));
  }
  document.querySelectorAll('input[name="term-status"]').forEach((input) => {
    input.addEventListener("change", () => refreshTermValidation({ showErrors: false }));
  });
  document.getElementById("alias-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      addAliasFromInput();
    } else if (event.key === "Backspace" && !event.target.value && state.term?.aliases.length) {
      state.term.aliases.pop();
      renderAliasChips();
      refreshTermValidation({ showErrors: false });
    }
  });
  document.getElementById("alias-chips").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-alias-index]");
    if (!button || !state.term) return;
    const index = Number(button.dataset.removeAliasIndex);
    state.term.aliases.splice(index, 1);
    renderAliasChips();
    refreshTermValidation({ showErrors: false });
  });
  document.getElementById("term-conflict-list").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-conflict-remove-alias]");
    if (remove) {
      removeAliasByValue(remove.dataset.conflictRemoveAlias);
      return;
    }
    const open = event.target.closest("[data-conflict-open]");
    if (open && canOpenConflictEntry(open.dataset.conflictOpen)) {
      const termId = open.dataset.conflictOpen;
      openConfirm({
        title: "查看冲突词条",
        textHtml: "打开已有词条会离开当前填写内容，确认继续？",
        extraHtml: '<div class="confirm-note">关闭已有词条后，可重新打开新增/编辑抽屉继续处理冲突。</div>',
        confirmText: "继续查看",
        tone: "primary",
        onConfirm: () => {
          closeModal("modal-term");
          openTermEditor({ id: termId, readOnly: true, source: state.currentPage === "kb-settings" ? "kb" : "global" });
        },
      });
    }
  });
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

  document.getElementById("audit-content").addEventListener("click", (event) => {
    const button = event.target.closest("[data-rollback-log]");
    if (button) rollbackAudit(button.dataset.rollbackLog);
  });

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
      const labels = { followup: "追问推荐", upload: "上传文件", black: "黑话增强" };
      toast(`${labels[key]}已${enabled ? "开启" : "关闭"}`);
    });
  }
  document.getElementById("btn-demo-run").addEventListener("click", () => {
    state.agentQuery = document.getElementById("demo-query").value;
    renderAgentDemo();
  });
  document.getElementById("demo-query").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    state.agentQuery = event.target.value;
    renderAgentDemo();
  });

  document.getElementById("btn-reset-demo").addEventListener("click", () => {
    openConfirm({
      title: "重置演示数据",
      textHtml: "确认清除本地演示中的词条、开关和变更记录？",
      extraHtml: '<div class="confirm-note">页面会恢复到初始示例数据，刷新后仍然保持一致。</div>',
      confirmText: "重置",
      tone: "danger",
      onConfirm: () => {
        localStorage.removeItem(STORAGE_KEY);
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
  document.getElementById("black-scope").value = state.globalFilters.scopeType;
  document.getElementById("black-status").value = state.globalFilters.status;
  bindEvents();
  applyPermissions();
  if (!permissions().canViewBlack && state.currentPage === "blacktalk") state.currentPage = "kb-list";
  setPage(state.currentPage);
}

init();
