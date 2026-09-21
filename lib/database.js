import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parameters, recordFields } from "./parameters.js";

const columnByField = Object.freeze({
  areaTecnica: "area_tecnica",
  responsavel: "responsavel",
  projeto: "projeto",
  ementa: "ementa",
  atualComissao: "atual_comissao",
  haParecer: "ha_parecer",
  sugestaoEmenda: "sugestao_emenda",
  posicionamento: "posicionamento"
});

const selectColumns = `
  id,
  area_tecnica AS areaTecnica,
  responsavel,
  projeto,
  ementa,
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
  ementa: 6000,
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
    if (field === "ementa" && (input?.camara || input?.proposition)) continue;
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
  const clauses = [];
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
    clauses.push(`(projeto LIKE ? OR ementa LIKE ? OR atual_comissao LIKE ? OR responsavel LIKE ? OR EXISTS (
      SELECT 1 FROM legislative_identifiers AS alias WHERE alias.matter_id = records.matter_id
      AND (alias.sigla || ' ' || alias.numero || '/' || alias.ano) LIKE ?
    ))`);
    const pattern = `%${query}%`;
    values.push(pattern, pattern, pattern, pattern, pattern);
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
      ementa TEXT NOT NULL,
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
  const attachmentColumns = {
    camara_json: "TEXT",
    proposition_json: "TEXT",
    matter_id: "INTEGER REFERENCES legislative_matters(id)",
    attachment_name: "TEXT",
    attachment_stored_name: "TEXT",
    attachment_mime: "TEXT",
    attachment_size: "INTEGER"
  };
  for (const [column, type] of Object.entries(attachmentColumns)) {
    if (!existingColumns.has(column)) database.exec(`ALTER TABLE records ADD COLUMN ${column} ${type}`);
  }
  if (!existingColumns.has("edited_at")) {
    database.exec("ALTER TABLE records ADD COLUMN edited_at TEXT");
    database.exec("UPDATE records SET edited_at = updated_at WHERE updated_at <> created_at");
  }

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

  const getRecordStatement = database.prepare(`SELECT ${selectColumns} FROM records WHERE id = ?`);
  const insertStatement = database.prepare(`
    INSERT INTO records (
      area_tecnica, responsavel, projeto, ementa, atual_comissao,
      ha_parecer, sugestao_emenda, posicionamento, camara_json, matter_id, proposition_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStatement = database.prepare(`
    UPDATE records SET
      area_tecnica = ?,
      responsavel = ?,
      projeto = ?,
      ementa = ?,
      atual_comissao = ?,
      ha_parecer = ?,
      sugestao_emenda = ?,
      posicionamento = ?,
      camara_json = ?,
      matter_id = ?,
      proposition_json = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);
  const deleteStatement = database.prepare("DELETE FROM records WHERE id = ?");
  const getAttachmentStatement = database.prepare(`
    SELECT
      attachment_name AS name,
      attachment_stored_name AS storedName,
      attachment_mime AS mime,
      attachment_size AS size
    FROM records
    WHERE id = ? AND attachment_stored_name IS NOT NULL
  `);
  const setAttachmentStatement = database.prepare(`
    UPDATE records SET
      attachment_name = ?,
      attachment_stored_name = ?,
      attachment_mime = ?,
      attachment_size = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);
  const clearAttachmentStatement = database.prepare(`
    UPDATE records SET
      attachment_name = NULL,
      attachment_stored_name = NULL,
      attachment_mime = NULL,
      attachment_size = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);

  function deserialize(row) {
    if (!row) return null;
    const { camaraJson, propositionJson, ...record } = row;
    const matter = record.matterId ? getMatter(record.matterId) : null;
    return { ...record, camara: camaraJson ? JSON.parse(camaraJson) : null,
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
    ensureDistinctRecord(record, matterId);
    const result = insertStatement.run(...recordFields.map((field) => record[field]), input.camara ? JSON.stringify(input.camara) : null, matterId, input.proposition ? JSON.stringify(input.proposition) : null);
    return get(Number(result.lastInsertRowid));
  }

  function update(id, input) {
    const previous = get(id);
    if (!previous) return null;
    const record = validateRecord(input);
    const matterId = resolveMatter(input);
    if (matterId !== previous.matterId || record.areaTecnica !== previous.areaTecnica || record.responsavel !== previous.responsavel) ensureDistinctRecord(record, matterId, id);
    updateStatement.run(...recordFields.map((field) => record[field]), input.camara ? JSON.stringify(input.camara) : null, matterId, input.proposition ? JSON.stringify(input.proposition) : null, id);
    return get(id);
  }

  function remove(id) {
    return deleteStatement.run(id).changes > 0;
  }

  function getAttachment(id) {
    return getAttachmentStatement.get(id) ?? null;
  }

  function setAttachment(id, attachment) {
    if (!get(id)) return null;
    setAttachmentStatement.run(attachment.name, attachment.storedName, attachment.mime, attachment.size, id);
    return get(id);
  }

  function clearAttachment(id) {
    if (!get(id)) return null;
    clearAttachmentStatement.run(id);
    return get(id);
  }

  function groupedBy(column, filters) {
    const where = buildRecordFilter(filters);
    return database
      .prepare(`SELECT ${column} AS label, COUNT(*) AS count FROM records${where.sql} GROUP BY ${column} ORDER BY count DESC, label COLLATE NOCASE`)
      .all(...where.values);
  }

  function totals(filters = {}) {
    const where = buildRecordFilter(filters);
    return {
      overallTotal: Number(database.prepare("SELECT COUNT(*) AS count FROM records").get().count),
      total: Number(database.prepare(`SELECT COUNT(*) AS count FROM records${where.sql}`).get(...where.values).count),
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
      database.prepare("UPDATE records SET matter_id = ? WHERE matter_id = ?").run(id, linkedId);
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
    const existing = database.prepare("SELECT id FROM records WHERE matter_id = ? AND area_tecnica = ? AND responsavel = ? AND id <> ? LIMIT 1").get(matterId, record.areaTecnica, record.responsavel, excludedId);
    if (existing) throw Object.assign(new Error("Esta matéria já está cadastrada para esta área técnica e responsável. Edite o registro existente."), { status: 409, existingRecordId: existing.id });
  }

  function getSearchCache(queryKey) {
    const row = database.prepare("SELECT results_json, cached_at FROM proposition_search_cache WHERE query_key = ?").get(queryKey);
    if (!row || Date.now() - Date.parse(row.cached_at) > 24 * 60 * 60 * 1000) return null;
    return JSON.parse(row.results_json);
  }

  function saveSearchCache(queryKey, results) {
    database.prepare(`INSERT INTO proposition_search_cache(query_key, results_json, cached_at) VALUES (?, ?, ?)
      ON CONFLICT(query_key) DO UPDATE SET results_json = excluded.results_json, cached_at = excluded.cached_at`).run(queryKey, JSON.stringify(results), new Date().toISOString());
  }

  return {
    getMatterByCamaraId,
    getMatterBySenadoId,
    saveMatter,
    getSearchCache,
    saveSearchCache,
    get,
    list,
    create,
    update,
    remove,
    getAttachment,
    setAttachment,
    clearAttachment,
    totals,
    filterOptions,
    close: () => database.close()
  };
}
