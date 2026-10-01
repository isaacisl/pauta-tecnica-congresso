import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../lib/database.js";
import { createSenadoClient } from "../lib/senado.js";
import { createPropositionService } from "../lib/propositions.js";
import { camaraEvents, senadoEvents } from "../lib/tramitations.js";
import { sameMatter, navigationValues } from "../public/record-utils.js";
import { backupDatabase } from "../scripts/backup.js";
import { startServer } from "../server.js";

const official = { id: 123, source: "camara", siglaTipo: "PL", numero: 123, ano: 2026, projeto: "PL 123/2026", ementa: "Educação 📚", consultadoEm: new Date().toISOString() };
const fields = { areaTecnica: "Educação", responsavel: "Beatriz Silva (Colaborador)", projeto: official.projeto, ementa: official.ementa, autor: "", despacho: "", atualComissao: "", haParecer: "Não", sugestaoEmenda: "Não", posicionamento: "Favorável", camara: official, proposition: official };

test("bloqueia edição e exclusão obsoletas sem apagar os dados de outra pessoa", () => {
  const db = createDatabase(":memory:");
  try {
    const old = db.create(fields);
    assert.throws(() => db.update(old.id, fields), error => error.status === 428);
    const saved = db.update(old.id, { ...old, haParecer: "Sim" });
    assert.equal(saved.revision, old.revision + 1);
    assert.throws(() => db.update(old.id, { ...old, sugestaoEmenda: "Sim" }), error => error.status === 409);
    assert.throws(() => db.remove(old.id, old.revision), error => error.status === 409);
    assert.equal(db.get(old.id).haParecer, "Sim");
    assert.equal(db.history(old.id).length, 2);
    assert.equal(db.history(old.id)[0].before.haParecer, "Não");
    assert.equal(db.history(old.id)[0].after.haParecer, "Sim");
  } finally { db.close(); }
});

test("lixeira preserva anexos, elimina totais e impede restauração duplicada", () => {
  const db = createDatabase(":memory:");
  try {
    const record = db.create(fields);
    const uploaded = db.setAttachment(record.id, { name: "parecer.pdf", storedName: "teste.pdf", size: 10, mime: "application/pdf" });
    assert.equal(db.remove(record.id, uploaded.revision), true);
    assert.equal(db.get(record.id), null);
    assert.equal(db.totals().total, 0);
    assert.equal(db.totals().overallTotal, 0);
    assert.equal(db.listAttachments(record.id).length, 1);
    assert.deepEqual(db.tramitationSources(), []);
    const [deleted] = db.trash();
    const duplicate = db.create(fields);
    assert.throws(() => db.restore(deleted.id, deleted.revision), error => error.status === 409);
    db.remove(duplicate.id, duplicate.revision);
    const restored = db.restore(deleted.id, deleted.revision);
    assert.equal(restored.attachments.length, 1);
    assert.equal(restored.createdAt, record.createdAt);
    assert.equal(db.totals().uniqueProjects, 1);
    assert.equal(db.history(record.id)[0].action, "restored");
  } finally { db.close(); }
});

