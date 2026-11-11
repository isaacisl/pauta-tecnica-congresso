const clean = value => typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
const key = value => clean(value).normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
const indexes = new WeakMap();
function directoryIndex(parameters) {
  if (!indexes.has(parameters)) indexes.set(parameters, {
    areas: new Map([...parameters.areasTecnicas, ...(parameters.legacyAreasTecnicas || [])].map(area => [key(area), area])),
    people: new Map([...parameters.responsaveis, ...(parameters.responsaveisLegados || [])].map(name => [key(name), name]))
  });
  return indexes.get(parameters);
}

export function canonicalArea(value, parameters) {
  // Only renames explicitly confirmed by the organization belong here.
  const aliases = {
    "gabinete presidente": "Gabinete do Presidente",
    "pre atendimento": "Pré-Atendimento",
    "saneamento": "Sustentabilidade",
    "consorcios publicos": "Consórcios",
    "financas": "Finanças e Tributação",
    "juridico": "Jurídico Técnico",
    "obras": "Obras, Transferências e Parcerias",
    "orcamento publico": "Orçamento",
    "planej. territ. e habitacao": "Planejamento Territorial e Habitação"
  };
  const candidate = Object.hasOwn(aliases, key(value)) ? aliases[key(value)] : clean(value);
  return directoryIndex(parameters).areas.get(key(candidate)) || clean(value);
}

export function canonicalResponsible(value, parameters) {
  const name = clean(value).replace(/\s*\((?:colaborador|consultor)\)\s*$/i, "");
  const aliases = { "rafael correa": "José Rafael Correa", "nancy ramos": "Nancy de Andrade" };
  const candidate = Object.hasOwn(aliases, key(name)) ? aliases[key(name)] : name;
  return directoryIndex(parameters).people.get(key(candidate)) || clean(value);
}

export function consultantAreas(responsible, parameters) {
  const canonical = canonicalResponsible(responsible, parameters);
  return Object.entries(parameters.consultoresPorArea || {})
    .filter(([, names]) => names.includes(canonical)).map(([area]) => area);
}

function ambiguousConsultantArea(area, responsible, parameters) {
  const areas = consultantAreas(responsible, parameters);
  return areas.length > 1 && !areas.includes(area);
}

export function responsibleOptions(area, parameters, existingRecord = null) {
  const canonical = canonicalArea(area, parameters);
  const local = Object.hasOwn(parameters.responsaveisPorArea, canonical) ? parameters.responsaveisPorArea[canonical] : [];
  // Preserve only the consultant already assigned to this saved record and area.
  const previous = canonicalResponsible(existingRecord?.responsavel, parameters);
  const preserve = existingRecord && canonicalArea(existingRecord.areaTecnica, parameters) === canonical
    && validAssignmentArea(canonical, previous, parameters)
    && !ambiguousConsultantArea(canonical, previous, parameters)
    && parameters.consultores?.includes(previous);
  return [...new Set([...local, ...(preserve ? [previous] : [])])].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function validAssignmentArea(area, responsible, parameters) {
  const canonical = canonicalArea(area, parameters);
  if (parameters.areasTecnicas.includes(canonical)) return true;
  return Boolean(parameters.legacyAreasTecnicas?.includes(canonical)
    && parameters.consultores?.includes(canonicalResponsible(responsible, parameters)));
}

export function assignmentIssue(record, parameters) {
  const area = canonicalArea(record.areaTecnica, parameters);
  const responsible = canonicalResponsible(record.responsavel, parameters);
  const fields = [];
  if (!validAssignmentArea(area, responsible, parameters) || ambiguousConsultantArea(area, responsible, parameters)) fields.push("areaTecnica");
  if (!responsibleOptions(area, parameters, record).includes(responsible)) fields.push("responsavel");
  if (!fields.length) return null;
  return {
    fields,
    message: fields.includes("areaTecnica")
      ? "Selecione uma área da lista atual e o responsável dessa área."
      : "Selecione o responsável desta área.",
    previousArea: record.areaTecnica || "Não informada",
    previousResponsible: record.responsavel || "Não informado"
  };
}

// Preserve an unresolved historical assignment only while its area is unchanged.
export function retainedResponsible(area, current, parameters, existingRecord = null) {
  const canonical = canonicalResponsible(current, parameters);
  return responsibleOptions(area, parameters, existingRecord).includes(canonical) ? canonical : "";
}
