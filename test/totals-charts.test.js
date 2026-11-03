import assert from "node:assert/strict";
import { test } from "node:test";
import { chartSeries, donutBackground, groupAreaPositions, areaChartRows } from "../public/totals-charts.js";

const positions = ["Favorável", "Desfavorável", "Indiferente"];

test("N/I aparece como categoria neutra e participa dos totais dos gráficos", () => {
  for (const kind of ["opinion", "amendment", "position"]) {
    const series = chartSeries(["Sim", "N/I"], [{ label: "Sim", count: 1 }, { label: "N/I", count: 2 }], kind);
    assert.equal(series[1].color, "#62758a");
    assert.equal(series[1].count, 2);
    assert.equal(series.reduce((sum, item) => sum + item.count, 0), 3);
  }
  const positions = chartSeries(["Indiferente", "N/I"], [{ label: "Indiferente", count: 1 }, { label: "N/I", count: 1 }], "position");
  assert.notEqual(positions[0].color, positions[1].color, "ausência de informação é diferente de posicionamento indiferente");
});

test("gráficos incluem categorias zeradas e mantêm cores consistentes", () => {
  const series = chartSeries(positions, [{ label: "Favorável", count: 3 }, { label: "Indiferente", count: 1 }], "position");
  assert.deepEqual(series.map(item => item.count), [3, 0, 1]);
  assert.equal(donutBackground(series), "conic-gradient(#198052 0% 75%, #a1adbc 75% 100%)");
  assert.equal(donutBackground(chartSeries(positions, [], "position")), "#edf1f6");
  assert.ok(!donutBackground(series).includes("NaN"));
  assert.equal(chartSeries(["Sim", "Não"], [{ label: "Sim", count: 2 }], "amendment")[1].color, "#a1adbc");
  assert.equal(chartSeries(["Sim", "Não"], [{ label: "Sim", count: 2 }], "opinion")[1].color, "#bc4233");
});

test("barras empilhadas refletem a distribuição real e escala relativa entre áreas", () => {
  const records = [
    { areaTecnica: "Educação", posicionamento: "Favorável" },
    { areaTecnica: "Educação", posicionamento: "Desfavorável" },
    { areaTecnica: "Educação", posicionamento: "Favorável" },
    { areaTecnica: "Educação", posicionamento: "Indiferente" },
    { areaTecnica: "Cultura", posicionamento: "Indiferente" }
  ];
  const rows = areaChartRows([{ label: "Cultura", count: 1 }, { label: "Educação", count: 4 }], groupAreaPositions(records), positions);
  assert.equal(rows[0].label, "Educação");
  assert.deepEqual(rows[0].segments.map(item => item.count), [2, 1, 1]);
  assert.deepEqual(rows[0].segments.map(item => item.width), [50, 25, 25]);
  assert.equal(rows[1].segments.reduce((sum, item) => sum + item.width, 0), 25);
  assert.deepEqual(areaChartRows([], [], positions), []);
});

test("séries preservam categorias legadas sem quebrar o gráfico", () => {
  const series = chartSeries(positions, [{ label: "Não informado", count: 1 }], "position");
  assert.equal(series.at(-1).label, "Não informado");
  assert.equal(series.at(-1).count, 1);
  assert.equal(donutBackground(series), "conic-gradient(#a1adbc 0% 100%)");
});
