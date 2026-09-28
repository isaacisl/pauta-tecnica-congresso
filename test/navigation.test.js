import assert from "node:assert/strict";
import { test } from "node:test";
import { createCamaraClient } from "../lib/camara.js";
import { createSenadoClient } from "../lib/senado.js";
import { createDatabase } from "../lib/database.js";
import { createPropositionService } from "../lib/propositions.js";

const camera = { id: 2310535, siglaTipo: "PL", numero: 4309, ano: 2021, ementa: "Política Nacional de Arborização Urbana",
  statusProposicao: { dataHora: "2026-01-10T10:00", siglaOrgao: "CCJC", descricaoSituacao: "Aguardando Parecer" } };
const olderDispatch = { dataHora: "2022-02-02T10:00", sequencia: 2, siglaOrgao: "MESA",
  codTipoTramitacao: "110", descricaoTramitacao: "Distribuição", despacho: "Às Comissões de Desenvolvimento Urbano; Meio Ambiente; Finanças; e Constituição e Justiça." };

test("Câmara extrai o último despacho formal e o órgão da última tramitação, não a última ação textual", async () => {
  const calls = [];
  const client = createCamaraClient(async (url) => {
    calls.push(url.pathname);
    if (url.pathname.endsWith("/tramitacoes")) return Response.json({ dados: [
      olderDispatch,
      { dataHora: "2026-01-10T10:00", sequencia: 9, siglaOrgao: "CCJC", descricaoTramitacao: "Recebimento", despacho: "Recebido pela comissão." },
      { dataHora: "2024-03-01T10:00", sequencia: 4, siglaOrgao: "MESA", codTipoTramitacao: "203", descricaoTramitacao: "Notificação de Despacho", despacho: "Requerimento indeferido." },
      { dataHora: "2023-03-01T10:00", sequencia: 3, siglaOrgao: "CDU", codTipoTramitacao: "112", descricaoTramitacao: "Redistribuição", despacho: "Novo despacho de distribuição." }
    ] });
    return Response.json({ dados: camera });
  });
  const result = await client.detail(camera.id);
  assert.equal(result.despacho, "Novo despacho de distribuição.");
  assert.equal(result.atualComissao, "CCJC");
  assert.equal(result.navigationWarning, null);
  assert.deepEqual(calls, [`/api/v2/proposicoes/${camera.id}`, `/api/v2/proposicoes/${camera.id}/tramitacoes`]);
});

test("Câmara reconhece despacho de apensação sem mudar a regra da comissão", async () => {
  const client = createCamaraClient(async (url) => Response.json({ dados: url.pathname.endsWith("/tramitacoes") ? [
    { dataHora: "2026-09-02T15:06", sequencia: 10, siglaOrgao: "MESA",
      codTipoTramitacao: "129", descricaoTramitacao: "Despacho de Apensação",
      despacho: "Apense-se à(ao) PL 2142/2026.Proposição Sujeita à Apreciação do Plenário." },
    { dataHora: "2026-09-02T17:13", sequencia: 16, siglaOrgao: "CTRAB",
      codTipoTramitacao: "106", descricaoTramitacao: "Apensação", despacho: "Apensação desta proposição ao PL 2142/2026." },
    { dataHora: "2026-09-02T00:00", sequencia: 17, siglaOrgao: "CCP",
      codTipoTramitacao: "604", descricaoTramitacao: "Publicação de Proposição", despacho: "Encaminhada à publicação." }
  ] : { id: 2634848, siglaTipo: "PL", numero: 3268, ano: 2026, ementa: "Ementa",
    statusProposicao: { siglaOrgao: "CCP" } } }));
  const result = await client.detail(2634848);
  assert.equal(result.despacho, "Apense-se à(ao) PL 2142/2026.Proposição Sujeita à Apreciação do Plenário.");
  assert.equal(result.atualComissao, "CTRAB");
});

