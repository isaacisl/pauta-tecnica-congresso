export function initializeHistoryUI({ api, escapeHtml, formatDateTime, showToast, refreshData, labels }) {
  const trashDialog = document.querySelector("#trash-dialog");
  const container = document.querySelector("#trash-records");
  async function loadTrash() {
    const { records } = await api("/api/trash");
    container.innerHTML = records.length ? records.map(record => `<article class="recovery-item">
      <div><strong>${escapeHtml(record.projeto)}</strong><p>${escapeHtml(record.areaTecnica)} · ${escapeHtml(record.responsavel)}</p><small>Excluído em ${escapeHtml(formatDateTime(record.deletedAt))}</small></div>
      <button type="button" class="button button-secondary" data-restore="${record.id}" data-revision="${record.revision}">Restaurar</button>
    </article>`).join("") : "<p>A lixeira está vazia.</p>";
  }
  document.querySelector("#open-trash").addEventListener("click", async () => {
    container.textContent = "Carregando…";
    trashDialog.showModal();
    try { await loadTrash(); } catch (error) { container.textContent = error.message; }
  });
  document.querySelector("#close-trash").addEventListener("click", () => trashDialog.close());
  container.addEventListener("click", async event => {
    const button = event.target.closest("[data-restore]");
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      await api(`/api/records/${button.dataset.restore}/restore`, { method: "POST", body: JSON.stringify({ revision: Number(button.dataset.revision) }) });
      await loadTrash();
      await refreshData();
      showToast("Registro e documentos restaurados.");
    } catch (error) { showToast(error.message, "error"); button.disabled = false; }
  });
  document.querySelector("#details-panel-followup").addEventListener("click", async event => {
    const button = event.target.closest("[data-load-history]");
    if (!button || button.disabled) return;
    button.disabled = true;
    const details = document.querySelector("#details-dialog");
    const id = details.dataset.recordId;
    try {
      const { history } = await api(`/api/records/${id}/history`);
      if (details.dataset.recordId !== id || !details.open) return;
      const actionNames = { created: "Inclusão", updated: "Edição", deleted: "Exclusão", restored: "Restauração", attachment_removed: "Documento removido", attachment_restored: "Documento restaurado" };
      document.querySelector("#record-change-history").innerHTML = history.length ? history.map(entry => {
        const changes = entry.action === "updated" ? labels.filter(([, field]) => entry.before?.[field] !== entry.after?.[field]) : [];
        return `<article class="change-entry"><strong>${escapeHtml(actionNames[entry.action] || entry.action)} · ${escapeHtml(formatDateTime(entry.createdAt))}</strong>
          ${entry.before?.attachmentName ? `<p>${escapeHtml(entry.before.attachmentName)}</p>` : ""}
          ${changes.map(([label, field]) => `<div><span>${escapeHtml(label)}</span><p><del>${escapeHtml(entry.before?.[field] || "Em branco")}</del></p><p>${escapeHtml(entry.after?.[field] || "Em branco")}</p></div>`).join("")}
          ${entry.action === "updated" && !changes.length ? "<p>Consulta ou metadados atualizados, sem alteração nos campos.</p>" : ""}</article>`;
      }).join("") : "<p>Sem alterações registradas nesta versão. Alterações anteriores à implantação do histórico não foram reconstruídas.</p>";
      button.hidden = true;
    } catch (error) { showToast(error.message, "error"); button.disabled = false; }
  });
}
