export function matchingPropositionTypes(types, input) {
  const prefix = String(input || "").trim().toLocaleUpperCase("pt-BR");
  return prefix ? types.filter(([code]) => code.startsWith(prefix)) : [];
}
