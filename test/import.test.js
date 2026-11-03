import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { crc32, deflateRawSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { readImportFile } from "../lib/import-files.js";
import { parseImportProject, mappedImportRows, importRowIssues, importIdentity, importDuplicateIndex } from "../public/import-utils.js";
import { parameters } from "../lib/parameters.js";
import { propositionTypes } from "../lib/proposition-types.js";
import { startServer } from "../server.js";

const importHeaders = { "X-Import-Password": encodeURIComponent(process.env.EXPORT_PASSWORD || "CentralDeDados2026") };

function zip(entries, compress = false) {
  const local = [], central = []; let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const filename = Buffer.from(name), data = Buffer.from(value), bytes = compress ? deflateRawSync(data) : data;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(compress ? 8 : 0, 8); header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(compress ? 8 : 0, 10); directory.writeUInt32LE(crc32(data), 16);
    directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, filename); offset += header.length + filename.length + bytes.length;
  }
  const entriesCount = Object.keys(entries).length, end = Buffer.alloc(22), directory = Buffer.concat(central);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entriesCount, 8); end.writeUInt16LE(entriesCount, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function xlsx(sheet, extra = {}) {
  return zip({ "xl/workbook.xml": '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Projetos" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": sheet,
    ...extra }, true);
}

test("CSV lê BOM, separadores, aspas, múltiplas linhas e ignora vazios sem inventar classificações", () => {
  const file = Buffer.from('\uFEFFProjeto;Posicionamento da área;Sugestão de emenda;Há parecer elaborado?\r\nPL 123/2026; favorável ;Sim;Em andamento\r\nPLP 2/2026;"desconhecido\ntexto";;\r\n;;;\r\n');
  const result = readImportFile(file, "lista.csv");
  assert.equal(result.sheets[0].rows.length, 2);
  const rows = mappedImportRows(result.sheets[0], result.sheets[0].mapping, parameters, randomUUID);
  assert.equal(rows[0].posicionamento, "Favorável");
  assert.equal(rows[0].haParecer, "Em andamento");
  assert.equal(rows[1].posicionamento, ""); assert.equal(rows[1].haParecer, "N/I"); assert.equal(rows[1].sugestaoEmenda, "N/I");
  assert.ok(rows[1].raw.posicionamento.includes("\n"));
  assert.equal(readImportFile(Buffer.from('sep=,\nProjeto,Parecer elaborado\nPL 1/2026,Sim'), "outro.csv").sheets[0].rows.length, 1);
  assert.throws(() => readImportFile(Buffer.from('Projeto;Parecer\n"PL 1/2026;Sim'), "quebrado.csv"), /aspas/);
});

test("importação usa N/I em classificações vazias ou ausentes e preserva valores desconhecidos para conferência", () => {
  const file = Buffer.from('Projeto;Posicionamento;Sugestão de emenda;Parecer elaborado\nPL 1/2026;;;\nPL 2/2026;N/I;N/I;N/I\nPL 3/2026;Indefinido;Talvez;Sim');
  const sheet = readImportFile(file, "lista.csv").sheets[0];
  const rows = mappedImportRows(sheet, sheet.mapping, parameters, randomUUID);
  for (const row of rows.slice(0, 2)) {
    assert.deepEqual([row.posicionamento, row.haParecer, row.sugestaoEmenda], ["N/I", "N/I", "N/I"]);
    assert.deepEqual(importRowIssues({ ...row, status: "checked", propositionToken: "teste", responsible: "Eduardo Santana" }, "Educação", ["Eduardo Santana"]), []);
  }
  assert.equal(rows[2].posicionamento, "");
  assert.equal(rows[2].raw.posicionamento, "Indefinido");
  assert.equal(rows[2].sugestaoEmenda, "");
  const onlyProject = readImportFile(Buffer.from('Projeto\nPL 4/2026'), "pautas.csv").sheets[0];
  const [minimal] = mappedImportRows(onlyProject, onlyProject.mapping, parameters, randomUUID);
  assert.deepEqual([minimal.posicionamento, minimal.haParecer, minimal.sugestaoEmenda], ["N/I", "N/I", "N/I"]);
});

test("projetos exigem sigla válida, número positivo e ano completo; prévia exige campos e documentos", () => {
  assert.deepEqual(parseImportProject(" plp 002 / 2026 ", propositionTypes), { siglaTipo: "PLP", numero: "2", ano: "2026" });
  for (const value of ["PL 1/26", "PL 0/2026", "BABOSEIRA 1/2026", "=PL 1/2026"]) assert.equal(parseImportProject(value, propositionTypes), null);
  const row = { status: "checked", responsible: "Eduardo Santana", propositionToken: "token", haParecer: "Sim", sugestaoEmenda: "Não", posicionamento: "Favorável", prioridade: "N/I", documents: [] };
  assert.deepEqual(importRowIssues(row, "Educação", ["Eduardo Santana"]), []);
  assert.ok(importRowIssues(row, "Educação", ["Eduardo Santana"], true).length);
  assert.ok(importRowIssues({ ...row, documents: [{ title: "", description: "" }] }, "Educação", ["Eduardo Santana"]).length);
});

test("XLSX lê shared strings, texto rico, fórmulas sem executar e linhas esparsas", () => {
  const result = readImportFile(xlsx('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Parecer elaborado</t></is></c></row><row r="4"><c r="A4" t="s"><v>1</v></c><c r="B4"><f>1+1</f><v>2</v></c></row><row r="1000"><c r="A1000"/></row></sheetData></worksheet>', {
    "xl/sharedStrings.xml": '<sst><si><t>Projeto</t></si><si><r><t>PL </t></r><r><t>123/2026</t></r></si></sst>'
  }), "lista.xlsx");
  assert.equal(result.sheets[0].rows.length, 1);
  assert.equal(result.sheets[0].rows[0].line, 4);
  assert.equal(result.sheets[0].rows[0].cells[0], "PL 123/2026");
  assert.match(result.sheets[0].rows[0].cells[1], /Fórmula/);
});

test("duplicidades usam identidade oficial, área e responsável, sem misturar homônimos das Casas", () => {
  const row = { selected: true, projeto: "PL 123/2026", responsible: "Eduardo Santana", proposition: { source: "camara", id: 123 } };
  const homonym = { ...row, proposition: { source: "senado", id: 123 } };
  const index = importDuplicateIndex([row, homonym], [], "Educação");
  assert.equal(index.size, 2);
  const linked = { ...row, proposition: { ...row.proposition, matterId: 7 } };
  const existing = { areaTecnica: "Educação", responsavel: row.responsible, matterId: 7 };
  assert.equal(importDuplicateIndex([linked], [existing], "Educação").get(JSON.stringify([importIdentity(linked), "Educação", row.responsible])), 2);
  assert.equal(importDuplicateIndex([linked], [existing], "Cultura").get(JSON.stringify([importIdentity(linked), "Cultura", row.responsible])), 1);
  assert.equal(importDuplicateIndex([{ ...linked, selected: false }], [], "Educação").size, 0);
});

test("leitor recusa arquivos corrompidos, macros, entidades, referências externas e excesso de linhas", () => {
  assert.throws(() => readImportFile(Buffer.from("não é Excel"), "ruim.xlsx"), /Excel/);
  assert.throws(() => readImportFile(Buffer.from("teste"), "ruim.xls"), /xls/);
  assert.throws(() => readImportFile(xlsx('<!DOCTYPE worksheet [<!ENTITY evil "teste">]><worksheet/>'), "ruim.xlsx"), /XML/);
  assert.throws(() => readImportFile(xlsx('<worksheet/>', { "xl/vbaProject.bin": "macro" }), "macro.xlsx"), /macros/);
  assert.throws(() => readImportFile(xlsx('<worksheet/>', { "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="https://exemplo.com/arquivo.xml" TargetMode="External"/></Relationships>' }), "externo.xlsx"), /próprio/);
  assert.throws(() => readImportFile(Buffer.from(`Projeto\n${Array.from({ length: 501 }, (_, i) => `PL ${i + 1}/2026`).join("\n")}`), "muitos.csv"), /500/);
  const corrupt = xlsx('<worksheet/>'); corrupt[50] ^= 1;
  assert.throws(() => readImportFile(corrupt, "corrompido.xlsx"));
});

const mockFetch = async url => {
  if (url.pathname.endsWith("/autores")) return Response.json({ dados: [{ nome: "Autor Teste", tipo: "Deputado(a)" }] });
  const numero = Number(url.searchParams.get("numero") || url.pathname.split("/").at(-1));
  const proposition = { id: numero, siglaTipo: "PL", numero, ano: 2026, ementa: "Ementa oficial de teste", statusProposicao: {} };
  return Response.json({ dados: url.pathname.endsWith("/tramitacoes") ? [] : url.pathname.endsWith("/proposicoes") ? [proposition] : proposition });
};

test("API mapeia cinco colunas, ignora área e responsável da planilha e exige a atribuição escolhida no sistema", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-import-columns-"));
  let app;
  try {
    app = await startServer({ port: 0, databasePath: path.join(directory, "test.sqlite"), tramitationCheckDelayMs: null, camaraFetch: mockFetch, senadoFetch: async () => Response.json([]) });
    const post = (endpoint, body) => fetch(`${app.url}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", ...importHeaders }, body: JSON.stringify(body) });
    const preview = await fetch(`${app.url}/api/import/preview`, { method: "POST", headers: { "X-File-Name": "lista.csv", ...importHeaders }, body: "Projeto;Área técnica;Responsável;Prioridade;Parecer elaborado;Sugestão de emenda;Posicionamento\nPL 124/2026;Educação;Eduardo Santana;Alta;Em andamento;Sim;Favorável\nPL 125/2026;Central de Dados;Luidy Santos;;;;" });
    assert.equal(preview.status, 200);
    const sheet = (await preview.json()).sheets[0];
    assert.deepEqual(sheet.mapping, { projeto: 0, prioridade: 3, posicionamento: 6, sugestaoEmenda: 5, haParecer: 4 });
    const imported = [];
    for (const [index, number] of [124, 125].entries()) {
      const search = await (await fetch(`${app.url}/api/propositions?siglaTipo=PL&numero=${number}&ano=2026`)).json();
      const selected = await (await post(`/api/propositions/${search.results[0].selectionId}`, { searchToken: search.searchToken })).json();
      const input = { propositionToken: selected.propositionToken, areaTecnica: index ? "Central de Dados" : "Educação", responsavel: index ? "Luidy Santos" : "Eduardo Santana", prioridade: index ? "" : "Alta", haParecer: index ? "" : "Em andamento", sugestaoEmenda: index ? "" : "Sim", posicionamento: index ? "" : "Favorável" };
      for (const field of ["areaTecnica", "responsavel"]) {
        assert.equal((await post("/api/import/records", { key: randomUUID(), record: { ...input, [field]: "" } })).status, 422);
        assert.equal((await post("/api/import/records", { key: randomUUID(), record: { ...input, [field]: "N/I" } })).status, 422);
      }
      const response = await post("/api/import/records", { key: randomUUID(), record: input });
      assert.equal(response.status, 201);
      imported.push((await response.json()).record);
    }
    assert.deepEqual(imported.map(row => [row.areaTecnica, row.responsavel, row.prioridade, row.haParecer, row.sugestaoEmenda, row.posicionamento]), [
      ["Educação", "Eduardo Santana", "Alta", "Em andamento", "Sim", "Favorável"],
      ["Central de Dados", "Luidy Santos", "N/I", "N/I", "N/I", "N/I"]
    ]);
    const records = (await (await fetch(`${app.url}/api/records`)).json()).records;
    assert.equal(records.length, 2);
  } finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("API importa acompanhamento incompleto com N/I e permite complementação posterior sem alterar outros registros", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-import-ni-"));
  let app;
  try {
    app = await startServer({ port: 0, databasePath: path.join(directory, "test.sqlite"), tramitationCheckDelayMs: null, camaraFetch: mockFetch, senadoFetch: async () => Response.json([]) });
    const post = (endpoint, body, method = "POST") => fetch(`${app.url}${endpoint}`, { method, headers: { "Content-Type": "application/json", ...importHeaders }, body: JSON.stringify(body) });
    const json = async endpoint => (await fetch(`${app.url}${endpoint}`)).json();
    const existing = app.database.create({ areaTecnica: "Educação", responsavel: "Eduardo Santana", projeto: "PL 999/2026", ementa: "Já preenchido", haParecer: "Sim", sugestaoEmenda: "Não", posicionamento: "Favorável" });
    const search = await json("/api/propositions?siglaTipo=PL&numero=123&ano=2026");
    const selected = await (await post(`/api/propositions/${search.results[0].selectionId}`, { searchToken: search.searchToken })).json();
    const response = await post("/api/import/records", { key: randomUUID(), record: { areaTecnica: "Educação", responsavel: "Eduardo Santana", propositionToken: selected.propositionToken } });
    assert.equal(response.status, 201);
    const { record } = await response.json();
    for (const field of ["haParecer", "sugestaoEmenda", "posicionamento", "prioridade"]) assert.equal(record[field], "N/I", field);
    const query = new URLSearchParams({ haParecer: "N/I", sugestaoEmenda: "N/I", posicionamento: "N/I" });
    assert.deepEqual((await json(`/api/records?${query}`)).records.map(item => item.id), [record.id]);
    const totals = await json(`/api/totals?${query}`);
    assert.equal(totals.total, 1);
    assert.deepEqual(totals.byParecer, [{ label: "N/I", count: 1 }]);
    assert.deepEqual((await json(`/api/filter-options?${query}`)).posicionamentos, ["N/I"]);
    const completed = await post(`/api/records/${record.id}`, { ...record, haParecer: "Em andamento", sugestaoEmenda: "Sim", posicionamento: "Favorável" }, "PUT");
    assert.equal(completed.status, 200);
    const updated = (await completed.json()).record;
    const { history } = await json(`/api/records/${record.id}/history`);
    assert.equal(history[0].before.haParecer, "N/I");
    assert.equal(history[0].after.haParecer, "Em andamento");
    const partial = { areaTecnica: record.areaTecnica, responsavel: record.responsavel, projeto: record.projeto, ementa: record.ementa, revision: updated.revision };
    const compatible = await post(`/api/records/${record.id}`, partial, "PUT");
    assert.equal(compatible.status, 200);
    const retained = (await compatible.json()).record;
    assert.deepEqual([retained.haParecer, retained.sugestaoEmenda, retained.posicionamento], ["Em andamento", "Sim", "Favorável"]);
    const explicit = await post(`/api/records/${record.id}`, { ...retained, haParecer: "N/I", sugestaoEmenda: "N/I", posicionamento: "N/I" }, "PUT");
    assert.equal(explicit.status, 200);
    assert.equal((await explicit.json()).record.posicionamento, "N/I");
    const invalid = await post(`/api/records/${record.id}`, { ...retained, revision: retained.revision + 1, haParecer: "Talvez" }, "PUT");
    assert.equal(invalid.status, 422);
    assert.deepEqual(app.database.get(existing.id), existing, "registros preenchidos não são reclassificados");
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("importação valida no servidor, não grava na prévia e reenvio é idempotente inclusive após reinício", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-import-"));
  const options = { port: 0, hostname: "127.0.0.1", databasePath: path.join(directory, "test.sqlite"), tramitationCheckDelayMs: null, camaraFetch: mockFetch, senadoFetch: async () => Response.json([]) };
  let app = await startServer(options);
  const json = (url, body) => fetch(`${app.url}${url}`, { method: "POST", headers: { "Content-Type": "application/json", ...importHeaders }, body: JSON.stringify(body) });
  try {
    const preview = await fetch(`${app.url}/api/import/preview`, { method: "POST", headers: { "X-File-Name": "lista.csv", ...importHeaders }, body: "Projeto;Parecer elaborado\nPL 123/2026;Sim" });
    assert.equal(preview.status, 200);
    assert.equal(app.database.list().length, 0);
    const search = await (await fetch(`${app.url}/api/propositions?siglaTipo=PL&numero=123&ano=2026`)).json();
    const selection = await (await json(`/api/propositions/${search.results[0].selectionId}`, { searchToken: search.searchToken })).json();
    const input = { areaTecnica: "Central de Dados", responsavel: "Luidy Santos", haParecer: "Sim", sugestaoEmenda: "Não", posicionamento: "Favorável", propositionToken: selection.propositionToken };
    const key = randomUUID();
    assert.equal((await json("/api/import/records", { key, record: { ...input, haParecer: "Talvez" } })).status, 422);
    assert.equal((await json("/api/import/records", { key, record: { ...input, responsavel: "Eduardo Santana" } })).status, 422);
    assert.equal((await json("/api/import/records", { key: "inválida", record: input })).status, 400);
    assert.equal(app.database.list().length, 0);
    const results = await Promise.all([json("/api/import/records", { key, record: input }), json("/api/import/records", { key, record: input })]);
    assert.deepEqual(results.map(response => response.status).sort(), [200, 201]);
    const record = (await results[0].json()).record;
    assert.equal(record.prioridade, "N/I", "importações sem prioridade continuam válidas");
    assert.equal(record.ementa, "Ementa oficial de teste"); assert.equal(record.projeto, "PL 123/2026");
    assert.equal(app.database.list().length, 1); assert.equal(app.database.history(record.id).length, 1);
    assert.equal((await json("/api/import/records", { key: randomUUID(), record: input })).status, 409);
    assert.equal((await json("/api/import/records", { key, record: { ...input, posicionamento: "Desfavorável" } })).status, 409);
    const badDocument = new FormData(); badDocument.append("file", new Blob(["Documento de teste"]), "teste.txt");
    assert.equal((await fetch(`${app.url}/api/records/${record.id}/attachments`, { method: "POST", body: badDocument })).status, 422);
    assert.equal(app.database.get(record.id).attachments.length, 0);
    const document = new FormData(); document.append("file", new Blob(["Documento de teste"]), "teste.txt"); document.append("title", "Análise"); document.append("description", "Documento importado para teste.");
    const uploadKey = randomUUID();
    assert.equal((await fetch(`${app.url}/api/records/${record.id}/attachments`, { method: "POST", headers: { "X-Upload-Id": uploadKey }, body: document })).status, 201);
    assert.equal((await fetch(`${app.url}/api/records/${record.id}/attachments`, { method: "POST", headers: { "X-Upload-Id": uploadKey }, body: document })).status, 200);
    assert.equal(app.database.get(record.id).attachments.length, 1);
    const revisionWithDocument = app.database.get(record.id).revision;
    await app.close(); app = await startServer(options);
    const replay = await json("/api/import/records", { key, record: input });
    assert.equal(replay.status, 200); assert.equal((await replay.json()).record.id, record.id);
    assert.equal(app.database.list()[0].revision, revisionWithDocument);
    assert.equal(app.database.list()[0].attachments.length, 1);
    app.database.remove(record.id, revisionWithDocument);
    assert.equal((await json("/api/import/records", { key, record: input })).status, 409);
    assert.equal(app.database.list().length, 0);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
