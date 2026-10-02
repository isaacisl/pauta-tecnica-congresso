import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const nativeTypes = new Map([[".pdf", "application/pdf"], [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"]]);
const wordTypes = new Set([".doc", ".docx", ".odt", ".rtf"]);
const maxPreviewSize = 50 * 1024 * 1024;
const previewError = (status, message) => Object.assign(new Error(message), { status });
const conversionFailed = () => previewError(422, "Não foi possível gerar a prévia deste documento. Ele pode estar protegido por senha ou danificado. Você ainda pode baixar o original.");

// Each conversion owns a separate process/profile. On timeout, stop only that
// process tree, including soffice.bin on Windows, before removing its work folder.
export function runOfficeProcess(executable, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
    let diagnostic = "";
    let timedOut = false;
    child.stderr.on("data", (chunk) => { if (diagnostic.length < 8192) diagnostic += chunk.toString(); });
    const timer = setTimeout(() => {
      timedOut = true;
      if (!child.pid) return;
      if (process.platform === "win32") {
        execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10000 }, (error) => {
          if (error && child.exitCode === null) child.kill("SIGKILL");
        });
      } else {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
    }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(previewError(504, "A preparação da prévia demorou demais. Tente novamente ou baixe o documento original."));
      else if (code !== 0) reject(new Error(`LibreOffice encerrou com código ${code}: ${diagnostic}`));
      else resolve();
    });
  });
}

export async function convertWithLibreOffice({ inputPath, outputDirectory, profileDirectory, timeoutMs = 90000 }) {
  const configured = process.env.LIBREOFFICE_PATH;
  const candidates = configured ? [configured] : process.platform === "win32"
    ? [...new Set([process.env.ProgramFiles, process.env["ProgramFiles(x86)"], "C:\\Program Files", "C:\\Program Files (x86)"].filter(Boolean))]
      .flatMap((directory) => [path.join(directory, "LibreOffice", "program", "soffice.com"), path.join(directory, "LibreOffice", "program", "soffice.exe")])
      .concat("soffice.com", "soffice.exe")
    : ["libreoffice", "soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"];
  const args = [`-env:UserInstallation=${pathToFileURL(profileDirectory).href}`, "--headless", "--nologo", "--nodefault", "--norestore",
    "--convert-to", "pdf:writer_pdf_Export", "--outdir", outputDirectory, inputPath];
  for (const executable of candidates) {
    try {
      if (path.isAbsolute(executable)) await access(executable);
      await runOfficeProcess(executable, args, timeoutMs);
      return;
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
  }
  throw previewError(503, "A visualização de Word ainda não está disponível neste servidor. Baixe o original ou peça ao administrador para habilitar as prévias.");
}

async function readPreview(filePath, mime) {
  const information = await stat(filePath);
  if (!information.isFile() || information.size > maxPreviewSize) throw previewError(413, "A prévia é muito grande para exibir aqui. Baixe o documento original.");
  const content = await readFile(filePath);
  const valid = mime === "application/pdf" ? content.subarray(0, 1024).includes(Buffer.from("%PDF-"))
    : mime === "image/png" ? content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : content[0] === 255 && content[1] === 216 && content[2] === 255;
  if (!valid) throw conversionFailed();
  return content;
}

export function createDocumentPreviews({ uploadDirectory, convertDocument = convertWithLibreOffice, timeoutMs = 90000 }) {
  const sourceDirectory = path.resolve(uploadDirectory);
  const cacheDirectory = path.join(path.dirname(sourceDirectory), "previews");
  const pending = new Map();
  let queue = Promise.resolve();

  async function cachedPdf(filePath) {
    try { return await readPreview(filePath, "application/pdf"); }
    catch (error) {
      if (error.code === "ENOENT" || error.status === 422) return null;
      throw error;
    }
  }

  async function generate(sourcePath, extension, cachedPath) {
    // A preceding request may have finished while this one waited in the queue.
    const existing = await cachedPdf(cachedPath);
    if (existing) return existing;
    await mkdir(cacheDirectory, { recursive: true });
    const workDirectory = await mkdtemp(path.join(cacheDirectory, "conversion-"));
    try {
      const inputPath = path.join(workDirectory, `document${extension}`);
      const outputDirectory = path.join(workDirectory, "output");
      const profileDirectory = path.join(workDirectory, "profile");
      await mkdir(outputDirectory);
      await mkdir(path.join(profileDirectory, "user"), { recursive: true });
      // No trusted locations/authors in a fresh profile; very high macro security.
      await writeFile(path.join(profileDirectory, "user", "registrymodifications.xcu"), `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>`);
      await copyFile(sourcePath, inputPath);
      await convertDocument({ inputPath, outputDirectory, profileDirectory, timeoutMs });
      const outputPath = path.join(outputDirectory, "document.pdf");
      const content = await readPreview(outputPath, "application/pdf");
      await rename(outputPath, cachedPath);
      return content;
    } catch (error) {
      if (error.status) throw error;
      console.error("Falha ao gerar prévia de documento:", error.message);
      throw conversionFailed();
    } finally {
      const resolvedWork = path.resolve(workDirectory);
      if (resolvedWork.startsWith(`${cacheDirectory}${path.sep}`)) {
        await rm(resolvedWork, { recursive: true, force: true }).catch((error) => console.error("Falha ao limpar prévia temporária:", error.message));
      }
    }
  }

  async function get(attachment) {
    const extension = path.extname(attachment.name).toLowerCase();
    if (!nativeTypes.has(extension) && !wordTypes.has(extension)) {
      throw previewError(415, "Este formato não possui prévia no sistema. Use Baixar para abrir o documento.");
    }
    if (!attachment.storedName || path.basename(attachment.storedName) !== attachment.storedName) throw previewError(404, "Documento não encontrado.");
    const sourcePath = path.resolve(sourceDirectory, attachment.storedName);
    if (!sourcePath.startsWith(`${sourceDirectory}${path.sep}`)) throw previewError(404, "Documento não encontrado.");
    let information;
    try { information = await stat(sourcePath); }
    catch (error) {
      if (error.code === "ENOENT") throw previewError(404, "Arquivo não encontrado no armazenamento.");
      throw error;
    }
    if (nativeTypes.has(extension)) {
      const mime = nativeTypes.get(extension);
      return { content: await readPreview(sourcePath, mime), mime, name: attachment.name, converted: false };
    }
    // Uploads are immutable. Include size and modification time so a replaced
    // source cannot accidentally reuse an earlier PDF.
    const key = createHash("sha256").update(`writer-v1\0${attachment.storedName}\0${information.size}\0${information.mtimeMs}`).digest("hex");
    const cachedPath = path.join(cacheDirectory, `${key}.pdf`);
    let content = await cachedPdf(cachedPath);
    if (!content) {
      if (!pending.has(key)) {
        if (pending.size >= 6) throw previewError(429, "Há outros documentos sendo preparados. Aguarde um instante e tente novamente.");
        const job = queue.then(() => generate(sourcePath, extension, cachedPath));
        pending.set(key, job);
        queue = job.catch(() => {});
        job.finally(() => pending.delete(key)).catch(() => {});
      }
      content = await pending.get(key);
    }
    return { content, mime: "application/pdf", name: `${path.parse(attachment.name).name}.pdf`, converted: true };
  }
  return { get };
}
