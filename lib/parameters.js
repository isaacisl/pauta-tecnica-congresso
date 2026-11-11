import { responsaveisPorArea, consultoresPorArea, responsaveisLegados } from "./collaborators.js";

export const parameters = Object.freeze({
  areasTecnicas: Object.freeze(Object.keys(responsaveisPorArea)),
  responsaveis: Object.freeze([...new Set(Object.values(responsaveisPorArea).flat())].sort((a, b) => a.localeCompare(b, "pt-BR"))),
  responsaveisPorArea,
  consultoresPorArea,
  responsaveisLegados,
  consultores: Object.freeze([...new Set([...Object.values(consultoresPorArea).flat(), ...responsaveisLegados])]),
  // Retain unresolved historical assignments without offering these areas in new forms.
  legacyAreasTecnicas: Object.freeze([
    "Consultor", "Consórcios Públicos", "Contabilidade", "Finanças", "Jurídico", "Mulheres",
    "Obras e Transf. da União", "Previdência", "Proteção e Defesa Civil"
  ]),
  pareceres: Object.freeze(["Sim", "Não", "Em andamento", "N/I"]),
  emendas: Object.freeze(["Sim", "Não", "N/I"]),
  posicionamentos: Object.freeze(["Favorável", "Desfavorável", "Indiferente", "N/I"]),
  prioridades: Object.freeze(["Alta", "Média", "Baixa", "N/I"])
});

export const recordFields = Object.freeze([
  "areaTecnica",
  "responsavel",
  "projeto",
  "autor",
  "ementa",
  "despacho",
  "atualComissao",
  "haParecer",
  "sugestaoEmenda",
  "posicionamento",
  "prioridade"
]);
