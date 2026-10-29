const colors = Object.freeze({
  blue: "#245fa4", green: "#198052", red: "#bc4233", amber: "#c99116", gray: "#a1adbc"
});

const countOf = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export function chartColor(label, kind = "position") {
  if (kind === "position") return label === "Favorável" ? colors.green : label === "Desfavorável" ? colors.red : colors.gray;
  if (label === "Sim") return colors.blue;
  return label === "Em andamento" ? colors.amber : kind === "opinion" ? colors.red : colors.gray;
}

export function chartSeries(options, series, kind) {
  const counts = new Map(series.map(item => [item.label, countOf(item.count)]));
  const labels = [...new Set([...options, ...counts.keys()])];
  return labels.map(label => ({ label, count: counts.get(label) ?? 0, color: chartColor(label, kind) }));
}

export function donutBackground(series) {
  const total = series.reduce((sum, item) => sum + countOf(item.count), 0);
  if (!total) return "#edf1f6";
  let offset = 0;
  return `conic-gradient(${series.filter(item => item.count > 0).map(item => {
    const start = offset;
    offset += item.count / total * 100;
    return `${item.color} ${start}% ${offset}%`;
  }).join(", ")})`;
}

// Compatibility with a server still running the previous version during deployment.
export function groupAreaPositions(records) {
  const areas = new Map();
  for (const record of records) {
    if (!areas.has(record.areaTecnica)) areas.set(record.areaTecnica, new Map());
    const positions = areas.get(record.areaTecnica);
    positions.set(record.posicionamento, (positions.get(record.posicionamento) ?? 0) + 1);
  }
  return [...areas].flatMap(([label, positions]) => [...positions].map(([position, count]) => ({ label, position, count })));
}

export function areaChartRows(byArea, byAreaPosition, options) {
  const groups = new Map();
  for (const item of byAreaPosition) {
    if (!groups.has(item.label)) groups.set(item.label, []);
    groups.get(item.label).push({ label: item.position, count: item.count });
  }
  const areas = byArea.filter(item => countOf(item.count) > 0)
    .map(item => ({ label: item.label, count: countOf(item.count) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
  const max = Math.max(1, ...areas.map(item => item.count));
  return areas.map(item => ({ ...item, segments: chartSeries(options, groups.get(item.label) ?? [], "position")
    .map(segment => ({ ...segment, width: segment.count / max * 100 })) }));
}
