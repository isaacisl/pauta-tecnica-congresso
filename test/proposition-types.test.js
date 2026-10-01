import assert from "node:assert/strict";
import { test } from "node:test";
import { createCamaraClient } from "../lib/camara.js";
import { propositionTypes, propositionTypeCodes } from "../lib/proposition-types.js";
import { matchingPropositionTypes } from "../public/proposition-type-utils.js";

test("catálogo oficial inclui siglas além da lista principal, sem duplicatas", () => {
  assert.ok(propositionTypes.length > 150);
  assert.equal(propositionTypes.length, propositionTypeCodes.size);
  for (const code of ["PL", "PLP", "PDL", "PRLP(V)", "PR/CNJ", "ATA_PRE"]) {
    assert.ok(propositionTypeCodes.has(code), `${code} deve estar disponível`);
  }
});

test("sugestões seguem o prefixo digitado, sem consultar proposições", () => {
  const p = matchingPropositionTypes(propositionTypes, "p").map(([code]) => code);
  const pl = matchingPropositionTypes(propositionTypes, " pl ").map(([code]) => code);
  assert.ok(p.includes("PL") && p.includes("PLP") && p.includes("PDL"));
  assert.ok(pl.includes("PL") && pl.includes("PLP"));
  assert.ok(!pl.includes("PDL"));
  assert.deepEqual(matchingPropositionTypes(propositionTypes, ""), []);
});

test("pesquisa aceita sigla adicional somente com os três parâmetros", async () => {
  const calls = [];
  const client = createCamaraClient(async (url) => {
    calls.push(url);
    return Response.json({ dados: [{ id: 123, siglaTipo: "PRLP(V)", numero: 7, ano: 2026, ementa: "Parecer" }] });
  });
  await assert.rejects(() => client.search(new URLSearchParams("siglaTipo=PRLP(V)&numero=7")));
  await assert.rejects(() => client.search(new URLSearchParams("siglaTipo=INEXISTENTE&numero=7&ano=2026")));
  assert.equal(calls.length, 0);
  const result = await client.search(new URLSearchParams("siglaTipo=PRLP(V)&numero=7&ano=2026"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("siglaTipo"), "PRLP(V)");
  assert.equal(result.results[0].projeto, "PRLP(V) 7/2026");
});
