import fs from "node:fs/promises";
import { adminLoginId, adminPassword } from "./auth-test-config.mjs";

const baseUrl = process.env.APP_BASE_URL || "http://127.0.0.1:4173";

function loadSourceData() {
  return fs.readFile("data.js", "utf8").then((text) => {
    const match = text.match(/window\.RESKILLING_DATA\s*=\s*(\{[\s\S]*\});\s*$/);
    if (!match) throw new Error("data.js could not be parsed");
    return JSON.parse(match[1]);
  });
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
  return { status: response.status, body };
}

function auth(session, extra = {}) {
  return { ...extra, Authorization: `Bearer ${session.token}` };
}

async function main() {
  const source = await loadSourceData();
  const login = await request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loginId: adminLoginId, password: adminPassword })
  });
  if (login.status !== 200) throw new Error(`admin login failed: ${login.status}`);
  const session = login.body.session;

  const response = await request("/api/companies", {
    method: "PUT",
    headers: auth(session, { "content-type": "application/json" }),
    body: JSON.stringify({
      scope: "all",
      actor: "自社管理者",
      session,
      summary: "最新スプシ正本との全社同期（NH/VVは2026-06-02共有リンクを正本）",
      companies: source.companies
    })
  });
  if (response.status !== 200) throw new Error(`sync failed: ${response.status} ${JSON.stringify(response.body)}`);

  console.log(JSON.stringify({
    ok: true,
    storage: response.body.storage,
    updatedAt: response.body.updatedAt,
    source: {
      companies: source.companies.length,
      members: source.companies.reduce((sum, company) => sum + company.members.length, 0),
      sales: source.companies.reduce((sum, company) => sum + Number(company.sales || 0), 0)
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
  process.exit(1);
});
