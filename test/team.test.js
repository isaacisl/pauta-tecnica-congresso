import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parameters } from "../lib/parameters.js";
import { createDatabase } from "../lib/database.js";
import { startServer } from "../server.js";
import { canonicalArea, canonicalResponsible, responsibleOptions, retainedResponsible, validAssignmentArea, assignmentIssue } from "../public/team-utils.js";

const fields = { areaTecnica: "Educação", responsavel: "Eduardo Santana", projeto: "PL 100/2026", ementa: "Teste", atualComissao: "", haParecer: "Não", sugestaoEmenda: "Não", posicionamento: "Favorável" };

test("diretório distribui consultores por área e inclui Políticas sobre Drogas", () => {
  assert.deepEqual(responsibleOptions("Políticas sobre Drogas", parameters), ["Vitória Jadallah"]);
  assert.ok(!responsibleOptions("Assistência Social", parameters).includes("Vitória Jadallah"));
  assert.equal(parameters.areasTecnicas.length, 46);
  assert.equal(parameters.responsaveis.length, 173);
  assert.equal(Object.values(parameters.responsaveisPorArea).flat().length, 174);
  assert.ok(!parameters.areasTecnicas.includes("Consultor"));
  assert.deepEqual(responsibleOptions("Consultor", parameters), []);
  assert.ok(responsibleOptions("Segurança Pública", parameters).includes("Arthur Trindade"));
  assert.ok(responsibleOptions("Obras, Transferências e Parcerias", parameters).includes("Valtuir Nunes"));
  assert.ok(responsibleOptions("Previdência", parameters).includes("Nancy de Andrade"));
  assert.ok(responsibleOptions("Desenvolvimento Rural", parameters).includes("Mário Nascimento"));
  assert.ok(responsibleOptions("Turismo", parameters).includes("Mário Nascimento"));
  for (const name of ["Pedro Passos", "Roberto Siegmann", "Nancy Ramos", "Rafael Correa"]) {
    assert.ok(!parameters.responsaveis.includes(name));
  }
  assert.equal(canonicalResponsible("Arthur Trindade (Consultor)", parameters), "Arthur Trindade");
  assert.equal(assignmentIssue({ areaTecnica: "Segurança Pública", responsavel: "Arthur Trindade (Consultor)" }, parameters), null);
  assert.deepEqual(parameters.responsaveisPorArea["Central de Dados"], ["Isaac Lacerda", "Jhonatan Pires", "João Krebs", "Luidy Santos", "Valdery Brito"]);
  assert.deepEqual(responsibleOptions("Educação", parameters), ["Eduardo Santana", "Mariza Abreu", "Zacarias Sousa"]);
  assert.equal(canonicalArea(" Assistencia   Social ", parameters), "Assistência Social");
  assert.equal(canonicalArea("Pré Atendimento", parameters), "Pré-Atendimento");
  assert.equal(canonicalArea("Saneamento", parameters), "Sustentabilidade");
  assert.equal(canonicalArea("Planej. Territ.  e Habitação", parameters), "Planejamento Territorial e Habitação");
  assert.equal(assignmentIssue({ areaTecnica: "Saneamento", responsavel: "Beatriz Silva (Colaborador)" }, parameters), null);
  assert.equal(assignmentIssue({ areaTecnica: "Planej. Territ.  e Habitação", responsavel: "Jordan Cabral (Colaborador)" }, parameters), null);
  assert.equal(canonicalResponsible(" Carlos Silva  (Colaborador)", parameters), "Carlos Silva");
  assert.equal(assignmentIssue({ areaTecnica: "Educação", responsavel: "Eduardo Santana (Colaborador)" }, parameters), null);
});

