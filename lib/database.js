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
  camara_json AS camaraJson
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
    if (field === "ementa" && input?.camara) continue;
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
    clauses.push("(projeto LIKE ? OR ementa LIKE ? OR atual_comissao LIKE ? OR responsavel LIKE ?)");
    const pattern = `%${query}%`;
    values.push(pattern, pattern, pattern, pattern);
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

  const existingColumns = new Set(database.prepare("PRAGMA table_info(records)").all().map((column) => column.name));
  const attachmentColumns = {
    camara_json: "TEXT",
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

  const getRecordStatement = database.prepare(`SELECT ${selectColumns} FROM records WHERE id = ?`);
  const insertStatement = database.prepare(`
    INSERT INTO records (
      area_tecnica, responsavel, projeto, ementa, atual_comissao,
      ha_parecer, sugestao_emenda, posicionamento, camara_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    const { camaraJson, ...record } = row;
    return { ...record, camara: camaraJson ? JSON.parse(camaraJson) : null };
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
    const result = insertStatement.run(...recordFields.map((field) => record[field]), input.camara ? JSON.stringify(input.camara) : null);
    return get(Number(result.lastInsertRowid));
  }

  function update(id, input) {
    if (!get(id)) return null;
    const record = validateRecord(input);
    updateStatement.run(...recordFields.map((field) => record[field]), input.camara ? JSON.stringify(input.camara) : null, id);
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

  return {
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
