import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { createDatabase } from "../lib/database.js";
import { startServer } from "../server.js";

test("buscas simultâneas e monitoramento compartilham frequência e concorrência por fonte", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-official-limits-"));
  const file = path.join(directory, "records.sqlite");
  const seed = createDatabase(file);
  const official = { id: 7001, source: "camara", siglaTipo: "PL", numero: 7001, ano: 2026, projeto: "PL 7001/2026", ementa: "Projeto de teste do monitoramento", consultadoEm: new Date().toISOString() };
  seed.create({ areaTecnica: "Educação", responsavel: "Eduardo Santana", projeto: official.projeto, ementa: official.ementa, camara: official, proposition: official });
  seed.close();
  const stats = { camara: { active: 0, peak: 0, starts: [] }, senado: { active: 0, peak: 0, starts: [] } };
  const paths = [];
  const provider = async input => {
    const url = new URL(input), source = url.hostname.includes("senado") ? "senado" : "camara";
    const state = stats[source];
    state.active++; state.peak = Math.max(state.peak, state.active); state.starts.push(performance.now()); paths.push(url.pathname);
    try {
      await new Promise(resolve => setTimeout(resolve, 110));
      if (source === "senado") return Response.json([]);
      if (/\/(autores|tramitacoes)$/.test(url.pathname)) return Response.json({ dados: [] });
      const number = Number(url.searchParams.get("numero") || url.pathname.split("/").at(-1));
      const proposition = { id: number, siglaTipo: "PL", numero: number, ano: 2026, ementa: "Projeto de teste", statusProposicao: {} };
      return Response.json({ dados: url.pathname.endsWith("/proposicoes") ? [proposition] : proposition });
    } finally { state.active--; }
  };
  let app;
  try {
    app = await startServer({ port: 0, databasePath: file, camaraFetch: provider, senadoFetch: provider, tramitationCheckDelayMs: 40,
      officialRequestLimits: { camara: { requestsPerSecond: 20, maxConcurrent: 2 }, senado: { requestsPerSecond: 20, maxConcurrent: 2 } } });
    const responses = await Promise.all([7101, 7102, 7103].map(number => fetch(`${app.url}/api/propositions?siglaTipo=PL&numero=${number}&ano=2026&refresh=1`)));
    assert.ok(responses.every(response => response.status === 200));
    assert.ok(paths.includes("/api/v2/proposicoes/7001/tramitacoes"), "o monitoramento também participa da fila");
    for (const [source, state] of Object.entries(stats)) {
      assert.ok(state.peak <= 2, `${source}: concorrência acima do limite compartilhado`);
      for (let index = 1; index < state.starts.length; index++) assert.ok(state.starts[index] - state.starts[index - 1] >= 47, `${source}: chamadas sem o espaçamento configurado`);
    }
  } finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("uma falha da fonte libera a fila e não bloqueia as demais pesquisas", { timeout: 5000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-official-failure-"));
  let app;
  const provider = async input => {
    const url = new URL(input);
    if (url.hostname.includes("senado")) return Response.json([]);
    if (url.searchParams.get("numero") === "7711") throw new Error("Falha simulada");
    if (/\/(autores|tramitacoes)$/.test(url.pathname)) return Response.json({ dados: [] });
    const number = Number(url.searchParams.get("numero") || url.pathname.split("/").at(-1));
    const data = { id: number, siglaTipo: "PL", numero: number, ano: 2026, ementa: "Teste da fila", statusProposicao: {} };
    return Response.json({ dados: url.pathname.endsWith("/proposicoes") ? [data] : data });
  };
  try {
    app = await startServer({ port: 0, databasePath: path.join(directory, "records.sqlite"), tramitationCheckDelayMs: null, camaraFetch: provider, senadoFetch: provider,
      officialRequestLimits: { camara: { requestsPerSecond: 1000, maxConcurrent: 1 }, senado: { requestsPerSecond: 1000, maxConcurrent: 1 } } });
    const responses = await Promise.all([7711, 7712, 7713].map(number => fetch(`${app.url}/api/propositions?siglaTipo=PL&numero=${number}&ano=2026`)));
    assert.deepEqual(responses.map(response => response.status), [503, 200, 200]);
    assert.equal((await responses[1].json()).results[0].projeto, "PL 7712/2026");
    assert.equal((await responses[2].json()).results[0].projeto, "PL 7713/2026");
  } finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("limite de concorrência inclui o recebimento do corpo da resposta oficial", { timeout: 5000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-official-body-"));
  let app;
  const stats = { camara: { active: 0, peak: 0 }, senado: { active: 0, peak: 0 } };
  const provider = async input => {
    const url = new URL(input), source = url.hostname.includes("senado") ? "senado" : "camara";
    const number = Number(url.searchParams.get("numero") || url.pathname.split("/").at(-1));
    const proposition = { id: number, siglaTipo: "PL", numero: number, ano: 2026, ementa: "Corpo de resposta atrasado", statusProposicao: {} };
    const payload = source === "senado" ? [] : { dados: /\/(autores|tramitacoes)$/.test(url.pathname) ? [] : url.pathname.endsWith("/proposicoes") ? [proposition] : proposition };
    const state = stats[source]; state.active++; state.peak = Math.max(state.peak, state.active);
    return new Response(new ReadableStream({ start(controller) {
      setTimeout(() => { state.active--; controller.enqueue(new TextEncoder().encode(JSON.stringify(payload))); controller.close(); }, 40);
    } }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    app = await startServer({ port: 0, databasePath: path.join(directory, "records.sqlite"), tramitationCheckDelayMs: null, camaraFetch: provider, senadoFetch: provider,
      officialRequestLimits: { camara: { requestsPerSecond: 1000, maxConcurrent: 1 }, senado: { requestsPerSecond: 1000, maxConcurrent: 1 } } });
    const responses = await Promise.all([7801, 7802, 7803].map(number => fetch(`${app.url}/api/propositions?siglaTipo=PL&numero=${number}&ano=2026`)));
    assert.ok(responses.every(response => response.status === 200));
    assert.equal(stats.camara.peak, 1);
    assert.equal(stats.senado.peak, 1);
  } finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("cancelar a busca HTTP remove chamadas ainda aguardando nas filas oficiais", { timeout: 6000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-official-abort-"));
  let app, announceStart;
  const started = new Promise(resolve => announceStart = resolve), seen = [];
  const provider = async input => {
    const url = new URL(input);
    if (url.searchParams.has("numero")) { seen.push(Number(url.searchParams.get("numero"))); announceStart(); }
    if (url.hostname.includes("senado")) return Response.json([]);
    if (/\/(autores|tramitacoes)$/.test(url.pathname)) return Response.json({ dados: [] });
    const number = Number(url.searchParams.get("numero") || url.pathname.split("/").at(-1));
    const proposition = { id: number, siglaTipo: "PL", numero: number, ano: 2026, ementa: "Teste de cancelamento", statusProposicao: {} };
    return Response.json({ dados: url.pathname.endsWith("/proposicoes") ? [proposition] : proposition });
  };
  try {
    app = await startServer({ port: 0, databasePath: path.join(directory, "records.sqlite"), tramitationCheckDelayMs: null, camaraFetch: provider, senadoFetch: provider,
      officialRequestLimits: { camara: { requestsPerSecond: 2, maxConcurrent: 3 }, senado: { requestsPerSecond: 2, maxConcurrent: 3 } } });
    const endpoint = number => `${app.url}/api/propositions?siglaTipo=PL&numero=${number}&ano=2026`;
    const first = fetch(endpoint(7911)); await started;
    const controller = new AbortController();
    const second = fetch(endpoint(7912), { signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 80);
    try { await assert.rejects(second, error => error.name === "AbortError"); } finally { clearTimeout(timer); }
    assert.equal((await first).status, 200);
    assert.ok(!seen.includes(7912), "uma busca cancelada na fila não deve chamar as fontes");
  } finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("cancelar a busca interrompe chamadas ativas e libera espaço para o próximo projeto", { timeout: 6000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-official-active-abort-"));
  let app, started = 0, aborted = 0, announceReady;
  const ready = new Promise(resolve => announceReady = resolve);
  const provider = async (input, { signal }) => {
    const url = new URL(input);
    if (url.searchParams.get("numero") === "7921") {
      started++; if (started === 2) announceReady();
      return new Promise((resolve, reject) => signal.addEventListener("abort", () => { aborted++; reject(signal.reason); }, { once: true }));
    }
    if (url.hostname.includes("senado")) return Response.json([]);
    if (/\/(autores|tramitacoes)$/.test(url.pathname)) return Response.json({ dados: [] });
    const number = Number(url.searchParams.get("numero") || url.pathname.split("/").at(-1));
    const data = { id: number, siglaTipo: "PL", numero: number, ano: 2026, ementa: "Próximo projeto", statusProposicao: {} };
    return Response.json({ dados: url.pathname.endsWith("/proposicoes") ? [data] : data });
  };
  try {
    app = await startServer({ port: 0, databasePath: path.join(directory, "records.sqlite"), tramitationCheckDelayMs: null, camaraFetch: provider, senadoFetch: provider,
      officialRequestLimits: { camara: { requestsPerSecond: 1000, maxConcurrent: 1 }, senado: { requestsPerSecond: 1000, maxConcurrent: 1 } } });
    const endpoint = number => `${app.url}/api/propositions?siglaTipo=PL&numero=${number}&ano=2026`;
    const controller = new AbortController();
    const cancelled = fetch(endpoint(7921), { signal: controller.signal });
    const rejection = assert.rejects(cancelled, error => error.name === "AbortError");
    await ready; controller.abort(); await rejection;
    const next = await fetch(endpoint(7922));
    assert.equal(next.status, 200); assert.equal(aborted, 2);
    assert.equal((await next.json()).results[0].projeto, "PL 7922/2026");
  } finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
});
