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

// A civil day is an interval, not midnight. Do not invent an ordering when one API
// supplies only the day and the other supplies a time within that same day.
function dateRange(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return null;
  const dayOnly = value.length === 10;
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  const start = Date.parse(dayOnly ? `${value}T00:00:00-03:00` : zoned ? value : `${value}-03:00`);
  return Number.isFinite(start) ? [start, start + (dayOnly ? 86400000 - 1 : 0)] : null;
}

export function summarizeStatuses(snapshots) {
  const statuses = snapshots.map((row) => ({
    source: row.source || "camara", externalId: row.id, projeto: row.projeto, sourceUrl: row.sourceUrl,
    descricao: row.statusDescricao || null, tramitacao: row.statusTramitacao || null,
    dataHora: row.statusDataHora || null, consultadoEm: row.consultadoEm
  }));
  if (statuses.length === 1) return { statuses, latestStatus: statuses[0], statusComparison: "single" };
  const dates = statuses.map((status) => dateRange(status.dataHora));
  if (dates.some((date) => !date)) return { statuses, latestStatus: null, statusComparison: "undated" };
  const winner = dates.findIndex((date, index) => dates.every((other, otherIndex) => index === otherIndex || date[0] > other[1]));
  return { statuses, latestStatus: winner < 0 ? null : statuses[winner], statusComparison: winner < 0 ? "overlap" : "latest" };
}

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
      if (!groups.has(evidence.id)) groups.set(evidence.id, { evidence, identifiers: [], proposition: matter.senado.find((row) => row.id === evidence.id) });
      groups.get(evidence.id).identifiers.push(identity);
    }
    return [...groups.values()];
  }
  function candidate(official, relations = []) {
    const senateSnapshots = relations.map((relation) => relation.proposition).filter(Boolean);
    const snapshots = official.source === "camara" ? [official, ...senateSnapshots] : [official];
    const identifiers = [{ house: official.source === "camara" ? "CD" : "SF", ...official }, ...relations.flatMap((relation) => relation.identifiers)];
    const identifications = [...new Map(identifiers.map((identifier) => [`${identifier.house}:${key(identifier)}`, { house: identifier.house, name: name(identifier) }])).values()];
    return { ...official, selectionId: `${official.source}-${official.id}`, relations, identifications,
      sources: [...new Set(snapshots.map((row) => row.source))], ...summarizeStatuses(snapshots) };
  }
  function response(results, warnings = [], cached = false) {
    return {
      results: results.map(({ relations, ...row }) => row),
      searchToken: sign("search", results), warnings: [...new Set(warnings)], cached,
      requiresSelection: warnings.length > 0
    };
  }

  async function search(params) {
    const query = filters(params);
    // Old cache entries contain Câmara-only, incomplete snapshots.
    const cacheKey = `v2:${key(query)}`;
    const cached = database.getSearchCache(cacheKey);
    if (cached) return response(cached, [], true);
    const warnings = [];
    const lookups = new Map();
    const cameraDetails = new Map();
    const senateDetails = new Map();
    function cameraSearch(reference) {
      if (!lookups.has(key(reference))) lookups.set(key(reference), camara.search(new URLSearchParams(reference)).then((payload) => payload.results));
      return lookups.get(key(reference));
    }
    function cameraDetail(row) {
      if (!cameraDetails.has(row.id)) cameraDetails.set(row.id, (async () => {
        const known = database.getMatterByCamaraId(row.id)?.camara;
        const official = known && Object.hasOwn(known, "statusDescricao") && fresh(known.consultadoEm) ? known : await camara.detail(row.id);
        if (!same(official, row)) throw new Error("A Câmara retornou uma identificação divergente da pesquisa.");
        return official;
      })());
      return cameraDetails.get(row.id);
    }
    function senateDetail(id) {
      if (!senateDetails.has(id)) senateDetails.set(id, (async () => {
        const known = storedRelations(database.getMatterBySenadoId(id)).find((relation) => relation.evidence.id === id);
        return known?.proposition && fresh(known.proposition.consultadoEm) ? known : senado.relations(id);
      })());
      return senateDetails.get(id);
    }
    const [cameraResult, senateResult] = await Promise.allSettled([cameraSearch(query), senado.search(query)]);
    const cameras = new Map();
    const senators = new Map();
    function addCamera(official, relations = []) {
      const previous = cameras.get(official.id);
      const combined = [...(previous?.relations || []), ...relations];
      cameras.set(official.id, { official, relations: [...new Map(combined.map((relation) => [relation.evidence.id, relation])).values()] });
    }
    if (cameraResult.status === "fulfilled") {
      for (const row of cameraResult.value) {
        try {
          addCamera(await cameraDetail(row));
          for (const relation of storedRelations(database.getMatterByCamaraId(row.id))) {
            try { addCamera(cameras.get(row.id).official, [await senateDetail(relation.evidence.id)]); }
            catch (error) { warnings.push(error.message); }
          }
        } catch (error) {
          warnings.push(`${error.message} O resultado da Câmara está disponível, mas os detalhes da situação não puderam ser obtidos.`);
          addCamera({ ...row, source: "camara", sourceUrl: `https://dadosabertos.camara.leg.br/api/v2/proposicoes/${row.id}`, consultadoEm: new Date().toISOString() });
        }
      }
    } else warnings.push(cameraResult.reason.message);
    if (senateResult.status === "fulfilled") {
      for (const process of senateResult.value) {
        try {
          const relation = await senateDetail(process.id);
          if (!same(relation.proposition, query)) throw new Error("O Senado retornou uma identificação divergente da pesquisa.");
          // Keep the Senate result even if its Câmara reference cannot be resolved.
          senators.set(process.id, relation);
          try {
            const knownCamera = database.getMatterBySenadoId(process.id)?.camara;
            if (knownCamera) { addCamera(await cameraDetail(knownCamera), [relation]); continue; }
            const references = [...new Map(relation.identifiers.filter((identifier) => identifier.house === "CD" && allowedTypes.has(identifier.siglaTipo)).map((identifier) => [key(identifier), identifier])).values()];
            if (!references.length) continue;
            const matches = new Map();
            let unresolved = false;
            for (const reference of references) {
              const rows = await cameraSearch({ siglaTipo: reference.siglaTipo, numero: reference.numero, ano: reference.ano });
              if (rows.length !== 1) unresolved = true;
              for (const row of rows) matches.set(row.id, row);
            }
            if (unresolved || matches.size !== 1) {
              if (matches.size) warnings.push(`A correspondência de ${process.identificacao} com a Câmara é ambígua. O resultado do Senado foi mantido separado.`);
              continue;
            }
            addCamera(await cameraDetail([...matches.values()][0]), [relation]);
          } catch (error) { warnings.push(`${error.message} O resultado do Senado foi mantido disponível.`); }
        } catch (error) {
          warnings.push(`${error.message} Os dados disponíveis na pesquisa do Senado foram mantidos, sem criar novos vínculos.`);
          const official = process.proposition;
          senators.set(process.id, {
            proposition: official,
            evidence: { id: process.id, identificacao: process.identificacao, sourceUrl: official.sourceUrl, consultedAt: official.consultadoEm },
            identifiers: [{ source: "senado", externalId: process.id, house: process.house === "CD" ? "CD" : "SF", siglaTipo: official.siglaTipo, numero: official.numero, ano: official.ano }]
          });
        }
      }
    } else warnings.push(senateResult.reason.message);
    const linkedSenateIds = new Set([...cameras.values()].flatMap((row) => row.relations.map((relation) => relation.evidence.id)));
    const candidates = [
      ...[...cameras.values()].map((row) => candidate(row.official, row.relations)),
      ...[...senators.values()].filter((relation) => !linkedSenateIds.has(relation.evidence.id)).map((relation) => candidate(relation.proposition, [relation]))
    ];
    if (!candidates.length && warnings.length) throw Object.assign(new Error(`${warnings.join(" ")} Não foi possível concluir a pesquisa nas duas Casas.`), { status: 503 });
    if (!warnings.length && candidates.length) database.saveSearchCache(cacheKey, candidates);
    return response(candidates, warnings);
  }

  async function select(id, searchToken) {
    // Numeric IDs remain a compatibility alias for Câmara, never for Senado.
    const selectionId = /^\d+$/.test(String(id)) ? `camara-${id}` : String(id);
    const selected = verify(searchToken, "search").find((row) => row.selectionId === selectionId);
    if (!selected) throw required();
    const { relations, selectionId: unused, identifications, sources, statuses, latestStatus, statusComparison, ...official } = selected;
    const matter = database.saveMatter(official, relations);
    const snapshot = { ...official, sources, statuses, latestStatus, statusComparison };
    const proposition = { ...snapshot, matterId: matter.id, identifiers: matter.identifiers };
    const proof = { ...snapshot, camara: official.source === "camara" ? official : null };
    return { proposition, propositionToken: sign("selection", proof) };
  }

  function recordInput(input, existing = null) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw required();
    if (input.propositionToken) {
      const { camara: cameraSnapshot, ...proposition } = verify(input.propositionToken, "selection");
      return { ...input, projeto: proposition.projeto, ementa: proposition.ementa, camara: cameraSnapshot, proposition };
    }
    if (!existing || input.projeto !== existing.projeto) throw required();
    return { ...input, camara: existing.camara, proposition: existing.proposition,
      ...(existing.camara || existing.proposition ? { ementa: existing.ementa } : {}) };
  }
  return { search, select, recordInput };
}
