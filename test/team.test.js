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

test("diretório inclui a planilha e todos os consultores da lista anterior", () => {
  assert.equal(parameters.areasTecnicas.length, 44);
  assert.equal(parameters.responsaveis.length, 168);
  assert.equal(Object.values(parameters.responsaveisPorArea).flat().length, 168);
  assert.equal(parameters.responsaveisPorArea.Consultor.length, 35);
  assert.ok(responsibleOptions("Consultor", parameters).includes("Arthur Trindade"));
  assert.ok(responsibleOptions("Consultor", parameters).includes("Valtuir Nunes"));
  assert.equal(canonicalResponsible("Arthur Trindade (Consultor)", parameters), "Arthur Trindade");
  assert.equal(assignmentIssue({ areaTecnica: "Consultor", responsavel: "Arthur Trindade (Consultor)" }, parameters), null);
  assert.deepEqual(parameters.responsaveisPorArea["Central de Dados"], ["Isaac Lacerda", "Jhonatan Pires", "João Krebs", "Luidy Santos"]);
  assert.deepEqual(parameters.responsaveisPorArea.Educação, ["Eduardo Santana", "Zacarias Sousa"]);
  assert.equal(responsibleOptions("Educação", parameters).length, 37);
  assert.equal(canonicalArea(" Assistencia   Social ", parameters), "Assistência Social");
  assert.equal(canonicalArea("Pré Atendimento", parameters), "Pré-Atendimento");
  assert.equal(canonicalArea("Saneamento", parameters), "Sustentabilidade");
  assert.equal(canonicalArea("Planej. Territ.  e Habitação", parameters), "Planejamento Territorial e Habitação");
  assert.equal(assignmentIssue({ areaTecnica: "Saneamento", responsavel: "Beatriz Silva (Colaborador)" }, parameters), null);
  assert.equal(assignmentIssue({ areaTecnica: "Planej. Territ.  e Habitação", responsavel: "Jordan Cabral (Colaborador)" }, parameters), null);
  assert.equal(canonicalResponsible(" Carlos Silva  (Colaborador)", parameters), "Carlos Silva");
  assert.notEqual(canonicalArea("Finanças", parameters), "Finanças e Tributação");
  assert.equal(assignmentIssue({ areaTecnica: "Educação", responsavel: "Eduardo Santana (Colaborador)" }, parameters), null);
});

test("trocar área limpa responsável incompatível sem escolher outra pessoa automaticamente", () => {
  assert.equal(retainedResponsible("Educação", "Eduardo Santana", parameters), "Eduardo Santana");
  assert.equal(retainedResponsible("Central de Dados", "Eduardo Santana", parameters), "");
  assert.equal(retainedResponsible("", "Eduardo Santana", parameters), "");
  assert.equal(retainedResponsible("não existe", "Eduardo Santana", parameters), "");
  assert.equal(retainedResponsible("Estudos Técnicos", "Carlos Silva (Colaborador)", parameters), "Carlos Silva");
  assert.equal(retainedResponsible("Educação", "Arthur Trindade (Consultor)", parameters), "Arthur Trindade");
  assert.equal(retainedResponsible("Saúde", "Arthur Trindade", parameters), "Arthur Trindade");
  assert.equal(retainedResponsible("Finanças", "Eudes Sippel (Consultor)", parameters), "Eudes Sippel");
  assert.equal(retainedResponsible("não existe", "Arthur Trindade", parameters), "");
});

