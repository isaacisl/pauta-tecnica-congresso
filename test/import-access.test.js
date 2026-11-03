import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { startServer } from "../server.js";

const password = process.env.EXPORT_PASSWORD || "CentralDeDados2026";

test("importação exige a senha da exportação na autorização, leitura e gravação", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pauta-import-access-"));
  let app;
  try {
    app = await startServer({ port: 0, databasePath: path.join(directory, "test.sqlite"), tramitationCheckDelayMs: null });
    const request = (endpoint, credential, body = "{}", headers = {}) => fetch(`${app.url}${endpoint}`, {
      method: "POST", headers: { ...headers, ...(credential === undefined ? {} : { "X-Import-Password": encodeURIComponent(credential) }) }, body
    });
    for (const credential of [undefined, "", "senha-incorreta-importacao-teste"]) {
      for (const endpoint of ["/api/import/authorize", "/api/import/preview", "/api/import/records"]) {
        const response = await request(endpoint, credential);
        assert.equal(response.status, 401, endpoint);
        assert.match((await response.json()).error, /senha/i);
      }
    }
    assert.equal((await request("/api/import/authorize", password)).status, 200);
    const preview = await request("/api/import/preview", password, "Projeto\nPL 123/2026", { "X-File-Name": "lista.csv" });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).sheets[0].rows.length, 1);
    assert.equal((await request("/api/import/records", password, JSON.stringify({ key: randomUUID(), record: {} }))).status, 422);
    const exported = await fetch(`${app.url}/api/export.csv`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    assert.equal(exported.status, 200);
    const records = await (await fetch(`${app.url}/api/records`)).json();
    assert.equal(records.records.length, 0);
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
