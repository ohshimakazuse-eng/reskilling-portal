import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { extname, join, resolve } from "node:path";
import {
  applyLegacyCompaniesToNormalized,
  ensureNormalizedDb,
  hydrateLegacyCompanies,
  normalizedCompanyDashboard,
  normalizedMemberDetail,
  normalizedMembers,
  readNormalizedDb,
  writeNormalizedDb
} from "./normalized-store.mjs";
import {
  isSupabaseConfigured,
  readSupabaseNormalizedDb,
  readSupabaseSyncState,
  writeSupabaseNormalizedDb
} from "./supabase-store.mjs";

const root = resolve(".");
const dbDir = join(root, "db");
const dbPath = join(dbDir, "platform-db.json");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const publicUrl = process.env.PUBLIC_URL || process.env.APP_PUBLIC_URL || "";
const activeSessions = new Map();
let companyWriteQueue = Promise.resolve();
let bundledDataSyncPromise = null;
let bundledDataSyncStatus = {
  status: "idle",
  startedAt: null,
  completedAt: null,
  message: "未実行",
  result: null
};
const nonClientCompanyIds = new Set(["nh", "vv"]);
const isProduction = process.env.NODE_ENV === "production";
const devAdminPassword = ["admin", "123"].join("");
const devOperatorPassword = ["operator", "123"].join("");
const adminPassword = process.env.ADMIN_PASSWORD || (isProduction ? "" : devAdminPassword);
const operatorPassword = process.env.OPERATOR_PASSWORD || (isProduction ? "" : devOperatorPassword);
const sessionSecret = process.env.SESSION_SECRET || adminPassword || operatorPassword || "reskilling-portal-local-session";
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;
const clientLoginAliases = {
  iberis: "イベリス",
  exceed: "エクシードキャリア",
  recrea: "レクレア",
  rower: "ローワー"
};
const defaultMonths = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

const demoUsers = {
  admin: { loginId: "admin", email: "admin@reskilling.local", password: adminPassword, role: "admin", name: "自社管理者", canViewAll: true, canEdit: true },
  operator: { loginId: "operator", email: "operator@reskilling.local", password: operatorPassword, role: "operator", name: "運用担当者", canViewAll: true, canEdit: true }
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png"
};

const blockedFileExtensions = new Set([".md", ".mjs", ".py", ".sql", ".xlsx", ".csv", ".json", ".ndjson", ".bak"]);
const blockedFileNames = new Set([
  "login-credentials.md",
  "client-distribution-credentials.md",
  "internal-admin-credentials.md",
  "data.js",
  "Dockerfile",
  "render.yaml",
  ".env.production.example"
]);

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function responseHeaders(extra = {}) {
  const headers = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    ...extra
  };
  if (process.env.NODE_ENV === "production" || process.env.FORCE_HTTPS === "true") {
    headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, responseHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }));
  response.end(JSON.stringify(payload));
}

function apiErrorPayload(error) {
  const rawMessage = String(error?.publicMessage || error?.message || "Server error");
  const isDbUnavailable = error?.statusCode === 503
    || /Supabase|Web server is down|Cloudflare|521|522|523|524/i.test(rawMessage);
  if (isDbUnavailable) {
    return {
      statusCode: 503,
      payload: {
        ok: false,
        code: "database_unavailable",
        message: "Supabase DBが一時的に応答していません。少し待ってから再度保存してください。"
      }
    };
  }
  return {
    statusCode: error?.statusCode || 500,
    payload: { ok: false, message: rawMessage.slice(0, 300) }
  };
}

function shouldRedirectToHttps(request) {
  return process.env.FORCE_HTTPS === "true"
    && request.headers["x-forwarded-proto"]
    && request.headers["x-forwarded-proto"] !== "https";
}

