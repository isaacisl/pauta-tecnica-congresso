import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { startServer } from "../server.js";

let app;
let temporaryDirectory;

const sampleRecord = {
  areaTecnica: "Educação",
  responsavel: "Beatriz Silva (Colaborador)",
  projeto: "PL 1234/2026",
  ementa: "Institui uma política nacional de apoio à educação municipal.",
  atualComissao: "Comissão de Educação",
  haParecer: "Em andamento",
  sugestaoEmenda: "Sim",
  posicionamento: "Favorável"
};

async function request(pathname, options) {
  return fetch(`${app.url}${pathname}`, options);
}

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pauta-tecnica-test-"));
  app = await startServer({
    port: 0,
    hostname: "127.0.0.1",
    databasePath: path.join(temporaryDirectory, "test.sqlite")
  });
});

after(async () => {
  await app.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test("disponibiliza os parâmetros extraídos da planilha", async () => {
  const response = await request("/api/parameters");
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.areasTecnicas.length, 22);
  assert.equal(payload.responsaveis.length, 80);
  assert.deepEqual(payload.pareceres, ["Sim", "Não", "Em andamento"]);

  const emptyFilterOptions = await (await request("/api/filter-options")).json();
  assert.deepEqual(emptyFilterOptions.areasTecnicas, []);
  assert.deepEqual(emptyFilterOptions.responsaveis, []);
});

test("valida, cria, filtra e edita registros", async () => {
  const invalidResponse = await request("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projeto: "Incompleto" })
  });
  assert.equal(invalidResponse.status, 422);

  const createResponse = await request("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sampleRecord)
  });
  const created = (await createResponse.json()).record;
  assert.equal(createResponse.status, 201);
  assert.equal(created.projeto, sampleRecord.projeto);

  const filterOptions = await (await request("/api/filter-options")).json();
  assert.deepEqual(filterOptions.areasTecnicas, ["Educação"]);
  assert.deepEqual(filterOptions.responsaveis, ["Beatriz Silva (Colaborador)"]);
  assert.deepEqual(filterOptions.pareceres, ["Em andamento"]);
  assert.deepEqual(filterOptions.emendas, ["Sim"]);
  assert.deepEqual(filterOptions.posicionamentos, ["Favorável"]);

  const filteredResponse = await request(`/api/records?areaTecnica=${encodeURIComponent("Educação")}&responsavel=${encodeURIComponent("Beatriz Silva (Colaborador)")}&haParecer=${encodeURIComponent("Em andamento")}`);
  const filtered = await filteredResponse.json();
  assert.equal(filtered.count, 1);
  assert.equal(filtered.records[0].id, created.id);

  const updateResponse = await request(`/api/records/${created.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...sampleRecord, haParecer: "Sim" })
  });
  const updated = (await updateResponse.json()).record;
  assert.equal(updated.haParecer, "Sim");
});

test("totaliza e exporta a base em CSV compatível com Excel", async () => {
  const totalsResponse = await request("/api/totals");
  const totals = await totalsResponse.json();
  assert.equal(totals.total, 1);
  assert.equal(totals.overallTotal, 1);
  assert.deepEqual(totals.byArea[0], { label: "Educação", count: 1 });
  assert.deepEqual(totals.byParecer[0], { label: "Sim", count: 1 });

  const filteredTotals = await (await request(`/api/totals?responsavel=${encodeURIComponent("Beatriz Silva (Colaborador)")}`)).json();
  assert.equal(filteredTotals.total, 1);
  assert.equal(filteredTotals.overallTotal, 1);

  const emptyTotals = await (await request(`/api/totals?responsavel=${encodeURIComponent("Pessoa inexistente")}`)).json();
  assert.equal(emptyTotals.total, 0);
  assert.equal(emptyTotals.overallTotal, 1);

  const unauthorizedResponse = await request("/api/export.csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "senha-incorreta" })
  });
  assert.equal(unauthorizedResponse.status, 401);

  const exportResponse = await request("/api/export.csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "CentralDeDados2026" })
  });
  const bytes = Buffer.from(await exportResponse.arrayBuffer());
  const csv = new TextDecoder("windows-1252").decode(bytes);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-type"), /charset=windows-1252/);
  assert.match(exportResponse.headers.get("content-disposition"), /registros-areas-tecnicas-/);
  assert.match(csv, /sep=;/);
  assert.match(csv, /PL 1234\/2026/);
  assert.match(csv, /Área Técnica/);
  assert.notEqual(bytes.indexOf(Buffer.from([0xc1, 0x72, 0x65, 0x61])), -1);
});

test("exclui um registro existente", async () => {
  const listResponse = await request("/api/records");
  const [record] = (await listResponse.json()).records;
  const deleteResponse = await request(`/api/records/${record.id}`, { method: "DELETE" });
  assert.equal(deleteResponse.status, 200);

  const totals = await (await request("/api/totals")).json();
  assert.equal(totals.total, 0);
});