test("nova pesquisa atualiza despacho de apensação mesmo com cache e matéria antigos", async () => {
  const database = createDatabase(":memory:");
  const proposition = { id: 2634848, siglaTipo: "PL", numero: 3268, ano: 2026, ementa: "Ementa",
    statusProposicao: { dataHora: "2026-09-02T00:00", siglaOrgao: "CCP" } };
  const calls = [];
  const service = createPropositionService({ database,
    camaraFetch: async (url) => {
      calls.push(url.pathname);
      if (url.pathname.endsWith("/tramitacoes")) return Response.json({ dados: [
        { dataHora: "2026-09-02T15:06", sequencia: 10, siglaOrgao: "MESA",
          codTipoTramitacao: "129", descricaoTramitacao: "Despacho de Apensação", despacho: "Apense-se ao PL 2142/2026." },
        { dataHora: "2026-09-02T17:13", sequencia: 16, siglaOrgao: "CTRAB",
          codTipoTramitacao: "106", descricaoTramitacao: "Apensação", despacho: "Apensação desta proposição." }
      ] });
      return Response.json({ dados: url.pathname.endsWith("/proposicoes") ? [proposition] : proposition });
    },
    senadoFetch: async () => Response.json([])
  });
  try {
    database.saveMatter({ ...proposition, source: "camara", projeto: "PL 3268/2026",
      despacho: "Despacho antigo.", atualComissao: "CTRAB", consultadoEm: new Date().toISOString() });
    database.saveSearchCache("v3:PL:3268:2026", [{ despacho: "Despacho antigo." }]);
    const result = await service.search(new URLSearchParams("siglaTipo=PL&numero=3268&ano=2026"));
    assert.equal(result.cached, false);
    assert.equal(result.results[0].despacho, "Apense-se ao PL 2142/2026.");
    assert.equal(result.results[0].atualComissao, "CTRAB");
    assert.ok(calls.includes("/api/v2/proposicoes/2634848/tramitacoes"));
  } finally { database.close(); }
});

test("Senado lê colegiado da autuação e despacho explícito nas movimentações", async () => {
  const calls = [];
  const senate = { id: 8862684, codigoMateria: 169542, identificacao: "PL 3361/2025", casaIdentificadora: "SF",
    autuacoes: [{ dataAutuacao: "2025-01-01", siglaColegiadoAtual: "CE" }, { dataAutuacao: "2026-01-01", siglaColegiadoAtual: "CCJ" }] };
  const client = createSenadoClient(async (url) => {
    calls.push(url.pathname);
    return Response.json(url.pathname.includes("/movimentacoes/")
      ? { MovimentacaoMateria: { Materia: { Despachos: { Despacho: [
        { DataDespacho: "2025-02-01", TextoDespacho: "À Comissão de Educação." },
        { DataDespacho: "2026-02-01", TextoDespacho: "À Comissão de Constituição e Justiça." }
      ] } } } } : senate);
  });
  const result = await client.relations(senate.id);
  assert.equal(result.proposition.despacho, "À Comissão de Constituição e Justiça.");
  assert.equal(result.proposition.atualComissao, "CCJ");
  assert.equal(result.proposition.navigationWarning, null);
  assert.equal(calls.length, 2);
});

test("Senado preserva o código da matéria quando o processo inicial usa o mesmo ID", async () => {
  const senate = { id: 9077370, codigoMateria: 174939, identificacao: "PL 3451/2026", casaIdentificadora: "SF",
    idProcessoCasaInicial: 9077370, identificacaoProcessoInicial: "PL 3451/2026", siglaCasaIniciadora: "SF" };
  const client = createSenadoClient(async (url) => Response.json(url.pathname.includes("/movimentacoes/") ? {} : senate));
  const relation = await client.relations(senate.id);
  assert.equal(relation.identifiers.length, 1);
  assert.equal(relation.identifiers[0].codigoMateria, 174939);
  const database = createDatabase(":memory:");
  try {
    const matter = database.saveMatter(relation.proposition, [relation]);
    assert.equal(matter.identifiers[0].codigoMateria, 174939);
  } finally { database.close(); }
});

