const state = {
  parameters: null,
  filterOptions: null,
  records: [],
  totals: null,
  requestId: 0,
  totalsRequestId: 0,
  toastTimer: null
};

const elements = {
  recordsView: document.querySelector("#records-view"),
  totalsView: document.querySelector("#totals-view"),
  navButtons: [...document.querySelectorAll("[data-view]")],
  filterForm: document.querySelector("#filter-form"),
  filterQ: document.querySelector("#filter-q"),
  filterArea: document.querySelector("#filter-area"),
  filterResponsavel: document.querySelector("#filter-responsavel"),
  filterParecer: document.querySelector("#filter-parecer"),
  filterEmenda: document.querySelector("#filter-emenda"),
  filterPosicionamento: document.querySelector("#filter-posicionamento"),
  clearFilters: document.querySelector("#clear-filters"),
  totalsFilterForm: document.querySelector("#totals-filter-form"),
  totalsFilterArea: document.querySelector("#totals-filter-area"),
  totalsFilterResponsavel: document.querySelector("#totals-filter-responsavel"),
  totalsFilterParecer: document.querySelector("#totals-filter-parecer"),
  totalsFilterEmenda: document.querySelector("#totals-filter-emenda"),
  totalsFilterPosicionamento: document.querySelector("#totals-filter-posicionamento"),
  clearTotalsFilters: document.querySelector("#clear-totals-filters"),
  exportButton: document.querySelector("#export-button"),
  newRecordButton: document.querySelector("#new-record-button"),
  emptyNewButton: document.querySelector("#empty-new-button"),
  totalsNewButton: document.querySelector("#totals-new-button"),
  totalRecords: document.querySelector("#total-records"),
  filteredRecords: document.querySelector("#filtered-records"),
  countLabel: document.querySelector("#record-count-label"),
  tableLoading: document.querySelector("#table-loading"),
  tableWrapper: document.querySelector("#table-wrapper"),
  recordsBody: document.querySelector("#records-body"),
  emptyState: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyDescription: document.querySelector("#empty-description"),
  grandTotal: document.querySelector("#grand-total"),
  grandTotalCaption: document.querySelector("#grand-total-caption"),
  areaTotals: document.querySelector("#area-totals"),
  parecerTotals: document.querySelector("#parecer-totals"),
  emendaTotals: document.querySelector("#emenda-totals"),
  positionTotals: document.querySelector("#position-totals"),
  dialog: document.querySelector("#record-dialog"),
  form: document.querySelector("#record-form"),
  dialogKicker: document.querySelector("#dialog-kicker"),
  dialogTitle: document.querySelector("#dialog-title"),
  closeDialog: document.querySelector("#close-dialog"),
  cancelDialog: document.querySelector("#cancel-dialog"),
  deleteRecord: document.querySelector("#delete-record"),
  saveRecord: document.querySelector("#save-record"),
  saveLabel: document.querySelector("#save-record .button-label"),
  saveLoading: document.querySelector("#save-record .button-loading"),
  exportDialog: document.querySelector("#export-dialog"),
  exportForm: document.querySelector("#export-form"),
  exportPassword: document.querySelector("#export-password"),
  exportPasswordError: document.querySelector("#export-password-error"),
  exportScope: document.querySelector("#export-scope"),
  closeExportDialog: document.querySelector("#close-export-dialog"),
  cancelExportDialog: document.querySelector("#cancel-export-dialog"),
  confirmExport: document.querySelector("#confirm-export"),
  exportLabel: document.querySelector("#confirm-export .button-label"),
  exportLoading: document.querySelector("#confirm-export .button-loading"),
  toast: document.querySelector("#toast"),
  toastMessage: document.querySelector("#toast-message")
};

