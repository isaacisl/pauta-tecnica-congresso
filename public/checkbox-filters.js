const controls = new WeakMap();
const normalized = value => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

function updateSelection(control) {
  const ui = controls.get(control);
  const selected = [...ui.options.values()].filter(option => option.input.checked).map(option => option.input.value);
  ui.selection.textContent = selected.length === 0 ? control.dataset.placeholder
    : selected.length === 1 ? selected[0] : `${selected.length} selecionadas`;
  ui.summary.title = selected.join(", ") || control.dataset.placeholder;
  ui.summary.setAttribute("aria-label", `${control.dataset.label}: ${ui.summary.title}`);
  ui.clear.disabled = selected.length === 0;
}

function searchOptions(control) {
  const ui = controls.get(control);
  const query = normalized(ui.search.value.trim());
  let visible = 0;
  for (const option of ui.options.values()) {
    option.label.hidden = !normalized(option.input.value).includes(query);
    if (!option.label.hidden) visible++;
  }
  ui.empty.hidden = visible > 0;
  ui.empty.textContent = ui.options.size ? "Nenhuma opção encontrada." : "Nenhuma opção disponível para os filtros atuais.";
}

export function initializeCheckboxFilters(form) {
  for (const control of form.querySelectorAll(".checkbox-filter")) {
    control.innerHTML = `<summary><span class="filter-selection"></span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5" /></svg></summary>
      <div class="checkbox-filter-panel">
        <input type="search" class="filter-option-search" placeholder="Buscar opções…" autocomplete="off" />
        <div class="checkbox-filter-options" role="group"></div>
        <p class="filter-options-empty" hidden></p>
        <div class="checkbox-filter-footer"><small>Nenhuma marcada = todas</small><button type="button" class="filter-option-clear">Limpar seleção</button></div>
      </div>`;
    const ui = {
      summary: control.querySelector("summary"), selection: control.querySelector(".filter-selection"),
      search: control.querySelector(".filter-option-search"), list: control.querySelector(".checkbox-filter-options"),
      empty: control.querySelector(".filter-options-empty"), clear: control.querySelector(".filter-option-clear"),
      options: new Map()
    };
    controls.set(control, ui);
    ui.list.setAttribute("aria-label", control.dataset.label);
    ui.search.setAttribute("aria-label", `Buscar opções de ${control.dataset.label.toLocaleLowerCase("pt-BR")}`);
    ui.search.hidden = control.dataset.searchable !== "true";
    ui.search.addEventListener("input", () => searchOptions(control));
    const changed = () => {
      updateSelection(control);
      control.dispatchEvent(new CustomEvent("filterchange", { bubbles: true }));
    };
    control.addEventListener("change", event => {
      if (event.target.matches('input[type="checkbox"]')) changed();
    });
    ui.clear.addEventListener("click", () => {
      for (const option of ui.options.values()) option.input.checked = false;
      changed();
    });
    control.addEventListener("toggle", () => {
      if (!control.open) return;
      for (const other of document.querySelectorAll(".checkbox-filter[open]")) {
        if (other !== control) other.open = false;
      }
    });
    control.addEventListener("keydown", event => {
      if (event.key === "Escape" && control.open) {
        event.preventDefault();
        event.stopPropagation();
        control.open = false;
        ui.summary.focus();
      }
    });
    updateSelection(control);
  }
  document.addEventListener("click", event => {
    for (const control of form.querySelectorAll(".checkbox-filter[open]")) {
      if (!control.contains(event.target)) control.open = false;
    }
  });
}

export function renderCheckboxOptions(control, values) {
  const ui = controls.get(control);
  const focused = control.contains(document.activeElement) ? document.activeElement : null;
  const available = new Set(values);
  // Reconcile in place so an open menu, its search and keyboard focus survive refreshes.
  for (const [value, option] of ui.options) {
    if (!available.has(value) && !option.input.checked) {
      option.label.remove();
      ui.options.delete(value);
    }
  }
  for (const value of values) {
    if (ui.options.has(value)) continue;
    const label = document.createElement("label");
    label.className = "checkbox-filter-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = control.dataset.filterName;
    input.value = value;
    const text = document.createElement("span");
    text.textContent = value === "N/I" ? "N/I — Não informado" : value;
    const note = document.createElement("small");
    note.textContent = "Sem resultados";
    label.append(input, text, note);
    ui.options.set(value, { label, input, note });
  }
  const ordered = [...values, ...[...ui.options.keys()].filter(value => !available.has(value))];
  for (const [index, value] of ordered.entries()) {
    const option = ui.options.get(value);
    option.note.hidden = available.has(value);
    if (ui.list.children[index] !== option.label) ui.list.insertBefore(option.label, ui.list.children[index] || null);
  }
  updateSelection(control);
  searchOptions(control);
  if (focused && document.activeElement !== focused) {
    const target = focused.isConnected ? focused : ui.summary;
    target.focus({ preventScroll: true });
  }
}

export function resetCheckboxFilters(form) {
  for (const control of form.querySelectorAll(".checkbox-filter")) {
    const ui = controls.get(control);
    for (const option of ui.options.values()) option.input.checked = false;
    ui.search.value = "";
    control.open = false;
    updateSelection(control);
    searchOptions(control);
  }
}

export function initializeActiveFilters(form, container) {
  function render() {
    const entries = [];
    const query = form.querySelector('input[name="q"]');
    if (query?.value.trim()) entries.push({ field: "q", value: query.value.trim(), label: "Busca" });
    for (const control of form.querySelectorAll(".checkbox-filter")) {
      for (const input of control.querySelectorAll('input[type="checkbox"]:checked')) {
        entries.push({ field: input.name, value: input.value, label: control.dataset.label });
      }
    }
    const key = JSON.stringify(entries);
    if (container.dataset.selectionKey === key) return;
    const focused = container.contains(document.activeElement) ? document.activeElement : null;
    const focusIndex = focused ? [...container.children].indexOf(focused) : -1;
    const buttons = entries.map(({ field, value, label }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "active-filter-chip";
      button.dataset.filterField = field;
      button.dataset.filterValue = value;
      button.setAttribute("aria-label", `Remover filtro ${label}: ${value}`);
      button.title = `Remover filtro ${label}: ${value}`;
      button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" /></svg>';
      const text = document.createElement("span");
      text.textContent = `${label}: ${value}`;
      button.prepend(text);
      return button;
    });
    container.replaceChildren(...buttons);
    container.hidden = entries.length === 0;
    container.dataset.selectionKey = key;
    if (focused) {
      const fallback = focused.dataset.filterField === "q" ? query
        : [...form.querySelectorAll(".checkbox-filter")].find(control => control.dataset.filterName === focused.dataset.filterField)?.querySelector("summary");
      (buttons[Math.min(focusIndex, buttons.length - 1)] || fallback)?.focus({ preventScroll: true });
    }
  }
  container.addEventListener("click", event => {
    const button = event.target.closest("button[data-filter-field]");
    if (!button || !container.contains(button)) return;
    if (button.dataset.filterField === "q") {
      const query = form.querySelector('input[name="q"]');
      query.value = "";
      query.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const input = [...form.querySelectorAll('input[type="checkbox"]')]
      .find(item => item.name === button.dataset.filterField && item.value === button.dataset.filterValue);
    if (input) {
      input.checked = false;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  form.addEventListener("filterchange", render);
  form.addEventListener("input", event => { if (event.target.name === "q") render(); });
  form.addEventListener("reset", () => queueMicrotask(render));
  render();
}