function authToken(request) {
  const header = request.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : "";
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signSessionPayload(payload) {
  return createHmac("sha256", sessionSecret).update(payload).digest("base64url");
}

function createSessionToken(session) {
  const payload = base64UrlEncode(JSON.stringify(session));
  const signature = signSessionPayload(payload);
  return `${payload}.${signature}`;
}

function verifySessionToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = signSessionPayload(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  try {
    const session = JSON.parse(base64UrlDecode(payload));
    if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function sessionFromRequest(request) {
  const token = authToken(request);
  if (!token) return null;
  const activeSession = activeSessions.get(token);
  if (activeSession) return activeSession;
  const verifiedSession = verifySessionToken(token);
  if (!verifiedSession) return null;
  activeSessions.set(token, verifiedSession);
  return verifiedSession;
}

function requireSession(request, response) {
  const session = sessionFromRequest(request);
  if (!session) {
    sendJson(response, 401, { ok: false, message: "login required" });
    return null;
  }
  return session;
}

function filterCompaniesBySession(companies, session) {
  if (session.permissions.canViewAll) return companies;
  return companies.filter((company) => company.id === session.companyId);
}

function clientSafeText(value) {
  return String(value)
    .replaceAll("現場の課題", "確認したい点")
    .replaceAll("運営が行う施策", "今後の支援方針")
    .replaceAll("運営施策", "今後の支援方針")
    .replaceAll("依頼事項", "貴社への確認事項")
    .replaceAll("要対応者", "要確認者")
    .replaceAll("要対応人数", "要確認人数")
    .replaceAll("要対応率", "要確認率")
    .replaceAll("要対応", "要確認")
    .replaceAll("停滞者", "個別確認者")
    .replaceAll("停滞", "進行確認")
    .replaceAll("F評価。", "確認優先評価。")
    .replaceAll("F評価", "確認優先評価")
    .replaceAll("要フォロー", "個別フォロー");
}

function clientSafePayload(value, session) {
  if (!session || session.permissions.canViewAll) return value;
  if (typeof value === "string") return clientSafeText(value);
  if (Array.isArray(value)) return value.map((item) => clientSafePayload(item, session));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clientSafePayload(item, session)]));
  }
  return value;
}

function resolveLogin(body, companies) {
  const loginId = String(body.loginId || body.email || "").trim().toLowerCase();
  const loginMatchedUser = Object.values(demoUsers).find((user) => user.loginId === loginId || user.email === loginId);
  const explicitRole = body.role && demoUsers[body.role] ? body.role : null;
  const demoUser = loginMatchedUser || (explicitRole && !loginId ? demoUsers[explicitRole] : null);
  if (demoUser) {
    return demoUser.password && body.password === demoUser.password ? { user: demoUser, company: companies.find((item) => item.id === body.companyId) || companies[0] } : null;
  }

  const companyId = clientLoginAliases[loginId] || (/^[a-z0-9_-]+$/.test(loginId) ? loginId : "");
  const company = companies.find((item) => item.id.toLowerCase() === companyId);
  if (!company || nonClientCompanyIds.has(company.id)) return null;
  const expectedPassword = `${loginId}123`;
  if (body.password !== expectedPassword) return null;
  return {
    user: { role: "client", name: "クライアント閲覧者", canViewAll: false, canEdit: false },
    company
  };
}

function loginBodyFromRequest(request) {
  const encoded = String(request.headers["x-portal-auth"] || "");
  const decoded = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
  const separator = decoded.indexOf(":");
  const loginId = separator >= 0 ? decoded.slice(0, separator) : "";
  const password = separator >= 0 ? decoded.slice(separator + 1) : "";
  return {
    loginId,
    email: loginId,
    password,
    companyId: request.headers["x-company-id"] || ""
  };
}

