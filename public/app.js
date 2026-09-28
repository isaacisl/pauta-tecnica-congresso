const state = {
  parameters: null,
  recordFilterOptions: null,
  totalFilterOptions: null,
  records: [],
  recordsPage: 1,
  recordsPageSize: 10,
  recordsFilterKey: null,
  recordsLoading: false,
  recordsSearchTimer: null,
  pendingAttachments: [],
  totals: null,
  requestId: 0,
  totalsRequestId: 0,
  toastTimer: null,
  recordFormBaseline: "",
  proposition: null,
  propositionToken: "",
  lookupPreviousProject: "",
  lookupWarnings: [],
  searchToken: "",
  mustSearch: false,
  lookupVersion: 0,
  lookupController: null,
  lookupBusy: false
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
  pagination: document.querySelector("#records-pagination"),
  pageSize: document.querySelector("#records-page-size"),
  pageRange: document.querySelector("#records-page-range"),
  pagePosition: document.querySelector("#records-page-position"),
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
  searchType: document.querySelector("#search-type"),
  searchNumber: document.querySelector("#search-number"),
  searchYear: document.querySelector("#search-year"),
  searchProposition: document.querySelector("#search-proposition"),
  searchStatus: document.querySelector("#proposition-search-status"),
  statusPreview: document.querySelector("#proposition-status-preview"),
  propositionResults: document.querySelector("#proposition-results"),
  despachoHelp: document.querySelector("#despacho-help"),
  comissaoHelp: document.querySelector("#comissao-help"),
  dialogKicker: document.querySelector("#dialog-kicker"),
  dialogTitle: document.querySelector("#dialog-title"),
  closeDialog: document.querySelector("#close-dialog"),
  cancelDialog: document.querySelector("#cancel-dialog"),
  deleteRecord: document.querySelector("#delete-record"),
  saveRecord: document.querySelector("#save-record"),
  saveLabel: document.querySelector("#save-record .button-label"),
  saveLoading: document.querySelector("#save-record .button-loading"),
  attachmentInput: document.querySelector("#field-attachment"),
  existingAttachment: document.querySelector("#existing-attachment"),
  attachmentHistory: document.querySelector("#attachment-history"),
  pendingAttachments: document.querySelector("#pending-attachments"),
  recordHistory: document.querySelector("#record-history"),
  recordCreatedAt: document.querySelector("#record-created-at"),
  recordEditedHistory: document.querySelector("#record-edited-history"),
  recordEditedAt: document.querySelector("#record-edited-at"),
  discardDialog: document.querySelector("#discard-dialog"),
  keepEditing: document.querySelector("#keep-editing"),
  confirmDiscard: document.querySelector("#confirm-discard"),
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
  ["Despacho", "despacho"],
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
  return Boolean(previousValue) && !values.includes(previousValue);
}

function availableInParameterOrder(parameterValues, availableValues) {
  const available = new Set(availableValues);
  return parameterValues.filter((value) => available.has(value));
}

function orderedFilterOptions(filterOptions) {
  if (!state.parameters || !filterOptions) return null;
  return {
    areasTecnicas: availableInParameterOrder(state.parameters.areasTecnicas, filterOptions.areasTecnicas),
    responsaveis: availableInParameterOrder(state.parameters.responsaveis, filterOptions.responsaveis),
    pareceres: availableInParameterOrder(state.parameters.pareceres, filterOptions.pareceres),
    emendas: availableInParameterOrder(state.parameters.emendas, filterOptions.emendas),
    posicionamentos: availableInParameterOrder(state.parameters.posicionamentos, filterOptions.posicionamentos)
  };
}

function renderRecordFilterOptions() {
  const options = orderedFilterOptions(state.recordFilterOptions);
  if (!options) return false;
  return [
    replaceOptions(elements.filterArea, options.areasTecnicas),
    replaceOptions(elements.filterResponsavel, options.responsaveis),
    replaceOptions(elements.filterParecer, options.pareceres),
    replaceOptions(elements.filterEmenda, options.emendas),
    replaceOptions(elements.filterPosicionamento, options.posicionamentos)
  ].some(Boolean);
}

function renderTotalFilterOptions() {
  const options = orderedFilterOptions(state.totalFilterOptions);
  if (!options) return false;
  return [
    replaceOptions(elements.totalsFilterArea, options.areasTecnicas),
    replaceOptions(elements.totalsFilterResponsavel, options.responsaveis),
    replaceOptions(elements.totalsFilterParecer, options.pareceres),
    replaceOptions(elements.totalsFilterEmenda, options.emendas),
    replaceOptions(elements.totalsFilterPosicionamento, options.posicionamentos)
  ].some(Boolean);
}

