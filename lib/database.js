import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parameters, recordFields } from "./parameters.js";

const selectColumns = `
  id,
  revision,
  deleted_at AS deletedAt,
  area_tecnica AS areaTecnica,
  responsavel,
  projeto,
  autor,
  ementa,
  despacho,
  atual_comissao AS atualComissao,
  ha_parecer AS haParecer,
  sugestao_emenda AS sugestaoEmenda,
  posicionamento,
  attachment_name AS attachmentName,
  attachment_mime AS attachmentMime,
  attachment_size AS attachmentSize,
  created_at AS createdAt,
  updated_at AS updatedAt,
  edited_at AS editedAt,
  matter_id AS matterId,
  camara_json AS camaraJson,
  proposition_json AS propositionJson
`;

const controlledFields = Object.freeze({
  areaTecnica: parameters.areasTecnicas,
  responsavel: parameters.responsaveis,
  haParecer: parameters.pareceres,
  sugestaoEmenda: parameters.emendas,
  posicionamento: parameters.posicionamentos
});

const lengthLimits = Object.freeze({
  areaTecnica: 120,
  responsavel: 180,
  projeto: 300,
  autor: 12000,
  ementa: 6000,
  despacho: 8000,
  atualComissao: 300,
  haParecer: 40,
  sugestaoEmenda: 20,
  posicionamento: 40
});

export class ValidationError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = "ValidationError";
    this.fields = fields;
  }
}

function normalizeRecord(input) {
  return Object.fromEntries(
    recordFields.map((field) => [field, typeof input?.[field] === "string" ? input[field].trim() : ""])
  );
}

function validateRecord(input) {
  const record = normalizeRecord(input);
  const errors = {};

  for (const field of recordFields) {
    if ((field === "ementa" && (input?.camara || input?.proposition)) || ["autor", "despacho", "atualComissao"].includes(field)) {
      if (record[field].length > lengthLimits[field]) errors[field] = `Use no máximo ${lengthLimits[field]} caracteres.`;
      continue;
    }
    if (!record[field]) {
      errors[field] = "Campo obrigatório.";
      continue;
    }
    if (record[field].length > lengthLimits[field]) {
      errors[field] = `Use no máximo ${lengthLimits[field]} caracteres.`;
    }
  }

  for (const [field, allowedValues] of Object.entries(controlledFields)) {
    if (record[field] && !allowedValues.includes(record[field])) {
      errors[field] = "Selecione uma opção válida.";
    }
  }

  if (Object.keys(errors).length) {
    throw new ValidationError("Revise os campos informados.", errors);
  }

  return record;
}

function buildRecordFilter(filters = {}) {
  const clauses = ["deleted_at IS NULL"];
  const values = [];
  const filterColumns = {
    areaTecnica: "area_tecnica",
    responsavel: "responsavel",
    haParecer: "ha_parecer",
    sugestaoEmenda: "sugestao_emenda",
    posicionamento: "posicionamento"
  };

  for (const [field, column] of Object.entries(filterColumns)) {
    const value = typeof filters[field] === "string" ? filters[field].trim() : "";
    if (value) {
      clauses.push(`${column} = ?`);
      values.push(value);
    }
  }

  const query = typeof filters.q === "string" ? filters.q.trim() : "";
  if (query) {
    clauses.push(`(projeto LIKE ? OR autor LIKE ? OR ementa LIKE ? OR atual_comissao LIKE ? OR responsavel LIKE ? OR EXISTS (
      SELECT 1 FROM legislative_identifiers AS alias WHERE alias.matter_id = records.matter_id
      AND (alias.sigla || ' ' || alias.numero || '/' || alias.ano) LIKE ?
    ))`);
    const pattern = `%${query}%`;
    values.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }

  return {
    sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    values
  };
}

