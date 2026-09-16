import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ValidationError } from "./database.js";

export const propositionTypes = Object.freeze([
  ["PEC", "Proposta de Emenda à Constituição"],
  ["PLP", "Projeto de Lei Complementar"],
  ["PL", "Projeto de Lei"],
  ["MPV", "Medida Provisória"],
  ["PLV", "Projeto de Lei de Conversão"],
  ["PDL", "Projeto de Decreto Legislativo"],
  ["PRC", "Projeto de Resolução"],
  ["REQ", "Requerimento"],
  ["RIC", "Requerimento de Informação"],
  ["RCP", "Requerimento de Instituição de CPI"],
  ["MSC", "Mensagem"],
  ["INC", "Indicação"]
]);

const baseUrl = "https://dadosabertos.camara.leg.br/api/v2/";
const allowedTypes = new Set(propositionTypes.map(([type]) => type));
const unavailable = () => Object.assign(new Error("Não foi possível consultar a Câmara. Tente pesquisar novamente em instantes."), { status: 503 });
const searchRequired = () => new ValidationError("Pesquise e selecione uma proposição na Câmara antes de salvar. Se a consulta expirou, pesquise novamente.");

export function createCamaraClient(fetchImpl = fetch) {
  // Proofs bind submitted data to a completed search, without another API call on save.
  const secret = randomBytes(32);
  const signature = (value) => createHmac("sha256", secret).update(value).digest();
  function sign(kind, data) {
    const payload = Buffer.from(JSON.stringify({ kind, data, expires: Date.now() + 2 * 60 * 60 * 1000 })).toString("base64url");
    return `${payload}.${signature(payload).toString("base64url")}`;
  }
  function verify(token, kind) {
    try {
      if (typeof token !== "string" || token.length > 60000) throw new Error();
      const [payload, encodedSignature, extra] = token.split(".");
      const received = Buffer.from(encodedSignature || "", "base64url");
      const expected = signature(payload);
      if (extra || received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error();
      const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (value.kind !== kind || value.expires < Date.now()) throw new Error();
      return value.data;
    } catch { throw searchRequired(); }
  }
  async function get(endpoint) {
    try {
      const response = await fetchImpl(new URL(endpoint, baseUrl), {
        headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error();
      return await response.json();
    } catch { throw unavailable(); }
  }
  function filters(params) {
    const siglaTipo = params.get("siglaTipo") || "";
    const numero = params.get("numero") || "";
    const ano = params.get("ano") || "";
    if (!allowedTypes.has(siglaTipo) || !/^\d{1,9}$/.test(numero) || Number(numero) < 1 || !/^\d{4}$/.test(ano) || Number(ano) < 1000) {
      throw new ValidationError("Selecione um tipo e informe o número e o ano (4 dígitos) para pesquisar.");
    }
    return { siglaTipo, numero: Number(numero), ano: Number(ano) };
  }
  function matches(data, query) {
    return data && data.siglaTipo === query.siglaTipo && Number(data.numero) === query.numero && Number(data.ano) === query.ano;
  }
  async function search(params) {
    const query = filters(params);
    const results = new Map();
    for (let page = 1; page <= 20; page++) {
      const searchParams = new URLSearchParams({ ...query, itens: 100, pagina: page });
      const payload = await get(`proposicoes?${searchParams}`);
      if (!Array.isArray(payload.dados)) throw unavailable();
      for (const row of payload.dados) {
        if (!matches(row, query) || !Number.isSafeInteger(row.id) || row.id < 1) throw unavailable();
        results.set(row.id, {
          id: row.id, ...query, projeto: `${query.siglaTipo} ${query.numero}/${query.ano}`,
          ementa: typeof row.ementa === "string" ? row.ementa : "",
          dataApresentacao: row.dataApresentacao || null
        });
      }
      if (!payload.links?.some((link) => link.rel === "next")) {
        return { results: [...results.values()], searchToken: sign("search", { ...query, ids: [...results.keys()] }) };
      }
    }
    throw Object.assign(new Error("A Câmara retornou resultados demais para essa pesquisa. Confira o tipo, número e ano."), { status: 502 });
  }
  async function select(id, searchToken) {
    const query = verify(searchToken, "search");
    if (!query.ids.includes(id)) throw searchRequired();
    const { dados } = await get(`proposicoes/${id}`);
    if (!matches(dados, query) || dados.id !== id) throw unavailable();
    const proposition = {
      id, siglaTipo: query.siglaTipo, numero: query.numero, ano: query.ano,
      projeto: `${query.siglaTipo} ${query.numero}/${query.ano}`,
      ementa: typeof dados.ementa === "string" ? dados.ementa : "",
      dataApresentacao: dados.dataApresentacao || null,
      statusDataHora: dados.statusProposicao?.dataHora || null,
      consultadoEm: new Date().toISOString()
    };
    return { proposition, propositionToken: sign("selection", proposition) };
  }
  function recordInput(input, existing = null) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw searchRequired();
    if (input.propositionToken) {
      const camara = verify(input.propositionToken, "selection");
      return { ...input, projeto: camara.projeto, ementa: camara.ementa, camara };
    }
    if (!existing) throw searchRequired();
    if (input.projeto !== existing.projeto) throw searchRequired();
    // Existing records remain editable offline; only a new search can change their identity.
    return { ...input, camara: existing.camara, ...(existing.camara ? { ementa: existing.ementa } : {}) };
  }
  return { search, select, recordInput };
}