test("nomes e áreas confirmados reconhecem formas antigas sem criar pessoas diferentes", () => {
  assert.equal(canonicalResponsible(" Rafael Correa (Consultor) ", parameters), "José Rafael Correa");
  assert.equal(canonicalResponsible("NANCY RAMOS", parameters), "Nancy de Andrade");
  assert.equal(canonicalResponsible("Pedro Passos (Consultor)", parameters), "Pedro Passos");
  for (const [oldArea, currentArea] of [
    ["Consórcios Públicos", "Consórcios"], ["Finanças", "Finanças e Tributação"],
    ["Jurídico", "Jurídico Técnico"], ["Obras", "Obras, Transferências e Parcerias"],
    ["Orçamento Público", "Orçamento"]
  ]) assert.equal(canonicalArea(oldArea, parameters), currentArea);
  const existing = { areaTecnica: "Educação", responsavel: "Pedro Passos (Consultor)" };
  assert.ok(!responsibleOptions("Educação", parameters).includes("Pedro Passos"));
  assert.ok(responsibleOptions("Educação", parameters, existing).includes("Pedro Passos"));
  assert.equal(assignmentIssue(existing, parameters), null);
});

test("consultor com duas áreas exige escolha explícita quando o vínculo antigo é ambíguo", () => {
  const existing = { areaTecnica: "Consultor", responsavel: "Mário Nascimento" };
  assert.deepEqual(assignmentIssue(existing, parameters)?.fields, ["areaTecnica", "responsavel"]);
  assert.deepEqual(responsibleOptions("Consultor", parameters, existing), []);
  assert.ok(!responsibleOptions("Educação", parameters, { ...existing, areaTecnica: "Educação" }).includes("Mário Nascimento"));
  assert.equal(retainedResponsible("Desenvolvimento Rural", "Mário Nascimento", parameters, existing), "Mário Nascimento");
  assert.equal(retainedResponsible("Turismo", "Mário Nascimento", parameters, existing), "Mário Nascimento");
  assert.equal(assignmentIssue({ ...existing, areaTecnica: "Turismo" }, parameters), null);
});

test("trocar área limpa responsável incompatível sem escolher outra pessoa automaticamente", () => {
  assert.equal(retainedResponsible("Educação", "Eduardo Santana", parameters), "Eduardo Santana");
  assert.equal(retainedResponsible("Central de Dados", "Eduardo Santana", parameters), "");
  assert.equal(retainedResponsible("", "Eduardo Santana", parameters), "");
  assert.equal(retainedResponsible("não existe", "Eduardo Santana", parameters), "");
  assert.equal(retainedResponsible("Estudos Técnicos", "Carlos Silva (Colaborador)", parameters), "Carlos Silva");
  const existing = { areaTecnica: "Educação", responsavel: "Arthur Trindade (Consultor)" };
  assert.equal(retainedResponsible("Educação", "Arthur Trindade (Consultor)", parameters), "");
  assert.equal(retainedResponsible("Educação", "Arthur Trindade (Consultor)", parameters, existing), "Arthur Trindade");
  assert.equal(retainedResponsible("Saúde", "Arthur Trindade", parameters, existing), "");
  assert.equal(retainedResponsible("Consultor", "Arthur Trindade", parameters, existing), "");
  assert.equal(retainedResponsible("Segurança Pública", "Arthur Trindade", parameters, existing), "Arthur Trindade");
  assert.equal(retainedResponsible("Finanças", "Eudes Sippel (Consultor)", parameters, { areaTecnica: "Finanças", responsavel: "Eudes Sippel" }), "Eudes Sippel");
  assert.equal(retainedResponsible("não existe", "Arthur Trindade", parameters), "");
});

test("servidor bloqueia área inexistente, nome inexistente e vínculo incorreto", () => {
  const db = createDatabase(":memory:");
  try {
    assert.throws(() => db.create({ ...fields, responsavel: "Beatriz Silva" }), error => error.fields?.responsavel === "Selecione o responsável desta área.");
    assert.throws(() => db.create({ ...fields, areaTecnica: "Área inexistente" }), error => Boolean(error.fields?.areaTecnica));
    assert.throws(() => db.create({ ...fields, areaTecnica: "Consultor", responsavel: "Arthur Trindade" }), error => Boolean(error.fields?.responsavel));
    assert.throws(() => db.create({ ...fields, responsavel: "Pedro Passos" }), error => Boolean(error.fields?.responsavel));
    assert.throws(() => db.create({ ...fields, responsavel: "Não existe" }), error => Boolean(error.fields?.responsavel));
    assert.throws(() => db.create({ ...fields, responsavel: "" }), error => Boolean(error.fields?.responsavel));
    const saved = db.create({ ...fields, responsavel: "Eduardo Santana (Colaborador)" });
    assert.equal(saved.responsavel, "Eduardo Santana");
    assert.equal(saved.assignmentIssue, null);
    assert.throws(() => db.update(saved.id, { ...saved, areaTecnica: "Central de Dados" }), error => Boolean(error.fields?.responsavel));
    assert.equal(db.get(saved.id).areaTecnica, "Educação");
  } finally { db.close(); }
});

