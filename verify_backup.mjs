import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const backupDir = process.argv[2];
const requiredTables = [
  "app_users",
  "companies",
  "members",
  "member_metrics",
  "coaching_sessions",
  "client_reports",
  "update_batches",
  "audit_logs"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  assert(backupDir, "Usage: node verify_backup.mjs <backup_dir>");
  const manifestPath = join(backupDir, "manifest.json");
  const dbPath = join(backupDir, "supabase-normalized-db.json");
  const auditPath = join(backupDir, "audit-logs.json");
  assert(existsSync(manifestPath), `missing ${manifestPath}`);
  assert(existsSync(dbPath), `missing ${dbPath}`);
  assert(existsSync(auditPath), `missing ${auditPath}`);

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const dbPayload = await fs.readFile(dbPath);
  const db = JSON.parse(dbPayload.toString("utf8"));
  const auditLogs = JSON.parse(await fs.readFile(auditPath, "utf8"));

  for (const table of requiredTables) {
    assert(Array.isArray(db.tables?.[table]), `missing table snapshot: ${table}`);
  }
  assert(manifest.files?.normalizedDb?.sha256 === sha256(dbPayload), "normalized DB checksum mismatch");
  assert((db.tables.companies || []).length === manifest.counts.companies, "company count mismatch");
  assert((db.tables.members || []).length === manifest.counts.members, "member count mismatch");
  assert(auditLogs.length === manifest.counts.audit_logs, "audit log count mismatch");

  console.log(JSON.stringify({
    ok: true,
    backupDir,
    counts: manifest.counts,
    totals: manifest.totals,
    checksum: manifest.files.normalizedDb.sha256
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
  process.exit(1);
});
