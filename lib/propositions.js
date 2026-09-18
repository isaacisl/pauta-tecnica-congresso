import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createCamaraClient, propositionTypes } from "./camara.js";
import { createSenadoClient } from "./senado.js";
import { ValidationError } from "./database.js";

const allowedTypes = new Set(propositionTypes.map(([type]) => type));
const key = (query) => `${query.siglaTipo}:${query.numero}:${query.ano}`;
const name = (query) => `${query.siglaTipo} ${query.numero}/${query.ano}`;
const same = (left, right) => key(left) === key(right);
const required = () => new ValidationError("Pesquise e selecione uma proposição antes de salvar. Se a consulta expirou, pesquise novamente.");
const fresh = (date) => Number.isFinite(Date.parse(date)) && Date.now() - Date.parse(date) < 24 * 60 * 60 * 1000;

export function createPropositionService({ database, camaraFetch = fetch, senadoFetch = fetch }) {
  const camara = createCamaraClient(camaraFetch);
  const senado = createSenadoClient(senadoFetch);
  const secret = randomBytes(32);
  const signature = (value) => createHmac("sha256", secret).update(value).digest();
  function sign(kind, data) {
    const value = Buffer.from(JSON.stringify({ kind, data, expires: Date.now() + 7200000 })).toString("base64url");
    if (value.length > 60000) throw new ValidationError("A pesquisa retornou dados demais. Confira os parâmetros informados.");
    return `${value}.${signature(value).toString("base64url")}`;
  }
  function verify(token, kind) {
    try {
      if (typeof token !== "string" || token.length > 61000) throw new Error();
      const [value, encoded, extra] = token.split(".");
      const expected = signature(value);
      const received = Buffer.from(encoded || "", "base64url");
      if (extra || received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error();
      const payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
      if (payload.kind !== kind || payload.expires < Date.now()) throw new Error();
      return payload.data;
    } catch { throw required(); }
  }
  function filters(params) {
    const siglaTipo = params.get("siglaTipo") || "";
    const numero = params.get("numero") || "";
    const ano = params.get("ano") || "";
    if (!allowedTypes.has(siglaTipo) || !/^\d{1,9}$/.test(numero) || Number(numero) < 1 || !/^\d{4}$/.test(ano) || Number(ano) < 1000) throw new ValidationError("Selecione um tipo e informe número e ano válidos para pesquisar.");
    return { siglaTipo, numero: Number(numero), ano: Number(ano) };
  }
  function storedRelations(matter) {
    const groups = new Map();
    for (const identifier of matter?.identifiers || []) {
      if (identifier.source !== "senado" || !identifier.evidence) continue;
      const { evidence, ...identity } = identifier;
      if (!groups.has(evidence.id)) groups.set(evidence.id, { evidence, identifiers: [] });
      groups.get(evidence.id).identifiers.push(identity);
    }
    return [...groups.values()];
  }
  function candidate(result, relations = []) {
    return { id: result.id, siglaTipo: result.siglaTipo, numero: result.numero, ano: result.ano, projeto: result.projeto,
      ementa: result.ementa, dataApresentacao: result.dataApresentacao, relations };
  }
  function response(results, warnings = [], cached = false) {
    return {
      results: results.map((row) => {
        const identifiers = [{ house: "CD", siglaTipo: row.siglaTipo, numero: row.numero, ano: row.ano }, ...row.relations.flatMap((relation) => relation.identifiers)];
        const labels = [...new Map(identifiers.map((identifier) => [`${identifier.house}:${key(identifier)}`, { house: identifier.house, name: name(identifier) }])).values()];
        return { ...row, relations: undefined, identifications: labels };
      }),
      searchToken: sign("search", results), warnings: [...new Set(warnings)], cached,
      requiresSelection: warnings.length > 0
    };
  }

  async function search(params) {
    const query = filters(params);
    const cached = database.getSearchCache(key(query));
    if (cached) return response(cached, [], true);
    const lookups = new Map();
    function cameraSearch(reference) {
      if (!lookups.has(key(reference))) lookups.set(key(reference), camara.search(new URLSearchParams(reference)).then((payload) => payload.results));
      return lookups.get(key(reference));
    }
    const [cameraResult, senateResult] = await Promise.allSettled([cameraSearch(query), senado.search(query)]);
    const results = new Map();
    const warnings = [];
    function add(result, relations = []) {
      const previous = results.get(result.id);
      const combined = [...(previous?.relations || []), ...relations];
      results.set(result.id, candidate(result, [...new Map(combined.map((relation) => [relation.evidence.id, relation])).values()]));
    }
    if (cameraResult.status === "fulfilled") {
      for (const row of cameraResult.value) add(row, storedRelations(database.getMatterByCamaraId(row.id)));
    } else warnings.push(cameraResult.reason.message);
    if (senateResult.status === "fulfilled") {
      for (const process of senateResult.value) {
        try {
          const known = database.getMatterBySenadoId(process.id);
          if (known && known.identifiers.some((identifier) => identifier.source === "senado" && identifier.externalId === process.id && identifier.house === process.house && same(identifier, query))) {
            add(known.camara, storedRelations(known));
            continue;
          }
          const relation = await senado.relations(process.id);
          if (!relation.identifiers.some((identifier) => identifier.externalId === process.id && same(identifier, query))) throw new Error("O Senado retornou uma identificação divergente da pesquisa.");
          const references = [...new Map(relation.identifiers.filter((identifier) => identifier.house === "CD" && allowedTypes.has(identifier.siglaTipo)).map((identifier) => [key(identifier), identifier])).values()];
          if (!references.length) {
            warnings.push(`${process.identificacao} foi encontrado no Senado, mas não possui correspondência explícita com a Câmara. Nenhum vínculo foi criado.`);
            continue;
          }
          const matches = new Map();
          let unresolved = false;
          for (const reference of references) {
            const rows = await cameraSearch({ siglaTipo: reference.siglaTipo, numero: reference.numero, ano: reference.ano });
            if (rows.length !== 1) unresolved = true;
            for (const row of rows) matches.set(row.id, row);
          }
          if (unresolved || matches.size !== 1) {
            warnings.push(`A relação de ${process.identificacao} com a Câmara não pôde ser confirmada de forma inequívoca. Nenhum vínculo foi criado.`);
            continue;
          }
          add([...matches.values()][0], [relation]);
        } catch (error) { warnings.push(error.message); }
      }
    } else warnings.push(senateResult.reason.message);
    if (!results.size && (cameraResult.status === "rejected" || senateResult.status === "rejected")) {
      throw Object.assign(new Error(`${warnings.join(" ")} Não foi possível concluir a pesquisa nas duas Casas.`), { status: 503 });
    }
    const candidates = [...results.values()];
    // Do not cache errors, partial searches or negative results.
    if (!warnings.length && candidates.length) database.saveSearchCache(key(query), candidates);
    return response(candidates, warnings);
  }

  async function select(id, searchToken) {
    const selected = verify(searchToken, "search").find((row) => row.id === id);
    if (!selected) throw required();
    const known = database.getMatterByCamaraId(id);
    const official = known && fresh(known.cachedAt) ? known.camara : await camara.detail(id);
    if (!same(official, selected)) throw new ValidationError("A identificação retornada pela Câmara mudou. Pesquise novamente.");
    const matter = database.saveMatter(official, selected.relations);
    const proposition = { ...official, matterId: matter.id, identifiers: matter.identifiers };
    // Sign only the identity and official data; source evidence stays in the database.
    const proof = { ...official, matterId: matter.id };
    return { proposition, propositionToken: sign("selection", proof) };
  }

  function recordInput(input, existing = null) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw required();
    if (input.propositionToken) {
      const { matterId, ...official } = verify(input.propositionToken, "selection");
      return { ...input, projeto: official.projeto, ementa: official.ementa, camara: official, matterId };
    }
    return camara.recordInput(input, existing);
  }
  return { search, select, recordInput };
}