test("servidor bloqueia área inexistente, nome inexistente e vínculo incorreto", () => {
  const db = createDatabase(":memory:");
  try {
    assert.throws(() => db.create({ ...fields, responsavel: "Beatriz Silva" }), error => error.fields?.responsavel === "Selecione o responsável desta área.");
    assert.throws(() => db.create({ ...fields, areaTecnica: "Finanças" }), error => Boolean(error.fields?.areaTecnica));
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
  db.setAttachment(first.id, { name: "parecer.pdf", storedName: "fixture.pdf", mime: "application/pdf", size: 5 });
  db.close();
  const raw = new DatabaseSync(databasePath);
  raw.prepare("UPDATE records SET responsavel = ? WHERE id = ?").run("Beatriz Silva (Colaborador)", first.id);
  raw.prepare("UPDATE records SET area_tecnica = ?, responsavel = ? WHERE id = ?").run("Finanças", "Alex Carneiro (Colaborador)", second.id);
  raw.prepare("UPDATE records SET responsavel = ? WHERE id = ?").run("Zacarias Sousa (Colaborador)", third.id);
  raw.close();
  return { directory, databasePath, first, second, third };
}

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
    assert.ok(db.filterOptions({ areaTecnica: "Educação", responsavel: "Zacarias Sousa" }).areasTecnicas.includes("Finanças"));
    assert.equal(db.list({ responsavel: "Zacarias Sousa" })[0].id, fixture.third.id);
    assert.ok(db.filterOptions().areasTecnicas.includes("Finanças"));
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

test("consultores podem atuar em qualquer área reconhecida, sem liberar áreas ou colaboradores incorretos", () => {
  for (const area of [...parameters.areasTecnicas, ...parameters.legacyAreasTecnicas]) {
    for (const name of parameters.responsaveisPorArea.Consultor) {
      assert.equal(assignmentIssue({ areaTecnica: area, responsavel: `${name} (Consultor)` }, parameters), null);
    }
  }
  assert.equal(validAssignmentArea("Finanças", "Eudes Sippel", parameters), true);
  assert.equal(validAssignmentArea("Finanças", "Alex Carneiro", parameters), false);
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
    const consultant = db.create({ ...fields, responsavel: "Arthur Trindade", projeto: "PL 103/2026" });
    const legacyConsultant = db.create({ ...fields, areaTecnica: "Finanças", responsavel: "Eudes Sippel", projeto: "PL 104/2026" });
    db.setAttachment(sustainability.id, { name: "parecer.pdf", storedName: "fixture.pdf", mime: "application/pdf", size: 5 });
    const revision = db.get(sustainability.id).revision;
    const history = db.history(sustainability.id).length;
    db.close();
    db = null;
    const raw = new DatabaseSync(databasePath);
    try {
      raw.prepare("UPDATE records SET area_tecnica = ?, responsavel = ? WHERE id = ?").run("Saneamento", "Beatriz Silva (Colaborador)", sustainability.id);
      raw.prepare("UPDATE records SET area_tecnica = ?, responsavel = ? WHERE id = ?").run("Planej. Territ.  e Habitação", "Jordan Cabral (Colaborador)", planning.id);
      raw.prepare("UPDATE records SET responsavel = ? WHERE id = ?").run("Arthur Trindade (Consultor)", consultant.id);
      raw.prepare("UPDATE records SET responsavel = ? WHERE id = ?").run("Eudes Sippel (Consultor)", legacyConsultant.id);
    } finally { raw.close(); }
    db = createDatabase(databasePath);
    for (const saved of [sustainability, current, planning, consultant, legacyConsultant]) assert.equal(db.get(saved.id).assignmentIssue, null);
    assert.equal(db.get(sustainability.id).areaTecnica, "Sustentabilidade");
    assert.equal(db.get(planning.id).areaTecnica, "Planejamento Territorial e Habitação");
    assert.equal(db.get(consultant.id).areaTecnica, "Educação");
    assert.equal(db.get(legacyConsultant.id).areaTecnica, "Finanças");
    assert.equal(db.get(legacyConsultant.id).responsavel, "Eudes Sippel");
    assert.equal(db.get(sustainability.id).revision, revision);
    assert.equal(db.history(sustainability.id).length, history);
    assert.equal(db.get(sustainability.id).attachments[0].name, "parecer.pdf");
    assert.equal(db.list({ areaTecnica: "Sustentabilidade" }).length, 2);
    assert.equal(db.list({ areaTecnica: "Saneamento" }).length, 2);
    assert.equal(db.list({ areaTecnica: "Planejamento Territorial e Habitação" })[0].id, planning.id);
    assert.deepEqual(db.filterOptions({ areaTecnica: "Educação" }).responsaveis, ["Arthur Trindade"]);
    assert.deepEqual(db.filterOptions({ areaTecnica: "Finanças" }).responsaveis, ["Eudes Sippel"]);
    assert.ok(!db.filterOptions().areasTecnicas.includes("Saneamento"));
    assert.equal(db.totals().total, 5);
    assert.equal(db.totals().byArea.find(item => item.label === "Sustentabilidade").count, 2);
    const updated = db.update(legacyConsultant.id, { ...db.get(legacyConsultant.id), haParecer: "Sim" });
    assert.equal(updated.areaTecnica, "Finanças");
    assert.equal(updated.responsavel, "Eudes Sippel");
    assert.equal(updated.assignmentIssue, null);
    const corrected = db.update(sustainability.id, { ...db.get(sustainability.id), haParecer: "Sim" });
    assert.equal(corrected.areaTecnica, "Sustentabilidade");
    assert.equal(corrected.attachments.length, 1);
  } finally { db?.close(); await rm(directory, { recursive: true, force: true }); }
});
