import { responsaveisPorArea } from "./collaborators.js";

export const parameters = Object.freeze({
  areasTecnicas: Object.freeze(Object.keys(responsaveisPorArea)),
  responsaveis: Object.freeze([...new Set(Object.values(responsaveisPorArea).flat())].sort((a, b) => a.localeCompare(b, "pt-BR"))),
  responsaveisPorArea,
  // Preserve original technical areas of existing consultants; do not infer renames.
  legacyAreasTecnicas: Object.freeze([
    "Consórcios Públicos", "Contabilidade", "Finanças", "Jurídico", "Mulheres",
    "Obras e Transf. da União", "Previdência", "Proteção e Defesa Civil"
  ]),
  pareceres: Object.freeze(["Sim", "Não", "Em andamento"]),
  emendas: Object.freeze(["Sim", "Não"]),
  posicionamentos: Object.freeze(["Favorável", "Desfavorável", "Indiferente"])
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
  "posicionamento"
]);
