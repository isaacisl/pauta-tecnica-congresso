export function sameMatter(previous, next) {
  if (!previous || !next) return false;
  if (previous.matterId && next.matterId) return previous.matterId === next.matterId;
  return (previous.source || "camara") === (next.source || "camara") && previous.id === next.id;
}

export function navigationValues(previous, next, current, replaceManual = false) {
  const same = sameMatter(previous, next);
  return Object.fromEntries(["despacho", "atualComissao"].map(field => {
    const official = next[field] || "";
    const manual = current[field] && current[field] !== (previous?.[field] || "");
    return [field, same && manual && !replaceManual ? current[field] : official];
  }));
}
