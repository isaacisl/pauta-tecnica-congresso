import path from "node:path";
import { inflateRawSync, crc32 } from "node:zlib";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export const importLimits = Object.freeze({ bytes: 8 * 1024 * 1024, expanded: 24 * 1024 * 1024, rows: 500, columns: 60, sheets: 20 });
const invalid = message => Object.assign(new Error(message), { status: 422 });
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const normalize = value => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const importAliases = Object.freeze({
  projeto: ["projeto", "proposicao", "proposicoes"],
  posicionamento: ["posicionamento", "posicionamentodaarea", "posicionamentodaareatecnica", "posicao"],
  sugestaoEmenda: ["sugestaodeemenda", "sugestaoemenda", "hasugestaodeemenda", "emenda"],
  haParecer: ["haparecerelaborado", "parecerelaborado", "haparecer", "parecer"]
});
const decoder = new TextDecoder("utf-8", { fatal: true });

// Read only bounded ZIP entries in memory. Never extract paths, evaluate formulas,
// run macros or resolve relationships outside this archive.
function unzip(buffer) {
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break; }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw invalid("Arquivo Excel inválido ou protegido. Salve uma cópia como .xlsx sem senha.");
  const entries = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16), size = 0;
  if (entries > 3000 || cursor + buffer.readUInt32LE(end + 12) !== end) throw invalid("A planilha excede os limites de leitura ou está danificada.");
  const files = new Map();
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw invalid("Estrutura do arquivo Excel inválida.");
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16), compressed = buffer.readUInt32LE(cursor + 20), expanded = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32), offset = buffer.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameLength + extra + comment > end) throw invalid("Arquivo Excel incompleto.");
    const name = decoder.decode(buffer.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extra + comment;
    size += expanded;
    if (size > importLimits.expanded || expanded > 12 * 1024 * 1024 || flags & 1 || ![0, 8].includes(method)
      || /(^\/|\\|(?:^|\/)\.\.(?:\/|$)|vbaProject)/i.test(name) || files.has(name)) throw invalid("Planilha protegida, com macros ou muito grande. Use um arquivo .xlsx simples, sem macros.");
    if (offset + 30 > end || buffer.readUInt32LE(offset) !== 0x04034b50) throw invalid("Arquivo Excel danificado.");
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    if (start + compressed > end) throw invalid("Arquivo Excel incompleto.");
    const data = method === 0 ? buffer.subarray(start, start + compressed)
      : inflateRawSync(buffer.subarray(start, start + compressed), { maxOutputLength: Math.min(expanded + 1, 12 * 1024 * 1024) });
    if (data.length !== expanded || crc32(data) !== checksum) throw invalid("O arquivo Excel está danificado. Salve uma nova cópia e tente novamente.");
    files.set(name, data);
  }
  return files;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false, trimValues: false, processEntities: true });
function xml(files, name) {
  const data = files.get(name);
  if (!data) throw invalid("A estrutura da planilha não foi reconhecida.");
  const text = decoder.decode(data);
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw invalid("A planilha contém uma estrutura XML não permitida ou inválida.");
  return parser.parse(text);
}
function textOf(value) {
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  if (Object.hasOwn(value, "#text")) return textOf(value["#text"]);
  if (Object.hasOwn(value, "t")) return list(value.t).map(textOf).join("");
  if (Object.hasOwn(value, "r")) return list(value.r).map(textOf).join("");
  return "";
}
function prepareSheet(name, rows) {
  const meaningful = rows.filter(row => row.cells.some(value => String(value ?? "").trim()));
  if (!meaningful.length) return null;
  let header = meaningful.slice(0, 30).findIndex(row => row.cells.some(value => importAliases.projeto.includes(normalize(value))));
  if (header < 0) header = 0;
  const headers = meaningful[header].cells.map((value, index) => String(value || `Coluna ${index + 1}`).trim());
  const data = meaningful.slice(header + 1);
  if (data.length > importLimits.rows) throw invalid(`A aba “${name}” tem mais de ${importLimits.rows} linhas de dados. Divida a importação em arquivos menores.`);
  const mapping = Object.fromEntries(Object.entries(importAliases).map(([field, aliases]) => [field, headers.findIndex(value => aliases.includes(normalize(value)))]));
  return { name, headers, rows: data, mapping };
}

