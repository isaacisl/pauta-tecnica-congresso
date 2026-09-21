import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../lib/database.js";
import { createPropositionService } from "../lib/propositions.js";
import { createSenadoClient } from "../lib/senado.js";

const camara = { id: 2125467, siglaTipo: "PL", numero: 7108, ano: 2017, ementa: "Texto da Câmara", dataApresentacao: "2017-03-15T11:55", statusProposicao: { dataHora: "2025-07-10T16:00" } };
const senate = {
  id: 8862684, codigoMateria: 169542, identificacao: "PL 3361/2025", casaIdentificadora: "SF",
  idProcessoCasaInicial: 8862683, identificacaoProcessoInicial: "PL 7108/2017", siglaCasaIniciadora: "CD",
  outrosNumeros: [{ idOutroProcesso: 8862683, sigla: "PL", numero: "07108", ano: 2017, casaIdentificadora: "CD", externaAoCongresso: "Não" }]
};
const fields = { areaTecnica: "Educação", responsavel: "Beatriz Silva (Colaborador)", atualComissao: "Comissão manual", haParecer: "Sim", sugestaoEmenda: "Não", posicionamento: "Favorável" };
const query = (numero = 3361, ano = 2025) => new URLSearchParams({ siglaTipo: "PL", numero, ano });
function setup({ collision = false, noRelation = false, senateDown = false, cameraAmbiguous = false } = {}) {
  const database = createDatabase(":memory:");
  const calls = [];
  const other = { ...camara, id: 9000001, numero: 3361, ano: 2025 };
  const camaraFetch = async (url) => {
    calls.push(url.href);
    if (!url.pathname.endsWith("/proposicoes")) {
      assert.ok([camara.id, other.id].includes(Number(url.pathname.split("/").at(-1))), "Senate process IDs must never be used as Câmara IDs");
      return Response.json({ dados: url.pathname.endsWith(`/${camara.id}`) ? camara : other });
    }
    const rows = url.searchParams.get("numero") === "7108" ? (cameraAmbiguous ? [camara, { ...camara, id: 123 }] : [camara]) : collision ? [other] : [];
    return Response.json({ dados: rows });
  };
  const senadoFetch = async (url) => {
    calls.push(url.href);
    if (senateDown) throw new Error("offline");
    if (url.pathname.endsWith("/processo")) return Response.json(url.searchParams.get("numero") === "3361" ? [senate] : []);
    assert.ok(url.pathname.endsWith("/8862684"));
    return Response.json(noRelation ? { ...senate, identificacaoProcessoInicial: null, idProcessoCasaInicial: null, outrosNumeros: [] } : senate);
  };
  const options = { database, camaraFetch, senadoFetch };
  return { database, calls, options, service: createPropositionService(options) };
}

