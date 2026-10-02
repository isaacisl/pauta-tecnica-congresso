const clean = value => typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
const key = value => clean(value).normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
const indexes = new WeakMap();
function directoryIndex(parameters) {
  if (!indexes.has(parameters)) indexes.set(parameters, {
    areas: new Map(parameters.areasTecnicas.map(area => [key(area), area])),
    people: new Map(parameters.responsaveis.map(name => [key(name), name]))
  });
  return indexes.get(parameters);
}

export function canonicalArea(value, parameters) {
  const aliases = { "gabinete presidente": "Gabinete do Presidente", "pre atendimento": "Pré-Atendimento" };
  const candidate = Object.hasOwn(aliases, key(value)) ? aliases[key(value)] : clean(value);
  return directoryIndex(parameters).areas.get(key(candidate)) || clean(value);
}

export function canonicalResponsible(value, parameters) {
  const name = clean(value).replace(/\s*\((?:colaborador|consultor)\)\s*$/i, "");
  return directoryIndex(parameters).people.get(key(name)) || clean(value);
}

export function responsibleOptions(area, parameters) {
  const canonical = canonicalArea(area, parameters);
  return Object.hasOwn(parameters.responsaveisPorArea, canonical) ? parameters.responsaveisPorArea[canonical] : [];
}

export function assignmentIssue(record, parameters) {
  const area = canonicalArea(record.areaTecnica, parameters);
  const responsible = canonicalResponsible(record.responsavel, parameters);
  const fields = [];
  if (!parameters.areasTecnicas.includes(area)) fields.push("areaTecnica");
  if (!responsibleOptions(area, parameters).includes(responsible)) fields.push("responsavel");
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

// Changing area never retains a person from another sector.
export function retainedResponsible(area, current, parameters) {
  const canonical = canonicalResponsible(current, parameters);
  return responsibleOptions(area, parameters).includes(canonical) ? canonical : "";
}
