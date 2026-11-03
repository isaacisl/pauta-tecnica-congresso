import { responsibleOptions } from "./team-utils.js?v=20261002-7";
import { documentMetadataErrors } from "./document-utils.js?v=20261015-1";
import { parseImportProject, mappedImportRows, importRowIssues, importIdentity, importDuplicateIndex } from "./import-utils.js?v=20261030-3";

const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const uuid = () => { const b = crypto.getRandomValues(new Uint8Array(16)); return [...b].map((n, i) => `${[4, 6, 8, 10].includes(i) ? "-" : ""}${n.toString(16).padStart(2, "0")}`).join(""); };
const choices = (values, current, placeholder = "Selecione") => `<option value="">${placeholder}</option>${values.map(value => `<option value="${escape(value)}"${value === current ? " selected" : ""}>${escape(value === "N/I" ? "N/I — Não informado" : value)}</option>`).join("")}`;
const fileTypes = ".pdf,.doc,.docx,.odt,.rtf,.txt,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png";
const columns = [["projeto", "Projeto"], ["prioridade", "Prioridade"], ["haParecer", "Parecer elaborado"], ["sugestaoEmenda", "Sugestão de emenda"], ["posicionamento", "Posicionamento"]];
const examples = [
  ["PL 900001/2099", "Alta", "Sim", "Sim", "Favorável"],
  ["PL 900002/2099", "Média", "Em andamento", "Não", "Indiferente"],
  ["PL 900003/2099", "Baixa", "Não", "Não", "Desfavorável"],
  ["PL 900004/2099", "N/I", "N/I", "N/I", "N/I"]
];

