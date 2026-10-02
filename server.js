import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDatabase, ValidationError } from "./lib/database.js";
import { parameters } from "./lib/parameters.js";
import { propositionTypes } from "./lib/proposition-types.js";
import { createPropositionService } from "./lib/propositions.js";
import { createTramitationMonitor } from "./lib/tramitations.js";
import { createDocumentPreviews } from "./lib/document-previews.js";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const defaultDatabasePath = path.join(rootDir, "data", "registros.sqlite");
const exportPassword = process.env.EXPORT_PASSWORD || "CentralDeDados2026";
const maxAttachmentSize = 20 * 1024 * 1024;

const attachmentTypes = Object.freeze({
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".rtf": "application/rtf",
  ".txt": "text/plain; charset=utf-8",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png"
});

const mimeTypes = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
});

const exportColumns = Object.freeze([
  ["Área Técnica", "areaTecnica"],
  ["Responsável", "responsavel"],
  ["Projeto", "projeto"],
  ["Autor(es)", "autor"],
  ["Ementa", "ementa"],
  ["Despacho", "despacho"],
  ["Atual comissão", "atualComissao"],
  ["Há parecer elaborado?", "haParecer"],
  ["Sugestão de emenda", "sugestaoEmenda"],
  ["Posicionamento da área técnica", "posicionamento"]
]);

function send(response, status, body, contentType = "application/json; charset=utf-8", extraHeaders = {}) {
  const payload = contentType.startsWith("application/json") ? JSON.stringify(body) : body;
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": contentType.startsWith("text/html") ? "no-cache" : "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  response.end(payload);
}

function sendError(response, status, message, fields) {
  send(response, status, { error: message, ...(fields ? { fields } : {}) });
}

async function readJson(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) {
      const error = new Error("O conteúdo enviado é muito grande.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("JSON inválido.");
    error.status = 400;
    throw error;
  }
}

async function readBinary(request, maxSize = maxAttachmentSize) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxSize) {
      const error = new Error("O arquivo deve ter no máximo 20 MB.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) {
    const error = new Error("Selecione um arquivo para enviar.");
    error.status = 400;
    throw error;
  }
  return Buffer.concat(chunks);
}

function attachmentDetails(request) {
  const encodedName = request.headers["x-file-name"];
  if (typeof encodedName !== "string" || !encodedName) {
    const error = new Error("Nome do arquivo não informado.");
    error.status = 400;
    throw error;
  }

  let decodedName;
  try {
    decodedName = decodeURIComponent(encodedName);
  } catch {
    const error = new Error("Nome do arquivo inválido.");
    error.status = 400;
    throw error;
  }

  const name = path.posix.basename(decodedName.replaceAll("\\", "/")).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const extension = path.extname(name).toLowerCase();
  if (!name || name.length > 255 || !attachmentTypes[extension]) {
    const error = new Error("Formato não permitido. Use PDF, documentos do Office, texto ou imagem.");
    error.status = 415;
    throw error;
  }
  return { name, extension, mime: attachmentTypes[extension] };
}

async function removeStoredAttachment(uploadDirectory, storedName) {
  if (!storedName) return;
  const resolvedDirectory = path.resolve(uploadDirectory);
  const filePath = path.resolve(uploadDirectory, storedName);
  if (!filePath.startsWith(`${resolvedDirectory}${path.sep}`)) return;
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function recordsToCsv(records) {
  const rows = [
    exportColumns.map(([header]) => csvCell(header)).join(";"),
    ...records.map((record) => exportColumns.map(([, field]) => csvCell(record[field])).join(";"))
  ];
  return Buffer.from(`\uFEFFsep=;\r\n${rows.join("\r\n")}\r\n`, "utf8");
}

function hasValidExportPassword(value) {
  const received = Buffer.from(typeof value === "string" ? value : "", "utf8");
  const expected = Buffer.from(exportPassword, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function getFilters(url) {
  return {
    q: url.searchParams.get("q") ?? "",
    areaTecnica: url.searchParams.get("areaTecnica") ?? "",
    responsavel: url.searchParams.get("responsavel") ?? "",
    haParecer: url.searchParams.get("haParecer") ?? "",
    sugestaoEmenda: url.searchParams.get("sugestaoEmenda") ?? "",
    posicionamento: url.searchParams.get("posicionamento") ?? ""
  };
}

async function serveStatic(request, response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = path.resolve(publicDir, relativePath);
  const publicPrefix = `${path.resolve(publicDir)}${path.sep}`;

  if (filePath !== path.join(publicDir, "index.html") && !filePath.startsWith(publicPrefix)) {
    sendError(response, 404, "Arquivo não encontrado.");
    return;
  }

  try {
    const file = await readFile(filePath);
    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": file.length,
      "Cache-Control": contentType.startsWith("text/html") ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    });
    if (request.method === "HEAD") response.end();
    else response.end(file);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      sendError(response, 404, "Arquivo não encontrado.");
      return;
    }
    throw error;
  }
}

