import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { startServer } from "../server.js";

test("API reutiliza cache completo por até 24 horas, permite atualização e não reutiliza falha parcial", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-30T18:00:00Z") });
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-official-cache-"));
  let app, calls = 0, version = 1, senateDown = false;
  const provider = async input => {
    const url = new URL(input); calls++;
    if (url.hostname.includes("senado")) { if (senateDown) throw new Error("Senado indisponível para teste"); return Response.json([]); }
    if (/\/(autores|tramitacoes)$/.test(url.pathname)) return Response.json({ dados: [] });
    const number = Number(url.searchParams.get("numero") || url.pathname.split("/").at(-1));
    const data = { id: number, siglaTipo: "PL", numero: number, ano: 2026, ementa: `Versão ${version}`, statusProposicao: {} };
    return Response.json({ dados: url.pathname.endsWith("/proposicoes") ? [data] : data });
  };
  try {
    app = await startServer({ port: 0, databasePath: path.join(directory, "records.sqlite"), tramitationCheckDelayMs: null, camaraFetch: provider, senadoFetch: provider,
      officialRequestLimits: { camara: { requestsPerSecond: 1000, maxConcurrent: 3 }, senado: { requestsPerSecond: 1000, maxConcurrent: 3 } } });
    const search = async (number, refresh = false) => (await fetch(`${app.url}/api/propositions?siglaTipo=PL&numero=${number}&ano=2026${refresh ? "&refresh=1" : ""}`)).json();
    assert.equal((await search(9901)).cached, false);
    const coldCalls = calls;
    assert.equal((await search(9901)).cached, true);
    assert.equal(calls, coldCalls);
    version = 2;
    const fresh = await search(9901, true);
    assert.equal(fresh.cached, false); assert.equal(fresh.results[0].ementa, "Versão 2"); assert.ok(calls > coldCalls);
    const refreshedCalls = calls;
    t.mock.timers.tick(24 * 60 * 60 * 1000 - 1);
    assert.equal((await search(9901)).cached, true); assert.equal(calls, refreshedCalls);
    t.mock.timers.tick(2);
    assert.equal((await search(9901)).cached, false); assert.ok(calls > refreshedCalls);
    senateDown = true;
    const partial = await search(9902);
    assert.ok(partial.warnings.length > 0); assert.equal(partial.requiresSelection, true);
    const partialCalls = calls;
    assert.equal((await search(9902)).cached, false); assert.ok(calls > partialCalls);
    senateDown = false;
    assert.equal((await search(9902)).cached, false);
    const recoveredCalls = calls;
    assert.equal((await search(9902)).cached, true); assert.equal(calls, recoveredCalls);
  } finally { if (app) await app.close(); t.mock.timers.reset(); await rm(directory, { recursive: true, force: true }); }
});