function createLoginSession(body, companies, resolved) {
  const { user: demoUser, company } = resolved;
  const session = {
    role: demoUser.role,
    companyId: demoUser.canViewAll ? body.companyId || company.id : company.id,
    companyIds: demoUser.canViewAll ? companies.map((item) => item.id) : [company.id],
    name: demoUser.canViewAll ? demoUser.name : `${company.name} ${demoUser.name}`,
    permissions: {
      canViewAll: demoUser.canViewAll,
      canEdit: demoUser.canEdit
    },
    signedInAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + sessionTtlMs).toISOString()
  };
  const token = createSessionToken(session);
  session.token = token;
  activeSessions.set(token, session);
  return session;
}

async function initialData() {
  try {
    const source = await readFile(join(root, "data.js"), "utf8");
    const match = source.match(/window\.RESKILLING_DATA\s*=\s*([\s\S]*);\s*$/);
    if (!match) throw new Error("data.js から初期データを読み取れませんでした。");
    return JSON.parse(match[1]);
  } catch {
    return {
      months: defaultMonths,
      companies: []
    };
  }
}

async function bundledDataSeed() {
  const source = await readFile(join(root, "data.js"), "utf8");
  const match = source.match(/window\.RESKILLING_DATA\s*=\s*([\s\S]*);\s*$/);
  if (!match) throw new Error("data.js から同期データを読み取れませんでした。");
  return {
    hash: createHash("sha256").update(source).digest("hex"),
    data: JSON.parse(match[1])
  };
}

async function syncBundledDataToSupabaseIfNeeded(options = {}) {
  if (!isSupabaseConfigured()) return { ok: false, skipped: true, message: "Supabase is not configured." };
  if (!options.force && process.env.AUTO_SYNC_BUNDLED_DATA !== "true") {
    return { ok: true, skipped: true, message: "Bundled data auto sync is disabled." };
  }
  const { hash, data } = await bundledDataSeed();
  const normalizedDb = await readSupabaseNormalizedDb();
  const alreadySynced = (normalizedDb.tables.audit_logs || []).some((log) => (
    log.action === "bundled_data_sync" && log.after_json?.seedHash === hash
  ));
  if (alreadySynced) return { ok: true, skipped: true, message: "Bundled data is already synced.", hash };

  applyLegacyCompaniesToNormalized(
    normalizedDb,
    data.companies || [],
    options.actor || "system",
    `最新スプシ正本のデプロイ同期 ${data.generatedAt || hash.slice(0, 12)}`
  );
  normalizedDb.tables.audit_logs.unshift({
    id: crypto.randomUUID(),
    batch_id: null,
    actor_id: null,
    company_id: null,
    target_type: "platform",
    target_id: "bundled-data",
    action: "bundled_data_sync",
    before_json: null,
    after_json: {
      seedHash: hash,
      generatedAt: data.generatedAt || null,
      companies: (data.companies || []).length,
      members: (data.companies || []).reduce((sum, company) => sum + (company.members || []).length, 0),
      sales: (data.companies || []).reduce((sum, company) => sum + Number(company.sales || 0), 0)
    },
    created_at: new Date().toISOString()
  });
  const result = await writeSupabaseNormalizedDb(normalizedDb, { scope: "all" });
  console.log(`Bundled data synced to Supabase: ${hash.slice(0, 12)} ${JSON.stringify(result.counts || {})}`);
  return {
    ok: true,
    skipped: false,
    hash,
    counts: result.counts,
    source: {
      companies: (data.companies || []).length,
      members: (data.companies || []).reduce((sum, company) => sum + (company.members || []).length, 0),
      sales: (data.companies || []).reduce((sum, company) => sum + Number(company.sales || 0), 0)
    }
  };
}

