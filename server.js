import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDatabase, ValidationError } from "./lib/database.js";
import { parameters } from "./lib/parameters.js";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const defaultDatabasePath = path.join(rootDir, "data", "registros.sqlite");
const exportPassword = process.env.EXPORT_PASSWORD || "CentralDeDados2026";

const mimeTypes = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
});

const exportColumns = Object.freeze([
  ["Área Técnica", "areaTecnica"],
  ["Responsável", "responsavel"],
  ["Projeto", "projeto"],
  ["Ementa", "ementa"],
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
    if (size > 64 * 1024) {
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

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function encodeWindows1252(value) {
  const replacements = new Map([
    [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
    [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
    [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
    [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
    [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
    [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
    [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f]
  ]);
  const bytes = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0xff) bytes.push(codePoint);
    else bytes.push(replacements.get(codePoint) ?? 0x3f);
  }
  return Buffer.from(bytes);
}

function recordsToCsv(records) {
  const rows = [
    exportColumns.map(([header]) => csvCell(header)).join(";"),
    ...records.map((record) => exportColumns.map(([, field]) => csvCell(record[field])).join(";"))
  ];
  return encodeWindows1252(`sep=;\r\n${rows.join("\r\n")}\r\n`);
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
  databasePath = process.env.DATABASE_PATH || defaultDatabasePath
} = {}) {
  const database = createDatabase(databasePath);

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const { pathname } = url;

      if (pathname === "/api/health" && request.method === "GET") {
        send(response, 200, { status: "ok" });
        return;
      }

      if (pathname === "/api/parameters" && request.method === "GET") {
        send(response, 200, parameters);
        return;
      }

      if (pathname === "/api/filter-options" && request.method === "GET") {
        send(response, 200, database.filterOptions());
        return;
      }

      if (pathname === "/api/records" && request.method === "GET") {
        const records = database.list(getFilters(url));
        send(response, 200, { records, count: records.length });
        return;
      }

      if (pathname === "/api/records" && request.method === "POST") {
        const record = database.create(await readJson(request));
        send(response, 201, { record });
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
          const record = database.update(id, await readJson(request));
          if (!record) sendError(response, 404, "Registro não encontrado.");
          else send(response, 200, { record });
          return;
        }

        if (request.method === "DELETE") {
          if (!database.remove(id)) sendError(response, 404, "Registro não encontrado.");
          else send(response, 200, { deleted: true });
          return;
        }
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
        send(response, 200, csv, "text/csv; charset=windows-1252", {
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
      console.error(error);
      sendError(response, error.status ?? 500, error.status ? error.message : "Erro interno do servidor.");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, resolve);
  });

  const address = server.address();
  const url = `http://${hostname}:${address.port}`;

  return {
    server,
    database,
    url,
    close: async () => {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
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