test("PL 3361/2025 resolve para PL 7108/2017; IDs ficam separados e cache persiste entre serviços", async () => {
  const { database, calls, options, service } = setup();
  try {
    for (const params of [new URLSearchParams(), new URLSearchParams("siglaTipo=PL&numero=3361"), new URLSearchParams("siglaTipo=XXX&numero=3361&ano=2025")]) await assert.rejects(() => service.search(params));
    assert.equal(calls.length, 0);
    const found = await service.search(query());
    assert.equal(found.results.length, 1);
    assert.equal(found.results[0].id, camara.id);
    assert.equal(found.results[0].projeto, "PL 7108/2017");
    assert.deepEqual(found.results[0].identifications, [{ house: "CD", name: "PL 7108/2017" }, { house: "SF", name: "PL 3361/2025" }]);
    await assert.rejects(() => service.select(8862684, found.searchToken));
    const selected = await service.select(camara.id, found.searchToken);
    assert.equal(calls.length, 5);
    assert.equal(selected.proposition.id, camara.id);
    assert.equal(selected.proposition.identifiers.find((identity) => identity.externalId === 8862684).codigoMateria, 169542);
    assert.equal(database.getMatterBySenadoId(8862683).id, database.getMatterByCamaraId(camara.id).id);
    assert.equal(database.getMatterBySenadoId(8862684).id, selected.proposition.matterId);
    const saved = database.create(service.recordInput({ ...fields, propositionToken: selected.propositionToken }));
    assert.equal(saved.atualComissao, "Comissão manual");
    assert.equal(saved.camara.dataApresentacao, "2017-03-15T11:55");
    assert.equal(database.list({ q: "PL 3361/2025" })[0].id, saved.id);
    assert.equal(database.list({ q: "PL 7108/2017" })[0].id, saved.id);
    const restarted = createPropositionService(options);
    const cached = await restarted.search(query());
    assert.equal(cached.cached, true);
    const reselected = await restarted.select(camara.id, cached.searchToken);
    assert.equal(calls.length, 5, "No API calls on repeat search and selection");
    assert.equal(reselected.proposition.matterId, saved.matterId);
    const reverse = await restarted.search(query(7108, 2017));
    const reverseSelection = await restarted.select(camara.id, reverse.searchToken);
    assert.equal(reverseSelection.proposition.matterId, saved.matterId);
    const input = restarted.recordInput({ ...fields, propositionToken: reverseSelection.propositionToken });
    assert.throws(() => database.create(input), (error) => error.status === 409);
    const otherArea = database.create({ ...input, areaTecnica: "Finanças" });
    assert.equal(otherArea.matterId, saved.matterId);
    assert.equal(database.list().length, 2);
    assert.equal(database.update(saved.id, input).id, saved.id);
  } finally { database.close(); }
});

test("numeração coincidente e ementa idêntica não unem matérias sem vínculo explícito", async () => {
  const { database, service } = setup({ collision: true });
  try {
    const result = await service.search(query());
    assert.deepEqual(result.results.map((row) => row.id).sort(), [2125467, 9000001]);
    const first = await service.select(2125467, result.searchToken);
    const second = await service.select(9000001, result.searchToken);
    assert.notEqual(first.proposition.matterId, second.proposition.matterId);
    assert.equal(second.proposition.identifiers.length, 1);
  } finally { database.close(); }
});

test("sem referência explícita ou com múltiplos IDs candidatos não inventa equivalência", async () => {
  for (const options of [{ noRelation: true }, { cameraAmbiguous: true }]) {
    const { database, service } = setup(options);
    try {
      const result = await service.search(query());
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].source, "senado");
      if (options.cameraAmbiguous) assert.ok(result.warnings.length);
      assert.equal(database.getMatterBySenadoId(senate.id), null);
      const selected = await service.select(result.results[0].selectionId, result.searchToken);
      assert.equal(selected.proposition.source, "senado");
      assert.equal(database.getMatterBySenadoId(senate.id).camara, null);
    } finally { database.close(); }
  }
});

test("falha parcial não é armazenada como resultado completo e exige escolha explícita", async () => {
  const { database, calls, service } = setup({ collision: true, senateDown: true });
  try {
    const found = await service.search(query());
    assert.equal(found.results.length, 1);
    assert.equal(found.requiresSelection, true);
    assert.match(found.warnings.join(" "), /Senado/);
    const before = calls.length;
    await service.search(query());
    assert.ok(calls.length > before);
  } finally { database.close(); }
});

test("vínculo conflitante é recusado em transação sem alterar a matéria já conhecida", async () => {
  const { database, service } = setup();
  try {
    const result = await service.search(query());
    await service.select(camara.id, result.searchToken);
    const existing = database.getMatterByCamaraId(camara.id);
    const relation = { identifiers: existing.identifiers.filter((identifier) => identifier.source === "senado"), evidence: existing.identifiers.find((identifier) => identifier.source === "senado").evidence };
    assert.throws(() => database.saveMatter({ ...existing.camara, id: 999 }, [relation]), (error) => error.status === 409);
    assert.equal(database.getMatterByCamaraId(999), null);
    assert.deepEqual(database.getMatterByCamaraId(camara.id), existing);
    // Identical numbers in different provider namespaces are independent IDs.
    const sameNumber = database.saveMatter(existing.camara, [{ identifiers: [{ source: "senado", externalId: camara.id, house: "SF", siglaTipo: "PL", numero: 3361, ano: 2025 }], evidence: { id: camara.id } }]);
    assert.equal(sameNumber.identifiers.filter((identifier) => identifier.externalId === camara.id).length, 2);
  } finally { database.close(); }
});