test("migração de documentos antigos preserva arquivos já cadastrados", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-attachment-migration-"));
  const filename = path.join(directory, "records.sqlite");
  try {
    const original = createDatabase(filename);
    const record = original.create(fields);
    original.setAttachment(record.id, { name: "antigo.pdf", storedName: "antigo.pdf", size: 10, mime: "application/pdf" });
    original.close();
    const legacy = new DatabaseSync(filename);
    legacy.exec("ALTER TABLE record_attachments DROP COLUMN deleted_at");
    legacy.close();
    const migrated = createDatabase(filename);
    try {
      assert.equal(migrated.get(record.id).attachments[0].name, "antigo.pdf");
      assert.deepEqual(migrated.get(record.id).removedAttachments, []);
    } finally { migrated.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("remove e restaura somente o documento escolhido, com revisão e backup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-attachment-remove-"));
  const databasePath = path.join(directory, "records.sqlite");
  let app = await startServer({ port: 0, databasePath, tramitationCheckDelayMs: null });
  try {
    const record = app.database.create(fields);
    const upload = (name, content) => fetch(`${app.url}/api/records/${record.id}/attachments`, {
      method: "POST", headers: { "X-File-Name": name }, body: Buffer.from(content)
    });
    const first = (await (await upload("primeiro.pdf", "%PDF-primeiro")).json()).record;
    const second = (await (await upload("segundo.pdf", "%PDF-segundo")).json()).record;
    const firstId = first.attachments[0].id;
    const secondId = second.attachments[0].id;
    const otherRecord = app.database.create({ ...fields, areaTecnica: "Finanças" });
    const change = (endpoint, method, revision) => fetch(`${app.url}${endpoint}`, {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(revision === undefined ? {} : { revision })
    });
    const endpoint = `/api/records/${record.id}/attachments/${firstId}`;
    assert.equal((await change(endpoint, "DELETE")).status, 428);
    assert.equal((await change(endpoint, "DELETE", first.revision)).status, 409);
    assert.equal((await change(`/api/records/${otherRecord.id}/attachments/${firstId}`, "DELETE", otherRecord.revision)).status, 404);
    assert.equal((await change(`/api/records/${record.id}/attachments/999999`, "DELETE", second.revision)).status, 404);
    const removedResponse = await change(endpoint, "DELETE", second.revision);
    assert.equal(removedResponse.status, 200);
    const removed = (await removedResponse.json()).record;
    assert.equal((await change(`${endpoint}/restore`, "POST", second.revision)).status, 409);
    assert.deepEqual(removed.attachments.map(item => item.id), [secondId]);
    assert.deepEqual(removed.removedAttachments.map(item => item.id), [firstId]);
    assert.ok(removed.removedAttachments[0].deletedAt);
    assert.equal((await fetch(`${app.url}${endpoint}`)).status, 404);
    assert.equal(await (await fetch(`${app.url}/api/records/${record.id}/attachments/${secondId}`)).text(), "%PDF-segundo");
    assert.equal(app.database.history(record.id)[0].action, "attachment_removed");
    assert.equal(app.database.history(record.id)[0].before.attachmentName, "primeiro.pdf");
    const backup = await backupDatabase(databasePath, path.join(directory, "backups"));
    assert.equal((await readdir(path.join(backup, "uploads"))).length, 2);
    await app.close();
    app = await startServer({ port: 0, databasePath, tramitationCheckDelayMs: null });
    const restoredResponse = await fetch(`${app.url}${endpoint}/restore`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: removed.revision })
    });
    assert.equal(restoredResponse.status, 200);
    const restored = (await restoredResponse.json()).record;
    assert.equal(restored.attachments.length, 2);
    assert.deepEqual(restored.removedAttachments, []);
    assert.equal(await (await fetch(`${app.url}${endpoint}`)).text(), "%PDF-primeiro");
    assert.equal(app.database.history(record.id)[0].action, "attachment_restored");
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("Senado reconhece colegiado de controle e dá precedência ao colegiado atual explícito", async () => {
  let autuacoes = [{ siglaColegiadoControleAtual: "PLEN" }];
  const client = createSenadoClient(async () => Response.json({ id: 7, identificacao: "PL 7/2026", casaIdentificadora: "SF", autuacoes }));
  assert.equal((await client.relations(7)).proposition.atualComissao, "PLEN");
  autuacoes = [{ siglaColegiadoAtual: "CCJ", siglaColegiadoControleAtual: "PLEN" }];
  assert.equal((await client.relations(7)).proposition.atualComissao, "CCJ");
});

test("troca entre homônimos limpa dados anteriores e atualização preserva ajustes manuais", () => {
  const camera = { ...official, atualComissao: "CE", despacho: "À CE" };
  const senate = { ...official, id: 999, source: "senado", atualComissao: "", despacho: "" };
  assert.equal(sameMatter(camera, senate), false);
  assert.deepEqual(navigationValues(camera, senate, camera), { atualComissao: "", despacho: "" });
  const current = { atualComissao: "CCJC", despacho: "À CE" };
  assert.equal(navigationValues(camera, { ...camera, atualComissao: "MESA" }, current).atualComissao, "CCJC");
  assert.equal(navigationValues(camera, { ...camera, atualComissao: "MESA" }, current, true).atualComissao, "MESA");
});