const labels = Object.freeze([
  ["Área técnica", "areaTecnica"],
  ["Responsável", "responsavel"],
  ["Projeto", "projeto"],
  ["Ementa", "ementa"],
  ["Atual comissão", "atualComissao"],
  ["Parecer", "haParecer"],
  ["Emenda", "sugestaoEmenda"],
  ["Posicionamento", "posicionamento"]
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Não foi possível concluir a operação.");
    error.fields = payload.fields;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function addOptions(select, values) {
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

function replaceOptions(select, values) {
  const previousValue = select.value;
  const placeholder = select.options[0];
  select.replaceChildren(placeholder);
  addOptions(select, values);
  if (values.includes(previousValue)) select.value = previousValue;
  else select.value = "";
}

function availableInParameterOrder(parameterValues, availableValues) {
  const available = new Set(availableValues);
  return parameterValues.filter((value) => available.has(value));
}

function renderFilterOptions() {
  if (!state.parameters || !state.filterOptions) return;
  const options = {
    areasTecnicas: availableInParameterOrder(state.parameters.areasTecnicas, state.filterOptions.areasTecnicas),
    responsaveis: availableInParameterOrder(state.parameters.responsaveis, state.filterOptions.responsaveis),
    pareceres: availableInParameterOrder(state.parameters.pareceres, state.filterOptions.pareceres),
    emendas: availableInParameterOrder(state.parameters.emendas, state.filterOptions.emendas),
    posicionamentos: availableInParameterOrder(state.parameters.posicionamentos, state.filterOptions.posicionamentos)
  };

  for (const select of [elements.filterArea, elements.totalsFilterArea]) replaceOptions(select, options.areasTecnicas);
  for (const select of [elements.filterResponsavel, elements.totalsFilterResponsavel]) replaceOptions(select, options.responsaveis);
  for (const select of [elements.filterParecer, elements.totalsFilterParecer]) replaceOptions(select, options.pareceres);
  for (const select of [elements.filterEmenda, elements.totalsFilterEmenda]) replaceOptions(select, options.emendas);
  for (const select of [elements.filterPosicionamento, elements.totalsFilterPosicionamento]) replaceOptions(select, options.posicionamentos);
}

function setupParameters() {
  renderFilterOptions();

  addOptions(document.querySelector("#field-area"), state.parameters.areasTecnicas);
  addOptions(document.querySelector("#field-responsavel"), state.parameters.responsaveis);
  addOptions(document.querySelector("#field-parecer"), state.parameters.pareceres);
  addOptions(document.querySelector("#field-emenda"), state.parameters.emendas);
  addOptions(document.querySelector("#field-posicionamento"), state.parameters.posicionamentos);
}

async function loadFilterOptions() {
  state.filterOptions = await api("/api/filter-options");
  renderFilterOptions();
}

function filtersFromForm(form) {
  const params = new URLSearchParams(new FormData(form));
  for (const [key, value] of [...params.entries()]) {
    if (!String(value).trim()) params.delete(key);
  }
  return params;
}

function currentFilters() {
  return filtersFromForm(elements.filterForm);
}

function currentTotalFilters() {
  return filtersFromForm(elements.totalsFilterForm);
}

function hasActiveFilters() {
  return currentFilters().size > 0;
}

function hasActiveTotalFilters() {
  return currentTotalFilters().size > 0;
}

function countText(value) {
  return `${value} ${value === 1 ? "registro" : "registros"}`;
}

function chipClass(value) {
  const classes = {
    Sim: "chip-green",
    "Não": "chip-red",
    "Em andamento": "chip-amber",
    Favorável: "chip-green",
    Desfavorável: "chip-red",
    Indiferente: "chip-blue"
  };
  return classes[value] ?? "";
}

function statusChip(value) {
  return `<span class="status-chip ${chipClass(value)}">${escapeHtml(value)}</span>`;
}

function renderRecords() {
  const records = state.records;
  elements.recordsBody.innerHTML = records
    .map((record) => {
      const cells = labels.map(([label, field]) => {
        const isStatus = ["haParecer", "sugestaoEmenda", "posicionamento"].includes(field);
        const content = isStatus
          ? statusChip(record[field])
          : `<span class="${["areaTecnica", "projeto"].includes(field) ? "cell-primary " : ""}cell-truncate" title="${escapeHtml(record[field])}">${escapeHtml(record[field])}</span>`;
        return `<td data-label="${escapeHtml(label)}">${content}</td>`;
      });
      cells.push(`
        <td data-label="Ações">
          <button class="row-action" type="button" data-edit-id="${record.id}" aria-label="Editar ${escapeHtml(record.projeto)}" title="Editar registro">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" /></svg>
          </button>
        </td>
      `);
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");

  elements.filteredRecords.textContent = records.length;
  elements.countLabel.textContent = countText(records.length);
  elements.tableLoading.hidden = true;
  elements.tableWrapper.hidden = records.length === 0;
  elements.emptyState.hidden = records.length > 0;

  if (!records.length) {
    const filtered = hasActiveFilters();
    elements.emptyTitle.textContent = filtered ? "Nenhum resultado encontrado" : "Nenhum registro cadastrado";
    elements.emptyDescription.textContent = filtered
      ? "Tente ajustar ou limpar os filtros aplicados."
      : "Adicione o primeiro projeto prioritário para começar.";
    elements.emptyNewButton.textContent = filtered ? "Limpar filtros" : "Adicionar registro";
    elements.emptyNewButton.dataset.action = filtered ? "clear" : "new";
  }
}

async function loadRecords({ showLoading = false } = {}) {
  const requestId = ++state.requestId;
  if (showLoading) {
    elements.tableLoading.hidden = false;
    elements.tableWrapper.hidden = true;
    elements.emptyState.hidden = true;
  }

  try {
    const params = currentFilters();
    const payload = await api(`/api/records${params.size ? `?${params}` : ""}`);
    if (requestId !== state.requestId) return;
    state.records = payload.records;
    renderRecords();
  } catch (error) {
    if (requestId !== state.requestId) return;
    elements.tableLoading.hidden = true;
    showToast(error.message, "error");
  }
}

function valueMap(series) {
  return new Map(series.map((item) => [item.label, Number(item.count)]));
}

function dotClass(label) {
  const classes = {
    Sim: "dot-green",
    "Não": "dot-red",
    "Em andamento": "dot-amber",
    Favorável: "dot-green",
    Desfavorável: "dot-red",
    Indiferente: "dot-blue"
  };
  return classes[label] ?? "dot-purple";
}

function formatPercentage(count, total) {
  if (!total) return "0%";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  }).format(count / total);
}

function renderMiniStats(container, options, series, total) {
  const counts = valueMap(series);
  container.innerHTML = options
    .map((label) => {
      const count = counts.get(label) ?? 0;
      return `
        <div class="mini-stat-item">
          <span class="mini-stat-label"><i class="mini-stat-dot ${dotClass(label)}"></i>${escapeHtml(label)}</span>
          <strong><span>${count}</span><small class="mini-stat-percent">${formatPercentage(count, total)}</small></strong>
        </div>
      `;
    })
    .join("");
}

function renderAreaTotals(series, total) {
  const used = series.filter((item) => Number(item.count) > 0);
  if (!used.length) {
    elements.areaTotals.innerHTML = '<div class="dashboard-empty">Os totais por área aparecerão aqui após o primeiro cadastro.</div>';
    return;
  }

  const max = Math.max(...used.map((item) => Number(item.count)), 1);
  elements.areaTotals.innerHTML = used
    .map(
      (item) => `
        <div class="bar-item">
          <div class="bar-item-head">
            <span>${escapeHtml(item.label)}</span>
            <strong class="bar-item-metrics"><span>${item.count}</span><small class="bar-item-percent">${formatPercentage(Number(item.count), total)}</small></strong>
          </div>
          <div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width: ${(Number(item.count) / max) * 100}%"></div></div>
        </div>
      `
    )
    .join("");
}

function renderTotals() {
  if (!state.totals || !state.parameters) return;
  elements.grandTotal.textContent = state.totals.total;
  elements.grandTotalCaption.textContent = hasActiveTotalFilters()
    ? "projetos encontrados com os filtros aplicados"
    : "projetos prioritários registrados";
  elements.totalRecords.textContent = state.totals.overallTotal ?? state.totals.total;
  renderAreaTotals(state.totals.byArea, state.totals.total);
  renderMiniStats(elements.parecerTotals, state.parameters.pareceres, state.totals.byParecer, state.totals.total);
  renderMiniStats(elements.emendaTotals, state.parameters.emendas, state.totals.byEmenda, state.totals.total);
  renderMiniStats(elements.positionTotals, state.parameters.posicionamentos, state.totals.byPosicionamento, state.totals.total);
}

async function loadTotals() {
  const requestId = ++state.totalsRequestId;
  try {
    const params = currentTotalFilters();
    const totals = await api(`/api/totals${params.size ? `?${params}` : ""}`);
    if (requestId !== state.totalsRequestId) return;
    state.totals = totals;
    renderTotals();
  } catch (error) {
    if (requestId !== state.totalsRequestId) return;
    showToast(error.message, "error");
  }
}

function showView(view) {
  const totals = view === "totals";
  elements.recordsView.hidden = totals;
  elements.totalsView.hidden = !totals;
  for (const button of elements.navButtons) {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  const hash = totals ? "#totalizacao" : "#registros";
  if (window.location.hash !== hash) history.replaceState(null, "", hash);
  if (totals) loadTotals();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearFieldErrors() {
  for (const errorElement of elements.form.querySelectorAll("[data-error-for]")) errorElement.textContent = "";
  for (const field of elements.form.elements) field.classList?.remove("is-invalid");
}

function showFieldErrors(fields = {}) {
  clearFieldErrors();
  let firstField = null;
  for (const [name, message] of Object.entries(fields)) {
    const field = elements.form.elements.namedItem(name);
    const errorElement = elements.form.querySelector(`[data-error-for="${name}"]`);
    if (field) {
      field.classList.add("is-invalid");
      firstField ??= field;
    }
    if (errorElement) errorElement.textContent = message;
  }
  firstField?.focus();
}

function openNewRecord() {
  elements.form.reset();
  elements.form.elements.id.value = "";
  clearFieldErrors();
  elements.dialogKicker.textContent = "Novo cadastro";
  elements.dialogTitle.textContent = "Adicionar registro";
  elements.deleteRecord.hidden = true;
  elements.dialog.showModal();
  requestAnimationFrame(() => elements.form.elements.areaTecnica.focus());
}

function openEditRecord(id) {
  const record = state.records.find((item) => item.id === id);
  if (!record) {
    showToast("O registro não está mais disponível.", "error");
    loadRecords();
    return;
  }

  clearFieldErrors();
  for (const [, field] of labels) elements.form.elements[field].value = record[field];
  elements.form.elements.id.value = record.id;
  elements.dialogKicker.textContent = "Edição de cadastro";
  elements.dialogTitle.textContent = "Editar registro";
  elements.deleteRecord.hidden = false;
  elements.dialog.showModal();
}

function closeDialog() {
  if (!elements.saveRecord.disabled) elements.dialog.close();
}

function formPayload() {
  const formData = new FormData(elements.form);
  const payload = {};
  for (const [, field] of labels) payload[field] = String(formData.get(field) ?? "").trim();
  return payload;
}

function setSaving(saving) {
  elements.saveRecord.disabled = saving;
  elements.deleteRecord.disabled = saving;
  elements.cancelDialog.disabled = saving;
  elements.closeDialog.disabled = saving;
  elements.saveLabel.hidden = saving;
  elements.saveLoading.hidden = !saving;
}

async function refreshData() {
  await loadFilterOptions();
  await Promise.all([loadRecords(), loadTotals()]);
}

async function saveRecord(event) {
  event.preventDefault();
  clearFieldErrors();
  if (!elements.form.reportValidity()) return;

  const id = elements.form.elements.id.value;
  setSaving(true);
  try {
    await api(id ? `/api/records/${id}` : "/api/records", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(formPayload())
    });
    elements.dialog.close();
    showToast(id ? "Registro atualizado com sucesso." : "Registro adicionado com sucesso.");
    await refreshData();
  } catch (error) {
    if (error.fields) showFieldErrors(error.fields);
    else showToast(error.message, "error");
  } finally {
    setSaving(false);
  }
}

async function deleteRecord() {
  const id = elements.form.elements.id.value;
  if (!id) return;
  const project = elements.form.elements.projeto.value;
  if (!window.confirm(`Excluir o registro "${project}"? Esta ação não pode ser desfeita.`)) return;

  setSaving(true);
  try {
    await api(`/api/records/${id}`, { method: "DELETE" });
    elements.dialog.close();
    showToast("Registro excluído.");
    await refreshData();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setSaving(false);
  }
}

function clearFilters() {
  elements.filterForm.reset();
  loadRecords({ showLoading: true });
}

function clearTotalsFilters() {
  elements.totalsFilterForm.reset();
  loadTotals();
}

function openExportDialog() {
  elements.exportForm.reset();
  elements.exportPassword.classList.remove("is-invalid");
  elements.exportPasswordError.textContent = "";
  const filtered = hasActiveFilters();
  const count = filtered ? state.records.length : (state.totals?.total ?? state.records.length);
  elements.exportScope.textContent = filtered
    ? `A exportação incluirá ${countText(count)} correspondentes aos filtros atuais.`
    : `A exportação incluirá a base completa com ${countText(count)}.`;
  elements.exportDialog.showModal();
  requestAnimationFrame(() => elements.exportPassword.focus());
}

function closeExportDialog() {
  if (!elements.confirmExport.disabled) elements.exportDialog.close();
}

function setExporting(exporting) {
  elements.confirmExport.disabled = exporting;
  elements.closeExportDialog.disabled = exporting;
  elements.cancelExportDialog.disabled = exporting;
  elements.exportLabel.hidden = exporting;
  elements.exportLoading.hidden = !exporting;
}

async function exportRecords(event) {
  event.preventDefault();
  elements.exportPassword.classList.remove("is-invalid");
  elements.exportPasswordError.textContent = "";
  if (!elements.exportForm.reportValidity()) return;

  setExporting(true);
  try {
    const params = currentFilters();
    const response = await fetch(`/api/export.csv${params.size ? `?${params}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: elements.exportPassword.value })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error || "Não foi possível exportar a base.");
      error.status = response.status;
      throw error;
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? "registros-areas-tecnicas.csv";
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

    elements.exportDialog.close();
    showToast("Base exportada com sucesso.");
  } catch (error) {
    if (error.status === 401) {
      elements.exportPassword.classList.add("is-invalid");
      elements.exportPasswordError.textContent = "Senha incorreta. Tente novamente.";
      elements.exportPassword.select();
    } else {
      showToast(error.message, "error");
    }
  } finally {
    setExporting(false);
  }
}

function showToast(message, type = "success") {
  window.clearTimeout(state.toastTimer);
  elements.toastMessage.textContent = message;
  elements.toast.classList.toggle("is-error", type === "error");
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3600);
}

function setupEvents() {
  let searchTimer;
  elements.filterForm.addEventListener("change", () => loadRecords());
  elements.filterQ.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => loadRecords(), 260);
  });
  elements.filterForm.addEventListener("submit", (event) => event.preventDefault());
  elements.totalsFilterForm.addEventListener("change", () => loadTotals());
  elements.totalsFilterForm.addEventListener("submit", (event) => event.preventDefault());

  elements.clearFilters.addEventListener("click", clearFilters);
  elements.clearTotalsFilters.addEventListener("click", clearTotalsFilters);
  elements.emptyNewButton.addEventListener("click", () => {
    if (elements.emptyNewButton.dataset.action === "clear") clearFilters();
    else openNewRecord();
  });
  elements.newRecordButton.addEventListener("click", openNewRecord);
  elements.totalsNewButton.addEventListener("click", openNewRecord);
  elements.exportButton.addEventListener("click", openExportDialog);

  elements.recordsBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-id]");
    if (button) openEditRecord(Number(button.dataset.editId));
  });

  for (const button of elements.navButtons) {
    button.addEventListener("click", () => showView(button.dataset.view));
  }

  elements.form.addEventListener("submit", saveRecord);
  elements.deleteRecord.addEventListener("click", deleteRecord);
  elements.closeDialog.addEventListener("click", closeDialog);
  elements.cancelDialog.addEventListener("click", closeDialog);
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) closeDialog();
  });
  elements.dialog.addEventListener("cancel", (event) => {
    if (elements.saveRecord.disabled) event.preventDefault();
  });

  elements.exportForm.addEventListener("submit", exportRecords);
  elements.closeExportDialog.addEventListener("click", closeExportDialog);
  elements.cancelExportDialog.addEventListener("click", closeExportDialog);
  elements.exportDialog.addEventListener("click", (event) => {
    if (event.target === elements.exportDialog) closeExportDialog();
  });
  elements.exportDialog.addEventListener("cancel", (event) => {
    if (elements.confirmExport.disabled) event.preventDefault();
  });
  elements.exportPassword.addEventListener("input", () => {
    elements.exportPassword.classList.remove("is-invalid");
    elements.exportPasswordError.textContent = "";
  });
  elements.form.addEventListener("input", (event) => {
    const field = event.target;
    if (!field.name) return;
    field.classList.remove("is-invalid");
    const error = elements.form.querySelector(`[data-error-for="${field.name}"]`);
    if (error) error.textContent = "";
  });

  window.addEventListener("hashchange", () => {
    showView(window.location.hash === "#totalizacao" ? "totals" : "records");
  });
}

async function init() {
  setupEvents();
  try {
    [state.parameters, state.filterOptions] = await Promise.all([
      api("/api/parameters"),
      api("/api/filter-options")
    ]);
    setupParameters();
    await Promise.all([loadRecords({ showLoading: true }), loadTotals()]);
    showView(window.location.hash === "#totalizacao" ? "totals" : "records");
  } catch (error) {
    elements.tableLoading.hidden = true;
    showToast(error.message, "error");
  }
}

init();
