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
  responsavel: "Eduardo Santana",
  projeto: "PL 1234/2026",
  ementa: "Institui uma política nacional de apoio à educação municipal.",
  despacho: "À Comissão de Educação.",
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
    tramitationCheckDelayMs: null,
    hostname: "127.0.0.1",
    databasePath: path.join(temporaryDirectory, "test.sqlite"),
    senadoFetch: async () => Response.json([]),
    camaraFetch: async (url) => {
      if (url.pathname.endsWith("/autores")) return Response.json({ dados: [{ nome: "Autora Teste", tipo: "Deputado(a)", ordemAssinatura: 1 }] });
      const number = Number(url.searchParams.get("numero") || url.pathname.split("/").at(-1));
      const proposition = { id: number, siglaTipo: "PL", numero: number, ano: 2026, ementa: sampleRecord.ementa, dataApresentacao: "2026-01-10T14:30", statusProposicao: { dataHora: "2026-02-20T15:45" } };
      return Response.json({ dados: url.pathname.endsWith("/tramitacoes") ? [] : url.pathname.endsWith("/proposicoes") ? [proposition] : proposition });
    }
  });
});

async function selection(number) {
  const search = await (await request(`/api/camara/proposicoes?siglaTipo=PL&numero=${number}&ano=2026`)).json();
  const result = await (await request(`/api/camara/proposicoes/${number}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ searchToken: search.searchToken })
  })).json();
  return result.propositionToken;
}

after(async () => {
  await app.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test("disponibiliza os parâmetros extraídos da planilha", async () => {
  const response = await request("/api/parameters");
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.areasTecnicas.length, 43);
  assert.equal(payload.responsaveis.length, 133);
  assert.deepEqual(payload.responsaveisPorArea["Central de Dados"], ["Isaac Lacerda", "Jhonatan Pires", "João Krebs", "Luidy Santos"]);
  assert.deepEqual(payload.pareceres, ["Sim", "Não", "Em andamento"]);
  assert.ok(payload.propositionTypes.some(([code]) => code === "PRLP(V)"));

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
    body: JSON.stringify({ ...sampleRecord, propositionToken: await selection(1234) })
  });
  const created = (await createResponse.json()).record;
  assert.equal(createResponse.status, 201);
  assert.equal(created.projeto, sampleRecord.projeto);
  assert.equal(created.autor, "Autora Teste (Deputado(a))");
  assert.equal(created.despacho, sampleRecord.despacho);
  assert.ok(created.createdAt);
  assert.equal(created.editedAt, null);

  const filterOptions = await (await request("/api/filter-options")).json();
  assert.deepEqual(filterOptions.areasTecnicas, ["Educação"]);
  assert.deepEqual(filterOptions.responsaveis, ["Eduardo Santana"]);
  assert.deepEqual(filterOptions.pareceres, ["Em andamento"]);
  assert.deepEqual(filterOptions.emendas, ["Sim"]);
  assert.deepEqual(filterOptions.posicionamentos, ["Favorável"]);

  const secondRecord = {
    ...sampleRecord,
    areaTecnica: "Finanças e Tributação",
    responsavel: "Alex Carneiro",
    projeto: "PL 987/2026",
    haParecer: "Não",
    sugestaoEmenda: "Não",
    posicionamento: "Desfavorável"
  };
  const secondCreateResponse = await request("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...secondRecord, propositionToken: await selection(987) })
  });
  const secondCreated = (await secondCreateResponse.json()).record;
  assert.equal(secondCreateResponse.status, 201);

  const educationOptions = await (await request(`/api/filter-options?areaTecnica=${encodeURIComponent("Educação")}`)).json();
  assert.deepEqual(educationOptions.responsaveis, ["Eduardo Santana"]);
  assert.deepEqual(educationOptions.pareceres, ["Em andamento"]);

  const financeOptions = await (await request(`/api/filter-options?areaTecnica=${encodeURIComponent("Finanças e Tributação")}`)).json();
  assert.deepEqual(financeOptions.responsaveis, ["Alex Carneiro"]);
  assert.deepEqual(financeOptions.posicionamentos, ["Desfavorável"]);

  const responsibleOptions = await (await request(`/api/filter-options?responsavel=${encodeURIComponent("Eduardo Santana")}`)).json();
  assert.deepEqual(responsibleOptions.areasTecnicas, ["Educação"]);

  await request(`/api/records/${secondCreated.id}`, { method: "DELETE", body: JSON.stringify({ revision: secondCreated.revision }) });

  const filteredResponse = await request(`/api/records?areaTecnica=${encodeURIComponent("Educação")}&responsavel=${encodeURIComponent("Eduardo Santana")}&haParecer=${encodeURIComponent("Em andamento")}`);
  const filtered = await filteredResponse.json();
  assert.equal(filtered.count, 1);
  assert.equal(filtered.records[0].id, created.id);

  const updateResponse = await request(`/api/records/${created.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...sampleRecord, revision: created.revision, haParecer: "Sim" })
  });
  const updated = (await updateResponse.json()).record;
  assert.equal(updated.haParecer, "Sim");
  assert.ok(updated.editedAt);
  assert.ok(new Date(updated.editedAt) >= new Date(updated.createdAt));
});