function startBundledDataSync(session) {
  if (bundledDataSyncPromise) return bundledDataSyncStatus;
  bundledDataSyncStatus = {
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    message: "最新スプシ正本を本番DBへ同期中です。",
    result: null
  };
  bundledDataSyncPromise = syncBundledDataToSupabaseIfNeeded({
    force: true,
    actor: session?.name || "自社管理者"
  }).then((result) => {
    bundledDataSyncStatus = {
      ...bundledDataSyncStatus,
      status: result.skipped ? "skipped" : "completed",
      completedAt: new Date().toISOString(),
      message: result.message || "最新スプシ正本の同期が完了しました。",
      result
    };
  }).catch((error) => {
    bundledDataSyncStatus = {
      ...bundledDataSyncStatus,
      status: "failed",
      completedAt: new Date().toISOString(),
      message: error.publicMessage || error.message || "同期に失敗しました。",
      result: null
    };
    console.error("Bundled data manual sync failed:", error);
  }).finally(() => {
    bundledDataSyncPromise = null;
  });
  return bundledDataSyncStatus;
}

async function ensureDb() {
  await mkdir(dbDir, { recursive: true });
  await ensureNormalizedDb(root);
  try {
    await stat(dbPath);
  } catch {
    const seed = await initialData();
    await writeFile(dbPath, JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      months: seed.months,
      companies: seed.companies,
      auditLogs: []
    }, null, 2));
  }
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function writeDb(db) {
  db.updatedAt = new Date().toISOString();
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

async function readStoreDb(options = {}) {
  return isSupabaseConfigured() ? readSupabaseNormalizedDb(options) : readNormalizedDb(root);
}

async function writeStoreDb(db, options = {}) {
  return isSupabaseConfigured() ? writeSupabaseNormalizedDb(db, options) : writeNormalizedDb(root, db);
}

async function readStoreSyncState(session = null) {
  const companyCodes = session && !session.permissions.canViewAll ? [session.companyId] : [];
  if (isSupabaseConfigured()) return readSupabaseSyncState({ companyCodes });
  const normalizedDb = await readNormalizedDb(root);
  const companies = normalizedDb.tables.companies || [];
  const scoped = companyCodes.length ? companies.filter((company) => companyCodes.includes(company.code)) : companies;
  const values = scoped
    .map((company) => company.updated_at)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  return {
    updatedAt: values.length ? new Date(Math.max(...values.map((date) => date.getTime()))).toISOString() : normalizedDb.updatedAt || "",
    companyCount: scoped.length
  };
}

async function hydratedCompaniesForSession(session = null, options = {}) {
  const normalizedDb = await readStoreDb(options);
  const db = isSupabaseConfigured()
    ? { months: defaultMonths, companies: [], auditLogs: [] }
    : await readDb();
  const companies = hydrateLegacyCompanies(normalizedDb, db.months, db.companies);
  return {
    db,
    normalizedDb,
    companies: session ? filterCompaniesBySession(companies, session) : companies
  };
}

function storageName() {
  return isSupabaseConfigured() ? "supabase" : "normalized";
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, { ok: true, storage: storageName(), publicUrl, dbPath, normalizedDbPath: join(dbDir, "normalized-db.json"), supabase: isSupabaseConfigured() });
    return true;
  }

  if (pathname === "/api/version" && request.method === "GET") {
    sendJson(response, 200, { ok: true, version: "2026-06-08-manual-sheet-sync-ui", commit: process.env.RENDER_GIT_COMMIT || "" });
    return true;
  }

  if (pathname === "/api/sync-state" && request.method === "GET") {
    const session = requireSession(request, response);
    if (!session) return true;
    const syncState = await readStoreSyncState(session);
    sendJson(response, 200, { ok: true, ...syncState });
    return true;
  }

  if (pathname === "/api/admin/sync-bundled-data" && request.method === "GET") {
    const session = requireSession(request, response);
    if (!session) return true;
    if (!session.permissions.canViewAll || !session.permissions.canEdit) {
      sendJson(response, 403, { ok: false, message: "admin permission required" });
      return true;
    }
    sendJson(response, 200, { ok: true, sync: bundledDataSyncStatus });
    return true;
  }

  if (pathname === "/api/admin/sync-bundled-data" && request.method === "POST") {
    const session = requireSession(request, response);
    if (!session) return true;
    if (!session.permissions.canViewAll || !session.permissions.canEdit) {
      sendJson(response, 403, { ok: false, message: "admin permission required" });
      return true;
    }
    const sync = startBundledDataSync(session);
    sendJson(response, 202, { ok: true, sync });
    return true;
  }

  if ((pathname === "/api/login" || pathname === "/api/auth/login" || pathname === "/api/session" || pathname === "/api/sessions" || pathname === "/api/companies") && request.method === "POST") {
    const body = await readJsonBody(request);
    const { companies } = await hydratedCompaniesForSession(null, { companiesOnly: true });
    const resolved = resolveLogin(body, companies);
    if (!resolved) {
      sendJson(response, 401, { ok: false, message: "Invalid credentials" });
      return true;
    }
    const { user: demoUser, company } = resolved;
    if (demoUser.role === "client" && nonClientCompanyIds.has(company.id)) {
      sendJson(response, 403, { ok: false, message: "This company is not a client account." });
      return true;
    }
    const session = createLoginSession(body, companies, resolved);
    sendJson(response, 200, { ok: true, session });
    return true;
  }

  if (pathname === "/api/companies" && request.method === "GET") {
    if (request.headers["x-portal-auth"]) {
      const body = loginBodyFromRequest(request);
      const { companies } = await hydratedCompaniesForSession(null, { companiesOnly: true });
      const resolved = resolveLogin(body, companies);
      if (!resolved) {
        sendJson(response, 401, { ok: false, message: "Invalid credentials" });
        return true;
      }
      const { user: demoUser, company } = resolved;
      if (demoUser.role === "client" && nonClientCompanyIds.has(company.id)) {
        sendJson(response, 403, { ok: false, message: "This company is not a client account." });
        return true;
      }
      const session = createLoginSession(body, companies, resolved);
      sendJson(response, 200, { ok: true, session });
      return true;
    }
    const session = requireSession(request, response);
    if (!session) return true;
    const readOptions = session.permissions.canViewAll ? {} : { companyCodes: [session.companyId] };
    const { db, normalizedDb, companies } = await hydratedCompaniesForSession(session, readOptions);
    const syncState = await readStoreSyncState(session);
    sendJson(response, 200, clientSafePayload({ ok: true, months: db.months, companies, updatedAt: syncState.updatedAt || normalizedDb.updatedAt, storage: storageName(), permissions: session.permissions }, session));
    return true;
  }

  if (pathname === "/api/companies" && request.method === "PUT") {
    const session = requireSession(request, response);
    if (!session) return true;
    if (!session.permissions.canEdit) {
      sendJson(response, 403, { ok: false, message: "edit permission required" });
      return true;
    }
    const body = await readJsonBody(request);
    if (!Array.isArray(body.companies)) {
      sendJson(response, 400, { ok: false, message: "companies must be an array" });
      return true;
    }
    const requestedIds = body.companies.map((company) => company.id);
    if (!session.permissions.canViewAll && requestedIds.some((id) => id !== session.companyId)) {
      sendJson(response, 403, { ok: false, message: "company scope violation" });
      return true;
    }
    let saveResult;
    let updatedAt;
    companyWriteQueue = companyWriteQueue.then(async () => {
      const saveScope = body.scope === "all" ? "all" : "company";
      const scopedCompanyId = String(body.companyId || session.companyId || "");
      const readOptions = saveScope === "company" ? { companyCodes: [scopedCompanyId] } : {};
      const { db, normalizedDb, companies: currentCompanies } = await hydratedCompaniesForSession(null, readOptions);
      const incomingById = new Map(body.companies.map((company) => [company.id, company]));
      let mergedCompanies = currentCompanies;
      if (saveScope === "all") {
        if (!session.permissions.canViewAll) {
          const error = new Error("all-company save requires admin permission");
          error.statusCode = 403;
          throw error;
        }
        mergedCompanies = body.companies;
      } else {
        const incomingCompany = incomingById.get(scopedCompanyId);
        if (!incomingCompany) {
          const error = new Error("scoped company is missing from payload");
          error.statusCode = 400;
          throw error;
        }
        if (!session.permissions.canViewAll && scopedCompanyId !== session.companyId) {
          const error = new Error("company scope violation");
          error.statusCode = 403;
          throw error;
        }
        const replaced = new Set();
        mergedCompanies = currentCompanies.map((company) => {
          if (company.id !== scopedCompanyId) return company;
          replaced.add(company.id);
          return incomingCompany;
        });
        if (!replaced.has(scopedCompanyId)) mergedCompanies.push(incomingCompany);
      }
      if (!isSupabaseConfigured()) {
        db.auditLogs.unshift({
          id: crypto.randomUUID(),
          action: saveScope === "all" ? "replace_companies" : "replace_company",
          actor: session.name,
          createdAt: new Date().toISOString(),
          summary: body.summary || "frontend save",
          companyId: saveScope === "company" ? scopedCompanyId : ""
        });
        db.companies = mergedCompanies;
        await writeDb(db);
      }
      const companiesToNormalize = saveScope === "company"
        ? [incomingById.get(scopedCompanyId)]
        : mergedCompanies;
      applyLegacyCompaniesToNormalized(normalizedDb, companiesToNormalize, session.name, body.summary || "frontend save");
      saveResult = await writeStoreDb(normalizedDb, {
        scope: saveScope,
        companyCodes: saveScope === "company" ? [scopedCompanyId] : []
      });
      updatedAt = saveResult?.updatedAt || normalizedDb.updatedAt;
    });
    try {
      await companyWriteQueue;
    } catch (error) {
      companyWriteQueue = Promise.resolve();
      const { statusCode, payload } = apiErrorPayload(error);
      sendJson(response, statusCode, payload);
      return true;
    }
    sendJson(response, 200, { ok: true, updatedAt, storage: storageName(), counts: saveResult?.counts });
    return true;
  }

  if (pathname === "/api/audit-logs" && request.method === "GET") {
    const session = requireSession(request, response);
    if (!session) return true;
    const db = await readDb();
    const normalizedDb = await readStoreDb();
    const normalizedLogs = normalizedDb.tables.audit_logs.map((log) => ({
      id: log.id,
      action: log.action,
      actor: log.actor_id || "system",
      createdAt: log.created_at,
      summary: log.after_json ? `${log.after_json.sourceFile || "DB"}: ${log.after_json.members || 0}名を移行` : log.action
    }));
    const scopedLogs = session.permissions.canViewAll
      ? normalizedLogs
      : normalizedLogs.filter((log) => {
        const raw = normalizedDb.tables.audit_logs.find((item) => item.id === log.id);
        const company = normalizedDb.tables.companies.find((item) => item.id === raw?.company_id);
        return company?.code === session.companyId;
      });
    const legacyLogs = session.permissions.canViewAll ? db.auditLogs : [];
    sendJson(response, 200, clientSafePayload({ ok: true, auditLogs: [...scopedLogs, ...legacyLogs].slice(0, 100) }, session));
    return true;
  }

  if (pathname === "/api/v2/companies" && request.method === "GET") {
    const session = requireSession(request, response);
    if (!session) return true;
    const normalizedDb = await readStoreDb();
    const companies = normalizedDb.tables.companies
      .filter((company) => !company.deleted_at)
      .filter((company) => session.permissions.canViewAll || company.code === session.companyId);
    sendJson(response, 200, clientSafePayload({ ok: true, companies, updatedAt: normalizedDb.updatedAt, permissions: session.permissions }, session));
    return true;
  }

  const dashboardMatch = pathname.match(/^\/api\/v2\/companies\/([^/]+)\/dashboard$/);
  if (dashboardMatch && request.method === "GET") {
    const session = requireSession(request, response);
    if (!session) return true;
    const requestedCompany = decodeURIComponent(dashboardMatch[1]);
    if (!session.permissions.canViewAll && requestedCompany !== session.companyId) {
      sendJson(response, 403, { ok: false, message: "company scope violation" });
      return true;
    }
    const normalizedDb = await readStoreDb();
    const dashboard = normalizedCompanyDashboard(normalizedDb, requestedCompany);
    if (!dashboard) {
      sendJson(response, 404, { ok: false, message: "company not found" });
      return true;
    }
    sendJson(response, 200, clientSafePayload({ ok: true, ...dashboard }, session));
    return true;
  }

  const membersMatch = pathname.match(/^\/api\/v2\/companies\/([^/]+)\/members$/);
  if (membersMatch && request.method === "GET") {
    const session = requireSession(request, response);
    if (!session) return true;
    const requestedCompany = decodeURIComponent(membersMatch[1]);
    if (!session.permissions.canViewAll && requestedCompany !== session.companyId) {
      sendJson(response, 403, { ok: false, message: "company scope violation" });
      return true;
    }
    const normalizedDb = await readStoreDb();
    const members = normalizedMembers(normalizedDb, requestedCompany);
    if (!members) {
      sendJson(response, 404, { ok: false, message: "company not found" });
      return true;
    }
    sendJson(response, 200, clientSafePayload({ ok: true, ...members }, session));
    return true;
  }

  const memberMatch = pathname.match(/^\/api\/v2\/members\/([^/]+)$/);
  if (memberMatch && request.method === "GET") {
    const session = requireSession(request, response);
    if (!session) return true;
    const normalizedDb = await readStoreDb();
    const detail = normalizedMemberDetail(normalizedDb, decodeURIComponent(memberMatch[1]));
    if (!detail) {
      sendJson(response, 404, { ok: false, message: "member not found" });
      return true;
    }
    const company = normalizedDb.tables.companies.find((item) => item.id === detail.member.company_id);
    if (!session.permissions.canViewAll && company?.code !== session.companyId) {
      sendJson(response, 403, { ok: false, message: "company scope violation" });
      return true;
    }
    sendJson(response, 200, clientSafePayload({ ok: true, ...detail }, session));
    return true;
  }

  return false;
}