test("monitoramento expõe falhas, limpa erro após sucesso e atualiza correções sem duplicar eventos", () => {
  const db = createDatabase(":memory:");
  const source = { source: "camara", externalId: official.id };
  const movement = { sequencia: 1, dataHora: "2025-01-01T12:00", siglaOrgao: "CE", descricaoTramitacao: "Recebido", despacho: "Texto" };
  try {
    const record = db.create(fields);
    assert.equal(db.get(record.id).monitoring[0].pending, 1);
    db.saveTramitationFailure(source, "HTTP 503");
    assert.equal(db.get(record.id).monitoring[0].error, "HTTP 503");
    db.saveTramitationScan(source, camaraEvents({ dados: [movement] }));
    assert.equal(db.get(record.id).monitoring[0].error, null);
    assert.equal(db.get(record.id).monitoring[0].pending, 0);
    const events = camaraEvents({ dados: [{ ...movement, sequencia: 2, despacho: "Novo" }] });
    db.saveTramitationScan(source, events);
    const notice = db.get(record.id).tramitationNotice;
    assert.equal(notice.count, 1);
    db.saveTramitationScan(source, camaraEvents({ dados: [{ ...movement, sequencia: 2, despacho: "Novo." }] }));
    assert.equal(db.get(record.id).tramitationNotice.count, 1);
    assert.equal(db.get(record.id).tramitationNotice.events[0].id, notice.events[0].id);
    assert.equal(db.get(record.id).tramitationNotice.events[0].detail, "Novo.");
  } finally { db.close(); }
});

test("Senado corrige conteúdo mantendo chave do informe", () => {
  const a = senadoEvents({ autuacoes: [{ informesLegislativos: [{ id: 12, data: "2026-01-01", descricao: "Original" }] }] });
  const b = senadoEvents({ autuacoes: [{ informesLegislativos: [{ id: 12, data: "2026-01-01", descricao: "Corrigido" }] }] });
  const db = createDatabase(":memory:");
  try {
    const senate = { ...official, source: "senado" };
    const record = db.create({ ...fields, camara: null, proposition: senate });
    const source = { source: "senado", externalId: senate.id };
    db.saveTramitationScan(source, []);
    db.saveTramitationScan(source, a);
    db.saveTramitationScan(source, b);
    assert.equal(db.get(record.id).tramitationNotice.count, 1);
    assert.equal(db.get(record.id).tramitationNotice.events[0].description, "Corrigido");
  } finally { db.close(); }
});

test("primeira consulta atrasada sinaliza eventos posteriores ao início do acompanhamento", () => {
  const db = createDatabase(":memory:");
  try {
    const record = db.create(fields);
    const date = new Date(Date.now() + 60000).toISOString();
    db.saveTramitationScan({ source: "camara", externalId: official.id }, camaraEvents({ dados: [{ sequencia: 1, dataHora: date, descricaoTramitacao: "Movimentação após cadastro" }] }));
    assert.equal(db.get(record.id).tramitationNotice.count, 1);
  } finally { db.close(); }
});

