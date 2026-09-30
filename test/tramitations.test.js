import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startServer } from "../server.js";
import { camaraEvents, senadoEvents } from "../lib/tramitations.js";

const recordInput = {
  areaTecnica: "Educação",
  responsavel: "Beatriz Silva (Colaborador)",
  projeto: "PL 1234/2026",
  autor: "",
  ementa: "Projeto de teste",
  despacho: "",
  atualComissao: "",
  haParecer: "Não",
  sugestaoEmenda: "Não",
  posicionamento: "Favorável"
};

function movement(sequence, description) {
  return {
    dataHora: `2026-09-${String(sequence).padStart(2, "0")}T10:00`,
    sequencia: sequence,
    siglaOrgao: "CE",
    descricaoTramitacao: description,
    codTipoTramitacao: "100",
    descricaoSituacao: "Em tramitação",
    despacho: ""
  };
}

test("notifica somente tramitações posteriores à linha de base e mantém o aviso até a confirmação", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-tramitacoes-"));
  let app;
  let movements = [movement(1, "Apresentação")];
  let fail = false;
  try {
    app = await startServer({
      port: 0, databasePath: path.join(directory, "registros.sqlite"), tramitationCheckDelayMs: null,
      camaraFetch: async () => fail ? new Response("erro", { status: 503 }) : Response.json({ dados: movements, links: [{ rel: "self" }] }),
      senadoFetch: async () => Response.json({ autuacoes: [] })
    });
    const official = { id: 1234, source: "camara", siglaTipo: "PL", numero: 1234, ano: 2026, projeto: "PL 1234/2026", ementa: "Projeto de teste", consultadoEm: new Date().toISOString() };
    app.database.saveMatter(official);
    const first = app.database.create({ ...recordInput, camara: official, proposition: official });
    await app.checkTramitations();
    assert.equal(app.database.get(first.id).tramitationNotice.count, 0, "histórico anterior não é novidade");
    await app.checkTramitations();
    assert.equal(app.database.get(first.id).tramitationNotice.count, 0, "a mesma tramitação não duplica");

    movements = [...movements, movement(2, "Encaminhada à Comissão de Educação")];
    await app.checkTramitations();
    let notice = app.database.get(first.id).tramitationNotice;
    assert.equal(notice.count, 1);
    assert.match(notice.events[0].description, /Encaminhada/);

    fail = true;
    await app.checkTramitations();
    assert.equal(app.database.get(first.id).tramitationNotice.count, 1, "erro de API não apaga alerta");
    fail = false;

    const second = app.database.create({ ...recordInput, responsavel: "Arthur Trindade (Consultor)", camara: official, proposition: official });
    assert.equal(app.database.get(second.id).tramitationNotice.count, 0, "novo acompanhamento não herda alertas antigos");

    const response = await fetch(`${app.url}/api/records/${first.id}/tramitations/acknowledge`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ throughEventId: notice.throughEventId })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).record.tramitationNotice.count, 0);

    movements = [...movements, movement(3, "Designado relator")];
    await app.checkTramitations();
    notice = app.database.get(first.id).tramitationNotice;
    assert.equal(notice.count, 1);
    assert.equal(app.database.get(second.id).tramitationNotice.count, 1);
    await app.close();
    app = null;

    const reopened = (await import("../lib/database.js")).createDatabase(path.join(directory, "registros.sqlite"));
    assert.equal(reopened.get(first.id).tramitationNotice.count, 1, "alerta persiste após reinício");
    reopened.close();
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Senado usa o ID do informe e Câmara usa dados estáveis da tramitação", () => {
  const senate = senadoEvents({ autuacoes: [{ informesLegislativos: [{ id: 12, data: "2026-09-30 10:20:00", descricao: "Remetido à comissão", colegiado: { sigla: "CAS" } }] }] });
  assert.equal(senate[0].eventKey, "informe:12");
  assert.equal(senate[0].organization, "CAS");
  const camera = camaraEvents({ dados: [movement(1, "Apresentação")], links: [{ rel: "self" }] });
  assert.equal(camera[0].eventKey, camaraEvents({ dados: [movement(1, "Apresentação")] })[0].eventKey);
  assert.throws(() => camaraEvents({ dados: [], links: [{ rel: "next" }] }), /histórico completo/);
});
