import assert from "node:assert/strict";
import { test } from "node:test";
import { officialLinks } from "../public/official-links.js";

const senatePage = "https://www25.senado.leg.br/web/atividade/materias/-/materia/174939";
const senateIdentity = { source: "senado", externalId: 9077370, house: "SF" };

test("registro novo do Senado abre a ficha pública da matéria", () => {
  const record = { proposition: { source: "senado", id: 9077370 },
    matter: { identifiers: [{ ...senateIdentity, codigoMateria: 174939 }] } };
  assert.deepEqual(officialLinks(record), [{ source: "senado", label: "Senado Federal", href: senatePage }]);
});

test("registro antigo recupera o link pelo código preservado na evidência", () => {
  const record = { proposition: { source: "senado", id: 9077370 },
    matter: { identifiers: [{ ...senateIdentity, codigoMateria: null,
      evidence: { id: 9077370, codigoMateria: 174939 } }] } };
  assert.deepEqual(officialLinks(record), [{ source: "senado", label: "Senado Federal", href: senatePage }]);
});

test("não usa código de matéria de outro processo nem confunde as Casas", () => {
  const record = { proposition: { source: "senado", id: 9077370 },
    matter: { identifiers: [
      { ...senateIdentity, codigoMateria: null, evidence: { id: 9999999, codigoMateria: 174939 } },
      { source: "senado", externalId: 9077370, house: "CD", codigoMateria: 174939 }
    ] } };
  assert.deepEqual(officialLinks(record), []);
});
