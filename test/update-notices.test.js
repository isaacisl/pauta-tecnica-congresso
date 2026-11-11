import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../server.js";

const fields = { areaTecnica: "Educação", responsavel: "Eduardo Santana", projeto: "PL 401/2026", ementa: "Teste de avisos", haParecer: "Não", sugestaoEmenda: "Não", posicionamento: "Favorável", prioridade: "Alta" };

test("filtro de atualizações combina critérios e acompanha a confirmação sem misturar acompanhamentos da mesma matéria", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-update-notices-"));
  let app;
  try {
    app = await startServer({ port: 0, databasePath: path.join(directory, "records.sqlite"), tramitationCheckDelayMs: null });
    const official = { id: 401, source: "camara", siglaTipo: "PL", numero: 401, ano: 2026, projeto: fields.projeto, ementa: fields.ementa };
    const source = { source: "camara", externalId: 401 };
    const first = app.database.create({ ...fields, camara: official, proposition: official });
    const second = app.database.create({ ...fields, areaTecnica: "Finanças e Tributação", responsavel: "Alex Carneiro", camara: official, proposition: official });
    app.database.create({ ...fields, projeto: "PL 402/2026", prioridade: "Baixa" });
    app.database.saveTramitationScan(source, []);
    const event = { eventKey: "sequencia:1", date: "2026-01-01T10:00", organization: "CE", description: "Recebido pela comissão", detail: "" };
    app.database.saveTramitationScan(source, [event, { ...event, eventKey: "sequencia:2", description: "Designado relator" }]);
    const json = async endpoint => (await fetch(`${app.url}${endpoint}`)).json();
    const selection = new URLSearchParams({ atualizacoes: "Pendentes", areaTecnica: "Educação", prioridade: "Alta" });
    const selected = await json(`/api/records?${selection}`);
    assert.deepEqual(selected.records.map(record => record.id), [first.id]);
    assert.equal(selected.pendingUpdates, 1, "dois eventos representam um acompanhamento pendente");
    assert.equal((await json("/api/records")).pendingUpdates, 2);
    assert.equal((await json(`/api/totals?${selection}`)).total, 1);
    const options = await json(`/api/filter-options?${selection}`);
    assert.deepEqual(options.responsaveis, ["Eduardo Santana"]);
    const exported = await fetch(`${app.url}/api/export.csv?${selection}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.EXPORT_PASSWORD || "CentralDeDados2026" }) });
    assert.equal(exported.status, 200);
    const csv = await exported.text();
    assert.match(csv, /Eduardo Santana/);
    assert.doesNotMatch(csv, /Alex Carneiro|PL 402\/2026/);
    const notice = selected.records[0].tramitationNotice;
    const acknowledge = await fetch(`${app.url}/api/records/${first.id}/tramitations/acknowledge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ throughEventId: notice.throughEventId }) });
    assert.equal(acknowledge.status, 200);
    assert.equal((await json(`/api/records?${selection}`)).count, 0);
    assert.equal((await json(`/api/records?${selection}`)).pendingUpdates, 0);
    assert.deepEqual((await json("/api/records?atualizacoes=Pendentes")).records.map(record => record.id), [second.id]);
    app.database.saveTramitationScan(source, [{ ...event, eventKey: "sequencia:3" }]);
    assert.equal((await json(`/api/records?${selection}`)).count, 1, "uma novidade posterior volta ao filtro");
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("leitura parcial preserva uma novidade concorrente e o filtro exclui histórico, lixeira e fontes não monitoráveis", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-update-cursor-"));
  let app;
  try {
    app = await startServer({ port: 0, databasePath: path.join(directory, "records.sqlite"), tramitationCheckDelayMs: null });
    const official = { id: 601, source: "camara", siglaTipo: "PL", numero: 601, ano: 2026, projeto: "PL 601/2026", ementa: fields.ementa };
    app.database.saveMatter(official, [{ identifiers: [{ source: "senado", externalId: 602, house: "CD", siglaTipo: "PL", numero: 601, ano: 2026 }], evidence: {} }]);
    const current = app.database.create({ ...fields, projeto: official.projeto, camara: official, proposition: official });
    const trashed = app.database.create({ ...fields, projeto: official.projeto, responsavel: "Zacarias Sousa", camara: official, proposition: official });
    app.database.remove(trashed.id, trashed.revision);
    app.database.create({ ...fields, projeto: "PL 603/2026" });
    const baseline = { ...official, id: 604, numero: 604, projeto: "PL 604/2026" };
    app.database.create({ ...fields, projeto: baseline.projeto, camara: baseline, proposition: baseline });
    const event = { eventKey: "sequencia:1", date: "2026-01-01T10:00", organization: "CE", description: "Movimentação", detail: "" };
    app.database.saveTramitationScan({ source: "camara", externalId: 604 }, [event]);
    const source = { source: "camara", externalId: 601 };
    app.database.saveTramitationScan(source, []);
    app.database.saveTramitationScan(source, [event]);
    app.database.saveTramitationScan({ source: "senado", externalId: 602 }, []);
    app.database.saveTramitationScan({ source: "senado", externalId: 602 }, [{ ...event, eventKey: "informe:99" }]);
    const json = async endpoint => (await fetch(`${app.url}${endpoint}`)).json();
    const opened = (await json(`/api/records/${current.id}`)).record.tramitationNotice;
    assert.equal(opened.count, 1);
    app.database.saveTramitationScan(source, [{ ...event, eventKey: "sequencia:2" }]);
    const response = await fetch(`${app.url}/api/records/${current.id}/tramitations/acknowledge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ throughEventId: opened.throughEventId }) });
    assert.equal((await response.json()).record.tramitationNotice.count, 1);
    const filtered = await json("/api/records?atualizacoes=Pendentes");
    assert.deepEqual(filtered.records.map(record => record.id), [current.id]);
    assert.equal(filtered.pendingUpdates, 1);
    assert.equal((await json("/api/totals?atualizacoes=Pendentes")).total, 1);
    assert.equal((await json("/api/records?atualizacoes=Pendentes&q=603")).pendingUpdates, 0);
    assert.equal((await json("/api/records?atualizacoes=desconhecido")).count, 0);
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
});