test("totaliza e exporta a base em CSV compatível com Excel", async () => {
  const totalsResponse = await request("/api/totals");
  const totals = await totalsResponse.json();
  assert.equal(totals.total, 1);
  assert.equal(totals.overallTotal, 1);
  assert.deepEqual(totals.byArea[0], { label: "Educação", count: 1 });
  assert.deepEqual(totals.byParecer[0], { label: "Sim", count: 1 });

  const filteredTotals = await (await request(`/api/totals?responsavel=${encodeURIComponent("Eduardo Santana")}`)).json();
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
  const csv = new TextDecoder("utf-8").decode(bytes);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-type"), /charset=utf-8/);
  assert.match(exportResponse.headers.get("content-disposition"), /registros-areas-tecnicas-/);
  assert.match(csv, /sep=;/);
  assert.match(csv, /PL 1234\/2026/);
  assert.match(csv, /Autor\(es\)/);
  assert.match(csv, /Autora Teste \(Deputado\(a\)\)/);
  assert.match(csv, /Área Técnica/);
  assert.match(csv, /"Despacho";"Atual comissão"/);
  assert.match(csv, /À Comissão de Educação/);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("acrescenta documentos ao histórico, preserva downloads e evita duplicação em novas tentativas", async () => {
  const [record] = (await (await request("/api/records")).json()).records;
  const file = Buffer.from("%PDF-1.7\nconteudo de teste\n", "utf8");
  const uploadResponse = await request(`/api/records/${record.id}/attachment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "X-File-Name": encodeURIComponent("parecer técnico.pdf")
    },
    body: file
  });
  const uploaded = (await uploadResponse.json()).record;
  assert.equal(uploadResponse.status, 201);
  assert.equal(uploaded.attachmentName, "parecer técnico.pdf");
  assert.equal(uploaded.attachmentSize, file.length);
  assert.equal(uploaded.attachments.length, 1);
  const original = uploaded.attachments[0];
  assert(Number.isFinite(Date.parse(original.createdAt)));
  assert.equal(original.storedName, undefined);

  const downloadResponse = await request(`/api/records/${record.id}/attachment`);
  const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
  assert.equal(downloadResponse.status, 200);
  assert.equal(downloadResponse.headers.get("content-type"), "application/pdf");
  assert.match(downloadResponse.headers.get("content-disposition"), /parecer%20t%C3%A9cnico\.pdf/);
  assert.deepEqual(downloaded, file);

  const secondFile = Buffer.from("%PDF-1.7\nsegunda versão\n");
  const upload = () => request(`/api/records/${record.id}/attachments`, {
    method: "POST", headers: { "X-File-Name": encodeURIComponent("parecer técnico.pdf"), "X-Upload-Id": "11111111-1111-4111-8111-111111111111" }, body: secondFile
  });
  const uploads = await Promise.all([upload(), upload()]);
  assert(uploads.every(response => [200, 201].includes(response.status)));
  const history = (await (await request(`/api/records/${record.id}`)).json()).record.attachments;
  assert.equal(history.length, 2);
  assert.notEqual(history[0].id, original.id);
  assert.equal(history[1].createdAt, original.createdAt);
  assert(Number.isFinite(Date.parse(history[0].createdAt)));
  assert.deepEqual(Buffer.from(await (await request(`/api/records/${record.id}/attachments/${original.id}`)).arrayBuffer()), file);
  assert.deepEqual(Buffer.from(await (await request(`/api/records/${record.id}/attachments/${history[0].id}`)).arrayBuffer()), secondFile);
  assert.equal((await request(`/api/records/99999/attachments/${original.id}`)).status, 404);
  assert.equal((await request(`/api/records/${record.id}/attachment`, { method: "DELETE" })).status, 405);

  await app.close();
  app = await startServer({ port: 0, databasePath: path.join(temporaryDirectory, "test.sqlite") });
  assert.deepEqual((await (await request(`/api/records/${record.id}/attachments`)).json()).attachments, history);

  const invalidResponse = await request(`/api/records/${record.id}/attachment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent("programa.exe")
    },
    body: Buffer.from("arquivo não permitido")
  });
  assert.equal(invalidResponse.status, 415);
});

test("exclui um registro existente", async () => {
  const listResponse = await request("/api/records");
  const [record] = (await listResponse.json()).records;
  const deleteResponse = await request(`/api/records/${record.id}`, { method: "DELETE", body: JSON.stringify({ revision: record.revision }) });
  assert.equal(deleteResponse.status, 200);

  const attachmentResponse = await request(`/api/records/${record.id}/attachment`);
  assert.equal(attachmentResponse.status, 404);

  const totals = await (await request("/api/totals")).json();
  assert.equal(totals.total, 0);
});
