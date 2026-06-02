import { adminLoginId, adminPassword, operatorLoginId, operatorPassword } from "./auth-test-config.mjs";

const baseUrl = process.env.APP_BASE_URL || "http://127.0.0.1:4173";

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(loginId, password, companyId) {
  const response = await request("/api/companies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loginId, password, companyId })
  });
  assert(response.status === 200, `${loginId}: login failed ${response.status}`);
  assert(response.body?.session?.token, `${loginId}: missing token`);
  return response.body.session;
}

function auth(session, extra = {}) {
  return { ...extra, Authorization: `Bearer ${session.token}` };
}

async function main() {
  const health = await request("/api/health");
  assert(health.status === 200, "health must return 200");
  assert(health.body?.storage === "supabase", `storage must be supabase, got ${health.body?.storage}`);
  assert(health.body?.supabase === true, "supabase flag must be true");

  const admin = await login(adminLoginId, adminPassword, "yrr");
  const operator = await login(operatorLoginId, operatorPassword, "yrr");
  const client = await login("yrr", "yrr123");

  assert(admin.permissions.canViewAll === true && admin.permissions.canEdit === true, "admin permissions mismatch");
  assert(operator.permissions.canViewAll === true && operator.permissions.canEdit === true, "operator permissions mismatch");
  assert(client.permissions.canViewAll === false && client.permissions.canEdit === false, "client permissions mismatch");

  const adminCompanies = await request("/api/companies", { headers: auth(admin) });
  assert(adminCompanies.status === 200, "admin companies should be 200");
  assert(adminCompanies.body.companies.length === 17, `admin must see 17 companies, got ${adminCompanies.body.companies.length}`);

  const operatorCompanies = await request("/api/companies", { headers: auth(operator) });
  assert(operatorCompanies.status === 200, "operator companies should be 200");
  assert(operatorCompanies.body.companies.length === 17, `operator must see 17 companies, got ${operatorCompanies.body.companies.length}`);

  const clientCompanies = await request("/api/companies", { headers: auth(client) });
  assert(clientCompanies.status === 200, "client companies should be 200");
  assert(clientCompanies.body.companies.length === 1, `client must see one company, got ${clientCompanies.body.companies.length}`);
  assert(clientCompanies.body.companies[0].id === "yrr", `client must see only yrr, got ${clientCompanies.body.companies[0].id}`);

  const clientPut = await request("/api/companies", {
    method: "PUT",
    headers: auth(client, { "content-type": "application/json" }),
    body: JSON.stringify({ companies: clientCompanies.body.companies, summary: "security test should fail" })
  });
  assert(clientPut.status === 403, `client PUT must be 403, got ${clientPut.status}`);

  const clientOtherDashboard = await request("/api/v2/companies/ba/dashboard", { headers: auth(client) });
  assert(clientOtherDashboard.status === 403, `client other dashboard must be 403, got ${clientOtherDashboard.status}`);

  const clientInternalLogin = await request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loginId: "nh", password: "nh123" })
  });
  assert(clientInternalLogin.status === 401 || clientInternalLogin.status === 403, `internal client login must fail, got ${clientInternalLogin.status}`);

  const noAuthCompanies = await request("/api/companies");
  assert(noAuthCompanies.status === 401, `no-auth companies must be 401, got ${noAuthCompanies.status}`);

  const adminOtherDashboard = await request("/api/v2/companies/ba/dashboard", { headers: auth(admin) });
  assert(adminOtherDashboard.status === 200, `admin other dashboard must be 200, got ${adminOtherDashboard.status}`);

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    storage: health.body.storage,
    checked: [
      "health_supabase_mode",
      "admin_all_company_access",
      "operator_all_company_access",
      "client_single_company_access",
      "client_write_denied",
      "client_other_company_denied",
      "internal_company_client_login_denied",
      "no_auth_denied",
      "admin_cross_company_allowed"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
  process.exit(1);
});
