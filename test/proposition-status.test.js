import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../lib/database.js";
import { createPropositionService, summarizeStatuses } from "../lib/propositions.js";
import { startServer } from "../server.js";

const fields = { areaTecnica: "Educação", responsavel: "Beatriz Silva (Colaborador)", atualComissao: "Manual", haParecer: "Sim", sugestaoEmenda: "Não", posicionamento: "Favorável" };
const query = () => new URLSearchParams("siglaTipo=PL&numero=1234&ano=2020");
const camera = { id: 123, siglaTipo: "PL", numero: 1234, ano: 2020, ementa: "Ementa da Câmara", dataApresentacao: "2020-01-01T10:00", statusProposicao: { dataHora: "2025-03-17T11:00", descricaoSituacao: "Aguardando apreciação do Senado", descricaoTramitacao: "Remessa ao Senado" } };
const senate = { id: 123, codigoMateria: 1000, identificacao: "PL 1234/2020", casaIdentificadora: "SF", conteudo: { ementa: "Ementa do Senado" }, documento: { dataApresentacao: "2020-06-01" }, situacaoAtual: "MATÉRIA COM A RELATORIA", dataSituacaoAtual: "2026-03-17", dthUltimaAtualizacao: "2099-12-31T10:00" };

function providers({ cameraFound = true, senateFound = true, cameraDown = false, senateDown = false, cameraDetailDown = false, senateDetailDown = false, linked = true, cameraDate, senateDate } = {}) {
  const calls = [];
  const c = { ...camera, statusProposicao: { ...camera.statusProposicao, dataHora: cameraDate === undefined ? camera.statusProposicao.dataHora : cameraDate } };
  const s = { ...senate, dataSituacaoAtual: senateDate === undefined ? senate.dataSituacaoAtual : senateDate,
    ...(linked ? { idProcessoCasaInicial: 999, identificacaoProcessoInicial: "PL 1234/2020", siglaCasaIniciadora: "CD", outrosNumeros: [] } : {}) };
  return {
    calls,
    camaraFetch: async (url) => {
      calls.push(url.href);
      if (cameraDown || (cameraDetailDown && !url.pathname.endsWith("/proposicoes"))) throw Error("offline");
      return Response.json({ dados: url.pathname.endsWith("/proposicoes") ? cameraFound ? [c] : [] : c });
    },
    senadoFetch: async (url) => {
      calls.push(url.href);
      if (senateDown || (senateDetailDown && !url.pathname.endsWith("/processo"))) throw Error("offline");
      return Response.json(url.pathname.endsWith("/processo") ? senateFound ? [{ ...s, ementa: s.conteudo.ementa, dataApresentacao: s.documento.dataApresentacao }] : [] : s);
    }
  };
}

test("aceita resultados exclusivos de qualquer Casa, sem confundir namespaces de IDs", async () => {
  for (const options of [{ cameraFound: false }, { senateFound: false }, { cameraDown: true }, { senateDown: true }]) {
    const database = createDatabase(":memory:");
    const p = providers(options);
    const service = createPropositionService({ database, ...p });
    try {
      const found = await service.search(query());
      assert.equal(found.results.length, 1);
      const row = found.results[0];
      const expectedSource = options.cameraFound === false || options.cameraDown ? "senado" : "camara";
      assert.equal(row.source, expectedSource);
      assert.deepEqual(row.sources, [expectedSource]);
      assert.equal(row.latestStatus.source, expectedSource);
      assert.equal(row.latestStatus.descricao, expectedSource === "senado" ? senate.situacaoAtual : camera.statusProposicao.descricaoSituacao);
      if (expectedSource === "senado") await assert.rejects(() => service.select(123, found.searchToken));
      const selected = await service.select(row.selectionId, found.searchToken);
      const before = p.calls.length;
      const saved = database.create(service.recordInput({ ...fields, propositionToken: selected.propositionToken, proposition: { id: 999 }, camara: { id: 999 } }));
      assert.equal(saved.proposition.source, expectedSource);
      assert.equal(saved.proposition.id, 123);
      assert.equal(saved.camara?.id || null, expectedSource === "camara" ? 123 : null);
      assert.equal(saved.ementa, expectedSource === "senado" ? senate.conteudo.ementa : camera.ementa);
      assert.equal(p.calls.length, before, "Saving does not call providers");
      const updated = database.update(saved.id, service.recordInput({ ...saved, haParecer: "Não", proposition: { source: "camara", id: 999 } }, saved));
      assert.deepEqual(updated.proposition, saved.proposition);
      assert.throws(() => database.create(service.recordInput({ ...fields, propositionToken: selected.propositionToken })), (error) => error.status === 409);
    } finally { database.close(); }
  }
});

