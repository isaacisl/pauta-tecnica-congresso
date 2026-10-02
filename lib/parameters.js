import { responsaveisPorArea } from "./collaborators.js";

export const parameters = Object.freeze({
  areasTecnicas: Object.freeze(Object.keys(responsaveisPorArea)),
  responsaveis: Object.freeze([...new Set(Object.values(responsaveisPorArea).flat())].sort((a, b) => a.localeCompare(b, "pt-BR"))),
  responsaveisPorArea,
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
