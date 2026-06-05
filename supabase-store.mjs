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

async function fetchAll(config, table) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const page = await requestJson(config, `${table}?select=*`, {
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

export async function readSupabaseNormalizedDb() {
  const config = supabaseConfig();
  if (!config) throw new Error("Supabase is not configured.");
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

export async function writeSupabaseNormalizedDb(db) {
  const config = supabaseConfig();
  if (!config) throw new Error("Supabase is not configured.");
  const counts = {};
  for (const [table, conflict] of tablePlan) {
    const rows = db.tables[table] || [];
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
