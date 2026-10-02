import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startServer } from "../server.js";
import { createDocumentPreviews, convertWithLibreOffice, runOfficeProcess } from "../lib/document-previews.js";

const pdf = Buffer.from("%PDF-1.4\npreview-test\n%%EOF");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhxoAAAAASUVORK5CYII=", "base64");
const fields = { areaTecnica: "Educação", responsavel: "Beatriz Silva (Colaborador)", projeto: "PL 123/2026", ementa: "Teste de visualização", atualComissao: "", haParecer: "Não", sugestaoEmenda: "Não", posicionamento: "Favorável" };

async function fixture(convertDocument) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-preview-test-"));
  const app = await startServer({ port: 0, databasePath: path.join(directory, "records.sqlite"), documentConverter: convertDocument, tramitationCheckDelayMs: null });
  const record = app.database.create(fields);
  async function upload(name, content) {
    const response = await fetch(`${app.url}/api/records/${record.id}/attachments`, { method: "POST", headers: { "X-File-Name": encodeURIComponent(name) }, body: content });
    assert.equal(response.status, 201);
    const attachment = (await response.json()).record.attachments[0];
    return app.database.getAttachment(record.id, attachment.id);
  }
  return { app, directory, record, upload, preview: (attachment, id = record.id) => fetch(`${app.url}/api/records/${id}/attachments/${attachment.id}/preview`), close: async () => {
    await app.close();
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith("pauta-preview-test-")) await rm(directory, { recursive: true, force: true });
  } };
}