test("falha nas tramitações não impede selecionar e salvar com valores manuais ou em branco", async () => {
  const database = createDatabase(":memory:");
  const service = createPropositionService({ database,
    camaraFetch: async (url) => {
      if (url.pathname.endsWith("/tramitacoes")) return new Response("indisponível", { status: 503 });
      return Response.json({ dados: url.pathname.endsWith("/proposicoes") ? [camera] : camera });
    },
    senadoFetch: async () => Response.json([])
  });
  try {
    const found = await service.search(new URLSearchParams("siglaTipo=PL&numero=4309&ano=2021"));
    const selected = await service.select(found.results[0].selectionId, found.searchToken);
    assert.equal(selected.proposition.despacho, "");
    assert.equal(selected.proposition.atualComissao, "CCJC");
    assert.match(selected.proposition.navigationWarning, /tramitações/);
    const common = { areaTecnica: "Educação", responsavel: "Beatriz Silva (Colaborador)",
      haParecer: "Não", sugestaoEmenda: "Não", posicionamento: "Favorável" };
    const saved = database.create(service.recordInput({ ...common, propositionToken: selected.propositionToken,
      despacho: "", atualComissao: "" }));
    assert.equal(saved.despacho, "");
    assert.equal(saved.atualComissao, "");
    const edited = database.update(saved.id, service.recordInput({ ...saved, despacho: "Despacho informado manualmente.", atualComissao: "CCJC" }, saved));
    assert.equal(edited.despacho, "Despacho informado manualmente.");
    assert.equal(edited.atualComissao, "CCJC");
  } finally { database.close(); }
});

test("matérias vinculadas usam despacho e comissão da Casa com situação mais recente", async () => {
  const database = createDatabase(":memory:");
  const senate = { id: 777, codigoMateria: 900, identificacao: "PL 3361/2025", casaIdentificadora: "SF",
    identificacaoProcessoInicial: "PL 7108/2017", idProcessoCasaInicial: 778, siglaCasaIniciadora: "CD",
    conteudo: { ementa: "Ementa do Senado" }, dataSituacaoAtual: "2026-01-01",
    autuacoes: [{ siglaColegiadoAtual: "CCJ" }], despachos: [{ dataDespacho: "2025-12-01", textoDespacho: "À CCJ do Senado." }] };
  const cameraLinked = { id: 555, siglaTipo: "PL", numero: 7108, ano: 2017, ementa: "Ementa da Câmara",
    statusProposicao: { dataHora: "2025-01-01T10:00", siglaOrgao: "CDU" } };
  const service = createPropositionService({ database,
    camaraFetch: async (url) => Response.json({ dados: url.pathname.endsWith("/tramitacoes")
      ? [olderDispatch] : url.pathname.endsWith("/proposicoes") ? [cameraLinked] : cameraLinked }),
    senadoFetch: async (url) => Response.json(url.pathname.endsWith("/processo") ? [senate] : senate)
  });
  try {
    const found = await service.search(new URLSearchParams("siglaTipo=PL&numero=3361&ano=2025"));
    assert.equal(found.results.length, 1);
    const selected = await service.select(found.results[0].selectionId, found.searchToken);
    assert.equal(selected.proposition.source, "camara");
    assert.equal(selected.proposition.navigationSource, "senado");
    assert.equal(selected.proposition.despacho, "À CCJ do Senado.");
    assert.equal(selected.proposition.atualComissao, "CCJ");
    assert.equal(database.getMatterByCamaraId(555).camara.despacho, olderDispatch.despacho);
    const automatic = service.recordInput({ propositionToken: selected.propositionToken });
    assert.equal(automatic.despacho, "À CCJ do Senado.");
    assert.equal(automatic.atualComissao, "CCJ");
  } finally { database.close(); }
});