export function initializeRecordImport({ parameters, api, uploadAttachment, onImported, available }) {
  document.body.insertAdjacentHTML("beforeend", `
  <dialog id="import-access-dialog" class="record-dialog export-dialog" aria-labelledby="import-access-title">
    <form id="import-access-form">
      <header class="dialog-header"><div><h2 id="import-access-title">Importar dados</h2><p>Use a mesma senha da exportação para continuar.</p></div><button id="import-access-close" type="button" class="icon-button" aria-label="Fechar">✕</button></header>
      <div class="dialog-body"><label class="field"><span>Senha</span><input id="import-password" type="password" autocomplete="current-password" placeholder="Digite a senha" required aria-describedby="import-password-error"/><small id="import-password-error" class="field-error" role="alert"></small></label></div>
      <footer class="dialog-footer"><button id="import-access-cancel" type="button" class="button button-secondary">Cancelar</button><button id="import-authorize" type="submit" class="button button-primary">Continuar</button></footer>
    </form>
  </dialog>
  <dialog id="import-dialog" class="record-dialog import-dialog" aria-labelledby="import-title">
    <div class="import-layout">
      <header class="dialog-header"><div><p class="eyebrow">Cadastro em lote</p><h2 id="import-title">Importar acompanhamentos</h2><p>Confira os projetos antes de incluí-los no sistema.</p></div><button id="import-close" class="icon-button" type="button" aria-label="Fechar importação">✕</button></header>
      <ol class="import-steps" aria-label="Etapas da importação"><li data-import-stage="file">1 · Planilha</li><li data-import-stage="review">2 · Conferência</li><li data-import-stage="confirm">3 · Importação</li></ol>
      <div class="dialog-body import-body">
        <p id="import-message" class="import-message" role="status" aria-live="polite"></p>
        <section id="import-file-stage">
          <div class="import-intro">
            <h3>Como preencher a planilha</h3>
            <p>Coloque os nomes das colunas na primeira linha e um projeto em cada linha seguinte, como no exemplo abaixo.</p>
            <div class="import-example-scroll" role="region" aria-label="Tabela de exemplo de preenchimento da planilha" tabindex="0">
              <table class="import-example-table">
                <caption>Exemplo fictício de preenchimento</caption>
                <thead><tr>${columns.map(([, label]) => `<th scope="col">${label}</th>`).join("")}</tr></thead>
                <tbody>${examples.map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join("")}</tr>`).join("")}</tbody>
              </table>
            </div>
            <p class="import-example-note">Os quatro PLs são fictícios, com números de exemplo no ano futuro 2099. Substitua-os pelos projetos reais que deseja acompanhar; esta tabela não será importada.</p>
            <dl class="import-format-rules">
              <div><dt>Projeto</dt><dd>Informe a sigla, um espaço, o número e o ano com quatro dígitos: <strong>PL 123/2026</strong>. Outros tipos oficiais, como PLP e PEC, também são aceitos. Não abrevie o ano para “26”.</dd></div>
              <div><dt>Prioridade</dt><dd>Use ${parameters.prioridades.map(value => `<strong>${escape(value)}</strong>`).join(", ")}.</dd></div>
              <div><dt>Posicionamento</dt><dd>Use ${parameters.posicionamentos.map(value => `<strong>${escape(value)}</strong>`).join(", ")}. Este é o posicionamento da área, não a situação legislativa do projeto.</dd></div>
              <div><dt>Sugestão de emenda</dt><dd>Use ${parameters.emendas.map(value => `<strong>${escape(value)}</strong>`).join(" ou ")}.</dd></div>
              <div><dt>Parecer elaborado</dt><dd>Use ${parameters.pareceres.map(value => `<strong>${escape(value)}</strong>`).join(", ")}. Escolha <strong>Em andamento</strong> quando o parecer ainda estiver sendo preparado.</dd></div>
            </dl>
            <p>Você pode importar somente a coluna Projeto. Classificações vazias ou colunas ausentes ficam como <strong>N/I — Não informado</strong>, para preenchimento posterior pela área técnica. Valores preenchidos mas diferentes das opções aceitas ficam pendentes para corrigir na conferência.</p>
            <p><strong>Escolha a área técnica e o responsável no sistema, na etapa Conferência.</strong> Ambos continuam obrigatórios. Colunas de área e responsável, se existirem na planilha, serão ignoradas. Autor, ementa e tramitação são buscados nas fontes oficiais; outras colunas e links não serão importados.</p>
            <a id="import-template" class="text-button" download="modelo-importacao.csv">Baixar modelo CSV para preencher</a>
          </div>
          <div class="import-upload">
            <span class="import-upload-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h8M12 13v4"/></svg></span>
            <div class="import-upload-copy"><span id="import-upload-label" class="import-upload-title">Sua planilha</span><span id="import-file-name" class="import-file-name" role="status">Nenhum arquivo selecionado</span><small id="import-file-size"></small><small id="import-file-help">XLSX ou CSV UTF-8. Até 8 MB e 500 projetos por aba.</small></div>
            <button id="import-choose-file" type="button" class="button button-primary import-upload-button" aria-controls="import-file" aria-describedby="import-file-help"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg><span id="import-choose-label">Selecionar planilha</span></button>
            <input id="import-file" class="sr-only" type="file" accept=".xlsx,.csv" tabindex="-1" aria-labelledby="import-upload-label" aria-describedby="import-file-help"/>
          </div>
          <div id="import-mapping" hidden><label class="field"><span>Aba da planilha</span><select id="import-sheet"></select></label><h3>Confira as colunas</h3><p>Associe cada campo à coluna correspondente. Os valores originais serão preservados para consulta durante a conferência.</p><div id="import-columns" class="import-fields"></div><p id="import-sheet-count" class="field-help"></p></div>
        </section>
        <section id="import-review-stage" hidden>
          <div class="import-assignment"><label class="field"><span>Área técnica</span><select id="import-area">${choices(parameters.areasTecnicas, "", "Selecione a área")}</select><small>Escolha no sistema para aplicar ao lote. Você pode ajustar cada projeto nos detalhes.</small></label><label class="field"><span>Responsável padrão</span><select id="import-responsible" disabled><option value="">Escolha a área primeiro</option></select><small>Escolha para o lote ou informe em cada projeto. Os responsáveis disponíveis dependem da área.</small></label></div>
          <p class="field-help">Área e responsável são obrigatórios. Prioridade, parecer, emenda e posicionamento vêm da planilha; valores vazios ficam em N/I.</p>
          <p class="field-help">Consultas oficiais completas podem ser reutilizadas por até 24 horas. Para atualizar um projeto, use Consultar novamente nos detalhes.</p>
          <section id="import-lookup-report" class="import-lookup-report" aria-label="Resultado da consulta de projetos" hidden>
            <p id="import-lookup-summary" role="status" aria-live="polite"></p>
            <details id="import-missing-details" open><summary id="import-missing-title">Pautas não localizadas</summary><ul id="import-missing-list"></ul><p>Confira a numeração ou corrija o projeto nos detalhes. Essas linhas ficam pendentes e não serão importadas.</p></details>
            <p id="import-lookup-errors"></p>
          </section>
          <div class="import-list-heading"><div><h3>Prévia dos acompanhamentos</h3><p id="import-count" aria-live="polite"></p></div><button id="import-retry" type="button" class="text-button">Consultar pendentes novamente</button></div>
          <p class="field-help">Confira como os dados ficarão nos registros. Para corrigir uma linha ou adicionar documentos, use Conferir. Os registros só serão salvos após a confirmação final.</p>
          <div class="import-list-tools"><label><input id="import-select-all" type="checkbox" checked/> Selecionar todos</label><label class="field"><span class="sr-only">Filtrar a prévia</span><select id="import-list-filter"><option value="all">Todos os projetos</option><option value="pending">Com pendências</option><option value="ready">Prontos para importar</option><option value="done">Importados</option></select></label></div>
          <p class="import-table-scroll-hint" id="import-table-scroll-hint">Deslize a tabela para os lados para ver todas as colunas.</p>
          <div class="import-table-scroll" role="region" aria-label="Tabela de prévia da importação" aria-describedby="import-table-scroll-hint" tabindex="0">
            <table class="import-preview-table">
              <caption class="sr-only">Prévia dos acompanhamentos</caption>
              <colgroup><col class="import-col-select"/><col class="import-col-area"/><col class="import-col-person"/><col class="import-col-project"/><col class="import-col-position"/><col class="import-col-priority"/><col class="import-col-opinion"/><col class="import-col-amendment"/><col class="import-col-status"/><col class="import-col-action"/></colgroup>
              <thead><tr><th scope="col"><span class="sr-only">Selecionar</span></th><th scope="col">Área técnica</th><th scope="col">Responsável</th><th scope="col">Projeto</th><th scope="col">Posicionamento</th><th scope="col">Prioridade</th><th scope="col">Parecer elaborado</th><th scope="col">Sugestão de emenda</th><th scope="col">Conferência</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
              <tbody id="import-rows"></tbody>
            </table>
          </div><nav class="import-pagination" aria-label="Paginação da prévia"><button id="import-prev" type="button" class="button button-secondary">Anterior</button><span id="import-page"></span><button id="import-next" type="button" class="button button-secondary">Próxima</button></nav>
        </section>
        <section id="import-confirm-stage" hidden><div class="import-confirm-card"><h3 id="import-confirm-title">Confirme a importação</h3><p id="import-confirm-summary"></p><p id="import-confirm-notice"></p><progress id="import-progress" max="1" value="0" aria-label="Progresso da importação"></progress><p id="import-result" role="status" aria-live="polite"></p></div></section>
      </div>
      <footer class="dialog-footer"><button id="import-back" type="button" class="button button-secondary" hidden>Voltar à conferência</button><span class="footer-spacer"></span><button id="import-primary" type="button" class="button button-primary" disabled>Preparar prévia</button></footer>
    </div>
  </dialog>
  <dialog id="import-prompt" class="record-dialog import-prompt" aria-labelledby="import-prompt-title"><div class="dialog-header"><h2 id="import-prompt-title">Conferir ação</h2></div><div class="dialog-body"><p id="import-prompt-message"></p></div><footer class="dialog-footer"><button id="import-prompt-cancel" type="button" class="button button-secondary">Cancelar</button><button id="import-prompt-ok" type="button" class="button button-primary">Continuar</button></footer></dialog>
  <dialog id="import-row-dialog" class="record-dialog import-row-dialog" aria-labelledby="import-row-title"><div class="details-layout"><header class="dialog-header"><div><p class="eyebrow">Conferência individual</p><h2 id="import-row-title"></h2></div><button id="import-row-close" class="icon-button" type="button" aria-label="Voltar à lista de importação">✕</button></header><div id="import-row-content" class="dialog-body"></div><footer class="dialog-footer"><span class="field-help">Alterações ficam na prévia até confirmar a importação.</span><span class="footer-spacer"></span><button id="import-row-done" type="button" class="button button-primary">Concluir conferência</button></footer></div></dialog>`);

  const $ = id => document.getElementById(id);
  const dialog = $("import-dialog"), editor = $("import-row-dialog"), access = $("import-access-dialog");
  let importPassword = "", accessVersion = 0;
  const importHeaders = () => ({ "X-Import-Password": encodeURIComponent(importPassword) });
  let resolvePrompt = null;
  const ask = (text, notice = false) => new Promise(resolve => {
    resolvePrompt = resolve; $("import-prompt-message").textContent = text;
    $("import-prompt-title").textContent = notice ? "Atenção" : "Conferir ação";
    $("import-prompt-cancel").hidden = notice; $("import-prompt-ok").textContent = notice ? "Entendi" : "Continuar";
    $("import-prompt").showModal();
  });
  const answer = value => { $("import-prompt").close(); resolvePrompt?.(value); resolvePrompt = null; };
  $("import-prompt-ok").addEventListener("click", () => answer(true)); $("import-prompt-cancel").addEventListener("click", () => answer(false));
  $("import-prompt").addEventListener("cancel", event => { event.preventDefault(); answer(false); });
  let workbook = null, mapping = {}, rows = [], existing = [], area = "", responsible = "", stage = "file", busy = false, looking = false, page = 1, active = null, generation = 0, chosen = [], finished = false, controller = new AbortController();
  const people = (row = null) => responsibleOptions(row ? row.areaTecnica : area, parameters);
  function applyDefaults() {
    for (const row of rows.filter(row => !locked(row))) {
      if (!row.customArea) row.areaTecnica = area;
      if (!row.customResponsible) row.responsible = row.areaTecnica === area ? responsible : "";
    }
  }
  let duplicateIndex = new Map();
  const message = (text = "", error = false) => { $("import-message").textContent = text; $("import-message").classList.toggle("is-error", error); };
  function duplicate(row) {
    if (!row.proposition || row.record) return false;
    const count = duplicateIndex.get(JSON.stringify([importIdentity(row), row.areaTecnica, row.responsible])) || 0;
    return count > (row.selected ? 1 : 0);
  }
  const issues = row => importRowIssues(row, row.areaTecnica, people(row), duplicate(row));
  const ready = row => row.status !== "done" && (!issues(row).length || Boolean(row.record));
  const locked = row => Boolean(row.attempt || row.record);
  function setStage(next) {
    stage = next;
    for (const name of ["file", "review", "confirm"]) {
      $(`import-${name}-stage`).hidden = name !== stage;
      const item = dialog.querySelector(`[data-import-stage="${name}"]`);
      item.classList.toggle("is-active", name === stage);
      if (name === stage) item.setAttribute("aria-current", "step"); else item.removeAttribute("aria-current");
    }
    $("import-back").hidden = stage === "file";
    $("import-back").textContent = stage === "review" ? "Voltar à planilha" : "Voltar à conferência";
    dialog.querySelector(".import-body").scrollTop = 0;
    update();
  }
  function renderLookupReport() {
    const missing = new Map();
    for (const row of rows.filter(row => row.lookupOutcome === "not-found" && row.searchProject === row.projeto)) {
      const identity = parseImportProject(row.projeto, parameters.propositionTypes);
      if (!identity) continue;
      const name = `${identity.siglaTipo} ${identity.numero}/${identity.ano}`;
      if (!missing.has(name)) missing.set(name, []);
      missing.get(name).push(row.line);
    }
    const failures = rows.filter(row => row.lookupOutcome === "failed");
    $("import-lookup-report").hidden = !missing.size && !failures.length;
    $("import-lookup-summary").textContent = missing.size ? `${missing.size} ${missing.size === 1 ? "pauta não localizada" : "pautas não localizadas"} nas consultas à Câmara e ao Senado.` : "";
    $("import-missing-details").hidden = !missing.size;
    $("import-missing-title").textContent = `Pautas não localizadas (${missing.size})`;
    $("import-missing-list").innerHTML = [...missing].map(([name, lines]) => `<li><strong>${escape(name)}</strong><span>${lines.length === 1 ? "Linha" : "Linhas"} ${lines.join(", ")}</span></li>`).join("");
    $("import-lookup-errors").textContent = failures.length ? `${failures.length} ${failures.length === 1 ? "linha com falha" : "linhas com falha"} de consulta. Consulte novamente; essas pautas não foram contadas como não localizadas.` : "";
  }
  function previewValue(row, field) {
    const value = row[field];
    if (!value) return `<span class="import-invalid-value" title="Corrija este valor na conferência">${escape(row.raw[field] || "Pendente")}</span>`;
    if (field === "posicionamento") {
      const style = { Favorável: "chip-green", Desfavorável: "chip-red", Indiferente: "chip-blue", "N/I": "chip-uninformed" }[value] || "";
      return `<span class="status-chip ${style}">${escape(value)}</span>`;
    }
    return `<span${value === "N/I" ? ' class="import-uninformed" title="Não informado"' : ""}>${escape(value)}</span>`;
  }
  function update() {
    const focused = $("import-rows").contains(document.activeElement) ? document.activeElement : null;
    const focusTarget = focused && {
      key: focused.dataset.selectRow || focused.dataset.openRow,
      checkbox: focused.matches("input"), details: focused.classList.contains("text-button")
    };
    duplicateIndex = importDuplicateIndex(rows, existing);
    renderLookupReport();
    const eligible = rows.filter(row => row.selected && ready(row));
    const pending = rows.filter(row => row.selected && row.status !== "done" && !ready(row));
    $("import-count").textContent = `${rows.length} linhas · ${eligible.length} prontas · ${pending.length} com pendências na seleção · ${rows.filter(row => row.status === "done").length} importadas`;
    $("import-primary").textContent = stage === "file" ? "Preparar prévia" : stage === "review" ? `Revisar importação (${eligible.length})` : finished ? "Concluir" : `Importar ${chosen.length} acompanhamentos`;
    $("import-primary").disabled = busy || looking || (stage === "file" ? !workbook || mapping.projeto < 0 : stage === "review" ? !eligible.length : !finished && !chosen.length);
    $("import-back").disabled = busy || looking;
    $("import-close").disabled = busy;
    $("import-file").disabled = busy;
    $("import-choose-file").disabled = busy;
    $("import-area").disabled = rows.some(locked) || busy;
    $("import-responsible").disabled = !area || busy;
    $("import-retry").disabled = busy || looking;
    const selectable = rows.filter(row => row.status !== "done");
    $("import-select-all").checked = selectable.length > 0 && selectable.every(row => row.selected);
    $("import-select-all").indeterminate = selectable.some(row => row.selected) && !selectable.every(row => row.selected);
    const filter = $("import-list-filter").value;
    const visible = rows.filter(row => filter === "all" || (filter === "pending" ? row.status !== "done" && !ready(row) : filter === "ready" ? ready(row) : row.status === "done"));
    const pages = Math.max(1, Math.ceil(visible.length / 10)); page = Math.min(Math.max(page, 1), pages);
    $("import-page").textContent = `Página ${page} de ${pages} · ${visible.length} linhas`;
    $("import-prev").disabled = page === 1 || busy; $("import-next").disabled = page === pages || busy;
    $("import-rows").innerHTML = visible.slice((page - 1) * 10, page * 10).map(row => {
      const problems = issues(row);
      const status = row.status === "done" ? "Importado" : row.record ? "Registro criado · documentos pendentes" : row.status === "searching" ? "Consultando…" : problems.length ? "Precisa de conferência" : "Pronto para importar";
      const waiting = looking && ["waiting", "searching"].includes(row.status);
      return `<tr class="import-list-row${row.selected ? "" : " is-unselected"}">
        <td><input type="checkbox" data-select-row="${row.key}" aria-label="Selecionar linha ${row.line}: ${escape(row.projeto)}"${row.selected ? " checked" : ""}${busy || row.status === "done" ? " disabled" : ""}/></td>
        <td>${row.areaTecnica ? `<strong class="cell-primary">${escape(row.areaTecnica)}</strong>` : '<span class="import-assignment-pending">Escolher área</span>'}</td>
        <td>${row.responsible ? escape(row.responsible) : '<span class="import-assignment-pending">Escolher responsável</span>'}</td>
        <td><button type="button" class="import-row-open" data-open-row="${row.key}"${waiting ? " disabled" : ""}><strong>${escape(row.proposition?.projeto || row.projeto || "Projeto não informado")}</strong><small>Linha ${row.line}</small>${row.documents.length ? `<small>${row.documents.length} ${row.documents.length === 1 ? "documento" : "documentos"}</small>` : ""}</button></td>
        <td>${previewValue(row, "posicionamento")}</td><td>${previewValue(row, "prioridade")}</td><td>${previewValue(row, "haParecer")}</td><td>${previewValue(row, "sugestaoEmenda")}</td>
        <td><div class="import-row-status"><span class="import-badge${row.status === "done" || !problems.length ? " is-ready" : ""}">${status}</span>${row.error || problems.length ? `<small>${escape(row.error || problems[0])}</small>` : ""}</div></td>
        <td><button type="button" class="text-button" data-open-row="${row.key}" aria-label="${row.status === "done" ? "Ver resumo de" : "Conferir"} ${escape(row.projeto)}, linha ${row.line}"${waiting ? " disabled" : ""}>${row.status === "done" ? "Ver resumo" : "Conferir"}</button></td>
      </tr>`;
    }).join("") || '<tr><td colspan="10" class="dashboard-empty">Nenhum projeto nesta seleção.</td></tr>';
    if (focusTarget?.key) {
      const controls = [...$("import-rows").querySelectorAll(focusTarget.checkbox ? "[data-select-row]" : "[data-open-row]")];
      const replacement = controls.find(control => (control.dataset.selectRow || control.dataset.openRow) === focusTarget.key
        && (focusTarget.checkbox || control.classList.contains("text-button") === focusTarget.details));
      if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
      else $("import-list-filter").focus({ preventScroll: true });
    }
  }

  function renderMapping() {
    const sheet = workbook.sheets[Number($("import-sheet").value)];
    mapping = Object.fromEntries(columns.map(([field]) => [field, sheet.mapping[field] ?? -1]));
    $("import-columns").innerHTML = columns.map(([field, label]) => `<label class="field"><span>${label}${field === "projeto" ? " *" : ""}</span><select data-mapping="${field}"><option value="-1">${field === "projeto" ? "Selecione a coluna" : "N/I se não informado"}</option>${sheet.headers.map((header, index) => `<option value="${index}"${mapping[field] === index ? " selected" : ""}>${escape(header)}</option>`).join("")}</select></label>`).join("");
    $("import-sheet-count").textContent = `${sheet.rows.length} linhas de dados nesta aba. Linhas vazias são ignoradas.`;
    update();
  }

  async function lookup(row, { refresh = false } = {}) {
    if (locked(row)) return;
    const version = generation;
    const queryProject = row.projeto;
    const identity = parseImportProject(row.projeto, parameters.propositionTypes);
    row.proposition = null; row.propositionToken = ""; row.candidates = []; row.error = ""; row.warnings = []; row.searchToken = ""; row.searchProject = "";
    if (!identity) { row.status = "pending"; row.lookupOutcome = "invalid"; row.error = "Informe tipo, número e ano com quatro dígitos. Exemplo: PL 123/2026."; return; }
    row.status = "searching"; row.lookupOutcome = "searching"; update();
    try {
      const result = await api(`/api/propositions?${new URLSearchParams({ ...identity, ...(refresh ? { refresh: "1" } : {}) })}`, { signal: controller.signal });
      if (version !== generation || queryProject !== row.projeto) return;
      row.candidates = result.results; row.searchToken = result.searchToken; row.warnings = result.warnings || [];
      row.searchProject = row.projeto;
      if (result.results.length === 1 && !result.requiresSelection) await choose(row, result.results[0].selectionId);
      else {
        row.status = "pending";
        row.lookupOutcome = result.results.length ? "needs-selection" : row.warnings.length ? "failed" : "not-found";
        row.error = result.results.length ? "Escolha a matéria correta nos detalhes." : row.warnings.length ? "Não foi possível concluir a consulta. Tente novamente." : "Projeto não localizado na Câmara nem no Senado. Confira a numeração ou consulte novamente.";
      }
    } catch { if (version === generation && queryProject === row.projeto) { row.status = "pending"; row.lookupOutcome = "failed"; row.error = "Não foi possível consultar o projeto. Tente novamente."; } }
  }
  async function choose(row, selectionId) {
    const version = generation;
    const queryProject = row.projeto;
    if (row.searchProject !== row.projeto) throw new Error("Consulte novamente após alterar a numeração.");
    const result = await api(`/api/propositions/${encodeURIComponent(selectionId)}`, { method: "POST", signal: controller.signal, body: JSON.stringify({ searchToken: row.searchToken }) });
    if (version !== generation || queryProject !== row.projeto) return;
    row.proposition = result.proposition; row.propositionToken = result.propositionToken; row.status = "checked"; row.lookupOutcome = "found"; row.error = "";
  }
  async function lookupAll({ refresh = false } = {}) {
    if (looking || busy) return;
    looking = true; const version = generation;
    const queue = rows.filter(row => !locked(row) && !row.propositionToken);
    const groups = new Map();
    for (const row of queue) {
      const identity = parseImportProject(row.projeto, parameters.propositionTypes);
      const key = identity ? JSON.stringify(identity) : `invalid:${row.key}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ row, project: row.projeto });
    }
    const pending = [...groups.values()];
    const current = () => version === generation && dialog.open;
    let completed = 0, next = 0;
    const progress = () => message(`Consultando projetos: ${completed} de ${queue.length}. Até 3 projetos são consultados por vez. Você já pode conferir as linhas concluídas.`);
    const worker = async () => {
      while (current() && next < pending.length) {
        const members = pending[next++];
        for (const { row } of members) { row.status = "searching"; row.lookupOutcome = "searching"; }
        update();
        // Isolate the result from edits and share it only with the same query.
        const task = { ...members[0].row };
        await lookup(task, { refresh });
        if (!current()) return;
        const result = { proposition: task.proposition, propositionToken: task.propositionToken, candidates: task.candidates,
          searchToken: task.searchToken, warnings: task.warnings, status: task.status, lookupOutcome: task.lookupOutcome, error: task.error };
        for (const { row, project } of members) {
          if (row.projeto === project) Object.assign(row, result, { searchProject: project });
        }
        completed += members.length; progress(); update();
      }
    };
    progress(); update();
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
    if (version === generation && dialog.open) { looking = false; message("Consulta concluída. Confira as pendências e selecione os projetos que deseja importar."); update(); }
  }

  function renderEditor() {
    const row = active; if (!row) return;
    const readonly = locked(row), done = row.status === "done";
    $("import-row-title").textContent = row.proposition?.projeto || row.projeto || `Linha ${row.line}`;
    const statusFields = [["prioridade", "Prioridade", parameters.prioridades], ["haParecer", "Há parecer elaborado?", parameters.pareceres], ["sugestaoEmenda", "Há sugestão de emenda?", parameters.emendas], ["posicionamento", "Posicionamento da área", parameters.posicionamentos]];
    $("import-row-content").innerHTML = `<p class="import-context">Linha ${row.line} · Área: <strong>${escape(row.areaTecnica || "pendente")}</strong></p>
      ${row.attempt && !row.record ? '<p class="import-message is-error">O envio ainda não foi confirmado. Tente importar esta linha novamente para recuperar a confirmação com segurança. Os dados ficam temporariamente bloqueados para evitar duplicação.</p>' : ""}
      ${row.record ? `<p class="import-message">Acompanhamento #${row.record.id} já criado. ${done ? "Importação concluída." : "Tente novamente para enviar somente os documentos pendentes."}</p>` : ""}
      <div class="import-editor-block"><h3>Projeto</h3><div class="import-project-query"><label class="field"><span>Tipo, número e ano *</span><input id="import-row-project" value="${escape(row.projeto)}" maxlength="300"${readonly ? " disabled" : ""}/></label><button id="import-row-search" type="button" class="button button-secondary"${readonly || looking ? " disabled" : ""}>Consultar novamente</button></div>
      ${row.error ? `<p class="import-message is-error">${escape(row.error)}</p>` : ""}
      ${!row.propositionToken && row.candidates.length ? `<div class="import-candidates">${row.candidates.map(candidate => `<button type="button" class="proposition-result" data-import-candidate="${escape(candidate.selectionId)}"><strong>${escape(candidate.projeto)} · ${candidate.source === "senado" ? "Senado Federal" : "Câmara dos Deputados"}</strong><span>${escape(candidate.ementa || "Ementa não informada")}</span><small>Selecionar esta matéria</small></button>`).join("")}</div>` : ""}
      ${row.proposition ? `<div class="import-official"><strong>${escape(row.proposition.projeto)}</strong><p>${escape(row.proposition.ementa || "Ementa não informada pela fonte.")}</p><dl><dt>Autor(es)</dt><dd>${escape(row.proposition.autor || "Não informado")}</dd><dt>Despacho</dt><dd>${escape(row.proposition.despacho || "Não localizado")}</dd><dt>Atual comissão</dt><dd>${escape(row.proposition.atualComissao || "Não localizada")}</dd></dl></div>` : ""}
      ${row.warnings.length ? `<p class="import-message is-error">${escape(row.warnings.join(" "))}</p>` : ""}</div>
      <div class="import-editor-block"><h3>Acompanhamento</h3><div class="import-fields"><label class="field"><span>Área técnica *</span><select data-row-field="areaTecnica"${readonly ? " disabled" : ""}>${choices(parameters.areasTecnicas, row.areaTecnica)}</select></label><label class="field"><span>Responsável *</span><select data-row-field="responsible"${readonly || !row.areaTecnica ? " disabled" : ""}>${choices(people(row), row.responsible)}</select></label></div><div class="import-fields">${statusFields.map(([field, label, values]) => `<label class="field"><span>${label}</span><select data-row-field="${field}"${readonly ? " disabled" : ""}>${choices(values, row[field])}</select>${!row[field] && row.raw[field] ? `<small class="import-invalid-value">Valor da planilha não reconhecido: ${escape(row.raw[field])}</small>` : ""}</label>`).join("")}</div></div>
      <div class="import-editor-block"><h3>Documentos <small>Opcional</small></h3><p>Adicione os arquivos deste acompanhamento. Cada documento precisa de título e descrição.</p><label class="field"><span>Selecionar documentos</span><input id="import-row-files" type="file" accept="${fileTypes}" multiple${readonly ? " disabled" : ""}/><small>Até 20 MB por arquivo, 20 documentos por projeto e 100 MB no lote.</small></label><div id="import-row-documents">${row.documents.map((doc, index) => `<div class="import-document"><strong>${escape(doc.file.name)}</strong><small>${doc.uploaded ? "Enviado" : "Aguardando confirmar a importação"}</small><label class="field"><span>Título *</span><input data-doc="${index}" data-doc-field="title" value="${escape(doc.title)}" maxlength="180"${readonly ? " disabled" : ""}/></label><label class="field"><span>Descrição *</span><textarea data-doc="${index}" data-doc-field="description" rows="3" maxlength="4000"${readonly ? " disabled" : ""}>${escape(doc.description)}</textarea></label><button type="button" class="text-button" data-remove-doc="${index}"${readonly ? " disabled" : ""}>Retirar da seleção</button></div>`).join("")}</div></div>
      ${issues(row).length ? `<div class="import-pending-box"><strong>Antes de importar</strong><ul>${issues(row).map(issue => `<li>${escape(issue)}</li>`).join("")}</ul></div>` : ""}`;
  }

  async function importRows() {
    if (busy) return;
    busy = true; update(); message("Importando os acompanhamentos. Aguarde a conclusão antes de fechar esta janela.");
    let complete = 0, failed = 0;
    $("import-progress").max = chosen.length; $("import-progress").value = 0;
    for (const row of chosen) {
      try {
        if (!row.record) {
          row.attempt ??= { areaTecnica: row.areaTecnica, responsavel: row.responsible, prioridade: row.prioridade, haParecer: row.haParecer, sugestaoEmenda: row.sugestaoEmenda, posicionamento: row.posicionamento, propositionToken: row.propositionToken };
          const result = await api("/api/import/records", { method: "POST", headers: importHeaders(), body: JSON.stringify({ key: row.key, record: row.attempt }) });
          row.record = result.record;
        }
        for (const doc of row.documents.filter(item => !item.uploaded)) {
          row.record = await uploadAttachment(row.record.id, doc); doc.uploaded = true;
        }
        row.status = "done"; row.error = ""; complete++;
      } catch (error) {
        row.error = row.record ? "O acompanhamento foi criado, mas há documentos pendentes. Tente novamente para concluir o envio." : error.status ? error.message : "Não foi possível confirmar o envio. Tente novamente: o mesmo identificador evita duplicação.";
        // An HTTP rejection confirms that no record was created by this request.
        // For network uncertainty, preserve the exact request for safe replay.
        if (!row.record && error.status) {
          row.attempt = null;
          if (error.status === 422 && !error.fields) { row.propositionToken = ""; row.proposition = null; row.status = "pending"; }
        }
        failed++;
      }
      $("import-progress").value++; $("import-result").textContent = `${complete} concluídos · ${failed} com pendências · ${$("import-progress").value} de ${chosen.length} processados.`;
    }
    busy = false; finished = true;
    const uploaded = chosen.flatMap(row => row.documents).filter(doc => doc.uploaded).length;
    const pendingDocuments = chosen.flatMap(row => row.documents).filter(doc => !doc.uploaded).length;
    $("import-confirm-summary").textContent = `${chosen.filter(row => row.record).length} acompanhamentos salvos · ${uploaded} documentos enviados · ${pendingDocuments} documentos pendentes.`;
    $("import-confirm-title").textContent = failed ? "Importação concluída com pendências" : "Importação concluída";
    message(failed ? "Volte à conferência para revisar as linhas que não foram concluídas. As concluídas não serão importadas novamente." : "Os acompanhamentos estão disponíveis na lista de registros.", Boolean(failed));
    try { ({ records: existing } = await api("/api/records")); } catch { /* Server duplicate checks remain authoritative. */ }
    update(); await onImported();
  }

  async function primary() {
    if (stage === "file") {
      const columns = Object.values(mapping).filter(index => index >= 0);
      if (new Set(columns).size !== columns.length) { message("Associe uma coluna diferente a cada campo.", true); return; }
      rows = mappedImportRows(workbook.sheets[Number($("import-sheet").value)], mapping, parameters, uuid);
      if (!rows.length) { message("Esta aba não tem linhas de dados. Escolha outra aba.", true); return; }
      busy = true; update();
      try { ({ records: existing } = await api("/api/records")); }
      catch { message("Não foi possível conferir os acompanhamentos existentes. Tente novamente.", true); return; }
      finally { busy = false; update(); }
      area = $("import-area").value; responsible = $("import-responsible").value; applyDefaults(); page = 1;
      setStage("review"); await lookupAll();
    } else if (stage === "review") {
      chosen = rows.filter(row => row.selected && ready(row)); finished = false;
      if (!chosen.length) return;
      $("import-confirm-title").textContent = "Confirme a importação";
      const documentCount = chosen.reduce((sum, row) => sum + row.documents.filter(doc => !doc.uploaded).length, 0);
      const areas = new Set(chosen.map(row => row.areaTecnica));
      $("import-confirm-summary").textContent = `${chosen.length} acompanhamentos em ${areas.size} ${areas.size === 1 ? "área técnica" : "áreas técnicas"}. Documentos a enviar: ${documentCount}.`;
      const excluded = rows.filter(row => row.status !== "done" && !chosen.includes(row)).length;
      $("import-confirm-notice").textContent = `${excluded ? `${excluded} linhas não serão importadas agora, por estarem desmarcadas ou com pendências. ` : ""}Nenhum acompanhamento existente será sobrescrito. Se algum documento falhar, o registro criado será mantido e você poderá reenviar apenas os documentos pendentes.`;
      $("import-progress").value = 0; $("import-result").textContent = "A próxima confirmação enviará apenas os acompanhamentos e documentos pendentes selecionados.";
      setStage("confirm"); message();
    } else if (finished) close(); else await importRows();
  }
  async function close() {
    if (busy) return;
    const unfinished = rows.some(row => row.status !== "done");
    if (unfinished && !await ask("Há linhas ou documentos não importados. Fechar descartará essa prévia, mas não apagará os acompanhamentos já criados. Deseja fechar?")) return;
    generation++; controller.abort(); looking = false; dialog.close(); importPassword = ""; rows = []; workbook = null; active = null; $("import-file").value = ""; renderFileSelection();
  }
  function renderFileSelection() {
    const file = $("import-file").files[0];
    $("import-file-name").textContent = file?.name || "Nenhum arquivo selecionado";
    $("import-file-name").title = file?.name || "";
    const size = file && (file.size >= 1024 * 1024 ? [file.size / (1024 * 1024), "MB"] : file.size >= 1024 ? [file.size / 1024, "KB"] : [file.size, "bytes"]);
    $("import-file-size").textContent = size ? `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(size[0])} ${size[1]}` : "";
    $("import-choose-label").textContent = file ? "Trocar planilha" : "Selecionar planilha";
    dialog.querySelector(".import-upload").classList.toggle("has-file", Boolean(file));
  }
  $("import-template").href = URL.createObjectURL(new Blob([`\uFEFF${[columns.map(([, label]) => label), ...examples].map(row => row.join(";")).join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" }));
  $("import-choose-file").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async event => {
    const restoreUploadFocus = [$("import-choose-file"), $("import-file")].includes(document.activeElement);
    const file = event.target.files[0]; workbook = null; $("import-mapping").hidden = true; renderFileSelection(); update(); if (!file) return;
    if (file.size > 8 * 1024 * 1024 || !/\.(xlsx|csv)$/i.test(file.name)) { message("Selecione um arquivo XLSX ou CSV de até 8 MB.", true); return; }
    busy = true; update(); message("Lendo a planilha…");
    try {
      const response = await fetch("/api/import/preview", { method: "POST", headers: { "X-File-Name": encodeURIComponent(file.name), ...importHeaders() }, body: file });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      workbook = data;
      $("import-sheet").innerHTML = data.sheets.map((sheet, index) => `<option value="${index}">${escape(sheet.name)} · ${sheet.rows.length} linhas</option>`).join("");
      const suggested = data.sheets.map((sheet, index) => ({ index, score: sheet.mapping.projeto >= 0 ? sheet.rows.length : -1 })).sort((a, b) => b.score - a.score)[0].index;
      $("import-sheet").value = String(suggested);
      $("import-mapping").hidden = false; renderMapping(); message("Planilha lida. Confira a aba e as colunas antes de continuar.");
    } catch (error) { message(error.message || "Não foi possível ler a planilha. Tente novamente.", true); }
    finally {
      busy = false; update();
      if (restoreUploadFocus && dialog.open && [document.body, dialog].includes(document.activeElement)) $("import-choose-file").focus({ preventScroll: true });
    }
  });
  $("import-sheet").addEventListener("change", renderMapping);
  $("import-columns").addEventListener("change", event => { if (event.target.dataset.mapping) mapping[event.target.dataset.mapping] = Number(event.target.value); update(); });
  $("import-area").addEventListener("change", async () => {
    area = $("import-area").value; responsible = "";
    $("import-responsible").innerHTML = choices(people(), "", "Selecione o responsável");
    applyDefaults(); update();
  });
  $("import-responsible").addEventListener("change", () => { responsible = $("import-responsible").value; applyDefaults(); update(); });
  $("import-select-all").addEventListener("change", event => { rows.filter(row => row.status !== "done").forEach(row => row.selected = event.target.checked); update(); });
  $("import-list-filter").addEventListener("change", () => { page = 1; update(); });
  $("import-prev").addEventListener("click", () => { page--; update(); }); $("import-next").addEventListener("click", () => { page++; update(); });
  $("import-rows").addEventListener("change", event => { const row = rows.find(item => item.key === event.target.dataset.selectRow); if (row) { row.selected = event.target.checked; update(); } });
  $("import-rows").addEventListener("click", event => { const key = event.target.closest("[data-open-row]")?.dataset.openRow; if (!key || busy) return; active = rows.find(row => row.key === key); renderEditor(); editor.showModal(); });
  $("import-row-content").addEventListener("input", event => {
    if (!active || locked(active)) return;
    const { rowField, doc, docField } = event.target.dataset;
    if (rowField) {
      active[rowField] = event.target.value;
      if (rowField === "responsible") active.customResponsible = true;
      if (rowField === "areaTecnica") {
        active.customArea = true;
        if (!people(active).includes(active.responsible)) active.responsible = "";
        renderEditor(); $("import-row-content").querySelector('[data-row-field="areaTecnica"]').focus();
      }
    }
    if (doc !== undefined && docField) active.documents[Number(doc)][docField] = event.target.value;
    if (event.target.id === "import-row-project") { active.projeto = event.target.value; active.proposition = null; active.propositionToken = ""; active.candidates = []; active.searchToken = ""; active.searchProject = ""; active.lookupOutcome = "unqueried"; active.warnings = []; active.error = ""; active.status = "pending"; }
  });
  $("import-row-content").addEventListener("change", async event => {
    if (event.target.id !== "import-row-files" || !active || locked(active)) return;
    for (const file of event.target.files) {
      const extension = `.${file.name.split(".").at(-1).toLowerCase()}`;
      const totalSize = rows.flatMap(row => row.documents).reduce((sum, doc) => sum + doc.file.size, 0);
      if (!file.size || file.size > 20 * 1024 * 1024 || !fileTypes.split(",").includes(extension) || active.documents.length >= 20 || totalSize + file.size > 100 * 1024 * 1024) { await ask(`${file.name}: use um formato permitido, até 20 MB por arquivo, 20 documentos por projeto e 100 MB no lote.`, true); continue; }
      active.documents.push({ file, uploadKey: uuid(), title: "", description: "", uploaded: false });
    }
    renderEditor();
  });
  $("import-row-content").addEventListener("click", async event => {
    if (!active || locked(active)) return;
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.removeDoc !== undefined) { active.documents.splice(Number(button.dataset.removeDoc), 1); renderEditor(); }
    if (button.id === "import-row-search" || button.dataset.importCandidate) {
      const row = active;
      button.disabled = true;
      try { if (button.dataset.importCandidate) await choose(row, button.dataset.importCandidate); else await lookup(row, { refresh: true }); }
      catch { row.error = "Não foi possível confirmar a matéria. Consulte novamente."; }
      renderEditor(); update();
    }
  });
  const closeEditor = () => { editor.close(); active = null; update(); };
  $("import-row-close").addEventListener("click", closeEditor); $("import-row-done").addEventListener("click", () => {
    if (active.documents.some(doc => Object.keys(documentMetadataErrors(doc)).length)) { ask("Complete título e descrição de cada documento ou retire-o da seleção.", true); return; }
    closeEditor();
  });
  editor.addEventListener("cancel", event => { event.preventDefault(); closeEditor(); });
  $("import-primary").addEventListener("click", primary); $("import-close").addEventListener("click", close);
  $("import-back").addEventListener("click", async () => {
    if (stage === "review") {
      if (rows.some(locked)) { message("Há acompanhamentos já enviados. Conclua ou feche este lote antes de selecionar outra planilha.", true); return; }
      if (!await ask("Voltar descartará a conferência e os documentos selecionados. Continuar?")) return;
      generation++; rows = []; setStage("file");
    } else { setStage("review"); message("As linhas concluídas não serão importadas novamente. Revise as pendências para tentar de novo."); }
  });
  $("import-retry").addEventListener("click", () => lookupAll({ refresh: true }));
  dialog.addEventListener("cancel", event => {
    if (event.target !== dialog) return;
    event.preventDefault(); close();
  });
  window.addEventListener("beforeunload", event => { if (dialog.open && (busy || rows.some(row => row.status !== "done"))) { event.preventDefault(); event.returnValue = ""; } });
  function openImport(password) {
    importPassword = password;
    controller = new AbortController(); generation++; looking = false; workbook = null; rows = []; area = ""; responsible = ""; mapping = {}; finished = false; active = null; page = 1;
    $("import-area").value = ""; $("import-responsible").innerHTML = choices([], "", "Escolha a área primeiro"); $("import-list-filter").value = "all";
    $("import-file").value = ""; renderFileSelection(); $("import-mapping").hidden = true; message(); setStage("file"); dialog.showModal();
  }
  const closeAccess = () => { accessVersion++; access.close(); $("import-password").value = ""; };
  $("import-access-close").addEventListener("click", closeAccess);
  $("import-access-cancel").addEventListener("click", closeAccess);
  access.addEventListener("cancel", event => { event.preventDefault(); closeAccess(); });
  $("import-access-form").addEventListener("submit", async event => {
    event.preventDefault();
    const version = ++accessVersion, password = $("import-password").value;
    $("import-password-error").textContent = ""; $("import-authorize").disabled = true;
    try {
      await api("/api/import/authorize", { method: "POST", headers: { "X-Import-Password": encodeURIComponent(password) } });
      if (version !== accessVersion || !access.open) return;
      closeAccess(); openImport(password);
    } catch (error) {
      if (version !== accessVersion || !access.open) return;
      $("import-password-error").textContent = error.message;
      $("import-password").focus(); $("import-password").select();
    } finally { if (version === accessVersion || !access.open) $("import-authorize").disabled = false; }
  });
  document.getElementById("import-button").addEventListener("click", async () => {
    if (dialog.open || access.open) return;
    if (!available) { await ask("Reinicie o serviço da Pauta Técnica e recarregue esta página para habilitar a importação.", true); return; }
    accessVersion++; $("import-password").value = ""; $("import-password-error").textContent = ""; $("import-authorize").disabled = false; access.showModal();
  });
  document.getElementById("import-button").disabled = false;
}
