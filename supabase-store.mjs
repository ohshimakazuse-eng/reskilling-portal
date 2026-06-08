const tablePlan = [
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

const tableWriteOptions = {
  update_batches: { chunkSize: 50, maxRows: 500, optional: true, maxAttempts: 2 },
  audit_logs: { chunkSize: 25, maxRows: 500, optional: true, maxAttempts: 2 }
};

function normalizeSupabaseUrl(url) {
  return String(url || "").replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
}

export function supabaseConfig() {
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL);
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

export function isSupabaseConfigured() {
  return Boolean(supabaseConfig());
}

function headers(config, extra = {}) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    ...extra
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 521 || status === 522 || status === 523 || status === 524 || status >= 500;
}

function compactDetail(text) {
  const value = String(text || "");
  if (value.includes("Web server is down") || value.includes("cloudflare") || value.includes("<!DOCTYPE html>")) {
    return "Supabase DBが一時的に応答していません。数十秒後にもう一度保存してください。";
  }
  return value.slice(0, 300);
}

async function requestJson(config, path, options = {}, attempt = 0) {
  const maxAttempts = Number(options.maxAttempts || 4);
  let response;
  try {
    response = await fetch(`${config.url}/rest/v1/${path}`, {
      ...options,
      headers: headers(config, options.headers || {})
    });
  } catch (error) {
    if (attempt + 1 < maxAttempts) {
      await wait(600 * (attempt + 1));
      return requestJson(config, path, options, attempt + 1);
    }
    const wrapped = new Error("Supabase DBに接続できません。少し待ってから再度保存してください。");
    wrapped.statusCode = 503;
    wrapped.cause = error;
    throw wrapped;
  }
  if (!response.ok) {
    const detail = await response.text();
    if (isRetryableStatus(response.status) && attempt + 1 < maxAttempts) {
      await wait(800 * (attempt + 1));
      return requestJson(config, path, options, attempt + 1);
    }
    const error = new Error(`${options.method || "GET"} ${path} failed: ${response.status} ${compactDetail(detail)}`);
    error.statusCode = isRetryableStatus(response.status) ? 503 : response.status;
    error.publicMessage = isRetryableStatus(response.status)
      ? "Supabase DBが一時的に応答していません。少し待ってから再度保存してください。"
      : compactDetail(detail);
    throw error;
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function inFilter(values) {
  return `in.(${values.map((value) => encodeURIComponent(String(value))).join(",")})`;
}

async function fetchAll(config, table, query = "select=*") {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const page = await requestJson(config, `${table}?${query}`, {
      headers: { Range: `${from}-${to}` }
    });
    rows.push(...(page || []));
    if (!page || page.length < pageSize) break;
  }
  return rows;
}

async function upsertRows(config, table, conflict, rows, options = {}) {
  if (!rows.length) return 0;
  const orderedRows = options.maxRows ? rows.slice(0, options.maxRows) : rows;
  const chunkSize = options.chunkSize || 500;
  let count = 0;
  for (let index = 0; index < orderedRows.length; index += chunkSize) {
    const chunk = orderedRows.slice(index, index + chunkSize);
    await requestJson(config, `${table}?on_conflict=${encodeURIComponent(conflict).replaceAll("%2C", ",")}`, {
      method: "POST",
      maxAttempts: options.maxAttempts,
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

function rowsForCompanyScope(db, companyCodes = []) {
  const codes = new Set(companyCodes.filter(Boolean));
  if (!codes.size) return db.tables;
  const tables = db.tables;
  const companies = (tables.companies || []).filter((company) => codes.has(company.code));
  const companyIds = new Set(companies.map((company) => company.id));
  const members = (tables.members || []).filter((member) => companyIds.has(member.company_id));
  const memberIds = new Set(members.map((member) => member.id));
  return {
    app_users: [],
    companies,
    company_users: (tables.company_users || []).filter((row) => companyIds.has(row.company_id)),
    members,
    member_accounts: (tables.member_accounts || []).filter((row) => memberIds.has(row.member_id)),
    member_milestones: (tables.member_milestones || []).filter((row) => memberIds.has(row.member_id)),
    member_metrics: (tables.member_metrics || []).filter((row) => memberIds.has(row.member_id)),
    coaching_sessions: (tables.coaching_sessions || []).filter((row) => companyIds.has(row.company_id) || memberIds.has(row.member_id)),
    company_monthly_summaries: (tables.company_monthly_summaries || []).filter((row) => companyIds.has(row.company_id)),
    client_reports: (tables.client_reports || []).filter((row) => companyIds.has(row.company_id)),
    update_batches: (tables.update_batches || []).slice(0, 3),
    audit_logs: (tables.audit_logs || []).filter((row) => companyIds.has(row.company_id)).slice(0, 10)
  };
}

export async function readSupabaseNormalizedDb(options = {}) {
  const config = supabaseConfig();
  if (!config) throw new Error("Supabase is not configured.");
  if (options.companiesOnly) {
    const tables = Object.fromEntries(tablePlan.map(([table]) => [table, []]));
    tables.companies = await fetchAll(config, "companies");
    return {
      version: 2,
      createdAt: null,
      updatedAt: new Date().toISOString(),
      source: "supabase",
      generatedAt: null,
      tables
    };
  }
  if (options.companyCodes?.length) {
    const tables = Object.fromEntries(tablePlan.map(([table]) => [table, []]));
    const allCompanies = await fetchAll(config, "companies");
    tables.companies = allCompanies.filter((company) => options.companyCodes.includes(company.code));
    const companyIds = tables.companies.map((company) => company.id);
    if (companyIds.length) {
      const companyFilter = inFilter(companyIds);
      tables.company_users = await fetchAll(config, "company_users", `select=*&company_id=${companyFilter}`);
      tables.members = await fetchAll(config, "members", `select=*&company_id=${companyFilter}`);
      const memberIds = tables.members.map((member) => member.id);
      if (memberIds.length) {
        const memberFilter = inFilter(memberIds);
        tables.member_accounts = await fetchAll(config, "member_accounts", `select=*&member_id=${memberFilter}`);
        tables.member_milestones = await fetchAll(config, "member_milestones", `select=*&member_id=${memberFilter}`);
        tables.member_metrics = await fetchAll(config, "member_metrics", `select=*&member_id=${memberFilter}`);
        tables.coaching_sessions = await fetchAll(config, "coaching_sessions", `select=*&member_id=${memberFilter}`);
      }
      tables.company_monthly_summaries = await fetchAll(config, "company_monthly_summaries", `select=*&company_id=${companyFilter}`);
      tables.client_reports = await fetchAll(config, "client_reports", `select=*&company_id=${companyFilter}`);
      tables.audit_logs = await fetchAll(config, "audit_logs", `select=*&company_id=${companyFilter}`);
    }
    return {
      version: 2,
      createdAt: null,
      updatedAt: new Date().toISOString(),
      source: "supabase",
      generatedAt: null,
      tables
    };
  }
  const tables = {};
  for (const [table] of tablePlan) {
    tables[table] = await fetchAll(config, table);
  }
  return {
    version: 2,
    createdAt: null,
    updatedAt: new Date().toISOString(),
    source: "supabase",
    generatedAt: null,
    tables
  };
}

export async function readSupabaseSyncState(options = {}) {
  const config = supabaseConfig();
  if (!config) throw new Error("Supabase is not configured.");
  const query = options.companyCodes?.length
    ? `select=code,updated_at&code=${inFilter(options.companyCodes)}`
    : "select=code,updated_at";
  const rows = await fetchAll(config, "companies", query);
  const values = rows
    .map((row) => row.updated_at)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  const updatedAt = values.length
    ? new Date(Math.max(...values.map((date) => date.getTime()))).toISOString()
    : "";
  return { updatedAt, companyCount: rows.length };
}

export async function writeSupabaseNormalizedDb(db, writeOptions = {}) {
  const config = supabaseConfig();
  if (!config) throw new Error("Supabase is not configured.");
  const counts = {};
  const scopedTables = writeOptions.scope === "company"
    ? rowsForCompanyScope(db, writeOptions.companyCodes || [])
    : db.tables;
  for (const [table, conflict] of tablePlan) {
    const rows = scopedTables[table] || [];
    const options = tableWriteOptions[table] || {};
    try {
      counts[table] = await upsertRows(config, table, conflict, rows, options);
    } catch (error) {
      if (!options.optional) throw error;
      console.warn(`${table} write skipped:`, error.message);
      counts[table] = 0;
      counts[`${table}_skipped`] = rows.length;
    }
  }
  return { counts, updatedAt: new Date().toISOString() };
}
