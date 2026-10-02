// PDF.js is loaded only when a PDF preview is requested. All scripts, fonts,
// character maps and decoders are served locally; document bytes never leave.
let libraryPromise;
async function pdfLibrary() {
  if (!libraryPromise) libraryPromise = import("/vendor/pdfjs/pdf.min.mjs?v=6.3.289").catch(error => { libraryPromise = null; throw error; });
  const library = await libraryPromise;
  library.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs?v=6.3.289";
  return library;
}

export function createPdfPreview(dialog, onError) {
  const container = dialog.querySelector("#document-preview-pdf");
  const pages = dialog.querySelector("#document-preview-pages");
  const previous = dialog.querySelector("#document-preview-previous");
  const next = dialog.querySelector("#document-preview-next");
  const pageInput = dialog.querySelector("#document-preview-page");
  const pageCount = dialog.querySelector("#document-preview-page-count");
  const zoomOut = dialog.querySelector("#document-preview-zoom-out");
  const zoomIn = dialog.querySelector("#document-preview-zoom-in");
  const zoomLabel = dialog.querySelector("#document-preview-zoom-label");
  const fit = dialog.querySelector("#document-preview-fit");
  let loadingTask = null;
  let pdf = null;
  let renderTask = null;
  let pageNumber = 1;
  let zoom = 1;
  let version = 0;
  let rendering = false;
  let resizeTimer;
  let lastWidth = 0;
  let documentName = "";

  function updateControls() {
    const busy = rendering || !pdf;
    previous.disabled = busy || pageNumber <= 1;
    next.disabled = busy || pageNumber >= (pdf?.numPages || 0);
    pageInput.disabled = busy;
    pageInput.value = String(pageNumber);
    pageInput.max = String(pdf?.numPages || 1);
    pageCount.textContent = String(pdf?.numPages || 0);
    zoomOut.disabled = busy || zoom <= 0.5;
    zoomIn.disabled = busy || zoom >= 2;
    fit.disabled = busy;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    pages.setAttribute("aria-busy", String(rendering));
  }

  function reset() {
    version++;
    clearTimeout(resizeTimer);
    renderTask?.cancel();
    renderTask = null;
    loadingTask?.destroy().catch(() => {});
    loadingTask = null;
    pdf = null;
    container.hidden = true;
    pages.replaceChildren();
    pageNumber = 1;
    zoom = 1;
    rendering = false;
    updateControls();
  }

  async function render() {
    const currentVersion = version;
    const document = pdf;
    if (!document || rendering) return;
    rendering = true;
    updateControls();
    try {
      const page = await document.getPage(pageNumber);
      if (currentVersion !== version) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(0.1, (pages.clientWidth - 32) / base.width) * zoom;
      const viewport = page.getViewport({ scale });
      // Bound the pixel buffer even for unusually large pages and HiDPI screens.
      const density = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8000000 / (viewport.width * viewport.height)), 16384 / viewport.width, 16384 / viewport.height);
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width * density));
      canvas.height = Math.max(1, Math.floor(viewport.height * density));
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Página ${pageNumber} de ${documentName}`);
      renderTask = page.render({ canvasContext: canvas.getContext("2d"), viewport, transform: density === 1 ? null : [density, 0, 0, density, 0, 0] });
      await renderTask.promise;
      if (currentVersion !== version) return;
      pages.replaceChildren(canvas);
      pages.scrollTop = pages.scrollLeft = 0;
      const textContent = await page.getTextContent().catch(() => ({ items: [] }));
      if (currentVersion !== version) return;
      const text = textContent.items.map(item => `${item.str || ""}${item.hasEOL ? "\n" : " "}`).join("").trim();
      if (text) {
        const details = window.document.createElement("details");
        details.className = "document-preview-transcript";
        const summary = window.document.createElement("summary");
        summary.textContent = "Texto da página";
        const paragraph = window.document.createElement("p");
        paragraph.textContent = text;
        details.append(summary, paragraph);
        pages.append(details);
      }
    } finally {
      if (currentVersion === version) { rendering = false; renderTask = null; updateControls(); }
    }
  }

  async function show(blob, name) {
    reset();
    const currentVersion = version;
    documentName = name;
    container.hidden = false;
    const library = await pdfLibrary();
    const data = new Uint8Array(await blob.arrayBuffer());
    if (currentVersion !== version) return;
    const task = loadingTask = library.getDocument({ data, isEvalSupported: false, enableXfa: false,
      cMapUrl: "/vendor/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/vendor/pdfjs/standard_fonts/", wasmUrl: "/vendor/pdfjs/wasm/" });
    const loaded = await task.promise;
    if (currentVersion !== version) return;
    pdf = loaded;
    await render();
  }

  function redraw() {
    const currentVersion = version;
    render().catch(error => { if (currentVersion === version && pdf && error.name !== "RenderingCancelledException") onError("Não foi possível exibir esta página. Tente novamente ou baixe o original."); });
  }
  previous.addEventListener("click", () => { if (!previous.disabled) { pageNumber--; redraw(); } });
  next.addEventListener("click", () => { if (!next.disabled) { pageNumber++; redraw(); } });
  function goToPage() {
    if (pageInput.disabled || !pdf) return;
    const entered = Number(pageInput.value);
    pageNumber = Number.isInteger(entered) && entered > 0 ? Math.min(entered, pdf.numPages) : pageNumber;
    redraw();
  }
  pageInput.addEventListener("change", goToPage);
  pageInput.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); goToPage(); } });
  zoomOut.addEventListener("click", () => { if (!zoomOut.disabled) { zoom = Math.max(0.5, zoom - 0.25); redraw(); } });
  zoomIn.addEventListener("click", () => { if (!zoomIn.disabled) { zoom = Math.min(2, zoom + 0.25); redraw(); } });
  fit.addEventListener("click", () => { if (!fit.disabled) { zoom = 1; redraw(); } });
  new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (Math.abs(width - lastWidth) < 4) return;
    lastWidth = width;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (pdf && !container.hidden) redraw(); }, 150);
  }).observe(pages);
  return { show, reset };
}
