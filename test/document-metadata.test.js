import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../lib/database.js";
import { startServer } from "../server.js";
import { backupDatabase } from "../scripts/backup.js";
import { documentMetadataErrors } from "../public/document-utils.js";

const fields = { areaTecnica: "Educação", responsavel: "Eduardo Santana", projeto: "PL 42/2026", ementa: "Teste de documentos", atualComissao: "", haParecer: "Não", sugestaoEmenda: "Não", posicionamento: "Favorável" };
const pdf = Buffer.from("%PDF-1.4\nDocumento original de teste\n%%EOF");

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-document-metadata-"));
  const databasePath = path.join(directory, "records.sqlite");
  const app = await startServer({ port: 0, databasePath, tramitationCheckDelayMs: null });
  const record = app.database.create(fields);
  const endpoint = `${app.url}/api/records/${record.id}/attachments`;
  const upload = (metadata = { title: "Emenda parlamentar", description: "Proposta de alteração para os Municípios." }, key, filename = "sugestão.pdf") => {
    const body = new FormData();
    body.append("file", new Blob([pdf], { type: "application/pdf" }), filename);
    for (const field of ["title", "description"]) if (metadata[field] !== undefined) body.append(field, metadata[field]);
    return fetch(endpoint, { method: "POST", headers: key ? { "X-Upload-Id": key } : {}, body });
  };
  const update = (id, input) => fetch(`${endpoint}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return { directory, databasePath, app, record, endpoint, upload, update, async close() { await app.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("metadados obrigatórios bloqueiam vazio, espaços e limites excessivos, sem gravar arquivo ou alterar o registro", async () => {
  const context = await fixture();
  try {
    const original = context.app.database.get(context.record.id);
    for (const metadata of [{}, { title: "Título" }, { title: "  ", description: "Descrição" }, { title: "Título", description: "\n\t " }, { title: "x".repeat(181), description: "Descrição" }, { title: "Título", description: "x".repeat(4001) }]) {
      assert.equal((await context.upload(metadata)).status, 422);
    }
    assert.equal((await fetch(context.endpoint, { method: "POST", headers: { "X-File-Name": "antigo.pdf" }, body: pdf })).status, 422);
    assert.deepEqual(context.app.database.get(context.record.id), original);
    assert.equal((await readdir(path.join(context.directory, "uploads"))).length, 0);
    assert.throws(() => context.app.database.setAttachment(context.record.id, { name: "x.pdf", storedName: "x.pdf", size: 1 }), error => Boolean(error.fields?.title && error.fields?.description));
    assert.deepEqual(documentMetadataErrors({ title: " A ", description: " B " }), {});
  } finally { await context.close(); }
});

test("multipart salva cada documento com Unicode e descrição longa, mantendo arquivo e datas originais na edição", async () => {
  const context = await fixture();
  try {
    const upload = await context.upload({ title: "  Sugestão de emenda 📄  ", description: "á".repeat(4000) });
    assert.equal(upload.status, 201);
    const uploaded = (await upload.json()).record;
    const original = uploaded.attachments[0];
    assert.equal(original.title, "Sugestão de emenda 📄");
    assert.equal(original.description.length, 4000);
    assert.equal(original.name, "sugestão.pdf");
    assert.equal(original.storedName, undefined);
    assert.ok(uploaded.editedAt);
    assert.equal(context.app.database.history(uploaded.id)[0].action, "attachment_added");
    const editedResponse = await context.update(original.id, { revision: uploaded.revision, title: "Título revisado", description: "Descrição revisada\nSegunda linha." });
    assert.equal(editedResponse.status, 200);
    const edited = (await editedResponse.json()).record;
    assert.equal(edited.revision, uploaded.revision + 1);
    assert.equal(edited.createdAt, uploaded.createdAt);
    assert.equal(edited.attachments[0].createdAt, original.createdAt);
    assert.equal(edited.attachments[0].name, original.name);
    assert.ok(edited.attachments[0].metadataUpdatedAt);
    assert.equal(edited.attachments[0].title, "Título revisado");
    assert.deepEqual(Buffer.from(await (await fetch(`${context.endpoint}/${original.id}`)).arrayBuffer()), pdf);
    const history = context.app.database.history(edited.id)[0];
    assert.equal(history.action, "attachment_updated");
    assert.equal(history.before.title, "Sugestão de emenda 📄");
    assert.equal(history.after.title, "Título revisado");
    const unchanged = await context.update(original.id, { ...edited.attachments[0], revision: edited.revision });
    assert.equal((await unchanged.json()).record.revision, edited.revision);
    const backup = await backupDatabase(context.databasePath, path.join(context.directory, "backups"));
    const restored = createDatabase(path.join(backup, "registros.sqlite"));
    try {
      assert.deepEqual(restored.get(edited.id).attachments, edited.attachments);
      assert.equal(restored.history(edited.id)[0].after.title, "Título revisado");
    } finally { restored.close(); }
    assert.deepEqual(await readFile(path.join(backup, "uploads", context.app.database.getAttachment(edited.id, original.id).storedName)), pdf);
  } finally { await context.close(); }
});

test("edição de metadados exige revisão atual e respeita documento, registro, remoção e lixeira", async () => {
  const context = await fixture();
  try {
    const uploaded = (await (await context.upload()).json()).record;
    const attachment = uploaded.attachments[0];
    const metadata = { title: "Novo título", description: "Nova descrição" };
    assert.equal((await context.update(attachment.id, metadata)).status, 428);
    assert.equal((await context.update(attachment.id, { ...metadata, revision: context.record.revision })).status, 409);
    assert.equal((await context.update(attachment.id, { ...metadata, title: " ", revision: uploaded.revision })).status, 422);
    const other = context.app.database.create({ ...fields, projeto: "PL 43/2026" });
    assert.equal((await fetch(`${context.app.url}/api/records/${other.id}/attachments/${attachment.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...metadata, revision: other.revision }) })).status, 404);
    assert.deepEqual(context.app.database.get(uploaded.id), uploaded);
    const removed = context.app.database.removeAttachment(uploaded.id, attachment.id, uploaded.revision);
    assert.equal((await context.update(attachment.id, { ...metadata, revision: removed.revision })).status, 404);
    const restored = context.app.database.restoreAttachment(uploaded.id, attachment.id, removed.revision);
    assert.equal(restored.attachments[0].title, attachment.title);
    context.app.database.remove(uploaded.id, restored.revision);
    assert.equal((await context.update(attachment.id, { ...metadata, revision: restored.revision + 1 })).status, 404);
  } finally { await context.close(); }
});

