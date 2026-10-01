import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// VACUUM INTO reads a consistent SQLite snapshot, including committed WAL data.
// Copy only documents referenced by that snapshot. Missing documents fail the backup.
export async function backupDatabase(databasePath, destinationRoot) {
  await mkdir(destinationRoot, { recursive: true });
  const destination = await mkdtemp(path.join(destinationRoot, "pauta-backup-"));
  const snapshotPath = path.join(destination, "registros.sqlite");
  const source = new DatabaseSync(databasePath, { readOnly: true });
  try { source.prepare("VACUUM INTO ?").run(snapshotPath); } finally { source.close(); }
  const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
  let attachments;
  try {
    if (snapshot.prepare("PRAGMA quick_check").get().quick_check !== "ok" || snapshot.prepare("PRAGMA foreign_key_check").all().length) throw new Error("O snapshot não passou na verificação de integridade.");
    attachments = snapshot.prepare("SELECT DISTINCT stored_name FROM record_attachments").all();
  } finally { snapshot.close(); }
  const uploads = path.join(destination, "uploads");
  await mkdir(uploads);
  for (const { stored_name: filename } of attachments) {
    if (!filename || path.basename(filename) !== filename || filename === "." || filename === "..") throw new Error("Nome de arquivo inválido na base.");
    await copyFile(path.join(path.dirname(databasePath), "uploads", filename), path.join(uploads, filename));
  }
  // This marker exists only after the database and every document were copied.
  await writeFile(path.join(destination, "backup-completo.json"), JSON.stringify({ createdAt: new Date().toISOString(), documents: attachments.length }, null, 2), { flag: "wx" });
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(root, "data", "registros.sqlite"));
  try {
    const directory = await backupDatabase(databasePath, path.resolve(process.argv[2] || path.join(path.dirname(databasePath), "backups")));
    console.log(`Backup completo: ${directory}`);
  } catch (error) {
    console.error(`Backup incompleto: ${error.message}. Não use pastas sem backup-completo.json para restaurar.`);
    process.exitCode = 1;
  }
}
