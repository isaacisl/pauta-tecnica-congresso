import { documentMetadataErrors } from "./document-utils.js?v=20261015-1";

export function initializeDocumentInfo({ api, formatDateTime, getRevision, onSaved, onConflict, showToast, closeOnBackdropClick }) {
  const dialog = document.querySelector("#document-info-dialog");
  const form = document.querySelector("#document-info-form");
  const title = document.querySelector("#document-info-name");
  const description = document.querySelector("#document-info-description");
  const error = document.querySelector("#document-info-error");
  const save = document.querySelector("#save-document-info");
  let current = null;
  let baseline = "";
  let saving = false;
  const snapshot = () => JSON.stringify([title.value, description.value]);
  function close() {
    if (saving) return;
    if (snapshot() !== baseline && !window.confirm("Fechar sem salvar as alterações no título e na descrição?")) return;
    dialog.close();
    current = null;
  }
  for (const id of ["close-document-info", "cancel-document-info"]) document.querySelector(`#${id}`).addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  closeOnBackdropClick(dialog, close);
  form.addEventListener("input", () => { error.hidden = true; });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!current || saving || !form.reportValidity()) return;
    const fields = { title: title.value, description: description.value };
    const errors = documentMetadataErrors(fields);
    if (Object.keys(errors).length) {
      error.textContent = "Preencha o título e a descrição. Não use apenas espaços.";
      error.hidden = false;
      (errors.title ? title : description).focus();
      return;
    }
    saving = true;
    for (const element of form.querySelectorAll("input, textarea, button")) element.disabled = true;
    save.textContent = "Salvando…";
    try {
      const { record } = await api(`/api/records/${current.recordId}/attachments/${current.file.id}`, {
        method: "PUT", body: JSON.stringify({ ...fields, revision: getRevision() })
      });
      await onSaved(record);
      dialog.close();
      current = null;
      showToast("Informações do documento atualizadas.");
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
      if ([409, 428].includes(failure.status)) onConflict(failure);
    } finally {
      saving = false;
      for (const element of form.querySelectorAll("input, textarea, button")) element.disabled = false;
      save.textContent = "Salvar informações";
    }
  });
  return { open(recordId, file) {
    current = { recordId, file };
    title.value = file.title || "";
    description.value = file.description || "";
    document.querySelector("#document-info-original").textContent = `Arquivo: ${file.name} · ${file.createdAt ? `Adicionado em ${formatDateTime(file.createdAt)}` : "Data original de inclusão não registrada"}`;
    error.hidden = true;
    baseline = snapshot();
    dialog.showModal();
    title.focus();
  } };
}
