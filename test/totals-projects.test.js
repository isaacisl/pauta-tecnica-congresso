import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDatabase } from "../lib/database.js";

const base = {
  areaTecnica: "Educação",
  responsavel: "Eduardo Santana",
  projeto: "PL 1234/2026",
  autor: "",
  ementa: "Projeto de teste",
  despacho: "",
  atualComissao: "",
  haParecer: "Não",
  sugestaoEmenda: "Não",
  posicionamento: "Favorável"
};

test("totalização distingue matérias de acompanhamentos e respeita os filtros", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-totais-projetos-"));
  const database = createDatabase(path.join(directory, "registros.sqlite"));
  try {
    const official = { id: 1234, source: "camara", siglaTipo: "PL", numero: 1234, ano: 2026,
      projeto: "PL 1234/2026", ementa: base.ementa, consultadoEm: new Date().toISOString() };
    database.create({ ...base, camara: official, proposition: official });
    database.create({ ...base, areaTecnica: "Finanças e Tributação", responsavel: "Alex Carneiro", camara: official, proposition: official });

    assert.equal(database.totals().total, 2);
    assert.equal(database.totals().uniqueProjects, 1);
    assert.equal(database.totals({ areaTecnica: "Educação" }).uniqueProjects, 1);
    assert.equal(database.totals({ areaTecnica: "Finanças e Tributação" }).uniqueProjects, 1);
    assert.equal(database.totals({ areaTecnica: "Cultura" }).uniqueProjects, 0);

    database.create({ ...base, projeto: "  Projeto Antigo  ", areaTecnica: "Educação" });
    database.create({ ...base, projeto: "projeto   antigo", areaTecnica: "Finanças e Tributação", responsavel: "Alex Carneiro" });
    assert.equal(database.totals().total, 4);
    assert.equal(database.totals().uniqueProjects, 2, "legados de mesmo nome contam uma vez");
    assert.equal(database.totals({ areaTecnica: "Educação" }).total, 2);
    assert.equal(database.totals({ areaTecnica: "Educação" }).uniqueProjects, 2);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
