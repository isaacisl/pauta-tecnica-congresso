import { createHash } from "node:crypto";

const camaraBase = "https://dadosabertos.camara.leg.br/api/v2/";
const senadoBase = "https://legis.senado.leg.br/dadosabertos/";
const text = (value) => typeof value === "string" ? value.trim() : "";

async function officialJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok || response.status === 206) throw new Error(`Consulta de tramitações indisponível (${response.status}).`);
  return response.json();
}

export function camaraEvents(payload) {
  if (!Array.isArray(payload?.dados) || payload.links?.some((link) => link.rel === "next")) {
    throw new Error("A Câmara não retornou o histórico completo de tramitações.");
  }
  return payload.dados.map((row) => {
    if (!row || !text(row.dataHora) || !Number.isInteger(Number(row.sequencia))) {
      throw new Error("A Câmara retornou uma tramitação incompleta.");
    }
    const identity = [row.dataHora, row.sequencia, row.codTipoTramitacao, row.siglaOrgao,
      row.descricaoTramitacao, row.descricaoSituacao, row.despacho];
    return {
      eventKey: createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
      date: row.dataHora,
      organization: text(row.siglaOrgao),
      description: text(row.descricaoTramitacao) || text(row.descricaoSituacao) || "Tramitação registrada",
      detail: text(row.despacho)
    };
  });
}

export function senadoEvents(payload) {
  if (!payload || !Array.isArray(payload.autuacoes)) throw new Error("O Senado não retornou o histórico completo do processo.");
  return payload.autuacoes.flatMap((autuacao) => {
    if (!Array.isArray(autuacao.informesLegislativos)) throw new Error("O Senado retornou uma autuação sem histórico de informes.");
    return autuacao.informesLegislativos.map((row) => {
      if (!Number.isSafeInteger(row.id) || !text(row.data)) throw new Error("O Senado retornou um informe incompleto.");
      return {
        eventKey: `informe:${row.id}`,
        date: row.data,
        organization: text(row.colegiado?.sigla || row.enteAdministrativo?.sigla),
        description: text(row.descricao) || "Tramitação registrada",
        detail: ""
      };
    });
  });
}

export function createTramitationMonitor({ database, camaraFetch = fetch, senadoFetch = fetch }) {
  let running = false;

  async function check() {
    if (running) return;
    running = true;
    try {
      for (const source of database.tramitationSources()) {
        try {
          if (source.source === "camara") {
            const payload = await officialJson(camaraFetch, `${camaraBase}proposicoes/${source.externalId}/tramitacoes`);
            database.saveTramitationScan(source, camaraEvents(payload));
          } else {
            const payload = await officialJson(senadoFetch, `${senadoBase}processo/${source.externalId}`);
            if (payload.id !== source.externalId) throw new Error("O Senado retornou outro processo.");
            database.saveTramitationScan(source, senadoEvents(payload));
          }
        } catch (error) {
          // A failed source must not erase its baseline or dismiss existing notices.
          console.warn(`Não foi possível verificar tramitações (${source.source} ${source.externalId}): ${error.message}`);
        }
      }
    } finally {
      running = false;
    }
  }

  return { check };
}