test("PDF e imagem inline preservam download original, revisão e histórico", async () => {
  const context = await fixture(() => { throw new Error("Não deve converter formatos nativos"); });
  try {
    const attachment = await context.upload("parecer técnico.pdf", pdf);
    const image = await context.upload("imagem.png", png);
    const before = context.app.database.get(context.record.id);
    const historyBefore = context.app.database.history(context.record.id);
    const response = await context.preview(attachment);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.match(response.headers.get("content-disposition"), /^inline;/);
    assert.match(response.headers.get("content-disposition"), /parecer%20t%C3%A9cnico.pdf/);
    assert.equal(response.headers.get("x-preview-converted"), "false");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
    const imageResponse = await context.preview(image);
    assert.equal(imageResponse.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png);
    const download = await fetch(`${context.app.url}/api/records/${context.record.id}/attachments/${attachment.id}`);
    assert.match(download.headers.get("content-disposition"), /^attachment;/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
    assert.deepEqual(context.app.database.get(context.record.id), before);
    assert.deepEqual(context.app.database.history(context.record.id), historyBefore);
    const scripts = await fetch(`${context.app.url}/vendor/pdfjs/pdf.min.mjs`, { method: "HEAD" });
    assert.equal(scripts.status, 200);
    assert.match(scripts.headers.get("content-type"), /^text\/javascript/);
    assert.equal((await fetch(`${context.app.url}/vendor/pdfjs/wasm/jbig2.wasm`, { method: "HEAD" })).headers.get("content-type"), "application/wasm");
  } finally { await context.close(); }
});

test("Word converte sob demanda, deduplica acessos simultâneos e reutiliza PDF após reinício", async () => {
  let calls = 0;
  const context = await fixture(async ({ inputPath, outputDirectory, profileDirectory }) => {
    calls++;
    assert.equal(await readFile(inputPath, "utf8"), "original-word");
    assert.match(await readFile(path.join(profileDirectory, "user", "registrymodifications.xcu"), "utf8"), /MacroSecurityLevel.*<value>3<\/value>/);
    await new Promise(resolve => setTimeout(resolve, 25));
    await writeFile(path.join(outputDirectory, "document.pdf"), pdf);
  });
  try {
    const attachment = await context.upload("análise.docx", "original-word");
    assert.equal(calls, 0);
    const responses = await Promise.all([context.preview(attachment), context.preview(attachment), context.preview(attachment)]);
    assert.equal(calls, 1);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-preview-converted"), "true");
      assert.match(response.headers.get("content-disposition"), /an%C3%A1lise.pdf/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
    }
    assert.equal((await context.preview(attachment)).status, 200);
    assert.equal(calls, 1);
    assert.equal(await (await fetch(`${context.app.url}/api/records/${context.record.id}/attachments/${attachment.id}`)).text(), "original-word");
    const service = createDocumentPreviews({ uploadDirectory: path.join(context.directory, "uploads"), convertDocument: () => { throw new Error("cache deve persistir"); } });
    assert.deepEqual((await service.get(attachment)).content, pdf);
    const cache = await readdir(path.join(context.directory, "previews"));
    assert.equal(cache.length, 1);
    assert.match(cache[0], /^[a-f0-9]{64}\.pdf$/);
    await writeFile(path.join(context.directory, "uploads", attachment.storedName), "updated-word-document");
    const changed = createDocumentPreviews({ uploadDirectory: path.join(context.directory, "uploads"), convertDocument: async ({ outputDirectory }) => { await writeFile(path.join(outputDirectory, "document.pdf"), pdf); calls++; } });
    await changed.get(attachment);
    assert.equal(calls, 2);
  } finally { await context.close(); }
});

test("conversão inválida permite nova tentativa, limpa temporários e preserva original", async () => {
  let attempts = 0;
  const context = await fixture(async ({ outputDirectory }) => {
    attempts++;
    await writeFile(path.join(outputDirectory, "document.pdf"), attempts === 1 ? "not-a-pdf" : pdf);
  });
  try {
    const attachment = await context.upload("arquivo.doc", "word-original");
    const failed = await context.preview(attachment);
    assert.equal(failed.status, 422);
    assert.match((await failed.json()).error, /baixar o original/);
    assert.deepEqual(await readdir(path.join(context.directory, "previews")), []);
    assert.equal((await context.preview(attachment)).status, 200);
    assert.equal(attempts, 2);
    assert.equal(await readFile(path.join(context.directory, "uploads", attachment.storedName), "utf8"), "word-original");
    assert.equal((await context.preview(await context.upload("planilha.xlsx", "xlsx"))).status, 415);
    assert.equal((await context.preview(await context.upload("inválido.pdf", "html-is-not-a-pdf"))).status, 422);
  } finally { await context.close(); }
});

test("não exibe anexos de outro registro, removidos ou na lixeira", async () => {
  const context = await fixture();
  try {
    const attachment = await context.upload("arquivo.pdf", pdf);
    const other = context.app.database.create({ ...fields, responsavel: "Elena Garrido (Consultor)" });
    assert.equal((await context.preview(attachment, other.id)).status, 404);
    assert.equal((await context.preview(attachment, 999999)).status, 404);
    const removed = context.app.database.removeAttachment(context.record.id, attachment.id, context.app.database.get(context.record.id).revision);
    assert.equal((await context.preview(attachment)).status, 404);
    context.app.database.restoreAttachment(context.record.id, attachment.id, removed.revision);
    assert.equal((await context.preview(attachment)).status, 200);
    context.app.database.remove(context.record.id, context.app.database.get(context.record.id).revision);
    assert.equal((await context.preview(attachment)).status, 404);
  } finally { await context.close(); }
});

test("remoção enquanto Word converte bloqueia também a resposta em andamento", async () => {
  let complete;
  let entered;
  const began = new Promise(resolve => { entered = resolve; });
  const context = await fixture(async ({ outputDirectory }) => {
    entered();
    await new Promise(resolve => { complete = resolve; });
    await writeFile(path.join(outputDirectory, "document.pdf"), pdf);
  });
  try {
    const attachment = await context.upload("arquivo.docx", "word");
    const request = context.preview(attachment);
    await began;
    context.app.database.removeAttachment(context.record.id, attachment.id, context.app.database.get(context.record.id).revision);
    complete();
    assert.equal((await request).status, 404);
  } finally { complete?.(); await context.close(); }
});

test("fila limita conversões diferentes e continua após uma falha", async () => {
  let release;
  let entered;
  const began = new Promise(resolve => { entered = resolve; });
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const context = await fixture();
  const service = createDocumentPreviews({ uploadDirectory: path.join(context.directory, "uploads"), convertDocument: async ({ outputDirectory }) => {
    calls++;
    active++;
    maximum = Math.max(maximum, active);
    if (calls === 1) { entered(); await new Promise(resolve => { release = resolve; }); }
    active--;
    if (calls === 2) throw Object.assign(new Error("falha temporária"), { status: 503 });
    await writeFile(path.join(outputDirectory, "document.pdf"), pdf);
  } });
  try {
    const attachments = [];
    for (let i = 0; i < 7; i++) attachments.push(await context.upload(`${i}.docx`, `word-${i}`));
    const first = service.get(attachments[0]);
    await began;
    const others = attachments.slice(1, 6).map(item => service.get(item));
    await new Promise(resolve => setTimeout(resolve, 50));
    await assert.rejects(service.get(attachments[6]), failure => failure.status === 429);
    const duplicate = service.get(attachments[0]);
    const settled = Promise.allSettled([first, ...others, duplicate]);
    release();
    const results = await settled;
    assert.equal(results.filter(item => item.status === "fulfilled").length, 6);
    assert.equal(results.filter(item => item.status === "rejected").length, 1);
    assert.equal(calls, 6);
    assert.equal(maximum, 1);
    await service.get(attachments[1]);
    assert.equal(calls, 7);
  } finally { release?.(); await context.close(); }
});

test("conversor ausente gera aviso e tempo limite encerra o processo", async () => {
  const previous = process.env.LIBREOFFICE_PATH;
  try {
    process.env.LIBREOFFICE_PATH = path.join(os.tmpdir(), "missing-pauta-libreoffice-executable", "soffice.com");
    await assert.rejects(convertWithLibreOffice({ inputPath: "document.docx", outputDirectory: os.tmpdir(), profileDirectory: os.tmpdir() }), failure => failure.status === 503 && /administrador/.test(failure.message));
    await assert.rejects(runOfficeProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], 100), failure => failure.status === 504);
  } finally {
    if (previous === undefined) delete process.env.LIBREOFFICE_PATH;
    else process.env.LIBREOFFICE_PATH = previous;
  }
});