function setupParameters() {
  addOptions(document.querySelector("#field-area"), state.parameters.areasTecnicas);
  addOptions(document.querySelector("#field-responsavel"), state.parameters.responsaveis);
  addOptions(document.querySelector("#field-parecer"), state.parameters.pareceres);
  addOptions(document.querySelector("#field-emenda"), state.parameters.emendas);
  addOptions(document.querySelector("#field-posicionamento"), state.parameters.posicionamentos);
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

function updateClearFilterButton(form, button) {
  button.disabled = filtersFromForm(form).size === 0;
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

function officialLinks(record) {
  const identifiers = record.matter?.identifiers || [];
  const validId = (value) => Number.isSafeInteger(value) && value > 0;
  const camaraId = identifiers.find((identifier) => identifier.source === "camara" && validId(identifier.externalId))?.externalId
    || (validId(record.camara?.id) ? record.camara.id : null)
    || (record.proposition?.source === "camara" && validId(record.proposition.id) ? record.proposition.id : null);
  const senado = identifiers.find((identifier) => identifier.source === "senado" && identifier.house === "SF"
    && identifier.externalId === record.proposition?.id && validId(identifier.codigoMateria))
    || identifiers.find((identifier) => identifier.source === "senado" && identifier.house === "SF" && validId(identifier.codigoMateria));

  return [
    ...(camaraId ? [{ source: "camara", label: "Câmara dos Deputados", href: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${camaraId}` }] : []),
    ...(senado ? [{ source: "senado", label: "Senado Federal", href: `https://www25.senado.leg.br/web/atividade/materias/-/materia/${senado.codigoMateria}` }] : [])
  ];
}

function openRecordDetails(id) {
  const record = state.records.find((item) => item.id === id);
  if (!record) return;
  const proposition = record.proposition || record.camara;
  const links = officialLinks(record);
  const dialog = document.querySelector("#details-dialog");
  dialog.dataset.recordId = String(id);
  const fields = [...labels, ["Data de inclusão", "createdAt"]];
  if (record.editedAt) fields.push(["Última edição", "editedAt"]);
  document.querySelector("#details-content").innerHTML = fields.map(([label, field]) => {
    const value = field.endsWith("At") ? formatDateTime(record[field]) : record[field];
    const content = ["haParecer", "sugestaoEmenda", "posicionamento"].includes(field) && value ? statusChip(value) : escapeHtml(value || "Não informado");
    return `<div class="${["projeto", "ementa", "despacho"].includes(field) ? "details-wide" : ""}"><dt>${escapeHtml(label)}</dt><dd>${content}</dd></div>`;
  }).join("") + `
    <div><dt>Data de apresentação (início)</dt><dd>${escapeHtml(formatCamaraDate(proposition?.dataApresentacao))}${proposition ? ` · ${escapeHtml(sourceLabel(proposition.source))}` : ""}</dd></div>
    <div><dt>Data e hora da situação</dt><dd>${proposition?.statuses?.length > 1 && !proposition.latestStatus ? "Confira abaixo as datas de cada fonte." : escapeHtml(formatCamaraDate(proposition?.latestStatus?.dataHora || (!proposition?.statuses ? proposition?.statusDataHora : null)))}</dd></div>
    ${proposition ? `<div class="details-wide"><dt>Encontrada em: ${escapeHtml(sourceNames(proposition))}</dt><dd>Projeto e ementa: ${escapeHtml(sourceLabel(proposition.source))} · ID ${escapeHtml(proposition.id)}. Consulta de ${escapeHtml(formatDateTime(proposition.consultadoEm))}.</dd></div>` : ""}
    ${proposition?.statuses ? `<div class="details-wide"><dt>Situação legislativa na consulta</dt><dd>${statusDetails(proposition)}</dd></div>` : `<div class="details-wide"><dt>Situação legislativa</dt><dd>Registro anterior à coleta da situação. Edite e pesquise novamente para obter essa informação.</dd></div>`}
    ${links.length ? `<div class="details-wide"><dt>Páginas oficiais da matéria</dt><dd class="official-links">${links.map((link) => `<a class="official-link" href="${link.href}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-10 10M20 13v7H4V4h7" /></svg></a>`).join("")}</dd></div>` : ""}
    ${record.matter ? `<div class="details-wide"><dt>Identificações da mesma matéria</dt><dd>${escapeHtml(matterIdentifications(record.matter.identifiers))}</dd></div>` : ""}
    ${(record.matter?.identifiers || []).filter((identifier) => identifier.source === "senado" && identifier.evidence).slice(0, 1).map((identifier) => `<div class="details-wide"><dt>Dados e relações oficiais do Senado</dt><dd><a href="https://legis.senado.leg.br/dadosabertos/processo/${Number(identifier.evidence.id)}" target="_blank" rel="noopener noreferrer">Consultar processo no Senado</a> · verificado em ${escapeHtml(formatDateTime(identifier.evidence.consultedAt))}</dd></div>`).join("")}
  ` + (record.attachments?.length ? `<div class="details-wide"><dt>Histórico de documentos (${record.attachments.length})</dt><dd>${attachmentHistoryMarkup(record)}</dd></div>` : "");
  dialog.showModal();
}

function renderPagination() {
  const total = state.records.length;
  const pages = Math.max(1, Math.ceil(total / state.recordsPageSize));
  state.recordsPage = Math.max(1, Math.min(state.recordsPage, pages));
  const start = total ? (state.recordsPage - 1) * state.recordsPageSize + 1 : 0;
  const end = Math.min(state.recordsPage * state.recordsPageSize, total);
  elements.pageSize.value = String(state.recordsPageSize);
  elements.pageSize.disabled = state.recordsLoading;
  elements.pageRange.textContent = state.recordsLoading
    ? "Atualizando registros…"
    : `Exibindo ${start}–${end} de ${countText(total)}`;
  elements.pagePosition.textContent = `Página ${total ? state.recordsPage : 0} de ${total ? pages : 0}`;
  for (const button of elements.pagination.querySelectorAll("[data-page-action]")) {
    const backwards = ["first", "previous"].includes(button.dataset.pageAction);
    button.disabled = state.recordsLoading || !total || (backwards ? state.recordsPage === 1 : state.recordsPage === pages);
  }
}

function setRecordsLoading(loading) {
  state.recordsLoading = loading;
  elements.tableWrapper.setAttribute("aria-busy", String(loading));
  elements.tableWrapper.inert = loading;
  renderPagination();
}

function changeRecordsPage(action) {
  if (state.recordsLoading) return;
  const pages = Math.max(1, Math.ceil(state.records.length / state.recordsPageSize));
  const target = { first: 1, previous: state.recordsPage - 1, next: state.recordsPage + 1, last: pages }[action];
  if (!Number.isInteger(target) || target < 1 || target > pages || target === state.recordsPage) return;
  state.recordsPage = target;
  renderRecords();
  document.querySelector("#table-title").scrollIntoView({ block: "start", behavior: "instant" });
}

function renderRecords() {
  const records = state.records;
  renderPagination();
  const offset = (state.recordsPage - 1) * state.recordsPageSize;
  elements.recordsBody.innerHTML = records.slice(offset, offset + state.recordsPageSize)
    .map((record) => {
      const links = officialLinks(record);
      const preferredLink = links.find((link) => link.source === record.proposition?.source) || links[0];
      const cells = labels.filter(([, field]) => ["areaTecnica", "responsavel", "projeto", "posicionamento"].includes(field)).map(([label, field]) => {
        const isStatus = ["haParecer", "sugestaoEmenda", "posicionamento"].includes(field);
        const content = isStatus
          ? statusChip(record[field])
          : `<span class="${["areaTecnica", "projeto"].includes(field) ? "cell-primary " : ""}cell-truncate" title="${escapeHtml(record[field])}">${escapeHtml(record[field])}</span>`;
        return `<td data-label="${escapeHtml(label)}">${content}</td>`;
      });
      cells.push(`
        <td data-label="Data de inclusão">
          <time class="table-date" datetime="${escapeHtml(record.createdAt)}" title="${escapeHtml(formatDateTime(record.createdAt))}">
            ${escapeHtml(formatDate(record.createdAt))}
          </time>
        </td>
      `);
      cells.push(`
        <td data-label="Ações">
          <span class="row-actions">
            <button class="row-action details-action" type="button" data-details-id="${record.id}" aria-label="Ver detalhes de ${escapeHtml(record.projeto)}" title="Ver detalhes do registro">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            ${preferredLink ? `<a class="row-action official-action" href="${preferredLink.href}" target="_blank" rel="noopener noreferrer" aria-label="Abrir ${escapeHtml(record.projeto)} no site oficial: ${escapeHtml(preferredLink.label)}" title="Abrir no site oficial: ${escapeHtml(preferredLink.label)}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-10 10M20 13v7H4V4h7" /></svg></a>` : ""}
            ${record.attachmentName ? `
              <button type="button" class="row-action attachment-action" data-details-id="${record.id}" aria-label="Ver documentos de ${escapeHtml(record.projeto)}" title="Ver histórico de documentos (${record.attachments?.length || 1})">
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 12.5 14.5 6a3 3 0 0 1 4.2 4.2l-8.2 8.2a5 5 0 0 1-7.1-7.1l8-8" /></svg>
              </button>
            ` : ""}
            <button class="row-action" type="button" data-edit-id="${record.id}" aria-label="Editar ${escapeHtml(record.projeto)}" title="Editar registro">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" /></svg>
            </button>
          </span>
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
  elements.pagination.hidden = false;

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
  window.clearTimeout(state.recordsSearchTimer);
  state.recordsSearchTimer = null;
  const requestId = ++state.requestId;
  setRecordsLoading(true);
  updateClearFilterButton(elements.filterForm, elements.clearFilters);
  if (showLoading) {
    elements.tableLoading.hidden = false;
    elements.tableWrapper.hidden = true;
    elements.emptyState.hidden = true;
  }

  try {
    const params = currentFilters();
    const suffix = params.size ? `?${params}` : "";
    const [payload, filterOptions] = await Promise.all([
      api(`/api/records${suffix}`),
      api(`/api/filter-options${suffix}`)
    ]);
    if (requestId !== state.requestId) return;
    state.recordFilterOptions = filterOptions;
    if (renderRecordFilterOptions()) {
      await loadRecords({ showLoading });
      return;
    }
    if (state.recordsFilterKey !== params.toString()) state.recordsPage = 1;
    state.recordsFilterKey = params.toString();
    state.records = payload.records;
    renderRecords();
  } catch (error) {
    if (requestId !== state.requestId) return;
    elements.tableLoading.hidden = true;
    elements.tableWrapper.hidden = state.records.length === 0;
    showToast(error.message, "error");
  } finally {
    if (requestId === state.requestId) setRecordsLoading(false);
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
  updateClearFilterButton(elements.totalsFilterForm, elements.clearTotalsFilters);
  try {
    const params = currentTotalFilters();
    const suffix = params.size ? `?${params}` : "";
    const [totals, filterOptions] = await Promise.all([
      api(`/api/totals${suffix}`),
      api(`/api/filter-options${suffix}`)
    ]);
    if (requestId !== state.totalsRequestId) return;
    state.totalFilterOptions = filterOptions;
    if (renderTotalFilterOptions()) {
      await loadTotals();
      return;
    }
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

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(size / 1024)} KB`;
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(size / (1024 * 1024))} MB`;
}

function renderExistingAttachment(record) {
  elements.existingAttachment.hidden = !record?.attachments?.length;
  elements.attachmentHistory.innerHTML = record ? attachmentHistoryMarkup(record) : "";
}

function attachmentHistoryMarkup(record) {
  return `<ul class="document-list">${(record.attachments || []).map(file => `<li class="document-item"><div><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(formatFileSize(file.size))} · ${file.createdAt ? `Adicionado em ${escapeHtml(formatDateTime(file.createdAt))}` : "Data de inclusão não registrada (arquivo anterior ao histórico)"}</small></div><a class="text-button attachment-link" href="/api/records/${record.id}/attachments/${file.id}" aria-label="Baixar ${escapeHtml(file.name)}">Baixar</a></li>`).join("")}</ul>`;
}

function renderPendingAttachments() {
  elements.pendingAttachments.hidden = !state.pendingAttachments.length;
  elements.pendingAttachments.innerHTML = state.pendingAttachments.map((item, index) => `<li class="document-item"><div><strong>${escapeHtml(item.file.name)}</strong><small>${escapeHtml(formatFileSize(item.file.size))} · Aguardando salvar</small></div><button type="button" class="text-button" data-remove-pending="${index}" aria-label="Retirar ${escapeHtml(item.file.name)} da seleção">Retirar</button></li>`).join("");
}

function queueAttachments() {
  for (const file of elements.attachmentInput.files) {
    const error = attachmentValidationMessage(file);
    if (error) { showToast(`${file.name}: ${error}`, "error"); continue; }
    if (state.pendingAttachments.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    const uploadKey = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    state.pendingAttachments.push({ file, uploadKey });
  }
  elements.attachmentInput.value = "";
  renderPendingAttachments();
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(date);
}

function renderRecordHistory(record) {
  const isExistingRecord = Boolean(record?.id && record?.createdAt);
  elements.recordHistory.hidden = !isExistingRecord;
  elements.recordCreatedAt.textContent = isExistingRecord ? formatDateTime(record.createdAt) : "";
  const hasEdition = Boolean(isExistingRecord && record.editedAt);
  elements.recordEditedHistory.hidden = !hasEdition;
  elements.recordEditedAt.textContent = hasEdition ? formatDateTime(record.editedAt) : "";
}

function attachmentValidationMessage(file) {
  if (!file) return "";
  const allowedExtension = /\.(pdf|doc|docx|odt|rtf|txt|xls|xlsx|ppt|pptx|jpe?g|png)$/i;
  if (!allowedExtension.test(file.name)) return "Formato não permitido. Selecione um PDF, documento do Office, texto ou imagem.";
  if (file.size > 20 * 1024 * 1024) return "O arquivo deve ter no máximo 20 MB.";
  return "";
}

async function uploadAttachment(recordId, file, uploadKey) {
  const response = await fetch(`/api/records/${recordId}/attachments`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
      "X-Upload-Id": uploadKey
    },
    body: file
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Não foi possível enviar o arquivo.");
    error.status = response.status;
    throw error;
  }
  return payload.record;
}

// Câmara timestamps have no timezone suffix: preserve the official wall-clock date/time.
function formatCamaraDate(value) {
  const match = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return match ? `${match[3]}/${match[2]}/${match[1]}${match[4] ? ` às ${match[4]}:${match[5]}` : ""}` : "Não informada";
}

function matterIdentifications(identifiers = []) {
  return identifiers.map((identifier) => {
    const name = `${identifier.siglaTipo} ${identifier.numero}/${identifier.ano}`;
    if (identifier.source === "camara") return `Câmara: ${name} · ID da proposição ${identifier.externalId}`;
    return `${identifier.house === "SF" ? "Senado" : "Numeração da Câmara no Senado"}: ${name} · ID do processo no Senado ${identifier.externalId}${identifier.codigoMateria ? ` · Código da matéria ${identifier.codigoMateria}` : ""}`;
  }).join("\n");
}

function sourceLabel(source) {
  return source === "senado" ? "Senado Federal" : "Câmara dos Deputados";
}

function sourceNames(proposition) {
  return (proposition.sources || [proposition.source || "camara"]).map(sourceLabel).join(" e ");
}

function situationText(proposition) {
  const status = proposition.latestStatus;
  if (status) return `${status.descricao || "Situação não informada pela fonte"} · ${sourceLabel(status.source)} · ${formatCamaraDate(status.dataHora)}`;
  return proposition.statusComparison === "undated"
    ? "Não é possível comparar a situação mais recente: uma das fontes não informou a data."
    : "As datas coincidem ou não têm precisão suficiente para definir a situação mais recente.";
}

function statusDetails(proposition) {
  return `<div class="legislative-status">
    <strong>${proposition.statusComparison === "latest" ? "Situação mais recente: " : ""}${escapeHtml(situationText(proposition))}</strong>
    ${(proposition.statuses || []).map((status) => `<div class="legislative-source">
      <span>${escapeHtml(sourceLabel(status.source))} · ${escapeHtml(status.projeto)} · ${escapeHtml(formatCamaraDate(status.dataHora))}</span>
      <span>${escapeHtml(status.descricao || "Situação não informada")}${status.tramitacao ? ` — ${escapeHtml(status.tramitacao)}` : ""}</span>
      <small>Dados consultados em ${escapeHtml(formatDateTime(status.consultadoEm))}.</small>
    </div>`).join("")}
    <small>Informações salvas no momento da pesquisa; não são atualizadas em segundo plano.</small>
  </div>`;
}

function showStatusPreview(proposition) {
  elements.statusPreview.hidden = !proposition?.statuses;
  elements.statusPreview.innerHTML = proposition?.statuses ? statusDetails(proposition) : "";
}

function showNavigationHints(proposition, selected = false) {
  const source = proposition?.navigationSource ? sourceLabel(proposition.navigationSource) : "fonte oficial";
  const saved = proposition && !selected;
  elements.despachoHelp.textContent = selected
    ? proposition.despacho ? `Obtido da ${source}. Confira e ajuste se necessário.` : "Despacho não localizado na consulta. Você pode informar manualmente ou deixar em branco."
    : saved ? "Valor salvo no registro. Você pode ajustar ou deixar em branco; uma nova pesquisa tenta atualizá-lo." : "Pesquise a proposição para tentar obter o despacho. Se não houver, preencha manualmente ou deixe em branco.";
  elements.comissaoHelp.textContent = selected
    ? proposition.atualComissao ? `Obtida da ${source}. Confira se este órgão representa a comissão atual e ajuste se necessário.` : "Comissão não localizada na consulta. Você pode informar manualmente ou deixar em branco."
    : saved ? "Valor salvo no registro. Você pode ajustar ou deixar em branco; uma nova pesquisa tenta atualizá-lo." : "Pesquise a proposição para tentar obter a comissão atual. Se não houver, preencha manualmente ou deixe em branco.";
}

function lookupMessage(message, error = false, success = false) {
  elements.searchStatus.textContent = message;
  elements.searchStatus.dataset.error = String(error);
  elements.searchStatus.dataset.success = String(success && !error);
}

function setLookupBusy(busy) {
  state.lookupBusy = busy;
  elements.searchProposition.disabled = busy;
  elements.searchProposition.textContent = busy ? "Consultando…" : "Pesquisar";
  elements.saveRecord.disabled = busy;
  elements.propositionResults.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
}

function cancelLookup() {
  state.lookupVersion++;
  state.lookupController?.abort();
  state.lookupController = null;
  setLookupBusy(false);
}

function resetLookup(record = null) {
  cancelLookup();
  state.proposition = record?.proposition || record?.camara || null;
  state.lookupWarnings = [];
  state.propositionToken = "";
  state.searchToken = "";
  state.lookupPreviousProject = "";
  state.mustSearch = !record;
  elements.searchType.value = state.proposition?.siglaTipo || "";
  elements.searchNumber.value = state.proposition?.numero || "";
  elements.searchYear.value = state.proposition?.ano || "";
  elements.propositionResults.innerHTML = "";
  elements.propositionResults.hidden = true;
  elements.form.elements.ementa.readOnly = !record || Boolean(state.proposition);
  elements.form.elements.ementa.required = Boolean(record && !state.proposition);
  showStatusPreview(state.proposition);
  showNavigationHints(state.proposition);
  lookupMessage(record ? (state.proposition ? `Matéria vinculada. Encontrada em: ${sourceNames(state.proposition)}. Para atualizar os dados ou trocar o projeto, pesquise novamente.` : "Cadastro anterior à integração. Para trocar o projeto, faça uma busca.") : "A pesquisa é obrigatória para criar um registro. Use a numeração da Câmara ou do Senado.");
}

function invalidateLookup() {
  cancelLookup();
  if (!state.lookupPreviousProject) state.lookupPreviousProject = elements.form.elements.projeto.value;
  state.mustSearch = true;
  state.proposition = null;
  state.lookupWarnings = [];
  showStatusPreview(null);
  showNavigationHints(null);
  state.propositionToken = "";
  state.searchToken = "";
  elements.form.elements.projeto.value = "";
  elements.form.elements.ementa.value = "";
  elements.form.elements.ementa.readOnly = true;
  elements.form.elements.ementa.required = false;
  elements.propositionResults.innerHTML = "";
  elements.propositionResults.hidden = true;
  lookupMessage("Clique em Pesquisar para consultar o tipo, número e ano informados.");
}

async function selectProposition(id, version = state.lookupVersion) {
  if (!state.searchToken) return;
  setLookupBusy(true);
  lookupMessage("Carregando os dados da proposição…");
  try {
    const payload = await api(`/api/propositions/${id}`, {
      method: "POST", body: JSON.stringify({ searchToken: state.searchToken }),
      signal: state.lookupController?.signal
    });
    if (version !== state.lookupVersion || !elements.dialog.open) return;
    state.proposition = payload.proposition;
    state.propositionToken = payload.propositionToken;
    state.mustSearch = false;
    const previousProject = state.lookupPreviousProject || elements.form.elements.projeto.value;
    elements.form.elements.projeto.value = payload.proposition.projeto;
    elements.form.elements.ementa.value = payload.proposition.ementa;
    for (const field of ["despacho", "atualComissao"]) {
      const officialValue = payload.proposition[field] || "";
      if (officialValue || (previousProject && previousProject !== payload.proposition.projeto)) {
        elements.form.elements[field].value = officialValue;
      }
    }
    elements.form.elements.ementa.readOnly = true;
    elements.form.elements.ementa.required = false;
    elements.propositionResults.hidden = true;
    showStatusPreview(payload.proposition);
    showNavigationHints(payload.proposition, true);
    state.lookupPreviousProject = payload.proposition.projeto;
    const missing = [["despacho", "despacho"], ["atualComissao", "comissão"]].filter(([field]) => !payload.proposition[field]).map(([, label]) => label);
    const missingNote = missing.length === 2 ? " Despacho e comissão não foram localizados. Você pode preencher esses campos ou deixá-los em branco."
      : missing.length === 1 ? ` ${missing[0] === "despacho" ? "O despacho não foi localizado" : "A comissão não foi localizada"}. Você pode preencher o campo ou deixá-lo em branco.` : "";
    lookupMessage(`Proposição encontrada com sucesso em: ${sourceNames(payload.proposition)}. ${payload.proposition.projeto} selecionado. Confira os dados e complete os demais campos.${missingNote}${payload.proposition.navigationWarning ? ` Atenção: ${payload.proposition.navigationWarning}` : ""}${payload.proposition.ementa ? "" : " A fonte não informou uma ementa."}${state.lookupWarnings.length ? ` Atenção: ${state.lookupWarnings.join(" ")}` : ""}`, false, true);
  } catch (error) {
    if (version === state.lookupVersion) lookupMessage(error.message, true);
  } finally {
    if (version === state.lookupVersion) setLookupBusy(false);
  }
}

async function searchPropositions() {
  if (state.lookupBusy || elements.saveLoading.hidden === false) return;
  const siglaTipo = elements.searchType.value;
  const numero = elements.searchNumber.value.trim();
  const ano = elements.searchYear.value.trim();
  if (!siglaTipo || !/^\d{1,9}$/.test(numero) || Number(numero) < 1 || !/^\d{4}$/.test(ano) || Number(ano) < 1000) {
    lookupMessage("Selecione o tipo e informe um número positivo e um ano com 4 dígitos.", true);
    return;
  }
  invalidateLookup();
  const version = state.lookupVersion;
  state.lookupController = new AbortController();
  setLookupBusy(true);
  lookupMessage("Pesquisando na Câmara e no Senado…");
  try {
    const payload = await api(`/api/propositions?${new URLSearchParams({ siglaTipo, numero, ano })}`, { signal: state.lookupController.signal });
    if (version !== state.lookupVersion || !elements.dialog.open) return;
    state.searchToken = payload.searchToken;
    state.lookupWarnings = payload.warnings || [];
    elements.propositionResults.innerHTML = payload.results.map((result) => `
      <button class="proposition-result" type="button" data-proposition-id="${escapeHtml(result.selectionId)}">
        <strong>${escapeHtml(result.projeto)} · ${escapeHtml(sourceLabel(result.source))} · ID ${result.id}</strong>
        <span>Encontrada em: ${escapeHtml(sourceNames(result))}</span>
        <span>${escapeHtml((result.identifications || []).map((identity) => `${identity.house === "SF" ? "Senado" : "Câmara"}: ${identity.name}`).join(" ↔ "))}</span>
        <span>${escapeHtml(result.ementa || "Ementa não informada")}</span>
        <span>Situação: ${escapeHtml(situationText(result))}</span>
        <small>Apresentação: ${escapeHtml(formatCamaraDate(result.dataApresentacao))} · Selecionar esta proposição</small>
      </button>
    `).join("");
    elements.propositionResults.hidden = payload.results.length === 0;
    if (payload.results.length === 1 && !payload.requiresSelection) await selectProposition(payload.results[0].selectionId, version);
    else {
      const warning = (payload.warnings || []).join(" ");
      lookupMessage(`${warning}${warning ? " " : ""}${payload.results.length ? `${payload.results.length} matéria(s) encontrada(s). Confira as identificações e selecione a desejada abaixo. Resultados separados não possuem equivalência confirmada, mesmo que tenham o mesmo número.` : warning ? "Confira os dados ou tente novamente." : "Nenhuma proposição encontrada. Confira o tipo, número e ano e pesquise novamente."}`, !payload.results.length || Boolean(warning), payload.results.length > 0);
    }
  } catch (error) {
    if (version === state.lookupVersion) lookupMessage(error.message, true);
  } finally {
    if (version === state.lookupVersion) setLookupBusy(false);
  }
}

function openNewRecord() {
  state.pendingAttachments = [];
  renderPendingAttachments();
  elements.form.reset();
  elements.form.elements.id.value = "";
  resetLookup();
  clearFieldErrors();
  elements.dialogKicker.textContent = "Novo cadastro";
  elements.dialogTitle.textContent = "Adicionar registro";
  elements.deleteRecord.hidden = true;
  renderExistingAttachment(null);
  renderRecordHistory(null);
  rememberRecordFormState();
  elements.dialog.showModal();
  requestAnimationFrame(() => elements.searchType.focus());
}

function openEditRecord(id) {
  const record = state.records.find((item) => item.id === id);
  if (!record) {
    showToast("O registro não está mais disponível.", "error");
    loadRecords();
    return;
  }

  clearFieldErrors();
  state.pendingAttachments = [];
  renderPendingAttachments();
  elements.attachmentInput.value = "";
  for (const [, field] of labels) elements.form.elements[field].value = record[field];
  elements.form.elements.id.value = record.id;
  resetLookup(record);
  elements.dialogKicker.textContent = "Edição de cadastro";
  elements.dialogTitle.textContent = "Editar registro";
  elements.deleteRecord.hidden = false;
  renderExistingAttachment(record);
  renderRecordHistory(record);
  rememberRecordFormState();
  elements.dialog.showModal();
}

function recordFormSnapshot() {
  const fields = Object.fromEntries(
    labels.map(([, field]) => [field, String(elements.form.elements[field].value ?? "")])
  );
  return JSON.stringify({
    fields,
    search: [elements.searchType.value, elements.searchNumber.value, elements.searchYear.value],
    proposition: state.proposition,
    attachments: state.pendingAttachments.map(item => item.uploadKey)
  });
}

function rememberRecordFormState() {
  state.recordFormBaseline = recordFormSnapshot();
}

function hasUnsavedRecordChanges() {
  return Boolean(state.recordFormBaseline && recordFormSnapshot() !== state.recordFormBaseline);
}

function closeRecordDialogImmediately() {
  cancelLookup();
  elements.dialog.close();
  state.recordFormBaseline = "";
}

function closeDialog() {
  if (!elements.saveLoading.hidden) return;
  if (hasUnsavedRecordChanges()) {
    if (!elements.discardDialog.open) elements.discardDialog.showModal();
    return;
  }
  closeRecordDialogImmediately();
}

function keepEditingRecord() {
  elements.discardDialog.close();
}

function discardRecordChanges() {
  elements.discardDialog.close();
  closeRecordDialogImmediately();
}

function formPayload() {
  const formData = new FormData(elements.form);
  const payload = {};
  for (const [, field] of labels) payload[field] = String(formData.get(field) ?? "").trim();
  if (state.propositionToken) payload.propositionToken = state.propositionToken;
  return payload;
}

function setSaving(saving) {
  elements.saveRecord.disabled = saving || state.lookupBusy;
  elements.searchProposition.disabled = saving || state.lookupBusy;
  for (const input of [elements.searchType, elements.searchNumber, elements.searchYear]) input.disabled = saving;
  elements.deleteRecord.disabled = saving;
  elements.cancelDialog.disabled = saving;
  elements.closeDialog.disabled = saving;
  elements.attachmentInput.disabled = saving;
  for (const button of elements.pendingAttachments.querySelectorAll("button")) button.disabled = saving;
  elements.saveLabel.hidden = saving;
  elements.saveLoading.hidden = !saving;
}

async function refreshData() {
  await Promise.all([loadRecords(), loadTotals()]);
}

async function saveRecord(event) {
  event.preventDefault();
  if (state.lookupBusy || !elements.saveLoading.hidden) return;
  if (state.mustSearch || (!elements.form.elements.id.value && !state.propositionToken)) {
    lookupMessage("Pesquise e selecione uma proposição antes de salvar.", true);
    elements.searchProposition.scrollIntoView({ block: "center" });
    elements.searchProposition.focus();
    return;
  }
  clearFieldErrors();
  if (!elements.form.reportValidity()) return;

  const attachmentError = state.pendingAttachments.map(item => attachmentValidationMessage(item.file)).find(Boolean);
  if (attachmentError) {
    showToast(attachmentError, "error");
    elements.attachmentInput.focus();
    return;
  }

  const id = elements.form.elements.id.value;
  let savedRecord = null;
  setSaving(true);
  try {
    const result = await api(id ? `/api/records/${id}` : "/api/records", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(formPayload())
    });
    elements.form.elements.id.value = result.record.id;
    savedRecord = result.record;
    state.propositionToken = "";
    state.proposition = result.record.proposition || result.record.camara;
    if (!id) {
      elements.deleteRecord.hidden = false;
      elements.dialogKicker.textContent = "Edição de cadastro";
      elements.dialogTitle.textContent = "Editar registro";
      renderRecordHistory(result.record);
    }
    while (state.pendingAttachments.length) {
      const item = state.pendingAttachments[0];
      savedRecord = await uploadAttachment(result.record.id, item.file, item.uploadKey);
      state.pendingAttachments.shift();
      renderExistingAttachment(savedRecord);
      renderPendingAttachments();
      setSaving(true);
    }
    elements.dialog.close();
    state.recordFormBaseline = "";
    showToast(id ? "Registro atualizado com sucesso." : "Registro adicionado com sucesso.");
    await refreshData();
  } catch (error) {
    if (error.fields) showFieldErrors(error.fields);
    else showToast(savedRecord ? `O registro foi salvo. ${error.message} Os documentos pendentes continuam selecionados; clique em Salvar para tentar novamente.` : error.message, "error");
    if (savedRecord) {
      renderExistingAttachment(savedRecord);
      renderRecordHistory(savedRecord);
      await refreshData();
    }
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
    state.recordFormBaseline = "";
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
  updateClearFilterButton(elements.filterForm, elements.clearFilters);
  loadRecords({ showLoading: true });
}

function clearTotalsFilters() {
  elements.totalsFilterForm.reset();
  updateClearFilterButton(elements.totalsFilterForm, elements.clearTotalsFilters);
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

function closeOnBackdropClick(dialog, closeHandler) {
  let pointerStartedOnBackdrop = false;

  dialog.addEventListener("pointerdown", (event) => {
    pointerStartedOnBackdrop = event.target === dialog;
  });
  dialog.addEventListener("pointerup", () => {
    window.setTimeout(() => {
      pointerStartedOnBackdrop = false;
    }, 0);
  });
  dialog.addEventListener("pointercancel", () => {
    pointerStartedOnBackdrop = false;
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && pointerStartedOnBackdrop) closeHandler();
  });
}

function setupEvents() {
  elements.searchProposition.addEventListener("click", searchPropositions);
  elements.searchType.addEventListener("change", invalidateLookup);
  elements.searchNumber.addEventListener("input", invalidateLookup);
  elements.searchYear.addEventListener("input", invalidateLookup);
  for (const input of [elements.searchType, elements.searchNumber, elements.searchYear]) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); elements.searchProposition.focus(); }
    });
  }
  elements.propositionResults.addEventListener("click", (event) => {
    const button = event.target.closest("[data-proposition-id]");
    if (button && !state.lookupBusy) selectProposition(button.dataset.propositionId);
  });
  elements.dialog.addEventListener("close", cancelLookup);
  elements.filterForm.addEventListener("change", (event) => {
    // The search input already reloads on input; its blur must not start a second request.
    if (event.target !== elements.filterQ) loadRecords();
  });
  elements.filterQ.addEventListener("input", () => {
    updateClearFilterButton(elements.filterForm, elements.clearFilters);
    // Invalidate a previous response as soon as typing starts, including the debounce interval.
    state.requestId++;
    setRecordsLoading(true);
    window.clearTimeout(state.recordsSearchTimer);
    state.recordsSearchTimer = window.setTimeout(() => loadRecords(), 260);
  });
  elements.filterForm.addEventListener("submit", (event) => event.preventDefault());
  elements.totalsFilterForm.addEventListener("change", () => loadTotals());
  elements.totalsFilterForm.addEventListener("submit", (event) => event.preventDefault());

  elements.clearFilters.addEventListener("click", clearFilters);
  elements.clearTotalsFilters.addEventListener("click", clearTotalsFilters);
  elements.pageSize.addEventListener("change", () => {
    const size = Number(elements.pageSize.value);
    if (state.recordsLoading || ![5, 10, 25].includes(size)) return;
    state.recordsPageSize = size;
    state.recordsPage = 1;
    renderRecords();
  });
  elements.pagination.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page-action]");
    if (button && !button.disabled) changeRecordsPage(button.dataset.pageAction);
  });
  elements.emptyNewButton.addEventListener("click", () => {
    if (elements.emptyNewButton.dataset.action === "clear") clearFilters();
    else openNewRecord();
  });
  elements.newRecordButton.addEventListener("click", openNewRecord);
  elements.totalsNewButton.addEventListener("click", openNewRecord);
  elements.exportButton.addEventListener("click", openExportDialog);

  elements.recordsBody.addEventListener("click", (event) => {
    const details = event.target.closest("[data-details-id]");
    if (details) openRecordDetails(Number(details.dataset.detailsId));
    const button = event.target.closest("[data-edit-id]");
    if (button) openEditRecord(Number(button.dataset.editId));
  });

  const detailsDialog = document.querySelector("#details-dialog");
  document.querySelector("#close-details").addEventListener("click", () => detailsDialog.close());
  closeOnBackdropClick(detailsDialog, () => detailsDialog.close());
  document.querySelector("#details-edit").addEventListener("click", () => {
    const id = Number(detailsDialog.dataset.recordId);
    detailsDialog.close();
    openEditRecord(id);
  });

  for (const button of elements.navButtons) {
    button.addEventListener("click", () => showView(button.dataset.view));
  }

  elements.form.addEventListener("submit", saveRecord);
  elements.deleteRecord.addEventListener("click", deleteRecord);
  elements.attachmentInput.addEventListener("change", queueAttachments);
  elements.pendingAttachments.addEventListener("click", event => {
    const button = event.target.closest("[data-remove-pending]");
    if (!button || elements.attachmentInput.disabled) return;
    state.pendingAttachments.splice(Number(button.dataset.removePending), 1);
    renderPendingAttachments();
  });
  elements.closeDialog.addEventListener("click", closeDialog);
  elements.cancelDialog.addEventListener("click", closeDialog);
  closeOnBackdropClick(elements.dialog, closeDialog);
  elements.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog();
  });
  elements.keepEditing.addEventListener("click", keepEditingRecord);
  elements.confirmDiscard.addEventListener("click", discardRecordChanges);
  closeOnBackdropClick(elements.discardDialog, keepEditingRecord);

  elements.exportForm.addEventListener("submit", exportRecords);
  elements.closeExportDialog.addEventListener("click", closeExportDialog);
  elements.cancelExportDialog.addEventListener("click", closeExportDialog);
  closeOnBackdropClick(elements.exportDialog, closeExportDialog);
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
    state.parameters = await api("/api/parameters");
    elements.searchType.innerHTML = '<option value="">Selecione o tipo</option>' + state.parameters.propositionTypes.map(([type, name]) => `<option value="${escapeHtml(type)}">${escapeHtml(type)} — ${escapeHtml(name)}</option>`).join("");
    setupParameters();
    await Promise.all([loadRecords({ showLoading: true }), loadTotals()]);
    showView(window.location.hash === "#totalizacao" ? "totals" : "records");
  } catch (error) {
    elements.tableLoading.hidden = true;
    showToast(error.message, "error");
  }
}

init();