test("mesmo código com vínculo oficial usa a situação mais recente, independentemente da fonte da ementa", async () => {
  for (const options of [{}, { cameraDate: "2026-04-20T10:00" }]) {
    const database = createDatabase(":memory:");
    try {
      const service = createPropositionService({ database, ...providers(options) });
      const result = await service.search(query());
      assert.equal(result.results.length, 1);
      const row = result.results[0];
      assert.deepEqual(row.sources, ["camara", "senado"]);
      assert.equal(row.statusComparison, "latest");
      assert.equal(row.latestStatus.source, options.cameraDate ? "camara" : "senado");
      assert.equal(row.latestStatus.dataHora, options.cameraDate || senate.dataSituacaoAtual);
      assert.equal(row.ementa, camera.ementa);
      const selected = await service.select(row.selectionId, result.searchToken);
      const saved = database.create(service.recordInput({ ...fields, propositionToken: selected.propositionToken }));
      assert.deepEqual(saved.proposition.latestStatus, row.latestStatus);
      assert.equal(selected.proposition.identifiers.filter((i) => i.externalId === 123).length, 2);
      assert.equal(database.getMatterByCamaraId(123).id, database.getMatterBySenadoId(123).id);
    } finally { database.close(); }
  }
});

test("código igual sem vínculo oficial retorna duas matérias, sem escolher situação de matéria distinta", async () => {
  const database = createDatabase(":memory:");
  try {
    const service = createPropositionService({ database, ...providers({ linked: false }) });
    const found = await service.search(query());
    assert.equal(found.results.length, 2);
    assert.deepEqual(found.results.map((row) => row.selectionId), ["camara-123", "senado-123"]);
    const first = await service.select("camara-123", found.searchToken);
    const second = await service.select("senado-123", found.searchToken);
    assert.notEqual(first.proposition.matterId, second.proposition.matterId);
    assert.equal(first.proposition.latestStatus.source, "camara");
    assert.equal(second.proposition.latestStatus.source, "senado");
  } finally { database.close(); }
});

test("datas ausentes, iguais ou com precisão diferente não inventam qual situação é mais recente", () => {
  const base = { source: "camara", id: 123, statusDescricao: "Situação", statusDataHora: "2026-03-17T10:00" };
  for (const [date, expected] of [[null, "undated"], ["invalid", "undated"], ["2026-03-17", "overlap"], ["2026-03-17T10:00", "overlap"]]) {
    const summary = summarizeStatuses([base, { ...base, source: "senado", statusDataHora: date }]);
    assert.equal(summary.latestStatus, null);
    assert.equal(summary.statusComparison, expected);
    assert.equal(summary.statuses.length, 2);
  }
  assert.equal(summarizeStatuses([base, { ...base, source: "senado", statusDataHora: "2026-03-17T14:00Z" }]).latestStatus.source, "senado");
});

test("falha no detalhe não esconde um resultado confirmado pela pesquisa", async () => {
  for (const options of [{ cameraDetailDown: true, senateFound: false }, { senateDetailDown: true, cameraFound: false }]) {
    const database = createDatabase(":memory:");
    try {
      const service = createPropositionService({ database, ...providers(options) });
      const found = await service.search(query());
      assert.equal(found.results.length, 1);
      assert.ok(found.warnings.length);
      const selected = await service.select(found.results[0].selectionId, found.searchToken);
      const saved = database.create(service.recordInput({ ...fields, propositionToken: selected.propositionToken }));
      assert.equal(saved.projeto, "PL 1234/2020");
      assert.equal(saved.ementa, options.senateDetailDown ? senate.conteudo.ementa : camera.ementa);
    } finally { database.close(); }
  }
});