export function createDatabase(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      area_tecnica TEXT NOT NULL,
      responsavel TEXT NOT NULL,
      projeto TEXT NOT NULL,
      autor TEXT NOT NULL DEFAULT '',
      ementa TEXT NOT NULL,
      despacho TEXT NOT NULL DEFAULT '',
      atual_comissao TEXT NOT NULL,
      ha_parecer TEXT NOT NULL,
      sugestao_emenda TEXT NOT NULL,
      posicionamento TEXT NOT NULL,
      attachment_name TEXT,
      attachment_stored_name TEXT,
      attachment_mime TEXT,
      attachment_size INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      edited_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_records_area_tecnica ON records(area_tecnica);
    CREATE INDEX IF NOT EXISTS idx_records_ha_parecer ON records(ha_parecer);
    CREATE INDEX IF NOT EXISTS idx_records_sugestao_emenda ON records(sugestao_emenda);
    CREATE INDEX IF NOT EXISTS idx_records_posicionamento ON records(posicionamento);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS legislative_matters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camara_id INTEGER UNIQUE,
      camara_json TEXT,
      senado_json TEXT NOT NULL DEFAULT '[]',
      cached_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS legislative_identifiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matter_id INTEGER NOT NULL REFERENCES legislative_matters(id),
      source TEXT NOT NULL CHECK (source IN ('camara', 'senado')),
      external_id INTEGER NOT NULL,
      house TEXT NOT NULL CHECK (house IN ('CD', 'SF')),
      sigla TEXT NOT NULL,
      numero INTEGER NOT NULL,
      ano INTEGER NOT NULL,
      codigo_materia INTEGER,
      evidence_json TEXT,
      UNIQUE (source, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_legislative_identification ON legislative_identifiers(sigla, numero, ano);
    CREATE TABLE IF NOT EXISTS proposition_search_cache (
      query_key TEXT PRIMARY KEY,
      results_json TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );
  `);

  // Older versions required a Câmara ID. Rebuild only the identity table, preserving
  // primary keys and all record/attachment data. Foreign keys are checked before commit.
  const matterColumns = database.prepare("PRAGMA table_info(legislative_matters)").all();
  if (matterColumns.find((column) => column.name === "camara_id").notnull) {
    database.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE");
    try {
      database.exec(`
        CREATE TABLE legislative_matters_next (
          id INTEGER PRIMARY KEY AUTOINCREMENT, camara_id INTEGER UNIQUE,
          camara_json TEXT, senado_json TEXT NOT NULL DEFAULT '[]', cached_at TEXT NOT NULL
        );
        INSERT INTO legislative_matters_next(id, camara_id, camara_json, cached_at)
          SELECT id, camara_id, camara_json, cached_at FROM legislative_matters;
        DROP TABLE legislative_matters;
        ALTER TABLE legislative_matters_next RENAME TO legislative_matters;
      `);
      if (database.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Falha de integridade na migração das matérias.");
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    finally { database.exec("PRAGMA foreign_keys = ON"); }
  }

  const existingColumns = new Set(database.prepare("PRAGMA table_info(records)").all().map((column) => column.name));
  const additionalColumns = {
    revision: "INTEGER NOT NULL DEFAULT 1",
    deleted_at: "TEXT",
    autor: "TEXT NOT NULL DEFAULT ''",
    despacho: "TEXT NOT NULL DEFAULT ''",
    camara_json: "TEXT",
    proposition_json: "TEXT",
    matter_id: "INTEGER REFERENCES legislative_matters(id)",
    attachment_name: "TEXT",
    attachment_stored_name: "TEXT",
    attachment_mime: "TEXT",
    attachment_size: "INTEGER"
  };
  for (const [column, type] of Object.entries(additionalColumns)) {
    if (!existingColumns.has(column)) database.exec(`ALTER TABLE records ADD COLUMN ${column} ${type}`);
  }
  if (!existingColumns.has("edited_at")) {
    database.exec("ALTER TABLE records ADD COLUMN edited_at TEXT");
    database.exec("UPDATE records SET edited_at = updated_at WHERE updated_at <> created_at");
  }

  database.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS record_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime TEXT,
      size INTEGER NOT NULL,
      created_at TEXT,
      deleted_at TEXT,
      upload_key TEXT,
      UNIQUE(record_id, upload_key),
      UNIQUE(record_id, stored_name)
    );
    CREATE INDEX IF NOT EXISTS idx_record_attachments ON record_attachments(record_id, id);
    INSERT OR IGNORE INTO record_attachments(record_id, name, stored_name, mime, size, created_at)
      SELECT id, COALESCE(attachment_name, attachment_stored_name), attachment_stored_name, attachment_mime, COALESCE(attachment_size, 0), NULL
      FROM records WHERE attachment_stored_name IS NOT NULL;
    UPDATE records SET attachment_name = NULL, attachment_stored_name = NULL,
      attachment_mime = NULL, attachment_size = NULL WHERE attachment_stored_name IS NOT NULL;
    COMMIT;
  `);

  // Arquivos anteriores à opção de remoção permanecem ativos.
  const attachmentColumns = new Set(database.prepare("PRAGMA table_info(record_attachments)").all().map((column) => column.name));
  if (!attachmentColumns.has("deleted_at")) database.exec("ALTER TABLE record_attachments ADD COLUMN deleted_at TEXT");

  // Backfill only verified external IDs; never infer identity from text or project numbers.
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const row of database.prepare("SELECT id, camara_json FROM records WHERE matter_id IS NULL AND camara_json IS NOT NULL").all()) {
      const camara = JSON.parse(row.camara_json);
      if (!Number.isSafeInteger(camara.id) || !camara.siglaTipo || !camara.numero || !camara.ano) continue;
      storeMatter(camara);
      const matter = getMatterByCamaraId(camara.id);
      database.prepare("UPDATE records SET matter_id = ? WHERE id = ?").run(matter.id, row.id);
    }
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }

  database.exec("CREATE INDEX IF NOT EXISTS idx_records_matter ON records(matter_id)");

  database.exec(`
    CREATE TABLE IF NOT EXISTS record_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL REFERENCES records(id),
      action TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_record_history ON record_history(record_id, id);
    CREATE TABLE IF NOT EXISTS tramitation_health (
      source TEXT NOT NULL, external_id INTEGER NOT NULL,
      watched_at TEXT, attempted_at TEXT, error TEXT,
      PRIMARY KEY(source, external_id)
    );
    CREATE TABLE IF NOT EXISTS tramitation_scans (
      source TEXT NOT NULL CHECK (source IN ('camara', 'senado')),
      external_id INTEGER NOT NULL,
      initialized_at TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      PRIMARY KEY (source, external_id)
    );
    CREATE TABLE IF NOT EXISTS tramitation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL CHECK (source IN ('camara', 'senado')),
      external_id INTEGER NOT NULL,
      event_key TEXT NOT NULL,
      event_date TEXT NOT NULL,
      organization TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      detected_at TEXT,
      UNIQUE (source, external_id, event_key)
    );
    CREATE INDEX IF NOT EXISTS idx_tramitation_events_source ON tramitation_events(source, external_id, id);
    CREATE TABLE IF NOT EXISTS record_tramitation_seen (
      record_id INTEGER PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
      event_id INTEGER NOT NULL DEFAULT 0,
      seen_at TEXT
    );
  `);

  const getRecordStatement = database.prepare(`SELECT ${selectColumns} FROM records WHERE id = ? AND deleted_at IS NULL`);
  const insertStatement = database.prepare(`
    INSERT INTO records (
      area_tecnica, responsavel, projeto, autor, ementa, despacho, atual_comissao,
      ha_parecer, sugestao_emenda, posicionamento, camara_json, matter_id, proposition_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStatement = database.prepare(`
    UPDATE records SET
      area_tecnica = ?,
      responsavel = ?,
      projeto = ?,
      autor = ?,
      ementa = ?,
      despacho = ?,
      atual_comissao = ?,
      ha_parecer = ?,
      sugestao_emenda = ?,
      posicionamento = ?,
      camara_json = ?,
      matter_id = ?,
      proposition_json = ?,
      revision = revision + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND revision = ? AND deleted_at IS NULL
  `);
  const listAttachmentsStatement = database.prepare(`
    SELECT id, name, stored_name AS storedName, mime, size, created_at AS createdAt
    FROM record_attachments WHERE record_id = ? AND deleted_at IS NULL ORDER BY id DESC
  `);
  const listRemovedAttachmentsStatement = database.prepare(`
    SELECT id, name, size, created_at AS createdAt, deleted_at AS deletedAt
    FROM record_attachments WHERE record_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC
  `);
  const setAttachmentStatement = database.prepare(`
    INSERT INTO record_attachments(record_id, name, stored_name, mime, size, created_at, upload_key)
    VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)
  `);

  function deserialize(row) {
    if (!row) return null;
    const { camaraJson, propositionJson, ...record } = row;
    const matter = record.matterId ? getMatter(record.matterId) : null;
    const attachments = listAttachments(record.id).map(({ storedName, ...attachment }) => attachment);
    const removedAttachments = listRemovedAttachmentsStatement.all(record.id);
    return { ...record, monitoring: monitoring(record.matterId), tramitationNotice: tramitationNotice(record.id), attachments, removedAttachments,
      attachmentName: attachments[0]?.name || null, attachmentSize: attachments[0]?.size ?? null,
      attachmentMime: attachments[0]?.mime || null,
      camara: camaraJson ? JSON.parse(camaraJson) : null,
      proposition: propositionJson ? JSON.parse(propositionJson) : null,
      matter: matter ? { id: matter.id, identifiers: matter.identifiers } : null };
  }

  function get(id) {
    return deserialize(getRecordStatement.get(id));
  }

  function list(filters = {}) {
    const where = buildRecordFilter(filters);
    return database
      .prepare(`SELECT ${selectColumns} FROM records${where.sql} ORDER BY updated_at DESC, id DESC`)
      .all(...where.values).map(deserialize);
  }

  function create(input) {
    const record = validateRecord(input);
    const matterId = resolveMatter(input);
    let id;
    database.exec("BEGIN IMMEDIATE");
    try {
      ensureDistinctRecord(record, matterId);
      const result = insertStatement.run(...recordFields.map((field) => record[field]), input.camara ? JSON.stringify(input.camara) : null, matterId, input.proposition ? JSON.stringify(input.proposition) : null);
      id = Number(result.lastInsertRowid);
      setTramitationSeen(id, latestMatterEventId(matterId));
      audit(id, "created", null, record);
      watchMatter(matterId);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return get(id);
  }

  function checkRevision(previous, revision) {
    if (!Number.isSafeInteger(revision)) throw Object.assign(new Error("Reabra o registro antes de salvar. Esta tela não possui a versão atual do cadastro."), { status: 428 });
    if (revision !== previous.revision) throw Object.assign(new Error("Este registro foi alterado por outra pessoa. Suas alterações não foram salvas. Copie o que deseja preservar e reabra o registro para conferir a versão atual."), { status: 409 });
  }

  function audit(id, action, before, after) {
    const snapshot = (value) => value ? JSON.stringify(Object.fromEntries(recordFields.map(field => [field, value[field] ?? ""]))) : null;
    database.prepare("INSERT INTO record_history(record_id, action, before_json, after_json) VALUES (?, ?, ?, ?)")
      .run(id, action, snapshot(before), snapshot(after));
  }

  function auditAttachment(id, action, name) {
    database.prepare("INSERT INTO record_history(record_id, action, before_json) VALUES (?, ?, ?)")
      .run(id, action, JSON.stringify({ attachmentName: name }));
  }

  function history(id) {
    return database.prepare("SELECT id, action, before_json AS beforeJson, after_json AS afterJson, created_at AS createdAt FROM record_history WHERE record_id = ? ORDER BY id DESC").all(id)
      .map(({ beforeJson, afterJson, ...row }) => ({ ...row, before: beforeJson ? JSON.parse(beforeJson) : null, after: afterJson ? JSON.parse(afterJson) : null }));
  }

  function update(id, input) {
    const previous = get(id);
    if (!previous) return null;
    checkRevision(previous, input.revision);
    const record = validateRecord(input);
    const matterId = resolveMatter(input);
    database.exec("BEGIN IMMEDIATE");
    try {
      if (matterId !== previous.matterId || record.areaTecnica !== previous.areaTecnica || record.responsavel !== previous.responsavel) ensureDistinctRecord(record, matterId, id);
      const result = updateStatement.run(...recordFields.map((field) => record[field]), input.camara ? JSON.stringify(input.camara) : null, matterId, input.proposition ? JSON.stringify(input.proposition) : null, id, input.revision);
      if (!result.changes) throw Object.assign(new Error("O registro mudou durante a gravação. Reabra-o para conferir."), { status: 409 });
      if (matterId !== previous.matterId) resetTramitationSeen(id, latestMatterEventId(matterId));
      audit(id, "updated", previous, record);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    watchMatter(matterId);
    return get(id);
  }

  function remove(id, revision) {
    const previous = get(id);
    if (!previous) return false;
    checkRevision(previous, revision);
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = database.prepare("UPDATE records SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL").run(id, revision);
      if (!result.changes) throw Object.assign(new Error("O registro mudou. Reabra-o antes de excluir."), { status: 409 });
      audit(id, "deleted", previous, null);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return true;
  }

  function trash() {
    return database.prepare("SELECT id, projeto, area_tecnica AS areaTecnica, responsavel, revision, deleted_at AS deletedAt FROM records WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC").all();
  }

  function restore(id, revision) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const previous = database.prepare(`SELECT ${selectColumns} FROM records WHERE id = ? AND deleted_at IS NOT NULL`).get(id);
      if (!previous) { database.exec("COMMIT"); return null; }
      checkRevision(previous, revision);
      ensureDistinctRecord(previous, previous.matterId, id);
      database.prepare("UPDATE records SET deleted_at = NULL, revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(id);
      audit(id, "restored", null, previous);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return get(id);
  }

  function listAttachments(id) {
    return listAttachmentsStatement.all(id);
  }

  function getAttachment(id, attachmentId = null) {
    const attachments = listAttachments(id);
    return (attachmentId === null ? attachments[0] : attachments.find(item => item.id === attachmentId)) ?? null;
  }

  function findAttachmentUpload(id, key) {
    return database.prepare("SELECT id FROM record_attachments WHERE record_id = ? AND upload_key = ?").get(id, key) ?? null;
  }

  function setAttachment(id, attachment) {
    if (!get(id)) return null;
    database.exec("BEGIN IMMEDIATE");
    try {
      setAttachmentStatement.run(id, attachment.name, attachment.storedName, attachment.mime, attachment.size, attachment.uploadKey || null);
      database.prepare("UPDATE records SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(id);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return get(id);
  }

  function changeAttachmentStatus(id, attachmentId, revision, remove) {
    const previous = get(id);
    if (!previous) return null;
    checkRevision(previous, revision);
    const condition = remove ? "deleted_at IS NULL" : "deleted_at IS NOT NULL";
    const attachment = database.prepare(`SELECT name FROM record_attachments WHERE record_id = ? AND id = ? AND ${condition}`).get(id, attachmentId);
    if (!attachment) return null;
    database.exec("BEGIN IMMEDIATE");
    try {
      const attachmentUpdate = remove
        ? "UPDATE record_attachments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE record_id = ? AND id = ? AND deleted_at IS NULL"
        : "UPDATE record_attachments SET deleted_at = NULL WHERE record_id = ? AND id = ? AND deleted_at IS NOT NULL";
      if (!database.prepare(attachmentUpdate).run(id, attachmentId).changes) throw Object.assign(new Error("O documento mudou. Reabra o registro para conferir."), { status: 409 });
      const result = database.prepare("UPDATE records SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND revision = ? AND deleted_at IS NULL").run(id, revision);
      if (!result.changes) throw Object.assign(new Error("O registro mudou. Reabra-o antes de alterar documentos."), { status: 409 });
      auditAttachment(id, remove ? "attachment_removed" : "attachment_restored", attachment.name);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return get(id);
  }

  const removeAttachment = (id, attachmentId, revision) => changeAttachmentStatus(id, attachmentId, revision, true);
  const restoreAttachment = (id, attachmentId, revision) => changeAttachmentStatus(id, attachmentId, revision, false);

  function groupedBy(column, filters) {
    const where = buildRecordFilter(filters);
    return database
      .prepare(`SELECT ${column} AS label, COUNT(*) AS count FROM records${where.sql} GROUP BY ${column} ORDER BY count DESC, label COLLATE NOCASE`)
      .all(...where.values);
  }

  function totals(filters = {}) {
    const where = buildRecordFilter(filters);
    const projectKeys = database.prepare(`SELECT matter_id AS matterId, projeto FROM records${where.sql}`)
      .all(...where.values).map((row) => row.matterId
        ? `matter:${row.matterId}`
        : `legacy:${row.projeto.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR")}`);
    return {
      overallTotal: Number(database.prepare("SELECT COUNT(*) AS count FROM records WHERE deleted_at IS NULL").get().count),
      total: Number(database.prepare(`SELECT COUNT(*) AS count FROM records${where.sql}`).get(...where.values).count),
      uniqueProjects: new Set(projectKeys).size,
      byArea: groupedBy("area_tecnica", filters),
      byParecer: groupedBy("ha_parecer", filters),
      byEmenda: groupedBy("sugestao_emenda", filters),
      byPosicionamento: groupedBy("posicionamento", filters)
    };
  }

  function distinctValues(column, filters = {}) {
    const where = buildRecordFilter(filters);
    return database
      .prepare(`SELECT DISTINCT ${column} AS value FROM records${where.sql} ORDER BY value COLLATE NOCASE`)
      .all(...where.values)
      .map((row) => row.value);
  }

  function filterOptions(filters = {}) {
    const without = (field) => ({ ...filters, [field]: "" });
    return {
      areasTecnicas: distinctValues("area_tecnica", without("areaTecnica")),
      responsaveis: distinctValues("responsavel", without("responsavel")),
      pareceres: distinctValues("ha_parecer", without("haParecer")),
      emendas: distinctValues("sugestao_emenda", without("sugestaoEmenda")),
      posicionamentos: distinctValues("posicionamento", without("posicionamento"))
    };
  }

  function getMatter(id) {
    const row = database.prepare("SELECT * FROM legislative_matters WHERE id = ?").get(id);
    if (!row) return null;
    const identifiers = database.prepare(`SELECT source, external_id AS externalId, house, sigla AS siglaTipo,
      numero, ano, codigo_materia AS codigoMateria, evidence_json AS evidenceJson
      FROM legislative_identifiers WHERE matter_id = ? ORDER BY house, source, external_id`).all(id).map(({ evidenceJson, ...identifier }) => ({ ...identifier, evidence: evidenceJson ? JSON.parse(evidenceJson) : null }));
    return { id: row.id, camara: row.camara_json ? JSON.parse(row.camara_json) : null, senado: JSON.parse(row.senado_json), cachedAt: row.cached_at, identifiers };
  }

  function tramitationSources() {
    return database.prepare(`SELECT DISTINCT alias.source, alias.external_id AS externalId
      FROM legislative_identifiers AS alias JOIN records AS record ON record.matter_id = alias.matter_id
      WHERE record.deleted_at IS NULL
      ORDER BY alias.source, alias.external_id`).all();
  }

  function watchMatter(matterId) {
    if (!matterId) return;
    database.prepare(`INSERT OR IGNORE INTO tramitation_health(source, external_id, watched_at)
      SELECT source, external_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM legislative_identifiers WHERE matter_id = ?`).run(matterId);
  }

  function monitoring(matterId) {
    if (!matterId) return [];
    return database.prepare(`SELECT alias.source, alias.external_id AS externalId,
      scan.checked_at AS checkedAt, health.attempted_at AS attemptedAt, health.error,
      CASE WHEN scan.checked_at IS NULL THEN 1 ELSE 0 END AS pending
      FROM legislative_identifiers AS alias
      LEFT JOIN tramitation_scans AS scan ON scan.source = alias.source AND scan.external_id = alias.external_id
      LEFT JOIN tramitation_health AS health ON health.source = alias.source AND health.external_id = alias.external_id
      WHERE alias.matter_id = ?`).all(matterId);
  }

  function saveTramitationFailure({ source, externalId }, error) {
    database.prepare(`INSERT INTO tramitation_health(source, external_id, attempted_at, error)
      VALUES (?, ?, ?, ?) ON CONFLICT(source, external_id) DO UPDATE SET attempted_at = excluded.attempted_at, error = excluded.error`)
      .run(source, externalId, new Date().toISOString(), String(error).slice(0, 500));
  }

  function saveTramitationScan({ source, externalId }, events) {
    if (!["camara", "senado"].includes(source) || !Number.isSafeInteger(externalId) || !Array.isArray(events)) throw new Error("Consulta de tramitações inválida.");
    const now = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      const initialized = Boolean(database.prepare("SELECT 1 FROM tramitation_scans WHERE source = ? AND external_id = ?").get(source, externalId));
      const watchedAt = database.prepare("SELECT watched_at FROM tramitation_health WHERE source = ? AND external_id = ?").get(source, externalId)?.watched_at;
      const insert = database.prepare(`INSERT INTO tramitation_events
        (source, external_id, event_key, event_date, organization, description, detail, detected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source, external_id, event_key) DO UPDATE SET
        event_date = excluded.event_date, organization = excluded.organization,
        description = excluded.description, detail = excluded.detail`);
      for (const event of events) {
        // Preserve IDs and read cursors when upgrading the old Câmara content hash.
        if (event.legacyEventKey && !database.prepare("SELECT 1 FROM tramitation_events WHERE source = ? AND external_id = ? AND event_key = ?").get(source, externalId, event.eventKey)) {
          database.prepare("UPDATE tramitation_events SET event_key = ? WHERE source = ? AND external_id = ? AND event_key = ?")
            .run(event.eventKey, source, externalId, event.legacyEventKey);
        }
        const officialDate = String(event.date).replace(" ", "T");
        const dateWithZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(officialDate) ? officialDate : `${officialDate.length === 10 ? `${officialDate}T00:00:00` : officialDate}-03:00`;
        const afterRegistration = watchedAt && Date.parse(dateWithZone) > Date.parse(watchedAt);
        insert.run(source, externalId, event.eventKey, event.date, event.organization, event.description, event.detail, initialized || afterRegistration ? now : null);
      }
      database.prepare(`INSERT INTO tramitation_scans(source, external_id, initialized_at, checked_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(source, external_id) DO UPDATE SET checked_at = excluded.checked_at`).run(source, externalId, now, now);
      database.prepare(`INSERT INTO tramitation_health(source, external_id, attempted_at, error) VALUES (?, ?, ?, NULL)
        ON CONFLICT(source, external_id) DO UPDATE SET attempted_at = excluded.attempted_at, error = NULL`).run(source, externalId, now);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  }

  function latestMatterEventId(matterId) {
    if (!matterId) return 0;
    return database.prepare(`SELECT COALESCE(MAX(event.id), 0) AS id FROM tramitation_events AS event
      JOIN legislative_identifiers AS alias ON alias.source = event.source AND alias.external_id = event.external_id
      WHERE alias.matter_id = ?`).get(matterId).id;
  }

  function setTramitationSeen(recordId, eventId) {
    database.prepare(`INSERT INTO record_tramitation_seen(record_id, event_id, seen_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(record_id) DO UPDATE SET event_id = MAX(event_id, excluded.event_id), seen_at = excluded.seen_at`).run(recordId, eventId);
  }

  function resetTramitationSeen(recordId, eventId) {
    database.prepare(`INSERT INTO record_tramitation_seen(record_id, event_id, seen_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(record_id) DO UPDATE SET event_id = excluded.event_id, seen_at = excluded.seen_at`).run(recordId, eventId);
  }

  function tramitationNotice(recordId) {
    const row = database.prepare("SELECT matter_id AS matterId FROM records WHERE id = ?").get(recordId);
    if (!row?.matterId) return { count: 0, throughEventId: 0, events: [] };
    const seenId = database.prepare("SELECT event_id AS eventId FROM record_tramitation_seen WHERE record_id = ?").get(recordId)?.eventId || 0;
    const pending = database.prepare(`SELECT event.id, event.source, event.event_date AS date,
      event.organization, event.description, event.detail, event.detected_at AS detectedAt
      FROM tramitation_events AS event
      JOIN legislative_identifiers AS alias ON alias.source = event.source AND alias.external_id = event.external_id
      WHERE alias.matter_id = ? AND event.detected_at IS NOT NULL AND event.id > ?
      ORDER BY event.id DESC`).all(row.matterId, seenId);
    return { count: pending.length, throughEventId: pending[0]?.id || seenId, events: pending };
  }

  function acknowledgeTramitations(recordId, throughEventId) {
    if (!getRecordStatement.get(recordId)) return null;
    if (!Number.isSafeInteger(throughEventId) || throughEventId < 0) throw new ValidationError("Atualização inválida.");
    const current = tramitationNotice(recordId);
    if (current.count && throughEventId > current.throughEventId) throw new ValidationError("Atualização inválida. Recarregue o registro.");
    if (current.count) setTramitationSeen(recordId, throughEventId);
    return get(recordId);
  }

  function getMatterByCamaraId(id) {
    const row = database.prepare("SELECT id FROM legislative_matters WHERE camara_id = ?").get(id);
    return row ? getMatter(row.id) : null;
  }

  function getMatterBySenadoId(id) {
    const row = database.prepare("SELECT matter_id AS id FROM legislative_identifiers WHERE source = 'senado' AND external_id = ?").get(id);
    return row ? getMatter(row.id) : null;
  }

  function storeMatter(official, relations = []) {
    const source = official.source || "camara";
    const camara = source === "camara" ? official : null;
    const identifiers = [{ source, externalId: official.id, house: source === "camara" ? "CD" : (relations.flatMap((relation) => relation.identifiers).find((identifier) => identifier.externalId === official.id)?.house || "SF"), siglaTipo: official.siglaTipo, numero: official.numero, ano: official.ano }, ...relations.flatMap((relation) => relation.identifiers.map((identifier) => ({ ...identifier, evidence: relation.evidence })))];
    const linked = new Map();
    const conflict = () => Object.assign(new Error("As fontes retornaram um vínculo conflitante com uma equivalência já salva. Nenhuma equivalência foi alterada."), { status: 409 });
    for (const identifier of identifiers) {
      const old = database.prepare("SELECT * FROM legislative_identifiers WHERE source = ? AND external_id = ?").get(identifier.source, identifier.externalId);
      if (old) {
        if (old.house !== identifier.house || old.sigla !== identifier.siglaTipo || old.numero !== identifier.numero || old.ano !== identifier.ano) throw conflict();
        linked.set(old.matter_id, getMatter(old.matter_id));
      }
    }
    const cameraIds = new Set([...linked.values()].filter((matter) => matter.camara).map((matter) => matter.camara.id));
    if (camara) cameraIds.add(camara.id);
    if (cameraIds.size > 1) throw conflict();
    // An explicit relation can promote a Senate-only identity into a joint matter.
    // Repoint records, never delete or combine users' records or attachments.
    let id = [...linked.values()].find((matter) => matter.camara)?.id || linked.keys().next().value;
    if (!id) id = Number(database.prepare("INSERT INTO legislative_matters(cached_at) VALUES (?)").run(official.consultadoEm || new Date().toISOString()).lastInsertRowid);
    const senateSnapshots = new Map([...linked.values()].flatMap((matter) => matter.senado).map((snapshot) => [snapshot.id, snapshot]));
    for (const snapshot of [...relations.map((relation) => relation.proposition).filter(Boolean), ...(source === "senado" ? [official] : [])]) senateSnapshots.set(snapshot.id, snapshot);
    for (const linkedId of linked.keys()) {
      if (linkedId === id) continue;
      database.prepare("UPDATE records SET matter_id = ?, revision = revision + 1 WHERE matter_id = ?").run(id, linkedId);
      database.prepare("UPDATE legislative_identifiers SET matter_id = ? WHERE matter_id = ?").run(id, linkedId);
      database.prepare("DELETE FROM legislative_matters WHERE id = ?").run(linkedId);
    }
    database.prepare(`UPDATE legislative_matters SET camara_id = COALESCE(?, camara_id),
      camara_json = COALESCE(?, camara_json), senado_json = ?, cached_at = ? WHERE id = ?`)
      .run(camara?.id || null, camara ? JSON.stringify(camara) : null, JSON.stringify([...senateSnapshots.values()]), official.consultadoEm || new Date().toISOString(), id);
    for (const identifier of identifiers) {
      database.prepare(`INSERT INTO legislative_identifiers(matter_id, source, external_id, house, sigla, numero, ano, codigo_materia, evidence_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, external_id) DO UPDATE SET codigo_materia = COALESCE(excluded.codigo_materia, codigo_materia), evidence_json = COALESCE(excluded.evidence_json, evidence_json)`)
        .run(id, identifier.source, identifier.externalId, identifier.house, identifier.siglaTipo, identifier.numero, identifier.ano, identifier.codigoMateria || null, identifier.evidence ? JSON.stringify(identifier.evidence) : null);
    }
    return id;
  }

  function saveMatter(camara, relations = []) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const id = storeMatter(camara, relations);
      database.exec("COMMIT");
      return getMatter(id);
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  }

  function resolveMatter(input) {
    const official = input.proposition || input.camara;
    if (!official?.id) return null;
    const existing = official.source === "senado" ? getMatterBySenadoId(official.id) : getMatterByCamaraId(official.id);
    return (existing || saveMatter(official)).id;
  }

  function ensureDistinctRecord(record, matterId, excludedId = -1) {
    if (!matterId) return;
    const existing = database.prepare("SELECT id FROM records WHERE deleted_at IS NULL AND matter_id = ? AND area_tecnica = ? AND responsavel = ? AND id <> ? LIMIT 1").get(matterId, record.areaTecnica, record.responsavel, excludedId);
    if (existing) throw Object.assign(new Error("Esta matéria já está cadastrada para esta área técnica e responsável. Edite o registro existente."), { status: 409, existingRecordId: existing.id });
  }

  function getSearchCache(queryKey) {
    const row = database.prepare("SELECT results_json, cached_at FROM proposition_search_cache WHERE query_key = ?").get(queryKey);
    if (!row || Date.now() - Date.parse(row.cached_at) > 24 * 60 * 60 * 1000) return null;
    const results = JSON.parse(row.results_json);
    const snapshots = results.flatMap(result => [result, ...(result.relations || []).map(relation => relation.proposition).filter(Boolean)]);
    if (snapshots.some(snapshot => !snapshot.consultadoEm || Date.now() - Date.parse(snapshot.consultadoEm) >= 24 * 60 * 60 * 1000)) return null;
    return results;
  }

  function saveSearchCache(queryKey, results) {
    database.prepare(`INSERT INTO proposition_search_cache(query_key, results_json, cached_at) VALUES (?, ?, ?)
      ON CONFLICT(query_key) DO UPDATE SET results_json = excluded.results_json, cached_at = excluded.cached_at`).run(queryKey, JSON.stringify(results), new Date().toISOString());
  }

  return {
    history,
    trash,
    restore,
    saveTramitationFailure,
    getMatterByCamaraId,
    getMatterBySenadoId,
    saveMatter,
    getSearchCache,
    saveSearchCache,
    tramitationSources,
    saveTramitationScan,
    acknowledgeTramitations,
    get,
    list,
    create,
    update,
    remove,
    getAttachment,
    listAttachments,
    findAttachmentUpload,
    hasStoredAttachment: storedName => Boolean(database.prepare("SELECT 1 FROM record_attachments WHERE stored_name = ? LIMIT 1").get(storedName)),
    setAttachment,
    removeAttachment,
    restoreAttachment,
    totals,
    filterOptions,
    close: () => database.close()
  };
}