async function legacyFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-team-test-"));
  const databasePath = path.join(directory, "test.sqlite");
  const db = createDatabase(databasePath);
  const first = db.create(fields);
  const second = db.create({ ...fields, areaTecnica: "Central de Dados", responsavel: "Luidy Santos", projeto: "PL 200/2026" });
  const third = db.create({ ...fields, responsavel: "Zacarias Sousa", projeto: "PL 300/2026" });
  db.setAttachment(first.id, { name: "parecer.pdf", storedName: "fixture.pdf", mime: "application/pdf", size: 5, title: "Documento", description: "Documento de teste" });
  db.close();
  const raw = new DatabaseSync(databasePath);
  raw.prepare("UPDATE records SET responsavel = ? WHERE id = ?").run("Beatriz Silva (Colaborador)", first.id);
  raw.prepare("UPDATE records SET area_tecnica = ?, responsavel = ? WHERE id = ?").run("Área antiga", "Alex Carneiro (Colaborador)", second.id);
  raw.prepare("UPDATE records SET responsavel = ? WHERE id = ?").run("Zacarias Sousa (Colaborador)", third.id);
  raw.close();
  return { directory, databasePath, first, second, third };
}

test("reinício transfere acompanhamentos antigos pela API com histórico, documentos e proteção de revisão", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-team-migration-"));
  const databasePath = path.join(directory, "test.sqlite");
  let app;
  try {
    const db = createDatabase(databasePath);
    const rows = Array.from({ length: 6 }, (_, index) => db.create({ ...fields, projeto: `PL ${700 + index}/2026` }));
    db.setAttachment(rows[0].id, { name: "parecer.pdf", storedName: "fixture.pdf", mime: "application/pdf", size: 5, title: "Parecer", description: "Preservar documento" });
    const oldRevision = db.get(rows[0].id).revision;
    db.remove(rows[5].id, rows[5].revision);
    db.close();
    const raw = new DatabaseSync(databasePath);
    const oldAssignments = [
      ["Central de Dados", "Nancy Ramos (Consultor)"], ["Consultor", "Caroline Hoss"],
      ["Transporte e Mobilidade", "Elena Garrido (Consultor)"], ["Assistência Social", "Vitória Jadallah"],
      ["Contabilidade", "Pedro Passos (Consultor)"], ["Transporte e Mobilidade", "Denilson Magalhães"]
    ];
    for (const [index, [area, name]] of oldAssignments.entries()) {
      raw.prepare("UPDATE records SET area_tecnica = ?, responsavel = ? WHERE id = ?").run(area, name, rows[index].id);
    }
    raw.exec("CREATE TABLE IF NOT EXISTS directory_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    raw.prepare("DELETE FROM directory_migrations WHERE name = ?").run("consultant-areas-2026-11");
    raw.close();
    app = await startServer({ port: 0, databasePath, tramitationCheckDelayMs: null });
    const record = (await (await fetch(`${app.url}/api/records/${rows[0].id}`)).json()).record;
    assert.equal(record.areaTecnica, "Previdência");
    assert.equal(record.responsavel, "Nancy de Andrade");
    assert.equal(record.revision, oldRevision + 1);
    assert.equal(record.createdAt, rows[0].createdAt);
    assert.equal(record.attachments[0].title, "Parecer");
    assert.equal(record.haParecer, "Não");
    const history = (await (await fetch(`${app.url}/api/records/${record.id}/history`)).json()).history;
    const transfer = history.find(entry => entry.before?.responsavel === "Nancy Ramos (Consultor)");
    assert.equal(transfer.before.areaTecnica, "Central de Dados");
    assert.equal(transfer.after.areaTecnica, "Previdência");
    const records = (await (await fetch(`${app.url}/api/records`)).json()).records;
    assert.equal(records.find(row => row.id === rows[1].id).areaTecnica, "Sustentabilidade");
    assert.equal(records.find(row => row.id === rows[2].id).areaTecnica, "Jurídico Técnico");
    assert.equal(records.find(row => row.id === rows[3].id).areaTecnica, "Políticas sobre Drogas");
    const retired = records.find(row => row.id === rows[4].id);
    assert.equal(retired.areaTecnica, "Contabilidade");
    assert.equal(retired.assignmentIssue, null);
    const editRetired = await fetch(`${app.url}/api/records/${retired.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...retired, haParecer: "Sim" }) });
    assert.equal(editRetired.status, 200);
    const trash = (await (await fetch(`${app.url}/api/trash`)).json()).records;
    assert.equal(trash[0].areaTecnica, "Saúde");
    const filters = await (await fetch(`${app.url}/api/filter-options?areaTecnica=${encodeURIComponent("Previdência")}`)).json();
    assert.deepEqual(filters.responsaveis, ["Nancy de Andrade"]);
    const staleEdit = await fetch(`${app.url}/api/records/${record.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...record, revision: oldRevision }) });
    assert.equal(staleEdit.status, 409);
    await app.close();
    app = await startServer({ port: 0, databasePath, tramitationCheckDelayMs: null });
    const reopened = (await (await fetch(`${app.url}/api/records/${record.id}`)).json()).record;
    assert.equal(reopened.revision, record.revision);
    assert.equal((await (await fetch(`${app.url}/api/records/${record.id}/history`)).json()).history.length, history.length);
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("pendências antigas são calculadas sem mudar banco, revisões, documentos ou histórico", async () => {
  const fixture = await legacyFixture();
  const db = createDatabase(fixture.databasePath);
  try {
    const invalid = db.get(fixture.first.id);
    assert.deepEqual(invalid.assignmentIssue.fields, ["responsavel"]);
    assert.equal(invalid.assignmentIssue.previousResponsible, "Beatriz Silva (Colaborador)");
    assert.equal(invalid.attachments[0].name, "parecer.pdf");
    assert.deepEqual(db.get(fixture.second.id).assignmentIssue.fields, ["areaTecnica", "responsavel"]);
    assert.equal(db.get(fixture.third.id).assignmentIssue, null);
    assert.equal(db.totals().total, 3);
    assert.deepEqual(db.filterOptions({ areaTecnica: "Educação" }).responsaveis, ["Zacarias Sousa"]);
    assert.equal(db.list({ areaTecnica: "Educação" }).length, 2);
    assert.ok(db.filterOptions({ areaTecnica: "Educação", responsavel: "Zacarias Sousa" }).areasTecnicas.includes("Área antiga"));
    assert.equal(db.list({ responsavel: "Zacarias Sousa" })[0].id, fixture.third.id);
    assert.ok(db.filterOptions().areasTecnicas.includes("Área antiga"));
    const raw = new DatabaseSync(fixture.databasePath, { readOnly: true });
    assert.equal(raw.prepare("SELECT responsavel FROM records WHERE id = ?").get(fixture.first.id).responsavel, "Beatriz Silva (Colaborador)");
    assert.equal(raw.prepare("SELECT revision FROM records WHERE id = ?").get(fixture.third.id).revision, fixture.third.revision);
    raw.close();
    const historyLength = db.history(invalid.id).length;
    const corrected = db.update(invalid.id, { ...invalid, responsavel: "Eduardo Santana" });
    assert.equal(corrected.assignmentIssue, null);
    assert.equal(corrected.revision, invalid.revision + 1);
    assert.equal(corrected.attachments.length, 1);
    assert.equal(db.history(invalid.id).length, historyLength + 1);
    assert.equal(db.totals().total, 3);
  } finally { db.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("API expõe pendência, limita filtros por área e permite corrigir sem pesquisar projeto novamente", async () => {
  const fixture = await legacyFixture();
  const app = await startServer({ port: 0, databasePath: fixture.databasePath, tramitationCheckDelayMs: null });
  try {
    const endpoint = `${app.url}/api/records/${fixture.first.id}`;
    const record = (await (await fetch(endpoint)).json()).record;
    assert.ok(record.assignmentIssue);
    const filter = await (await fetch(`${app.url}/api/filter-options?areaTecnica=${encodeURIComponent("Educação")}`)).json();
    assert.deepEqual(filter.responsaveis, ["Zacarias Sousa"]);
    const invalid = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...record, responsavel: "Luidy Santos" }) });
    assert.equal(invalid.status, 422);
    const result = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...record, responsavel: "Eduardo Santana" }) });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).record.assignmentIssue, null);
  } finally { await app.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("nomes antigos não burlam prevenção de acompanhamentos duplicados", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-team-duplicate-"));
  const databasePath = path.join(directory, "test.sqlite");
  const db = createDatabase(databasePath);
  const official = { id: 991, source: "camara", projeto: "PL 991/2026", siglaTipo: "PL", numero: 991, ano: 2026, ementa: "Teste" };
  const saved = db.create({ ...fields, projeto: official.projeto, camara: official, proposition: official });
  db.close();
  const raw = new DatabaseSync(databasePath);
  raw.prepare("UPDATE records SET responsavel = ? WHERE id = ?").run("Eduardo Santana (Colaborador)", saved.id);
  raw.close();
  const reopened = createDatabase(databasePath);
  try {
    assert.throws(() => reopened.create({ ...fields, projeto: official.projeto, camara: official, proposition: official }), error => error.status === 409);
  } finally { reopened.close(); await rm(directory, { recursive: true, force: true }); }
});

