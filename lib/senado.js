const baseUrl = "https://legis.senado.leg.br/dadosabertos/";
const unavailable = () => Object.assign(new Error("Não foi possível consultar o Senado. Tente novamente em instantes."), { status: 503 });

function identification(value) {
  const match = typeof value === "string" && value.trim().match(/^([A-Z]+)\s+(\d+)\/(\d{4})$/);
  return match ? { siglaTipo: match[1], numero: Number(match[2]), ano: Number(match[3]) } : null;
}

export function createSenadoClient(fetchImpl = fetch) {
  async function get(endpoint) {
    try {
      const response = await fetchImpl(new URL(endpoint, baseUrl), {
        headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000)
      });
      // A partial response is not a complete identity search.
      if (!response.ok || response.status === 206) throw new Error();
      return await response.json();
    } catch { throw unavailable(); }
  }

  async function search(query) {
    const params = new URLSearchParams({ sigla: query.siglaTipo, numero: query.numero, ano: query.ano });
    const rows = await get(`processo?${params}`);
    if (!Array.isArray(rows)) throw unavailable();
    return rows.filter((row) => {
      const parsed = identification(row.identificacao);
      return Number.isSafeInteger(row.id) && parsed && parsed.siglaTipo === query.siglaTipo && parsed.numero === query.numero && parsed.ano === query.ano;
    }).map((row) => ({ id: row.id, identificacao: row.identificacao, house: row.casaIdentificadora }));
  }

  async function relations(id) {
    const data = await get(`processo/${id}`);
    if (data.id !== id || !identification(data.identificacao)) throw unavailable();
    const identifiers = new Map();
    function add(processId, house, parsed, codigoMateria = null) {
      if (!Number.isSafeInteger(processId) || processId < 1 || !["CD", "SF"].includes(house) || !parsed) return;
      if (!parsed.siglaTipo || !Number.isSafeInteger(parsed.numero) || parsed.numero < 1 || !Number.isInteger(parsed.ano)) return;
      const identifier = { source: "senado", externalId: processId, house, ...parsed, codigoMateria };
      const previous = identifiers.get(processId);
      if (previous && (previous.house !== house || previous.siglaTipo !== parsed.siglaTipo || previous.numero !== parsed.numero || previous.ano !== parsed.ano)) throw unavailable();
      identifiers.set(processId, identifier);
    }
    add(data.id, data.casaIdentificadora, identification(data.identificacao), data.codigoMateria || null);
    // Both these IDs belong to the Senate process namespace, even when the house is CD.
    add(data.idProcessoCasaInicial, data.siglaCasaIniciadora, identification(data.identificacaoProcessoInicial));
    for (const other of data.outrosNumeros || []) {
      if (other.externaAoCongresso === "Sim") continue;
      add(other.idOutroProcesso, other.casaIdentificadora, {
        siglaTipo: other.sigla, numero: Number(other.numero), ano: Number(other.ano)
      });
    }
    const evidence = {
      sourceUrl: `${baseUrl}processo/${id}`, consultedAt: new Date().toISOString(),
      id: data.id, codigoMateria: data.codigoMateria || null,
      identificacao: data.identificacao, casaIdentificadora: data.casaIdentificadora,
      identificacaoProcessoInicial: data.identificacaoProcessoInicial || null,
      idProcessoCasaInicial: data.idProcessoCasaInicial || null,
      siglaCasaIniciadora: data.siglaCasaIniciadora || null,
      outrosNumeros: data.outrosNumeros || []
    };
    return { identifiers: [...identifiers.values()], evidence };
  }
  return { search, relations };
}
