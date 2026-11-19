import { APPS, normalizeScopes, normalizeText, scopeKey, scopeLabel } from "./domain.mjs?v=20261119-global-log";

export function createScopePicker(root, { label, placeholder, onChange }) {
  const options = [{ type: "global" }, ...APPS.map(app => ({ type: "app", id: app.id }))];
  let selected = new Set();
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "input scope-picker-trigger";
  trigger.setAttribute("aria-label", label);
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  const summary = document.createElement("span");
  const arrow = document.createElement("span");
  arrow.textContent = "⌄";
  arrow.setAttribute("aria-hidden", "true");
  trigger.append(summary, arrow);
  const panel = document.createElement("div");
  panel.className = "scope-picker-panel";
  panel.id = `${root.id}-panel`;
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", label);
  trigger.setAttribute("aria-controls", panel.id);
  const search = document.createElement("input");
  search.className = "input scope-picker-search";
  search.type = "search";
  search.placeholder = "搜索 Agent 名称";
  search.setAttribute("aria-label", "搜索 Agent 名称");
  const list = document.createElement("div");
  list.className = "scope-picker-options";
  const allLabel = document.createElement("label");
  allLabel.className = "scope-picker-option scope-picker-all";
  const all = document.createElement("input");
  all.type = "checkbox";
  allLabel.append(all, "全选");
  const rows = options.map(scope => {
    const row = document.createElement("label");
    row.className = "scope-picker-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = scopeKey(scope);
    row.append(input, scopeLabel(scope));
    input.addEventListener("change", () => {
      if (input.checked) selected.add(input.value);
      else selected.delete(input.value);
      update();
      onChange(value());
    });
    list.append(row);
    return { row, input, scope };
  });
  const empty = document.createElement("div");
  empty.className = "scope-picker-empty";
  empty.textContent = "暂无匹配 Agent";
  empty.hidden = true;
  panel.append(search, allLabel, list, empty);
  root.append(trigger, panel);

  function value() {
    return options.filter(scope => selected.has(scopeKey(scope))).map(scope => ({ ...scope }));
  }

  function update() {
    const text = value().map(scope => scopeLabel(scope)).join("、") || placeholder;
    summary.textContent = text;
    trigger.title = text;
    all.checked = selected.size === options.length;
    all.indeterminate = selected.size > 0 && !all.checked;
    for (const { input, scope } of rows) {
      input.checked = selected.has(scopeKey(scope));
    }
  }

  function close(restoreFocus = false) {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  }

  function open() {
    document.dispatchEvent(new CustomEvent("scope-picker-open", { detail: root.id }));
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    search.value = "";
    filter();
    search.focus();
  }

  function filter() {
    const keyword = normalizeText(search.value);
    let visible = 0;
    for (const { row, scope } of rows) {
      row.hidden = !normalizeText(scopeLabel(scope)).includes(keyword);
      if (!row.hidden) visible += 1;
    }
    empty.hidden = visible > 0;
  }

  trigger.addEventListener("click", () => panel.hidden ? open() : close());
  trigger.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") { event.preventDefault(); open(); }
  });
  root.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) { event.stopPropagation(); close(true); }
  });
  search.addEventListener("input", filter);
  search.addEventListener("keydown", event => { if (event.key === "Enter") event.preventDefault(); });
  all.addEventListener("change", () => {
    selected = all.checked ? new Set(options.map(scopeKey)) : new Set();
    update();
    onChange(value());
  });
  document.addEventListener("click", event => { if (!root.contains(event.target)) close(); });
  document.addEventListener("scope-picker-open", event => { if (event.detail !== root.id) close(); });
  update();
  return {
    value,
    close,
    set(scopes, disabled = false) {
      selected = new Set(normalizeScopes(scopes).map(scopeKey));
      trigger.disabled = disabled;
      update();
      close();
    },
  };
}