function readXlsx(buffer) {
  const files = unzip(buffer);
  const workbook = xml(files, "xl/workbook.xml").workbook;
  const relationships = list(xml(files, "xl/_rels/workbook.xml.rels").Relationships?.Relationship);
  const strings = files.has("xl/sharedStrings.xml") ? list(xml(files, "xl/sharedStrings.xml").sst?.si).map(textOf) : [];
  const sheets = list(workbook?.sheets?.sheet);
  if (!sheets.length || sheets.length > importLimits.sheets) throw invalid("Use uma planilha com até 20 abas.");
  return sheets.filter(sheet => sheet["@state"] !== "veryHidden").map(sheet => {
    const relation = relationships.find(item => item["@Id"] === sheet["@id"]);
    if (!relation || relation["@TargetMode"] === "External") throw invalid("A aba deve estar dentro do próprio arquivo Excel.");
    const target = String(relation["@Target"] || "");
    const name = path.posix.normalize(target.startsWith("/") ? target.slice(1) : `xl/${target}`);
    if (!name.startsWith("xl/")) throw invalid("Caminho de aba inválido.");
    const source = list(xml(files, name).worksheet?.sheetData?.row);
    if (source.length > 10000) throw invalid("Há muitas linhas formatadas. Copie apenas a tabela para um novo arquivo.");
    const rows = source.map((row, index) => {
      const cells = [];
      for (const cell of list(row.c)) {
        const ref = String(cell["@r"] || ""), letters = ref.match(/^[A-Z]+/i)?.[0];
        if (!letters) throw invalid("Endereço de célula inválido.");
        const column = [...letters.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
        if (column >= importLimits.columns) { if (cell.v || cell.is || cell.f) throw invalid("A tabela deve ter no máximo 60 colunas."); continue; }
        const value = Object.hasOwn(cell, "f") ? "[Fórmula: substitua por texto]" : cell["@t"] === "s" ? strings[Number(cell.v)] ?? "" : cell["@t"] === "inlineStr" ? textOf(cell.is) : textOf(cell.v);
        if (value.length > 16000) throw invalid("Há uma célula muito longa. Use até 16 mil caracteres por célula.");
        cells[column] = value;
      }
      return { line: Number(row["@r"]) || index + 1, cells: Array.from(cells, value => value ?? "") };
    });
    return prepareSheet(String(sheet["@name"]), rows);
  }).filter(Boolean);
}

function readCsv(buffer) {
  const text = decoder.decode(buffer).replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const separator = first.startsWith("sep=") ? first.slice(4, 5) : first.split(";").length >= first.split(",").length ? ";" : ",";
  if (![";", ","].includes(separator)) throw invalid("Use CSV UTF-8 separado por vírgula ou ponto e vírgula.");
  const source = first.startsWith("sep=") ? text.slice(text.indexOf("\n") + 1) : text;
  const rows = []; let cells = [], cell = "", quoted = false, line = 1, rowLine = 1;
  const finishCell = () => { cells.push(cell); cell = ""; if (cells.length > importLimits.columns) throw invalid("Use até 60 colunas."); };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || !cell) quoted = !quoted;
      else throw invalid("Aspas inválidas no CSV. Exporte novamente como CSV UTF-8.");
    } else if (char === separator && !quoted) finishCell();
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[i + 1] === "\n") i++;
      finishCell(); rows.push({ line: rowLine, cells }); cells = []; line++; rowLine = line;
    } else { cell += char; if (char === "\n") line++; }
    if (cell.length > 16000 || rows.length > 10000) throw invalid("CSV muito grande. Use até 500 projetos e 16 mil caracteres por célula.");
  }
  if (quoted) throw invalid("Há aspas não fechadas no CSV.");
  finishCell(); rows.push({ line: rowLine, cells });
  return [prepareSheet("Dados", rows)].filter(Boolean);
}

export function readImportFile(buffer, filename) {
  if (!buffer.length || buffer.length > importLimits.bytes) throw invalid("Escolha uma planilha de até 8 MB.");
  try {
    const extension = path.extname(filename).toLowerCase();
    const sheets = extension === ".xlsx" ? readXlsx(buffer) : extension === ".csv" ? readCsv(buffer) : null;
    if (!sheets) throw invalid("Use um arquivo .xlsx ou .csv (UTF-8). O formato .xls antigo não é aceito.");
    if (!sheets.length) throw invalid("A planilha não contém dados para importar.");
    return { sheets, limits: importLimits };
  } catch (error) {
    if (error.status) throw error;
    throw invalid("Não foi possível ler a planilha. Salve uma cópia como .xlsx sem senha ou CSV UTF-8.");
  }
}
