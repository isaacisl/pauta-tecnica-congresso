const normalized = value => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
export const importKey = value => normalized(value).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function importIdentity(row) {
  const official = row.proposition || row.camara;
  const matterId = row.matterId || official?.matterId;
  if (matterId) return `matter:${matterId}`;
  if (official?.id) return `${official.source || "camara"}:${official.id}`;
  return null;
}

export function importDuplicateIndex(rows, existing, area = "") {
  const index = new Map();
  for (const row of [...existing, ...rows.filter(row => row.selected && !row.record)]) {
    const identity = importIdentity(row);
    if (!identity) continue;
    const key = JSON.stringify([identity, row.areaTecnica ?? area, row.responsible || row.responsavel]);
    index.set(key, (index.get(key) || 0) + 1);
  }
  return index;
}

export function parseImportProject(value, types) {
  const match = normalized(value).toUpperCase().match(/^(.+?)\s+(\d{1,9})\s*\/\s*(\d{4})$/);
  if (!match || !Number(match[2]) || Number(match[3]) < 1000) return null;
  if (!types.some(([type]) => type === match[1])) return null;
  return { siglaTipo: match[1], numero: String(Number(match[2])), ano: match[3] };
}

export function importChoice(value, options) {
  return options.find(option => importKey(option) === importKey(value)) || "";
}

export function mappedImportRows(sheet, mapping, parameters, uuid) {
  const fields = { posicionamento: parameters.posicionamentos, haParecer: parameters.pareceres, sugestaoEmenda: parameters.emendas, prioridade: parameters.prioridades };
  return sheet.rows.filter(row => row.cells.some(value => normalized(value))).map(row => {
    const raw = Object.fromEntries(["projeto", ...Object.keys(fields)].map(field => {
      const index = mapping[field];
      return [field, index >= 0 ? String(row.cells[index] ?? "").trim() : ""];
    }));
    return { key: uuid(), line: row.line, projeto: raw.projeto, raw, selected: true,
      areaTecnica: "", customArea: false, responsible: "", customResponsible: false,
      ...Object.fromEntries(Object.entries(fields).map(([field, options]) => [field, normalized(raw[field]) ? importChoice(raw[field], options) : "N/I"])),
      documents: [], proposition: null, propositionToken: "", candidates: [], searchToken: "", warnings: [], status: "waiting", lookupOutcome: "unqueried", error: "", record: null, attempt: null };
  });
}

export function importRowIssues(row, area, people, duplicates = false) {
  if (row.status === "done") return [];
  if (row.record) return row.documents.some(doc => !doc.uploaded) ? ["Envio de documentos pendente."] : [];
  const issues = [];
  if (!area) issues.push("Escolha a área técnica.");
  if (!people.includes(row.responsible)) issues.push("Escolha o responsável.");
  if (!row.propositionToken) issues.push(row.status === "searching" ? "Consultando o projeto…" : "Confirme o projeto na busca oficial.");
  if (!row.haParecer) issues.push("Informe se há parecer elaborado.");
  if (!row.sugestaoEmenda) issues.push("Informe se há sugestão de emenda.");
  if (!row.posicionamento) issues.push("Informe o posicionamento.");
  if (!row.prioridade) issues.push("Informe a prioridade.");
  if (row.documents.some(doc => !doc.title.trim() || !doc.description.trim())) issues.push("Complete título e descrição dos documentos.");
  if (duplicates) issues.push("Já há outra linha ou acompanhamento deste projeto para a mesma área e responsável.");
  return issues;
}