export async function startServer({
  port = Number(process.env.PORT) || 3000,
  hostname = process.env.HOST || "127.0.0.1",
  databasePath = process.env.DATABASE_PATH || defaultDatabasePath,
  camaraFetch = fetch,
  senadoFetch = fetch,
  documentConverter,
  tramitationCheckDelayMs = 10000,
  tramitationCheckIntervalMs = 60 * 60 * 1000
} = {}) {
  const database = createDatabase(databasePath);
  const propositions = createPropositionService({ database, camaraFetch, senadoFetch });
  const monitor = createTramitationMonitor({ database, camaraFetch, senadoFetch });
  const uploadDirectory = path.join(path.dirname(databasePath), "uploads");
  await mkdir(uploadDirectory, { recursive: true });
  const previews = createDocumentPreviews({ uploadDirectory, convertDocument: documentConverter });

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const { pathname } = url;

      if (pathname === "/api/health" && request.method === "GET") {
        send(response, 200, { status: "ok", apiVersion: 3 });
        return;
      }

      if (pathname === "/api/parameters" && request.method === "GET") {
        send(response, 200, { ...parameters, propositionTypes });
        return;
      }

      if (["/api/propositions", "/api/camara/proposicoes"].includes(pathname) && request.method === "GET") {
        send(response, 200, await propositions.search(url.searchParams));
        return;
      }

      const propositionMatch = pathname.match(/^\/api\/(?:propositions|camara\/proposicoes)\/((?:(?:camara|senado)-)?\d+)$/);
      if (propositionMatch && request.method === "POST") {
        const { searchToken } = await readJson(request);
        send(response, 200, await propositions.select(propositionMatch[1], searchToken));
        return;
      }

      if (pathname === "/api/filter-options" && request.method === "GET") {
        send(response, 200, database.filterOptions(getFilters(url)));
        return;
      }

      if (pathname === "/api/records" && request.method === "GET") {
        const records = database.list(getFilters(url));
        send(response, 200, { records, count: records.length });
        return;
      }

      if (pathname === "/api/records" && request.method === "POST") {
        const record = database.create(propositions.recordInput(await readJson(request)));
        if (tramitationCheckDelayMs !== null) scheduleMonitor(0);
        send(response, 201, { record });
        return;
      }

      if (pathname === "/api/trash" && request.method === "GET") {
        send(response, 200, { records: database.trash() });
        return;
      }
      const restoreMatch = pathname.match(/^\/api\/records\/(\d+)\/restore$/);
      if (restoreMatch && request.method === "POST") {
        const { revision } = await readJson(request);
        const record = database.restore(Number(restoreMatch[1]), revision);
        if (!record) sendError(response, 404, "Registro não encontrado na lixeira.");
        else send(response, 200, { record });
        return;
      }
      const historyMatch = pathname.match(/^\/api\/records\/(\d+)\/history$/);
      if (historyMatch && request.method === "GET") {
        if (!database.get(Number(historyMatch[1]))) sendError(response, 404, "Registro não encontrado.");
        else send(response, 200, { history: database.history(Number(historyMatch[1])) });
        return;
      }

      const attachmentRestoreMatch = pathname.match(/^\/api\/records\/(\d+)\/attachments\/(\d+)\/restore$/);
      if (attachmentRestoreMatch && request.method === "POST") {
        const { revision } = await readJson(request);
        const record = database.restoreAttachment(Number(attachmentRestoreMatch[1]), Number(attachmentRestoreMatch[2]), revision);
        if (!record) sendError(response, 404, "Documento removido não encontrado neste registro.");
        else send(response, 200, { record });
        return;
      }

      const previewMatch = pathname.match(/^\/api\/records\/(\d+)\/attachments\/(\d+)\/preview$/);
      if (previewMatch) {
        if (request.method !== "GET") { sendError(response, 405, "Método não permitido."); return; }
        const recordId = Number(previewMatch[1]);
        const attachmentId = Number(previewMatch[2]);
        const attachment = database.get(recordId) && database.getAttachment(recordId, attachmentId);
        if (!attachment) { sendError(response, 404, "Documento não encontrado neste registro."); return; }
        const preview = await previews.get(attachment);
        // A removal while a Word document is converting revokes this request too.
        if (!database.get(recordId) || !database.getAttachment(recordId, attachmentId)) {
          sendError(response, 404, "Este documento não está mais disponível neste registro.");
          return;
        }
        send(response, 200, preview.content, preview.mime, {
          "Content-Disposition": `inline; filename="previa${path.extname(preview.name)}"; filename*=UTF-8''${encodeURIComponent(preview.name)}`,
          "X-Preview-Converted": String(preview.converted)
        });
        return;
      }

      const attachmentMatch = pathname.match(/^\/api\/records\/(\d+)\/(?:attachment|attachments(?:\/(\d+))?)$/);
      if (attachmentMatch) {
        const id = Number(attachmentMatch[1]);
        const attachmentId = attachmentMatch[2] ? Number(attachmentMatch[2]) : null;
        const record = database.get(id);
        if (!record) {
          sendError(response, 404, "Registro não encontrado.");
          return;
        }

        if (request.method === "GET") {
          if (pathname.endsWith("/attachments")) {
            send(response, 200, { attachments: record.attachments });
            return;
          }
          const attachment = database.getAttachment(id, attachmentId);
          if (!attachment) {
            sendError(response, 404, "Este registro não possui arquivo.");
            return;
          }
          try {
            const file = await readFile(path.join(uploadDirectory, attachment.storedName));
            const fallbackName = `arquivo${path.extname(attachment.name).toLowerCase()}`;
            send(response, 200, file, attachment.mime || "application/octet-stream", {
              "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`
            });
          } catch (error) {
            if (error.code === "ENOENT") sendError(response, 404, "Arquivo não encontrado no armazenamento.");
            else throw error;
          }
          return;
        }

        if (request.method === "POST" && attachmentId === null) {
          const details = attachmentDetails(request);
          const uploadKey = request.headers["x-upload-id"] || null;
          if (uploadKey && (typeof uploadKey !== "string" || !/^[a-f0-9-]{36}$/i.test(uploadKey))) {
            sendError(response, 400, "Identificador de envio inválido.");
            return;
          }
          const file = await readBinary(request);
          if (uploadKey && database.findAttachmentUpload(id, uploadKey)) {
            send(response, 200, { record: database.get(id) });
            return;
          }
          const storedName = `${randomUUID()}${details.extension}`;
          const storedPath = path.join(uploadDirectory, storedName);
          await writeFile(storedPath, file, { flag: "wx" });
          try {
            const updatedRecord = database.setAttachment(id, {
              name: details.name,
              storedName,
              mime: details.mime,
              size: file.length,
              uploadKey
            });
            if (!updatedRecord) throw Object.assign(new Error("Registro não encontrado."), { status: 404 });
            send(response, 201, { record: updatedRecord });
          } catch (error) {
            await removeStoredAttachment(uploadDirectory, storedName);
            if (uploadKey && database.findAttachmentUpload(id, uploadKey)) {
              send(response, 200, { record: database.get(id) });
              return;
            }
            throw error;
          }
          return;
        }

        if (request.method === "DELETE" && attachmentId !== null) {
          const { revision } = await readJson(request);
          const updatedRecord = database.removeAttachment(id, attachmentId, revision);
          if (!updatedRecord) sendError(response, 404, "Documento não encontrado neste registro.");
          else send(response, 200, { record: updatedRecord });
          return;
        }

        sendError(response, 405, "Método não permitido para este endereço de documento.");
        return;
      }

      const recordMatch = pathname.match(/^\/api\/records\/(\d+)$/);
      if (recordMatch) {
        const id = Number(recordMatch[1]);

        if (request.method === "GET") {
          const record = database.get(id);
          if (!record) sendError(response, 404, "Registro não encontrado.");
          else send(response, 200, { record });
          return;
        }

        if (request.method === "PUT") {
          const existing = database.get(id);
          if (!existing) {
            sendError(response, 404, "Registro não encontrado.");
            return;
          }
          const record = database.update(id, propositions.recordInput(await readJson(request), existing));
          if (record && record.matterId !== existing.matterId && tramitationCheckDelayMs !== null) scheduleMonitor(0);
          if (!record) sendError(response, 404, "Registro não encontrado.");
          else send(response, 200, { record });
          return;
        }

        if (request.method === "DELETE") {
          const { revision } = await readJson(request);
          if (!database.remove(id, revision)) sendError(response, 404, "Registro não encontrado.");
          else {
            send(response, 200, { deleted: true });
          }
          return;
        }
      }

      const acknowledgeMatch = pathname.match(/^\/api\/records\/(\d+)\/tramitations\/acknowledge$/);
      if (acknowledgeMatch && request.method === "POST") {
        const { throughEventId } = await readJson(request);
        const record = database.acknowledgeTramitations(Number(acknowledgeMatch[1]), throughEventId);
        if (!record) sendError(response, 404, "Registro não encontrado.");
        else send(response, 200, { record });
        return;
      }

      if (pathname === "/api/totals" && request.method === "GET") {
        send(response, 200, database.totals(getFilters(url)));
        return;
      }

      if (pathname === "/api/export.csv" && request.method === "POST") {
        const credentials = await readJson(request);
        if (!hasValidExportPassword(credentials.password)) {
          sendError(response, 401, "Senha de exportação incorreta.");
          return;
        }
        const csv = recordsToCsv(database.list(getFilters(url)));
        const date = new Date().toISOString().slice(0, 10);
        send(response, 200, csv, "text/csv; charset=utf-8", {
          "Content-Disposition": `attachment; filename="registros-areas-tecnicas-${date}.csv"`
        });
        return;
      }

      if (pathname.startsWith("/api/")) {
        sendError(response, 404, "Rota não encontrada.");
        return;
      }

      if (request.method === "GET" || request.method === "HEAD") {
        await serveStatic(request, response, pathname);
        return;
      }

      sendError(response, 405, "Método não permitido.");
    } catch (error) {
      if (error instanceof ValidationError) {
        sendError(response, 422, error.message, error.fields);
        return;
      }
      if (error.status) {
        sendError(response, error.status, error.message);
        return;
      }
      console.error(error);
      sendError(response, 500, "Erro interno do servidor.");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, resolve);
  });

  const address = server.address();
  const url = `http://${hostname}:${address.port}`;
  let monitorClosed = false;
  let monitorTimer = null;
  let monitorRun = Promise.resolve();
  function scheduleMonitor(delay) {
    clearTimeout(monitorTimer);
    monitorTimer = setTimeout(() => {
      monitorRun = monitor.check().catch((error) => console.error("Falha na verificação de tramitações:", error))
        .finally(() => { if (!monitorClosed) scheduleMonitor(tramitationCheckIntervalMs); });
    }, delay);
    monitorTimer.unref?.();
  }
  if (tramitationCheckDelayMs !== null) scheduleMonitor(tramitationCheckDelayMs);

  return {
    server,
    database,
    url,
    checkTramitations: () => monitor.check(),
    close: async () => {
      monitorClosed = true;
      clearTimeout(monitorTimer);
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await monitorRun;
      database.close();
    }
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  const app = await startServer();
  console.log(`\nPauta Técnica disponível em ${app.url}\n`);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