test("listas por área não incluem todos os consultores e preservam somente o vínculo salvo", () => {
  for (const area of [...parameters.areasTecnicas, ...parameters.legacyAreasTecnicas]) {
    for (const name of parameters.consultores.filter(name => name !== "Mário Nascimento")) {
      assert.equal(assignmentIssue({ areaTecnica: area, responsavel: `${name} (Consultor)` }, parameters), null);
    }
  }
  assert.ok(responsibleOptions("Segurança Pública", parameters).includes("Arthur Trindade"));
  assert.ok(!responsibleOptions("Educação", parameters).includes("Arthur Trindade"));
  assert.ok(!responsibleOptions("Segurança Pública", parameters).includes("Eudes Sippel"));
  const existing = { areaTecnica: "Educação", responsavel: "Arthur Trindade (Consultor)" };
  assert.deepEqual(responsibleOptions("Educação", parameters, existing), ["Arthur Trindade", "Eduardo Santana", "Mariza Abreu", "Zacarias Sousa"]);
  assert.deepEqual(responsibleOptions("Central de Dados", parameters, existing), parameters.responsaveisPorArea["Central de Dados"]);
  assert.deepEqual(responsibleOptions("Consultor", parameters), []);
  assert.ok(responsibleOptions("Finanças", parameters).includes("Eudes Sippel"));
  assert.equal(validAssignmentArea("Finanças", "Eudes Sippel", parameters), true);
  assert.equal(validAssignmentArea("Finanças", "Alex Carneiro", parameters), true);
  assert.ok(assignmentIssue({ areaTecnica: "Área inexistente", responsavel: "Arthur Trindade" }, parameters));
  assert.ok(assignmentIssue({ areaTecnica: "Consultor", responsavel: "Alex Carneiro" }, parameters));
  assert.ok(assignmentIssue({ areaTecnica: "Educação", responsavel: "Arthur Trindade Jr." }, parameters));
});

