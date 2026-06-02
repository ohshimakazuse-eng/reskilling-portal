import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { supabaseConfig } from "./supabase-store.mjs";

const backupDir = process.argv[2];
const shouldRestore = process.argv.includes("--confirm-restore");
const shouldReplace = process.argv.includes("--replace");

const restorePlan = [
  ["app_users", "id"],
  ["companies", "id"],
  ["company_users", "company_id,user_id,role"],
  ["members", "id"],
  ["member_accounts", "id"],
  ["member_milestones", "member_id,milestone_key"],
  ["member_metrics", "member_id,metric_month"],
  ["coaching_sessions", "id"],
  ["company_monthly_summaries", "company_id,summary_month"],
  ["client_reports", "id"],
  ["update_batches", "id"],
  ["audit_logs", "id"]
];

function requireArgs() {
  if (!backupDir) throw new Error("Usage: node restore_supabase_backup.mjs <backup_dir> [--confirm-restore] [--replace]");
  if (!existsSync(join(backupDir, "supabase-normalized-db.json"))) {
    throw new Error(`Backup file not found: ${join(backupDir, "supabase-normalized-db.json")}`);
  }
}

function headers(config, extra = {}) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    ...extra
  };
}

async function request(config, path, options = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: headers(config, options.headers || {})
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} failed ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function deleteTable(config, table, conflict) {
  const filterColumn = conflict.split(",")[0];
  await request(config, `${table}?${filterColumn}=not.is.null`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
}

async function upsertRows(config, table, conflict, rows) {
  if (!rows.length) return 0;
  const chunkSize = 500;
  let count = 0;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    await request(config, `${table}?on_conflict=${encodeURIComponent(conflict).replaceAll("%2C", ",")}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(chunk)
    });
    count += chunk.length;
  }
  return count;
}

async function main() {
  requireArgs();
  const config = supabaseConfig();
  if (!config) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const db = JSON.parse(await fs.readFile(join(backupDir, "supabase-normalized-db.json"), "utf8"));
  const counts = Object.fromEntries(restorePlan.map(([table]) => [table, (db.tables?.[table] || []).length]));

  if (!shouldRestore) {
    console.log(JSON.stringify({
      ok: true,
      mode: "dry-run",
      message: "No data was changed. Add --confirm-restore to restore this backup.",
      replaceMode: shouldReplace,
      backupDir,
      counts
    }, null, 2));
    return;
  }

  if (shouldReplace) {
    for (const [table, conflict] of [...restorePlan].reverse()) {
      await deleteTable(config, table, conflict);
    }
  }

  const restored = {};
  for (const [table, conflict] of restorePlan) {
    restored[table] = await upsertRows(config, table, conflict, db.tables?.[table] || []);
  }

  await request(config, "audit_logs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify([{
      batch_id: null,
      actor_id: null,
      company_id: null,
      target_type: "database",
      target_id: "full_backup",
      action: "restore_full_backup",
      before_json: null,
      after_json: { backupDir, replaceMode: shouldReplace, restored },
      created_at: new Date().toISOString()
    }])
  });

  console.log(JSON.stringify({
    ok: true,
    mode: "restore",
    replaceMode: shouldReplace,
    backupDir,
    restored
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
  process.exit(1);
});
