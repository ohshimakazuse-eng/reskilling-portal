import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readSupabaseNormalizedDb, supabaseConfig } from "./supabase-store.mjs";

const backupRoot = "backups";
const tableOrder = [
  "app_users",
  "companies",
  "company_users",
  "members",
  "member_accounts",
  "member_milestones",
  "member_metrics",
  "coaching_sessions",
  "company_monthly_summaries",
  "client_reports",
  "update_batches",
  "audit_logs"
];

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function copyIfExists(source, target) {
  if (!existsSync(source)) return null;
  const payload = await fs.readFile(source);
  await fs.writeFile(target, payload);
  return { file: target, bytes: payload.length, sha256: sha256(payload) };
}

async function copyDirectoryFiles(sourceDir, targetDir) {
  if (!existsSync(sourceDir)) return [];
  await fs.mkdir(targetDir, { recursive: true });
  const files = await fs.readdir(sourceDir);
  const copied = [];
  for (const file of files) {
    const source = join(sourceDir, file);
    const target = join(targetDir, file);
    const stat = await fs.stat(source);
    if (!stat.isFile()) continue;
    const payload = await fs.readFile(source);
    await fs.writeFile(target, payload);
    copied.push({ file: target, bytes: payload.length, sha256: sha256(payload) });
  }
  return copied;
}

async function main() {
  const config = supabaseConfig();
  if (!config) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

  const id = process.env.BACKUP_ID || timestamp();
  const dir = join(backupRoot, id);
  await fs.mkdir(dir, { recursive: true });

  const db = await readSupabaseNormalizedDb();
  const counts = Object.fromEntries(tableOrder.map((table) => [table, (db.tables[table] || []).length]));

  const dbJson = JSON.stringify(db, null, 2);
  await fs.writeFile(join(dir, "supabase-normalized-db.json"), dbJson);
  await fs.writeFile(join(dir, "audit-logs.json"), JSON.stringify(db.tables.audit_logs || [], null, 2));
  await fs.writeFile(join(dir, "update-batches.json"), JSON.stringify(db.tables.update_batches || [], null, 2));

  const localFiles = [];
  for (const file of ["data.js", "data-summary.json", "latest-google-sheets-sync-report.md", "latest-sheet-reconciliation-report.md"]) {
    const copied = await copyIfExists(file, join(dir, file));
    if (copied) localFiles.push(copied);
  }
  const sheetFiles = await copyDirectoryFiles("google_sheets_xlsx", join(dir, "google_sheets_xlsx"));

  const manifest = {
    ok: true,
    backupId: id,
    createdAt: new Date().toISOString(),
    supabaseUrl: config.url,
    counts,
    totals: {
      companies: counts.companies || 0,
      members: counts.members || 0,
      auditLogs: counts.audit_logs || 0,
      updateBatches: counts.update_batches || 0,
      sheetFiles: sheetFiles.length
    },
    files: {
      normalizedDb: {
        file: join(dir, "supabase-normalized-db.json"),
        bytes: Buffer.byteLength(dbJson),
        sha256: sha256(dbJson)
      },
      auditLogs: join(dir, "audit-logs.json"),
      updateBatches: join(dir, "update-batches.json"),
      localFiles,
      sheetFiles
    }
  };
  await fs.writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
  process.exit(1);
});
