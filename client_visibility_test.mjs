const baseUrl = process.env.APP_BASE_URL || "http://127.0.0.1:4173";
const forbiddenTerms = [
  "株式会社NEXT Homie",
  "株式会社vivavista",
  "株式会社B-Liber",
  "柏田 竜希",
  "山田 将悟",
  "松山晃明"
];
const forbiddenClientWording = ["現場の課題", "運営が行う施策", "依頼事項", "要対応", "停滞者", "停滞", "F評価。"];
const requiredClientWording = ["確認したい点", "今後の支援方針", "貴社への確認事項", "要確認"];

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: response.status, text, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(loginId, password) {
  const response = await request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loginId, password })
  });
  assert(response.status === 200, `${loginId}: login failed ${response.status}`);
  return response.body.session;
}

function auth(session, extra = {}) {
  return { ...extra, Authorization: `Bearer ${session.token}` };
}

async function assertStaticBlocked(path) {
  const response = await request(path);
  assert(response.status === 403, `${path}: expected 403, got ${response.status}`);
}

async function main() {
  await assertStaticBlocked("/data.js");
  await assertStaticBlocked("/client-distribution-credentials.md");
  await assertStaticBlocked("/internal-admin-credentials.md");
  await assertStaticBlocked("/server.mjs");
  await assertStaticBlocked("/production-db-schema.sql");

  const html = await request("/");
  assert(html.status === 200, "/ must return 200");
  assert(!html.text.includes("デモID"), "login screen must not show demo ID");
  assert(!html.text.includes("data.js"), "index.html must not load data.js");

  const client = await login("yrr", "yrr123");
  const companies = await request("/api/companies", { headers: auth(client) });
  assert(companies.status === 200, `client companies failed ${companies.status}`);
  assert(companies.body.companies.length === 1, `client must see one company, got ${companies.body.companies.length}`);
  assert(companies.body.companies[0].id === "yrr", `client must see yrr only, got ${companies.body.companies[0].id}`);
  const payload = JSON.stringify(companies.body);
  for (const term of forbiddenTerms) {
    assert(!payload.includes(term), `client payload leaked forbidden term: ${term}`);
  }
  for (const forbiddenText of forbiddenClientWording) {
    assert(!payload.includes(forbiddenText), `client payload still contains old wording: ${forbiddenText}`);
  }

  const otherDashboard = await request("/api/v2/companies/bl/dashboard", { headers: auth(client) });
  assert(otherDashboard.status === 403, `client other dashboard must be 403, got ${otherDashboard.status}`);

  const clientSave = await request("/api/companies", {
    method: "PUT",
    headers: auth(client, { "content-type": "application/json" }),
    body: JSON.stringify({ companies: companies.body.companies, summary: "client save must fail" })
  });
  assert(clientSave.status === 403, `client save must be 403, got ${clientSave.status}`);

  const appJs = await request("/app.js");
  assert(appJs.status === 200, "app.js must load");
  for (const requiredText of requiredClientWording) {
    assert(appJs.text.includes(requiredText), `client-facing wording missing: ${requiredText}`);
  }

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "static_data_js_blocked",
      "credential_files_blocked",
      "server_source_blocked",
      "index_no_demo_id",
      "index_no_data_js",
      "client_single_company_only",
      "client_payload_no_other_company_terms",
      "client_payload_wording_adjusted",
      "client_other_company_denied",
      "client_save_denied",
      "client_wording_adjusted"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
  process.exit(1);
});
