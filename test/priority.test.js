import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startServer } from "../server.js";
import { createDatabase } from "../lib/database.js";

const fields = {
  areaTecnica: "Educação", responsavel: "Eduardo Santana", projeto: "PL 123/2026",
  ementa: "Educação municipal", haParecer: "Não", sugestaoEmenda: "Não", posicionamento: "Favorável"
};

async function withApp(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-priority-"));
  let app;
  try {
    app = await startServer({
      port: 0, hostname: "127.0.0.1", databasePath: path.join(directory, "records.sqlite"),
      tramitationCheckDelayMs: null,
      senadoFetch: async () => Response.json([]),
      camaraFetch: async url => {
        if (url.pathname.endsWith("/autores")) return Response.json({ dados: [] });
        const number = Number(url.searchParams.get("numero") || url.pathname.split("/").at(-1));
        const proposition = { id: number, siglaTipo: "PL", numero: number, ano: 2026, ementa: fields.ementa };
        return Response.json({ dados: url.pathname.endsWith("/tramitacoes") ? [] : url.pathname.endsWith("/proposicoes") ? [proposition] : proposition });
      }
    });
    const request = (endpoint, options) => fetch(`${app.url}${endpoint}`, options);
    const json = async (endpoint, options) => (await request(endpoint, options)).json();
    async function create(number, overrides = {}) {
      const search = await json(`/api/camara/proposicoes?siglaTipo=PL&numero=${number}&ano=2026`);
      const selected = await json(`/api/camara/proposicoes/${number}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ searchToken: search.searchToken })
      });
      const response = await request("/api/records", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, propositionToken: selected.propositionToken, ...overrides })
      });
      return { response, payload: await response.json() };
    }
    await run({ request, json, create });
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("cadastro inicia em N/I e edição persiste a prioridade no registro e histórico", async () => {
  await withApp(async ({ request, json, create }) => {
    const { response, payload } = await create(123);
    assert.equal(response.status, 201);
    assert.equal(payload.record.prioridade, "N/I");
    const original = payload.record;
    const updatedResponse = await request(`/api/records/${original.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, revision: original.revision, prioridade: "Alta" })
    });
    assert.equal(updatedResponse.status, 200);
    const { record: updated } = await updatedResponse.json();
    assert.equal(updated.prioridade, "Alta");
    assert.equal((await json(`/api/records/${original.id}`)).record.prioridade, "Alta");
    const { history } = await json(`/api/records/${original.id}/history`);
    assert.equal(history[0].before.prioridade, "N/I");
    assert.equal(history[0].after.prioridade, "Alta");
    const compatible = await request(`/api/records/${original.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, revision: updated.revision })
    });
    assert.equal(compatible.status, 200);
    assert.equal((await compatible.json()).record.prioridade, "Alta", "cliente antigo não apaga a prioridade");
  });
});

test("prioridade filtra registros e totalização, combina filtros e aparece nas opções disponíveis", async () => {
  await withApp(async ({ json, create, request }) => {
    for (const [number, prioridade] of [[201, "Alta"], [202, "Média"], [203, "Baixa"], [204, "N/I"]]) {
      assert.equal((await create(number, { prioridade })).response.status, 201);
    }
    const { payload: { record: finance } } = await create(205, { prioridade: "Alta", areaTecnica: "Finanças e Tributação", responsavel: "Alex Carneiro" });
    assert.deepEqual((await json("/api/parameters")).prioridades, ["Alta", "Média", "Baixa", "N/I"]);
    for (const [prioridade, expected] of [["Alta", 2], ["Média", 1], ["Baixa", 1], ["N/I", 1]]) {
      const query = new URLSearchParams({ prioridade });
      const listed = await json(`/api/records?${query}`);
      const totals = await json(`/api/totals?${query}`);
      assert.equal(listed.count, expected);
      assert.ok(listed.records.every(record => record.prioridade === prioridade));
      assert.equal(totals.total, expected);
      assert.equal(totals.uniqueProjects, expected);
      assert.equal(totals.byAreaPosition.reduce((sum, row) => sum + row.count, 0), expected);
      assert.equal(totals.overallTotal, 5);
    }
    const combined = new URLSearchParams({ prioridade: "Alta", areaTecnica: "Finanças e Tributação" });
    assert.deepEqual((await json(`/api/records?${combined}`)).records.map(record => record.id), [finance.id]);
    assert.equal((await json(`/api/totals?${combined}`)).total, 1);
    const options = await json(`/api/filter-options?${combined}`);
    assert.deepEqual(options.prioridades, ["Alta"]);
    assert.deepEqual(options.responsaveis, ["Alex Carneiro"]);
    const education = await json(`/api/filter-options?${new URLSearchParams({ areaTecnica: "Educação", prioridade: "Alta" })}`);
    assert.deepEqual(new Set(education.prioridades), new Set(["Alta", "Média", "Baixa", "N/I"]), "o próprio filtro não esconde outras prioridades disponíveis");
    assert.deepEqual(education.responsaveis, ["Eduardo Santana"]);
    const removed = await request(`/api/records/${finance.id}`, { method: "DELETE", body: JSON.stringify({ revision: finance.revision }) });
    assert.equal(removed.status, 200);
    assert.equal((await json("/api/totals?prioridade=Alta")).total, 1);
    assert.equal((await json(`/api/totals?${combined}`)).total, 0);
  });
});

test("migração atribui N/I a registros antigos e preserva datas, revisões, documentos e histórico", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-priority-migration-"));
  const filename = path.join(directory, "legacy.sqlite");
  let database;
  try {
    database = createDatabase(filename);
    const record = database.create(fields);
    const saved = database.setAttachment(record.id, { name: "antigo.pdf", storedName: "antigo.pdf", size: 10, mime: "application/pdf", title: "Documento antigo", description: "Preservar na migração" });
    const history = database.history(record.id);
    database.close(); database = null;
    const legacy = new DatabaseSync(filename);
    try { legacy.exec("ALTER TABLE records DROP COLUMN prioridade"); } finally { legacy.close(); }
    database = createDatabase(filename);
    const migrated = database.get(record.id);
    assert.equal(migrated.prioridade, "N/I");
    assert.equal(migrated.createdAt, saved.createdAt);
    assert.equal(migrated.updatedAt, saved.updatedAt);
    assert.equal(migrated.editedAt, saved.editedAt);
    assert.equal(migrated.revision, saved.revision);
    assert.deepEqual(migrated.attachments, saved.attachments);
    assert.deepEqual(database.history(record.id), history);
    const changed = database.update(record.id, { ...migrated, prioridade: "Média" });
    database.close(); database = createDatabase(filename);
    assert.equal(database.get(record.id).prioridade, "Média");
    assert.equal(database.get(record.id).revision, changed.revision);
  } finally {
    if (database) database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("valida as opções de prioridade no servidor e normaliza vazio para N/I", async () => {
  await withApp(async ({ create }) => {
    for (const prioridade of ["Urgente", 1, null]) {
      const { response, payload } = await create(301, { prioridade });
      assert.equal(response.status, 422);
      assert.ok(payload.fields.prioridade);
    }
    const { response, payload } = await create(301, { prioridade: "  " });
    assert.equal(response.status, 201);
    assert.equal(payload.record.prioridade, "N/I");
  });
});

test("exportação inclui a prioridade e respeita a seleção filtrada", async () => {
  await withApp(async ({ create, request }) => {
    await create(401, { prioridade: "Alta" });
    await create(402, { prioridade: "Baixa" });
    const response = await request("/api/export.csv?prioridade=Alta", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: process.env.EXPORT_PASSWORD || "CentralDeDados2026" })
    });
    assert.equal(response.status, 200);
    const csv = await response.text();
    assert.match(csv, /"Prioridade"/);
    assert.match(csv, /"Alta"/);
    assert.match(csv, /PL 401\/2026/);
    assert.doesNotMatch(csv, /PL 402\/2026/);
  });
});
