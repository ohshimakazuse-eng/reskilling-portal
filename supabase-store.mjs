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

async function requestJson(config, path, options = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: headers(config, options.headers || {})
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${options.method || "GET"} ${path} failed: ${response.status} ${detail}`);
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

async function upsertRows(config, table, conflict, rows) {
  if (!rows.length) return 0;
  const chunkSize = 500;
  let count = 0;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    await requestJson(config, `${table}?on_conflict=${encodeURIComponent(conflict).replaceAll("%2C", ",")}`, {
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
    counts[table] = await upsertRows(config, table, conflict, rows);
  }
  return { counts, updatedAt: new Date().toISOString() };
}
