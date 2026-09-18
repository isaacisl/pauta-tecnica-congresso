import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { startServer } from "../server.js";
import { createCamaraClient } from "../lib/camara.js";
import { createDatabase } from "../lib/database.js";

const fields = { areaTecnica: "Educação", responsavel: "Beatriz Silva (Colaborador)", projeto: "Manual", ementa: "Manual", atualComissao: "Comissão preenchida manualmente", haParecer: "Sim", sugestaoEmenda: "Não", posicionamento: "Favorável" };
const official = { id: 42, siglaTipo: "PL", numero: 1234, ano: 2024, ementa: "Ementa oficial", dataApresentacao: "2024-04-12T15:20", statusProposicao: { dataHora: "2024-04-19T00:00" } };
const query = () => new URLSearchParams("siglaTipo=PL&numero=1234&ano=2024");

test("consulta exige os três parâmetros, percorre páginas e valida a seleção antes de consultar o detalhe", async () => {
  const calls = [];
  const client = createCamaraClient(async (url) => {
    calls.push(url);
    if (!url.pathname.endsWith("/proposicoes")) return Response.json({ dados: official });
    return Response.json(url.searchParams.get("pagina") === "1"
      ? { dados: [official], links: [{ rel: "next", href: "https://untrusted.invalid/" }] }
      : { dados: [{ ...official, id: 43 }], links: [] });
  });
  for (const params of ["", "siglaTipo=PL&numero=1234", "siglaTipo=INVALID&numero=1&ano=2024", "siglaTipo=PL&numero=-2&ano=2024", "siglaTipo=PL&numero=12abc&ano=2024"]) {
    await assert.rejects(() => client.search(new URLSearchParams(params)), /tipo/);
  }
  assert.equal(calls.length, 0);
  const search = await client.search(query());
  assert.deepEqual(search.results.map((item) => item.id), [42, 43]);
  assert.equal(calls.length, 2);
  for (const url of calls) {
    assert.equal(url.origin, "https://dadosabertos.camara.leg.br");
    assert.equal(url.searchParams.get("siglaTipo"), "PL");
    assert.equal(url.searchParams.get("numero"), "1234");
    assert.equal(url.searchParams.get("ano"), "2024");
  }
  await assert.rejects(() => client.select(9999, search.searchToken));
  assert.equal(calls.length, 2);
  const selected = await client.select(42, search.searchToken);
  assert.equal(calls.length, 3);
  const input = client.recordInput({ ...fields, propositionToken: selected.propositionToken, camara: { id: 9999 } });
  assert.equal(input.projeto, "PL 1234/2024");
  assert.equal(input.ementa, "Ementa oficial");
  assert.equal(input.camara.id, 42);
  assert.equal(input.camara.dataApresentacao, "2024-04-12T15:20");
  assert.equal(input.camara.statusDataHora, "2024-04-19T00:00");
  assert.equal(input.atualComissao, fields.atualComissao);
  assert.equal(calls.length, 3);
  assert.throws(() => client.recordInput(fields));
  assert.throws(() => client.recordInput({ ...fields, propositionToken: `${selected.propositionToken}tampered` }));
});

test("trata pesquisa vazia, indisponibilidade, respostas inválidas e datas ausentes", async () => {
  const empty = createCamaraClient(async () => Response.json({ dados: [] }));
  assert.deepEqual((await empty.search(query())).results, []);
  for (const reply of [() => { throw new Error("timeout"); }, () => new Response("offline", { status: 503 }), () => Response.json({ dados: {} })]) {
    const client = createCamaraClient(reply);
    await assert.rejects(() => client.search(query()), (error) => error.status === 503);
  }
  const client = createCamaraClient(async (url) => Response.json({ dados: url.pathname.endsWith("/proposicoes") ? [official] : { ...official, dataApresentacao: null, statusProposicao: null, ementa: null } }));
  const search = await client.search(query());
  const selected = await client.select(42, search.searchToken);
  assert.equal(selected.proposition.dataApresentacao, null);
  assert.equal(selected.proposition.statusDataHora, null);
  assert.equal(selected.proposition.ementa, "");
});

test("API bloqueia cadastro manual e conserva o vínculo e datas após edição e reinício", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-camara-test-"));
  const databasePath = path.join(directory, "records.sqlite");
  let calls = 0;
  const camaraFetch = async (url) => {
    calls++;
    return Response.json({ dados: url.pathname.endsWith("/proposicoes") ? [official] : official });
  };
  let app = await startServer({ port: 0, databasePath, camaraFetch, senadoFetch: async () => Response.json([]) });
  const request = (endpoint, body, method = "POST") => fetch(`${app.url}${endpoint}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    await fetch(`${app.url}/api/parameters`);
    await fetch(`${app.url}/api/records`);
    assert.equal(calls, 0);
    assert.equal((await request("/api/records", fields)).status, 422);
    const search = await (await fetch(`${app.url}/api/camara/proposicoes?${query()}`)).json();
    const selection = await (await request("/api/camara/proposicoes/42", { searchToken: search.searchToken })).json();
    const response = await request("/api/records", { ...fields, propositionToken: selection.propositionToken });
    assert.equal(response.status, 201);
    const saved = (await response.json()).record;
    assert.equal(saved.camara.id, 42);
    assert.equal(saved.projeto, "PL 1234/2024");
    assert.equal(saved.atualComissao, fields.atualComissao);
    assert.equal(calls, 2);
    await app.close();
    app = await startServer({ port: 0, databasePath, camaraFetch, senadoFetch: async () => Response.json([]) });
    const updatedResponse = await request(`/api/records/${saved.id}`, { ...saved, haParecer: "Não", ementa: "Tentativa de trocar", camara: { id: 123 } }, "PUT");
    assert.equal(updatedResponse.status, 200);
    const updated = (await updatedResponse.json()).record;
    assert.deepEqual(updated.camara, saved.camara);
    assert.equal(updated.ementa, official.ementa);
    assert.equal(updated.haParecer, "Não");
    assert.equal(calls, 2);
    assert.equal((await request(`/api/records/${saved.id}`, { ...saved, projeto: "PL 999/2024" }, "PUT")).status, 422);
    assert.equal((await request("/api/records", { ...fields, propositionToken: selection.propositionToken })).status, 422);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("migração preserva registros antigos e seus metadados de anexos", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-migration-test-"));
  const file = path.join(directory, "legacy.sqlite");
  let db = createDatabase(file);
  const legacy = db.create(fields);
  db.setAttachment(legacy.id, { name: "documento.pdf", storedName: "original.pdf", mime: "application/pdf", size: 42 });
  db.close();
  const sqlite = new DatabaseSync(file);
  sqlite.exec("ALTER TABLE records DROP COLUMN camara_json");
  sqlite.close();
  try {
    db = createDatabase(file);
    const migrated = db.get(legacy.id);
    assert.equal(migrated.projeto, fields.projeto);
    assert.equal(migrated.attachmentName, "documento.pdf");
    assert.equal(migrated.camara, null);
    const client = createCamaraClient(() => { throw new Error("Não deve consultar"); });
    const edited = db.update(legacy.id, client.recordInput({ ...fields, atualComissao: "Nova comissão" }, migrated));
    assert.equal(edited.atualComissao, "Nova comissão");
    assert.equal(edited.attachmentName, "documento.pdf");
    assert.equal(edited.createdAt, legacy.createdAt);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