test("áreas renomeadas e consultores antigos são reconhecidos em registros, filtros e totais sem alterar documentos ou histórico", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-team-renames-"));
  const databasePath = path.join(directory, "test.sqlite");
  let db = createDatabase(databasePath);
  try {
    const sustainability = db.create({ ...fields, areaTecnica: "Sustentabilidade", responsavel: "Beatriz Silva" });
    const current = db.create({ ...fields, areaTecnica: "Sustentabilidade", responsavel: "Cláudia Lima", projeto: "PL 101/2026" });
    const planning = db.create({ ...fields, areaTecnica: "Planejamento Territorial e Habitação", responsavel: "Jordan Cabral", projeto: "PL 102/2026" });
    const consultant = db.create({ ...fields, areaTecnica: "Segurança Pública", responsavel: "Arthur Trindade", projeto: "PL 103/2026" });
    const legacyConsultant = db.create({ ...fields, areaTecnica: "Finanças e Tributação", responsavel: "Eudes Sippel", projeto: "PL 104/2026" });
    db.setAttachment(sustainability.id, { name: "parecer.pdf", storedName: "fixture.pdf", mime: "application/pdf", size: 5, title: "Documento", description: "Documento de teste" });
    const revision = db.get(sustainability.id).revision;
    const history = db.history(sustainability.id).length;
    db.close();
    db = null;
    const raw = new DatabaseSync(databasePath);
    try {
      raw.prepare("UPDATE records SET area_tecnica = ?, responsavel = ? WHERE id = ?").run("Saneamento", "Beatriz Silva (Colaborador)", sustainability.id);
      raw.prepare("UPDATE records SET area_tecnica = ?, responsavel = ? WHERE id = ?").run("Planej. Territ.  e Habitação", "Jordan Cabral (Colaborador)", planning.id);
      raw.prepare("UPDATE records SET area_tecnica = ?, responsavel = ? WHERE id = ?").run("Educação", "Arthur Trindade (Consultor)", consultant.id);
      raw.prepare("UPDATE records SET area_tecnica = ?, responsavel = ? WHERE id = ?").run("Finanças", "Eudes Sippel (Consultor)", legacyConsultant.id);
    } finally { raw.close(); }
    db = createDatabase(databasePath);
    for (const saved of [sustainability, current, planning, consultant, legacyConsultant]) assert.equal(db.get(saved.id).assignmentIssue, null);
    assert.equal(db.get(sustainability.id).areaTecnica, "Sustentabilidade");
    assert.equal(db.get(planning.id).areaTecnica, "Planejamento Territorial e Habitação");
    assert.equal(db.get(consultant.id).areaTecnica, "Educação");
    assert.equal(db.get(legacyConsultant.id).areaTecnica, "Finanças e Tributação");
    assert.equal(db.get(legacyConsultant.id).responsavel, "Eudes Sippel");
    assert.equal(db.get(sustainability.id).revision, revision);
    assert.equal(db.history(sustainability.id).length, history);
    assert.equal(db.get(sustainability.id).attachments[0].name, "parecer.pdf");
    assert.equal(db.list({ areaTecnica: "Sustentabilidade" }).length, 2);
    assert.equal(db.list({ areaTecnica: "Saneamento" }).length, 2);
    assert.equal(db.list({ areaTecnica: "Planejamento Territorial e Habitação" })[0].id, planning.id);
    assert.deepEqual(db.filterOptions({ areaTecnica: "Educação" }).responsaveis, ["Arthur Trindade"]);
    assert.deepEqual(db.filterOptions({ areaTecnica: "Finanças" }).responsaveis, ["Eudes Sippel"]);
    assert.throws(() => db.create({ ...fields, responsavel: "Arthur Trindade", projeto: "PL 105/2026" }), error => Boolean(error.fields?.responsavel));
    const existing = db.get(consultant.id);
    assert.throws(() => db.update(consultant.id, { ...existing, responsavel: "Eudes Sippel" }), error => Boolean(error.fields?.responsavel));
    assert.throws(() => db.update(consultant.id, { ...existing, areaTecnica: "Saúde" }), error => Boolean(error.fields?.responsavel));
    assert.equal(db.update(consultant.id, { ...existing, haParecer: "Sim" }).responsavel, "Arthur Trindade");
    assert.ok(!db.filterOptions().areasTecnicas.includes("Saneamento"));
    assert.equal(db.totals().total, 5);
    assert.equal(db.totals().byArea.find(item => item.label === "Sustentabilidade").count, 2);
    const updated = db.update(legacyConsultant.id, { ...db.get(legacyConsultant.id), haParecer: "Sim" });
    assert.equal(updated.areaTecnica, "Finanças e Tributação");
    assert.equal(updated.responsavel, "Eudes Sippel");
    assert.equal(updated.assignmentIssue, null);
    const corrected = db.update(sustainability.id, { ...db.get(sustainability.id), haParecer: "Sim" });
    assert.equal(corrected.areaTecnica, "Sustentabilidade");
    assert.equal(corrected.attachments.length, 1);
  } finally { db?.close(); await rm(directory, { recursive: true, force: true }); }
});