test("Senado ignora resultados fora dos filtros e rejeita respostas parciais", async () => {
  const service = createSenadoClient(async () => Response.json([senate, { ...senate, id: 123, identificacao: "PL 999/2025" }]));
  assert.equal((await service.search({ siglaTipo: "PL", numero: 3361, ano: 2025 })).length, 1);
  const partial = createSenadoClient(async () => new Response("[]", { status: 206 }));
  await assert.rejects(() => partial.search({ siglaTipo: "PL", numero: 3361, ano: 2025 }), (error) => error.status === 503);
});

test("equivalências e cache sobrevivem ao fechamento do SQLite sem novas chamadas", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pauta-senado-persist-"));
  const file = path.join(dir, "records.sqlite");
  const fixture = setup();
  fixture.database.close();
  let database = createDatabase(file);
  try {
    let service = createPropositionService({ ...fixture.options, database });
    const found = await service.search(query());
    const selected = await service.select(camara.id, found.searchToken);
    database.close();
    database = createDatabase(file);
    service = createPropositionService({ database, camaraFetch: () => { throw Error("unexpected"); }, senadoFetch: () => { throw Error("unexpected"); } });
    const cached = await service.search(query());
    assert.equal(cached.cached, true);
    const again = await service.select(camara.id, cached.searchToken);
    assert.equal(again.proposition.matterId, selected.proposition.matterId);
    assert.equal(again.proposition.identifiers.length, 3);
  } finally { database.close(); await rm(dir, { recursive: true, force: true }); }
});

test("migração vincula registros com ID oficial preservando duplicidades históricas e anexos", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pauta-senado-migration-"));
  const file = path.join(dir, "records.sqlite");
  const sqlite = new DatabaseSync(file);
  sqlite.exec(`CREATE TABLE records (
    id INTEGER PRIMARY KEY, area_tecnica TEXT, responsavel TEXT, projeto TEXT, ementa TEXT,
    atual_comissao TEXT, ha_parecer TEXT, sugestao_emenda TEXT, posicionamento TEXT,
    attachment_name TEXT, attachment_stored_name TEXT, attachment_mime TEXT, attachment_size INTEGER,
    created_at TEXT, updated_at TEXT, edited_at TEXT, camara_json TEXT
  )`);
  const official = { ...camara, projeto: "PL 7108/2017", consultadoEm: "2026-09-16T00:00:00Z" };
  for (const id of [1, 2]) sqlite.prepare("INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, fields.areaTecnica, fields.responsavel, official.projeto, official.ementa, fields.atualComissao, fields.haParecer, fields.sugestaoEmenda, fields.posicionamento, "arquivo.pdf", "stored.pdf", "application/pdf", 100, "2026-09-16T00:00:00Z", "2026-09-16T00:00:00Z", null, JSON.stringify(official));
  sqlite.close();
  const database = createDatabase(file);
  try {
    const records = database.list();
    assert.equal(records.length, 2);
    assert.equal(records[0].matterId, records[1].matterId);
    assert.equal(records[0].attachmentName, "arquivo.pdf");
    assert.equal(records[0].createdAt, "2026-09-16T00:00:00Z");
    assert.equal(database.getAttachment(records[0].id).storedName, "stored.pdf");
    assert.equal(database.update(records[0].id, { ...records[0], atualComissao: "Outra comissão" }).atualComissao, "Outra comissão");
    assert.throws(() => database.create(records[0]), (error) => error.status === 409);
  } finally { database.close(); await rm(dir, { recursive: true, force: true }); }
});
