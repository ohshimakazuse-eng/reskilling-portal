import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { adminLoginId, adminPassword } from "./auth-test-config.mjs";

const baseUrl = process.env.APP_BASE_URL || "http://127.0.0.1:4173";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed: ${response.status} ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

function auth(session, extra = {}) {
  return { ...extra, Authorization: `Bearer ${session.token}` };
}

async function main() {
  const id = process.env.BACKUP_ID || timestamp();
  const dir = join("backups", `api-${id}`);
  await fs.mkdir(dir, { recursive: true });

  const login = await request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loginId: adminLoginId, password: adminPassword })
  });
  const session = login.session;
  const companies = await request("/api/companies", { headers: auth(session) });
  const auditLogs = await request("/api/audit-logs", { headers: auth(session) });

  const snapshot = {
    ok: true,
    createdAt: new Date().toISOString(),
    baseUrl,
    months: companies.months,
    companies: companies.companies,
    auditLogs: auditLogs.auditLogs || []
  };
  const payload = JSON.stringify(snapshot, null, 2);
  await fs.writeFile(join(dir, "platform-api-snapshot.json"), payload);

  const manifest = {
    ok: true,
    backupId: `api-${id}`,
    dir,
    createdAt: snapshot.createdAt,
    totals: {
      companies: snapshot.companies.length,
      members: snapshot.companies.reduce((sum, company) => sum + (company.members || []).length, 0),
      auditLogs: snapshot.auditLogs.length
    },
    files: {
      snapshot: {
        file: join(dir, "platform-api-snapshot.json"),
        bytes: Buffer.byteLength(payload),
        sha256: sha256(payload)
      }
    }
  };
  await fs.writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
  process.exit(1);
});
