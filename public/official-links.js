const validId = (value) => Number.isSafeInteger(value) && value > 0;

function senateMatterId(identifier) {
  if (validId(identifier.codigoMateria)) return identifier.codigoMateria;
  // Older records may have lost the code from the identifier when the initial
  // process and the current process shared an ID. The verified evidence kept it.
  return identifier.evidence?.id === identifier.externalId && validId(identifier.evidence?.codigoMateria)
    ? identifier.evidence.codigoMateria : null;
}

export function officialLinks(record) {
  const identifiers = record.matter?.identifiers || [];
  const camaraId = identifiers.find((identifier) => identifier.source === "camara" && validId(identifier.externalId))?.externalId
    || (validId(record.camara?.id) ? record.camara.id : null)
    || (record.proposition?.source === "camara" && validId(record.proposition.id) ? record.proposition.id : null);
  const senate = identifiers.filter((identifier) => identifier.source === "senado" && identifier.house === "SF")
    .map((identifier) => ({ identifier, materiaId: senateMatterId(identifier) }))
    .filter(({ materiaId }) => validId(materiaId));
  const preferredSenate = senate.find(({ identifier }) => identifier.externalId === record.proposition?.id) || senate[0];

  return [
    ...(camaraId ? [{ source: "camara", label: "Câmara dos Deputados", href: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${camaraId}` }] : []),
    ...(preferredSenate ? [{ source: "senado", label: "Senado Federal", href: `https://www25.senado.leg.br/web/atividade/materias/-/materia/${preferredSenate.materiaId}` }] : [])
  ];
}
