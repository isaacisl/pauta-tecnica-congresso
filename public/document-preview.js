import { createPdfPreview } from "./pdf-preview.js?v=20261002-1";

export function supportsDocumentPreview(name) {
  return /\.(pdf|png|jpe?g|docx?|odt|rtf)$/i.test(name || "");
}

export function initializeDocumentPreview({ containers, closeOnBackdropClick }) {
  const dialog = document.querySelector("#document-preview-dialog");
  const name = dialog.querySelector("#document-preview-name");
  const loading = dialog.querySelector("#document-preview-loading");
  const loadingText = dialog.querySelector("#document-preview-loading-text");
  const error = dialog.querySelector("#document-preview-error");
  const errorText = dialog.querySelector("#document-preview-error-text");
  const retry = dialog.querySelector("#document-preview-retry");
  const image = dialog.querySelector("#document-preview-image");
  const download = dialog.querySelector("#document-preview-download");
  const open = dialog.querySelector("#document-preview-open");
  const note = dialog.querySelector("#document-preview-note");
  let controller = null;
  let objectUrl = null;
  let version = 0;
  let selected = null;
  const pdfViewer = createPdfPreview(dialog, message => showError(message));

  function resetContent() {
    version++;
    controller?.abort();
    controller = null;
    pdfViewer.reset();
    image.hidden = true;
    image.onload = image.onerror = null;
    image.removeAttribute("src");
    open.hidden = true;
    open.removeAttribute("href");
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function showError(message, allowRetry = true) {
    loading.hidden = true;
    pdfViewer.reset();
    image.hidden = true;
    errorText.textContent = message;
    retry.hidden = !allowRetry;
    error.hidden = false;
  }

  async function showPreview(document) {
    resetContent();
    selected = document;
    const requestVersion = version;
    controller = new AbortController();
    const signal = controller.signal;
    name.textContent = document.name;
    image.alt = `Prévia de ${document.name}`;
    download.href = `/api/records/${document.recordId}/attachments/${document.attachmentId}`;
    loadingText.textContent = /\.(docx?|odt|rtf)$/i.test(document.name) ? "Preparando a prévia em PDF…" : "Carregando documento…";
    loading.hidden = false;
    error.hidden = true;
    note.textContent = "O documento original está disponível em Baixar.";
    if (!dialog.open) dialog.showModal();
    try {
      const response = await fetch(`${download.getAttribute("href")}/preview`, { signal });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error === "Rota não encontrada." ? "A visualização ainda não está disponível neste servidor. Você pode baixar o original." : payload.error || "Não foi possível abrir a prévia. Você ainda pode baixar o original.");
      }
      const blob = await response.blob();
      if (requestVersion !== version || !dialog.open) return;
      if (!["application/pdf", "image/png", "image/jpeg"].includes(blob.type)) throw new Error("Este formato não pode ser exibido aqui. Use Baixar para abrir o documento.");
      objectUrl = URL.createObjectURL(blob);
      open.href = objectUrl;
      open.hidden = false;
      note.textContent = response.headers.get("X-Preview-Converted") === "true"
        ? "A formatação pode variar na prévia. Baixar mantém o arquivo original."
        : "O documento original está disponível em Baixar.";
      if (blob.type === "application/pdf") {
        try { await pdfViewer.show(blob, document.name); }
        catch (failure) {
          if (failure.name === "PasswordException") throw failure;
          throw new Error("Não foi possível exibir este PDF. Tente novamente ou baixe o documento original.");
        }
        if (requestVersion === version && dialog.open) loading.hidden = true;
      } else {
        image.onload = () => { if (requestVersion === version) loading.hidden = true; };
        image.onerror = () => { if (requestVersion === version) showError("Não foi possível exibir esta imagem. Você ainda pode baixar o original.", false); };
        image.src = objectUrl;
        image.hidden = false;
      }
    } catch (failure) {
      if (failure.name !== "AbortError" && requestVersion === version && dialog.open) {
        const message = failure.name === "PasswordException" ? "Este PDF está protegido por senha. Baixe o original para abri-lo."
          : ["InvalidPDFException", "UnknownErrorException"].includes(failure.name) ? "Não foi possível ler este PDF. Você ainda pode baixar o original." : failure.message;
        showError(message);
      }
    }
  }

  for (const container of containers) {
    container.addEventListener("click", (event) => {
      const button = event.target.closest("[data-preview-attachment]");
      if (!button || button.disabled) return;
      showPreview({ recordId: Number(button.dataset.previewRecord), attachmentId: Number(button.dataset.previewAttachment), name: button.dataset.previewName });
    });
  }
  retry.addEventListener("click", () => { if (selected) showPreview(selected); });
  dialog.querySelector("#close-document-preview").addEventListener("click", () => dialog.close());
  closeOnBackdropClick(dialog, () => dialog.close());
  dialog.addEventListener("close", () => { if (!dialog.open) { resetContent(); selected = null; } });
}
