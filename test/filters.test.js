import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../server.js";

test("filtros aceitam várias opções por campo e combinam campos nas listas, totais e exportação", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-checkbox-filters-"));
  let app;
  try {
    app = await startServer({ port: 0, databasePath: path.join(directory, "records.sqlite"), tramitationCheckDelayMs: null });
    const samples = [
      ["Educação", "Eduardo Santana", "Alta", "Sim", "Sim", "Favorável"],
      ["Educação", "Eduardo Santana", "Média", "Não", "Não", "Desfavorável"],
      ["Finanças e Tributação", "Alex Carneiro", "Baixa", "Em andamento", "Sim", "Indiferente"],
      ["Finanças e Tributação", "Alex Carneiro", "Alta", "Não", "Não", "Favorável"],
      ["Cultura", "Jaqueline Silva", "N/I", "Sim", "Não", "Indiferente"]
    ];
    const ids = samples.map(([areaTecnica, responsavel, prioridade, haParecer, sugestaoEmenda, posicionamento], index) => app.database.create({
      areaTecnica, responsavel, prioridade, haParecer, sugestaoEmenda, posicionamento, projeto: `PL ${index + 1}/2026`, ementa: "Teste dos filtros"
    }).id);
    const json = async endpoint => (await fetch(`${app.url}${endpoint}`)).json();
    const selection = new URLSearchParams([
      ["prioridade", "Alta"], ["prioridade", "Média"], ["areaTecnica", "Educação"], ["areaTecnica", "Finanças e Tributação"]
    ]);
    assert.deepEqual(new Set((await json(`/api/records?${selection}`)).records.map(record => record.id)), new Set([ids[0], ids[1], ids[3]]));
    const totals = await json(`/api/totals?${selection}`);
    assert.equal(totals.total, 3);
    assert.equal(totals.overallTotal, 5);
    assert.equal(totals.uniqueProjects, 3);
    const fields = [
      ["responsavel", ["Eduardo Santana", "Alex Carneiro"], 4],
      ["haParecer", ["Sim", "Em andamento"], 3],
      ["sugestaoEmenda", ["Sim", "Não"], 5],
      ["posicionamento", ["Favorável", "Indiferente"], 4],
      ["prioridade", ["Média", "N/I"], 2]
    ];
    for (const [field, values, count] of fields) {
      const query = new URLSearchParams(values.map(value => [field, value]));
      assert.equal((await json(`/api/records?${query}`)).count, count, field);
      assert.equal((await json(`/api/totals?${query}`)).total, count, field);
    }
    const options = await json(`/api/filter-options?${selection}`);
    assert.deepEqual(new Set(options.responsaveis), new Set(["Eduardo Santana", "Alex Carneiro"]));
    assert.deepEqual(new Set(options.prioridades), new Set(["Alta", "Média", "Baixa"]));
    selection.append("responsavel", "Eduardo Santana");
    assert.equal((await json(`/api/records?${selection}`)).count, 2);
    selection.append("responsavel", "Alex Carneiro");
    assert.equal((await json(`/api/records?${selection}`)).count, 3);
    selection.append("q", "PL 4/2026");
    assert.deepEqual((await json(`/api/records?${selection}`)).records.map(record => record.id), [ids[3]]);
    selection.delete("q");
    const csvResponse = await fetch(`${app.url}/api/export.csv?${selection}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.EXPORT_PASSWORD || "CentralDeDados2026" })
    });
    assert.equal(csvResponse.status, 200);
    const csv = await csvResponse.text();
    assert.match(csv, /PL 1\/2026/);
    assert.match(csv, /PL 2\/2026/);
    assert.match(csv, /PL 4\/2026/);
    assert.doesNotMatch(csv, /PL 3\/2026|PL 5\/2026/);
    assert.equal((await json("/api/records?prioridade=Alta")).count, 2, "consulta antiga com valor único permanece compatível");
    assert.equal((await json("/api/records?prioridade=Alta&prioridade=Alta&prioridade=")).count, 2, "repetições e vazios não alteram o resultado");
    assert.equal((await json("/api/records?prioridade=Alta&prioridade=Urgente")).count, 2, "valores desconhecidos não ampliam o filtro");
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
