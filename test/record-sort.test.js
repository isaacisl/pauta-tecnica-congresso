import assert from "node:assert/strict";
import { test } from "node:test";
import { sortRecords } from "../public/record-sort.js";

const records = [
  { id: 1, createdAt: "2026-01-01T10:00:00Z", editedAt: null },
  { id: 2, createdAt: "2026-01-02T10:00:00Z", editedAt: "2026-02-04T10:00:00Z" },
  { id: 3, createdAt: "2026-01-03T10:00:00Z", editedAt: "2026-02-02T10:00:00Z" },
  { id: 4, createdAt: "2026-01-03T10:00:00Z", editedAt: "2026-02-02T10:00:00Z" },
  { id: 5, createdAt: "2026-01-05T10:00:00Z", editedAt: "inválido" }
];

test("atualizações pendentes vêm antes da paginação e usam a detecção mais recente", () => {
  const values = [
    { id: 1, createdAt: "2026-06-01", tramitationNotice: { count: 0, events: [] } },
    { id: 2, createdAt: "2026-01-01", tramitationNotice: { count: 2, events: [{ date: "2099-01-01", detectedAt: "2026-11-10T10:00:00Z" }, { detectedAt: "2026-11-09T10:00:00Z" }] } },
    { id: 3, createdAt: "2026-03-01", tramitationNotice: { count: 1, events: [{ date: "2000-01-01", detectedAt: "2026-11-11T10:00:00Z" }] } },
    { id: 4, createdAt: "2026-04-01", tramitationNotice: { count: 1, events: [{ detectedAt: "inválido" }] } },
    { id: 5, createdAt: "2026-06-02", tramitationNotice: { count: 0, events: [{ detectedAt: "2099-01-01" }] } }
  ];
  const before = structuredClone(values);
  assert.deepEqual(sortRecords(values).map(row => row.id), [3, 2, 4, 5, 1]);
  assert.deepEqual(sortRecords(values, "updates-first").slice(0, 2).map(row => row.id), [3, 2]);
  assert.deepEqual(sortRecords(values, "created-desc").map(row => row.id), [5, 1, 4, 3, 2]);
  assert.deepEqual(values, before);
});

test("classifica pela data real de inclusão ou edição, com desempate determinístico e sem modificar a origem", () => {
  const before = structuredClone(records);
  const ids = sort => sortRecords(records, sort).map(record => record.id);
  assert.deepEqual(ids("created-desc"), [5, 4, 3, 2, 1]);
  assert.deepEqual(ids("created-asc"), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids("edited-desc"), [2, 4, 3, 5, 1]);
  assert.deepEqual(ids("edited-asc"), [3, 4, 2, 1, 5]);
  assert.deepEqual(ids("invalid"), ids("created-desc"));
  assert.deepEqual(records, before);
  assert.deepEqual(sortRecords([], "edited-asc"), []);
});

test("ordena todos os registros antes de paginar sem repetição, desaparecimento ou datas de edição inventadas", () => {
  const values = Array.from({ length: 28 }, (_, index) => ({ id: index + 1, createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), editedAt: index % 3 ? new Date(Date.UTC(2026, 1, 28 - index)).toISOString() : null, updatedAt: "2099-01-01T10:00:00Z" }));
  for (const sort of ["created-asc", "created-desc", "edited-asc", "edited-desc"]) {
    for (const size of [5, 10, 25]) {
      const sorted = sortRecords(values, sort);
      const pages = Array.from({ length: Math.ceil(sorted.length / size) }, (_, index) => sorted.slice(index * size, (index + 1) * size));
      assert.equal(new Set(pages.flat().map(record => record.id)).size, values.length);
      assert.deepEqual(pages.flat(), sorted);
      if (sort.startsWith("edited")) assert.ok(sorted.slice(-10).every(record => !record.editedAt));
    }
  }
  assert.equal(sortRecords([{ id: 1, createdAt: "invalid" }, { id: 2, createdAt: "2026-01-01" }])[0].id, 2);
});