test("repetir upload não duplica anexos ou histórico e não descarta metadados diferentes silenciosamente", async () => {
  const context = await fixture();
  try {
    const key = "11111111-1111-4111-8111-111111111111";
    const responses = await Promise.all([context.upload(undefined, key), context.upload(undefined, key)]);
    assert.ok(responses.every(response => [200, 201].includes(response.status)));
    const record = context.app.database.get(context.record.id);
    assert.equal(record.attachments.length, 1);
    assert.equal(context.app.database.history(record.id).filter(entry => entry.action === "attachment_added").length, 1);
    assert.equal((await context.upload({ title: "Outro título", description: "Outra descrição" }, key)).status, 409);
    assert.deepEqual(context.app.database.get(record.id), record);
    assert.equal((await readdir(path.join(context.directory, "uploads"))).length, 1);
  } finally { await context.close(); }
});

test("migração aditiva preserva documentos antigos ativos e removidos, sem exigir preenchimento ao salvar o registro", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-document-migration-"));
  const databasePath = path.join(directory, "records.sqlite");
  let app;
  try {
    const db = createDatabase(databasePath);
    const record = db.create(fields);
    db.close();
    await mkdir(path.join(directory, "uploads"));
    await writeFile(path.join(directory, "uploads", "old.pdf"), pdf);
    const raw = new DatabaseSync(databasePath);
    raw.exec("ALTER TABLE record_attachments DROP COLUMN title; ALTER TABLE record_attachments DROP COLUMN description; ALTER TABLE record_attachments DROP COLUMN metadata_updated_at;");
    raw.prepare("INSERT INTO record_attachments(record_id, name, stored_name, size, mime, created_at) VALUES (?, 'antigo.pdf', 'old.pdf', ?, 'application/pdf', NULL)").run(record.id, pdf.length);
    raw.prepare("INSERT INTO record_attachments(record_id, name, stored_name, size, deleted_at) VALUES (?, 'removido.pdf', 'removed.pdf', 1, '2026-01-01T10:00:00Z')").run(record.id);
    raw.close();
    app = await startServer({ port: 0, databasePath, tramitationCheckDelayMs: null });
    const original = app.database.get(record.id);
    assert.equal(original.attachments[0].title, null);
    assert.equal(original.attachments[0].description, null);
    assert.equal(original.attachments[0].createdAt, null);
    assert.equal(original.revision, record.revision);
    assert.equal(original.editedAt, null);
    assert.equal(original.removedAttachments.length, 1);
    const saved = app.database.update(record.id, { ...original, haParecer: "Sim" });
    assert.equal(saved.attachments[0].description, null);
    const completed = app.database.updateAttachmentMetadata(record.id, saved.attachments[0].id, { revision: saved.revision, title: "Documento antigo", description: "Descrição adicionada posteriormente." });
    assert.equal(completed.attachments[0].createdAt, null);
    assert.equal(completed.attachments[0].name, "antigo.pdf");
    assert.equal(completed.attachments[0].title, "Documento antigo");
    assert.deepEqual(Buffer.from(await (await fetch(`${app.url}/api/records/${record.id}/attachments/${saved.attachments[0].id}`)).arrayBuffer()), pdf);
    await app.close();
    app = await startServer({ port: 0, databasePath, tramitationCheckDelayMs: null });
    assert.deepEqual(app.database.get(record.id).attachments, completed.attachments);
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
});