function safeFilePath(pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  if (requested.startsWith("/backups/") || requested.startsWith("/db/") || requested.startsWith("/google_sheets_xlsx/")) return null;
  if (requested.startsWith("/.env")) return null;
  const filePath = resolve(root, `.${decodeURIComponent(requested)}`);
  if (!filePath.startsWith(root)) return null;
  const extension = extname(filePath);
  const filename = filePath.split(/[\\/]/).at(-1);
  if (blockedFileExtensions.has(extension) || blockedFileNames.has(filename)) return null;
  return filePath;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (shouldRedirectToHttps(request)) {
      response.writeHead(308, responseHeaders({ location: `https://${request.headers.host}${url.pathname}${url.search}` }));
      response.end();
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url.pathname);
      if (!handled) sendJson(response, 404, { ok: false, message: "Not found" });
      return;
    }

    if (url.pathname === "/favicon.ico") {
      response.writeHead(204, responseHeaders());
      response.end();
      return;
    }

    const filePath = safeFilePath(url.pathname);
    if (!filePath) {
      response.writeHead(403, responseHeaders());
      response.end("Forbidden");
      return;
    }
    await stat(filePath);
    response.writeHead(200, responseHeaders({
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    }));
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") {
      response.writeHead(404, responseHeaders());
      response.end("Not found");
      return;
    }
    console.error(error);
    const { statusCode, payload } = apiErrorPayload(error);
    sendJson(response, statusCode, payload);
  }
});

async function startServer() {
  await ensureDb();
  server.listen(port, host, () => {
    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    console.log(`Reskilling Portal server: ${publicUrl || `http://${displayHost}:${port}`}`);
    syncBundledDataToSupabaseIfNeeded().catch((error) => {
      console.error("Bundled data sync failed:", error);
    });
  });
}

startServer().catch((error) => {
  console.error("Server startup failed:", error);
  process.exit(1);
});