test("refresh ignora cache da busca e dos detalhes; navegação usa processo exato vencedor", async () => {
  const database = createDatabase(":memory:");
  let requests = 0;
  const camera = { id: 123, siglaTipo: "PL", numero: 123, ano: 2026, ementa: "Teste", statusProposicao: { dataHora: "2024-01-01T10:00" } };
  const senates = [7, 8].map((id) => ({ id, identificacao: "PL 123/2026", casaIdentificadora: "SF", idProcessoCasaInicial: 9, identificacaoProcessoInicial: "PL 123/2026", siglaCasaIniciadora: "CD", dataSituacaoAtual: id === 8 ? "2026-09-01" : "2025-01-01", despachos: [{ texto: `Despacho ${id}` }], autuacoes: [{ siglaColegiadoControleAtual: `C${id}` }] }));
  const service = createPropositionService({ database,
    camaraFetch: async url => {
      requests++;
      return Response.json({ dados: url.pathname.endsWith("/autores") ? [{ nome: "Autor" }] : url.pathname.endsWith("/tramitacoes") ? [] : url.pathname.endsWith("/proposicoes") ? [camera] : camera });
    },
    senadoFetch: async url => { requests++; return Response.json(url.pathname.endsWith("/processo") ? senates : senates.find(item => url.pathname.endsWith(`/${item.id}`))); }
  });
  try {
    const first = await service.search(new URLSearchParams("siglaTipo=PL&numero=123&ano=2026"));
    assert.equal(first.results[0].atualComissao, "C8");
    await service.select(first.results[0].selectionId, first.searchToken);
    const before = requests;
    assert.equal((await service.search(new URLSearchParams("siglaTipo=PL&numero=123&ano=2026"))).cached, true);
    assert.equal(requests, before);
    await service.search(new URLSearchParams("siglaTipo=PL&numero=123&ano=2026&refresh=1"));
    assert.ok(requests > before);
  } finally { database.close(); }
});

test("API protege versões, restaura arquivo e exporta Unicode sem fórmulas executáveis", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-reliability-"));
  const app = await startServer({ port: 0, databasePath: path.join(directory, "db.sqlite"), tramitationCheckDelayMs: null });
  const request = (url, method, body) => fetch(`${app.url}${url}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await (await fetch(`${app.url}/api/health`)).json()).apiVersion, 3);
    const record = app.database.create({ ...fields, despacho: '=HYPERLINK("https://example.invalid")' });
    assert.equal((await request(`/api/records/${record.id}`, "PUT", fields)).status, 428);
    const upload = await fetch(`${app.url}/api/records/${record.id}/attachments`, { method: "POST", headers: { "X-File-Name": "teste.pdf" }, body: Buffer.from("%PDF-audit") });
    const uploaded = (await upload.json()).record;
    assert.equal((await request(`/api/records/${record.id}`, "DELETE", { revision: record.revision })).status, 409);
    assert.equal((await request(`/api/records/${record.id}`, "DELETE", { revision: uploaded.revision })).status, 200);
    assert.equal((await fetch(`${app.url}/api/records/${record.id}/attachment`)).status, 404);
    const trash = await (await fetch(`${app.url}/api/trash`)).json();
    assert.equal((await request(`/api/records/${record.id}/restore`, "POST", { revision: trash.records[0].revision })).status, 200);
    assert.equal(await (await fetch(`${app.url}/api/records/${record.id}/attachment`)).text(), "%PDF-audit");
    const csv = await (await request("/api/export.csv", "POST", { password: "CentralDeDados2026" })).text();
    assert.match(csv, /Educação 📚/);
    assert.match(csv, /"'=HYPERLINK/);
    assert.equal((await (await fetch(`${app.url}/api/records/${record.id}/history`)).json()).history.length, 3);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("backup consistente restaura banco, histórico e anexos inclusive da lixeira", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-backup-test-"));
  const filename = path.join(directory, "db.sqlite");
  const db = createDatabase(filename);
  try {
    const record = db.create(fields);
    await mkdir(path.join(directory, "uploads"));
    await writeFile(path.join(directory, "uploads", "file.pdf"), "%PDF-test");
    const uploaded = db.setAttachment(record.id, { name: "doc.pdf", storedName: "file.pdf", size: 9, mime: "application/pdf" });
    db.remove(record.id, uploaded.revision);
    const destination = await backupDatabase(filename, path.join(directory, "backups"));
    assert.equal(await readFile(path.join(destination, "uploads", "file.pdf"), "utf8"), "%PDF-test");
    const restored = createDatabase(path.join(destination, "registros.sqlite"));
    try {
      assert.equal(restored.trash().length, 1);
      assert.equal(restored.history(record.id).length, 2);
      assert.equal(restored.restore(record.id, restored.trash()[0].revision).attachments.length, 1);
    } finally { restored.close(); }
    await assert.rejects(backupDatabase(path.join(directory, "missing.sqlite"), path.join(directory, "backups")));
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
