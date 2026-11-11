export const recordSortOptions = Object.freeze({
  "updates-first": "Atualizações primeiro",
  "created-desc": "Inclusão · mais recentes",
  "created-asc": "Inclusão · mais antigas",
  "edited-desc": "Última edição · mais recentes",
  "edited-asc": "Última edição · mais antigas"
});

const timestamp = value => value ? Date.parse(value) : NaN;
const latestDetection = record => Math.max(-Infinity, ...(record.tramitationNotice?.events || [])
  .map(event => timestamp(event.detectedAt)).filter(Number.isFinite));

export function sortRecords(records, selected = "updates-first") {
  const sort = Object.hasOwn(recordSortOptions, selected) ? selected : "updates-first";
  const field = sort.startsWith("edited") ? "editedAt" : "createdAt";
  const direction = sort.endsWith("asc") ? 1 : -1;
  return [...records].sort((a, b) => {
    if (sort === "updates-first") {
      const leftPending = Number(a.tramitationNotice?.count) > 0;
      const rightPending = Number(b.tramitationNotice?.count) > 0;
      if (leftPending !== rightPending) return leftPending ? -1 : 1;
      if (leftPending) {
        const leftDetection = latestDetection(a);
        const rightDetection = latestDetection(b);
        if (leftDetection !== rightDetection) return rightDetection > leftDetection ? 1 : -1;
      }
    }
    const left = timestamp(a[field]);
    const right = timestamp(b[field]);
    if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
    if (Number.isFinite(left) && left !== right) return (left - right) * direction;
    const createdLeft = timestamp(a.createdAt);
    const createdRight = timestamp(b.createdAt);
    if (Number.isFinite(createdLeft) !== Number.isFinite(createdRight)) return Number.isFinite(createdLeft) ? -1 : 1;
    if (Number.isFinite(createdLeft) && createdLeft !== createdRight) return (createdLeft - createdRight) * direction;
    return (Number(a.id) - Number(b.id)) * direction;
  });
}