test("relação oficial posterior une identidades antes separadas sem apagar registros, anexos ou datas", async () => {
  const database = createDatabase(":memory:");
  try {
    const first = createPropositionService({ database, ...providers({ linked: false }) });
    const found = await first.search(query());
    const saved = [];
    for (const id of ["camara-123", "senado-123"]) {
      const selection = await first.select(id, found.searchToken);
      saved.push(database.create(first.recordInput({ ...fields, propositionToken: selection.propositionToken })));
    }
    database.setAttachment(saved[1].id, { name: "original.pdf", storedName: "original-stored.pdf", mime: "application/pdf", size: 123 });
    const cameraMatter = database.getMatterByCamaraId(123);
    const senateMatter = database.getMatterBySenadoId(123);
    assert.notEqual(cameraMatter.id, senateMatter.id);
    const identifier = senateMatter.identifiers[0];
    const merged = database.saveMatter(cameraMatter.camara, [{ identifiers: [identifier], evidence: { id: 123, identificacaoProcessoInicial: "PL 1234/2020", siglaCasaIniciadora: "CD" }, proposition: senateMatter.senado[0] }]);
    assert.equal(database.get(saved[0].id).matterId, merged.id);
    assert.equal(database.get(saved[1].id).matterId, merged.id);
    assert.equal(database.list().length, 2);
    assert.equal(database.getAttachment(saved[1].id).storedName, "original-stored.pdf");
    for (const record of saved) {
      assert.deepEqual(database.get(record.id).proposition, record.proposition);
      assert.equal(database.get(record.id).createdAt, record.createdAt);
      assert.equal(database.get(record.id).editedAt, record.editedAt);
    }
    assert.throws(() => database.create(saved[1]), (error) => error.status === 409);
    assert.equal(database.update(saved[1].id, { ...saved[1], haParecer: "Não" }).haParecer, "Não");
  } finally { database.close(); }
});

test("rotas aceitam Senado, preservam situação após reinício e recusam snapshot forjado", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-status-http-"));
  const databasePath = path.join(directory, "records.sqlite");
  const p = providers({ cameraFound: false });
  let app = await startServer({ port: 0, databasePath, ...p });
  const request = (endpoint, body, method = "POST") => fetch(`${app.url}${endpoint}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    const search = await (await fetch(`${app.url}/api/propositions?${query()}`)).json();
    const selection = await (await request("/api/propositions/senado-123", { searchToken: search.searchToken })).json();
    const response = await request("/api/records", { ...fields, propositionToken: selection.propositionToken });
    assert.equal(response.status, 201);
    const saved = (await response.json()).record;
    const before = p.calls.length;
    await app.close();
    app = await startServer({ port: 0, databasePath, ...p });
    const edit = await request(`/api/records/${saved.id}`, { ...saved, atualComissao: "Nova comissão", proposition: { latestStatus: { descricao: "Forjada" } } }, "PUT");
    assert.equal(edit.status, 200);
    assert.deepEqual((await edit.json()).record.proposition, saved.proposition);
    const cached = await (await fetch(`${app.url}/api/propositions?${query()}`)).json();
    assert.equal(cached.cached, true);
    assert.equal(cached.results[0].latestStatus.descricao, senate.situacaoAtual);
    assert.equal(p.calls.length, before);
    const forged = await request("/api/records", { ...fields, proposition: saved.proposition, camara: saved.proposition });
    assert.equal(forged.status, 422);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("migração do schema Câmara obrigatório mantém chaves estrangeiras e registros intactos", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-status-migration-"));
  const file = path.join(directory, "records.sqlite");
  let db = createDatabase(file);
  const camara = { id: 123, siglaTipo: "PL", numero: 1234, ano: 2020, projeto: "PL 1234/2020", ementa: "Ementa", consultadoEm: new Date().toISOString() };
  const before = db.create({ ...fields, projeto: camara.projeto, ementa: camara.ementa, camara });
  db.setAttachment(before.id, { name: "anexo.pdf", storedName: "real.pdf", mime: "application/pdf", size: 12 });
  db.close();
  let sqlite = new DatabaseSync(file);
  sqlite.exec(`PRAGMA foreign_keys = OFF;
    CREATE TABLE original_matters(id INTEGER PRIMARY KEY AUTOINCREMENT, camara_id INTEGER NOT NULL UNIQUE, camara_json TEXT NOT NULL, cached_at TEXT NOT NULL);
    INSERT INTO original_matters SELECT id, camara_id, camara_json, cached_at FROM legislative_matters;
    DROP TABLE legislative_matters;
    ALTER TABLE original_matters RENAME TO legislative_matters;
    ALTER TABLE records DROP COLUMN proposition_json;`);
  const original = sqlite.prepare("SELECT * FROM records").all();
  sqlite.close();
  try {
    db = createDatabase(file);
    assert.equal(db.get(before.id).matterId, before.matterId);
    assert.equal(db.getAttachment(before.id).storedName, "real.pdf");
    db.close();
    sqlite = new DatabaseSync(file);
    const migrated = sqlite.prepare("SELECT * FROM records").all().map(({ proposition_json, ...row }) => row);
    assert.deepEqual(migrated, original.map((row) => ({ ...row })));
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    sqlite.close();
    db = createDatabase(file);
    const service = createPropositionService({ database: db, ...providers({ cameraFound: false, linked: false }) });
    const result = await service.search(query());
    const selected = await service.select("senado-123", result.searchToken);
    assert.equal(selected.proposition.source, "senado");
    assert.notEqual(selected.proposition.matterId, before.matterId);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
