const fallbackCompanyData = [];

const PLATFORM_STORAGE_KEY = "reskilling-platform-data-v2";
const SESSION_STORAGE_KEY = "reskilling-session-v1";
const MONTHLY_RESET_STORAGE_KEY = "reskilling-monthly-reset-v1";
const NON_CLIENT_COMPANY_IDS = new Set(["nh", "vv"]);
const CLIENT_LOGIN_ALIASES = {
  iberis: "イベリス",
  exceed: "エクシードキャリア",
  recrea: "レクレア",
  rower: "ローワー"
};
const importedCompanyData = window.RESKILLING_DATA?.companies || fallbackCompanyData;
let months = window.RESKILLING_DATA?.months || ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const milestoneLabels = [
  ["daily", "毎日投稿"],
  ["orient", "オリエン"],
  ["firstMtg", "初回MTG"],
  ["account", "アカウント作成"],
  ["firstPost", "初回投稿"],
  ["f100", "フォロワー100"],
  ["prMtg", "PR初回MTG"],
  ["product", "商品申請"]
];

const detailMilestoneGroups = [
  {
    title: "前提条件",
    items: [
      ["daily", "毎日投稿"],
      ["qa", "Q&A"],
      ["mtg", "MTG"]
    ]
  },
  {
    title: "基礎構築",
    items: [
      ["orient", "オリエン"],
      ["firstMtg", "初回MTG"],
      ["account", "アカウント作成"],
      ["firstPost", "初回投稿"]
    ]
  },
  {
    title: "フォロワー成長",
    items: [
      ["f100", "100人"],
      ["f300", "300人"],
      ["f500", "500人"],
      ["f700", "700人"],
      ["f1000", "1000人"]
    ]
  },
  {
    title: "PR・案件",
    items: [
      ["prMtg", "PR初回MTG"],
      ["product", "商品申請"],
      ["prCarousel", "PRカルーセル"],
      ["prVideo", "PR動画"],
      ["prTts", "PR TTS"],
      ["sparkAds", "スパークアズ対象"],
      ["sakura", "サクラ連携"]
    ]
  },
  {
    title: "成果実績",
    items: [
      ["month1", "月1件獲得"],
      ["month10", "月10件獲得"],
      ["month30", "月30件獲得"],
      ["month100", "月100件獲得"]
    ]
  }
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function platformDataSignature(data) {
  return JSON.stringify(data.map((company) => ({
    id: company.id,
    sourceFile: company.sourceFile,
    newCount: company.newCount,
    buildCount: company.buildCount,
    prCount: company.prCount,
    sales: company.sales,
    members: (company.members || []).map((member) => ({
      name: member.name,
      status: member.status,
      progress: member.progress,
      sales: member.sales,
      accountLinks: member.accountLinks || [],
      meetings: member.meetings || []
    }))
  })));
}

const importedDataSignature = platformDataSignature(importedCompanyData);

function loadPlatformData() {
  try {
    const stored = localStorage.getItem(PLATFORM_STORAGE_KEY);
    if (!stored) return cloneData(importedCompanyData);
    const parsed = JSON.parse(stored);
    if (parsed?.sourceSignature !== importedDataSignature) {
      localStorage.removeItem(PLATFORM_STORAGE_KEY);
      return cloneData(importedCompanyData);
    }
    return Array.isArray(parsed?.companies) ? parsed.companies : cloneData(importedCompanyData);
  } catch (error) {
    return cloneData(importedCompanyData);
  }
}

let companyData = loadPlatformData();

function mergeImportedAccountLinks() {
  const importedByCompany = new Map(importedCompanyData.map((company) => [company.id, company]));
  companyData.forEach((company) => {
    const importedCompany = importedByCompany.get(company.id);
    if (!importedCompany?.members?.length) return;
    const importedMembers = new Map(importedCompany.members.map((member) => [member.name, member]));
    company.members?.forEach((member) => {
      const importedMember = importedMembers.get(member.name);
      if (!importedMember?.accountLinks?.length) return;
      if (!Array.isArray(member.accountLinks) || !member.accountLinks.length) {
        member.accountLinks = importedMember.accountLinks;
      }
    });
  });
}

mergeImportedAccountLinks();

function apiAvailable() {
  return location.protocol === "http:" || location.protocol === "https:";
}

async function savePlatformData(summary = "platform save") {
  if (!roleCanEdit()) return false;
  try {
    const now = new Date().toISOString();
    state.platformUpdatedAt = now;
    if (selectedCompany()) selectedCompany().lastUpdatedAt = now;
    localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify({
      savedAt: now,
      sourceSignature: importedDataSignature,
      companies: companyData
    }));
    if (apiAvailable()) {
      const response = await fetch("/api/companies", {
        method: "PUT",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          actor: state.session?.name || "prototype",
          session: state.session,
          summary,
          companies: companyData
        })
      });
      if (!response.ok) throw new Error(`API save failed: ${response.status}`);
    }
    return true;
  } catch (error) {
    console.warn("Platform data could not be saved in this browser.", error);
    throw error;
  }
}

async function hydratePlatformDataFromApi() {
  if (!apiAvailable() || !state.session?.token) return;
  try {
    const authedResponse = await fetch("/api/companies", { headers: authHeaders() });
    if (!authedResponse.ok) {
      if ([401, 403].includes(authedResponse.status)) {
        clearAuthSession();
        state.session = null;
        state.role = "admin";
        renderAuthShell();
      }
      throw new Error(`API returned ${authedResponse.status}`);
    }
    const payload = await authedResponse.json();
    if (!Array.isArray(payload.companies)) return;
    companyData = payload.companies;
    state.platformUpdatedAt = payload.updatedAt || "";
    if (Array.isArray(payload.months)) months = payload.months;
    if (payload.permissions) state.session.permissions = payload.permissions;
    ensureMonthlyScheduleState();
    localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      sourceSignature: importedDataSignature,
      companies: companyData
    }));
    mergeImportedAccountLinks();
    renderCompanySelect();
    renderLoginCompanies();
    if (!companies().some((company) => company.id === state.companyId)) {
      state.companyId = companies()[0]?.id || state.companyId;
      state.session.companyId = state.companyId;
      saveAuthSession(state.session);
    }
    renderAll();
  } catch (error) {
    console.warn("API load failed; using local data fallback.", error);
  }
}

function loadAuthSession() {
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    const session = stored ? JSON.parse(stored) : null;
    if (session && !session.token) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return session;
  } catch (error) {
    return null;
  }
}

function saveAuthSession(session) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearAuthSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

function platformTime() {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthlyResetKeys() {
  return ["f1000"];
}

function ensureHistoryLength(values, fallback = 0) {
  const list = Array.isArray(values) ? [...values] : [];
  while (list.length < months.length) list.unshift(fallback);
  return list.slice(-months.length);
}

function resetMemberForMonth(member, monthKey) {
  const now = new Date().toISOString();
  const detail = memberDetail(member);
  member.salesHistory = ensureHistoryLength(detail.sales, 0);
  member.salesHistory[member.salesHistory.length - 1] = 0;
  member.sales = 0;
  monthlyResetKeys().forEach((key) => {
    member[key] = false;
  });
  member.monthlyPeriod = monthKey;
  member.monthlyResetAt = now;
  member.lastUpdatedAt = now;
  member.autoConclusion = generateMemberAutoConclusion(member);
}

function resetCompanyForMonth(company, monthKey) {
  const now = new Date().toISOString();
  (company.members || []).forEach((member) => resetMemberForMonth(member, monthKey));
  company.monthlyPeriod = monthKey;
  company.monthlyResetAt = now;
  company.lastUpdatedAt = now;
  recalcCompanyStats(company);
}

function resetCurrentMonthNumbers({ force = false, persist = false } = {}) {
  if (!roleCanEdit()) return false;
  const monthKey = currentMonthKey();
  const stored = localStorage.getItem(MONTHLY_RESET_STORAGE_KEY);
  if (!force && stored === monthKey && companies().every((company) => company.monthlyPeriod === monthKey)) return false;
  companies().forEach((company) => {
    if (force || company.monthlyPeriod !== monthKey) resetCompanyForMonth(company, monthKey);
  });
  localStorage.setItem(MONTHLY_RESET_STORAGE_KEY, monthKey);
  state.platformUpdatedAt = new Date().toISOString();
  addOperation("月次リセット", `${monthKey} を0で開始`, "当月売上・当月1000達成を0から開始");
  if (persist) void persistAndRefresh(null, `${monthKey}: 月初リセット`);
  return true;
}

function ensureMonthlyScheduleState() {
  if (!roleCanEdit()) return false;
  const monthKey = currentMonthKey();
  const list = companies();
  const hasOlderPeriod = list.some((company) => company.monthlyPeriod && company.monthlyPeriod !== monthKey);
  if (hasOlderPeriod) {
    const changed = resetCurrentMonthNumbers({ force: false, persist: false });
    if (changed) void savePlatformData(`${monthKey}: 月替わり自動リセット`);
    return changed;
  }
  let initialized = false;
  list.forEach((company) => {
    if (!company.monthlyPeriod) {
      company.monthlyPeriod = monthKey;
      initialized = true;
    }
    (company.members || []).forEach((member) => {
      if (!member.monthlyPeriod) {
        member.monthlyPeriod = monthKey;
        initialized = true;
      }
    });
  });
  if (initialized) void savePlatformData(`${monthKey}: 月次管理キー初期化`);
  return false;
}

async function persistAndRefresh(member, summary) {
  regenerateAutoConclusions(member ? [member] : selectedCompany()?.members || []);
  await savePlatformData(summary);
  renderAll();
  if (member) openMemberDetail(member);
  if (apiAvailable()) setTimeout(renderAuditLogs, 450);
}

const initialSession = loadAuthSession();

const state = {
  session: initialSession,
  role: initialSession?.role || "admin",
  companyId: initialSession?.companyId || "yrr",
  stage: "all",
  status: "all",
  search: "",
  companySearch: "",
  companySort: { key: "enrollment", direction: "desc" },
  activeMemberName: "",
  mtgMemberName: "",
  platformUpdatedAt: "",
  updateDrafts: {},
  detailFeed: [],
  operationFeed: [
    { type: "初期移行", company: "株式会社YRR", title: "2026年5月までのExcelデータを取込", detail: "在籍・進捗・MTG履歴を初期データとして反映", time: "2026/06/01 09:00" },
    { type: "売上", company: "株式会社テイクフィット", title: "成果売上を更新", detail: "PRアカウントの売上を月次実績へ反映", time: "2026/06/01 10:30" },
    { type: "MTG", company: "株式会社Rower", title: "PRフェーズ受講生の改善MTGを登録", detail: "次回までにPR動画の構成を修正", time: "2026/06/01 11:15" }
  ]
};

function formatDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "未登録";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatMonthLabel(monthKey = currentMonthKey()) {
  const [year, month] = String(monthKey).split("-");
  return `${year}年${Number(month)}月`;
}

function monthStartDateLabel(monthKey = currentMonthKey()) {
  const [year, month] = String(monthKey).split("-");
  return `${year}/${String(month).padStart(2, "0")}/01`;
}

function latestUpdateForCompanies(list = companies()) {
  const values = [
    state.platformUpdatedAt,
    ...list.flatMap((company) => [
      company.lastUpdatedAt,
      company.updatedAt,
      company.monthlyResetAt,
      ...(company.members || []).flatMap((member) => [member.lastUpdatedAt, member.monthlyResetAt])
    ])
  ].filter(Boolean).map((value) => new Date(value)).filter((date) => !Number.isNaN(date.getTime()));
  if (!values.length) return "";
  return new Date(Math.max(...values.map((date) => date.getTime()))).toISOString();
}

function buildGeneratedMembers(company) {
  const count = currentEnrollment(company);
  return Array.from({ length: count }, (_, index) => {
    const stage = index < company.prCount ? "PR" : "構築";
    const base = Math.max(8, Math.min(92, company.healthSeed + ((index % 7) - 3) * 6));
    const status = base >= 80 ? "A" : base >= 60 ? "B" : "F";
    return {
      name: `${company.name.replace("株式会社", "")} 受講生${String(index + 1).padStart(2, "0")}`,
      status,
      stage,
      progress: base,
      daily: base >= 45,
      orient: base >= 20,
      firstMtg: base >= 35,
      account: base >= 50,
      firstPost: base >= 55,
      f100: base >= 60,
      prMtg: stage === "PR" && base >= 65,
      product: stage === "PR" && base >= 72
    };
  });
}

function companies() {
  companyData.forEach((company) => {
    if (!company.members) company.members = buildGeneratedMembers(company);
  });
  if (state.session && !roleCanViewAll()) {
    return companyData.filter((company) => company.id === state.session.companyId);
  }
  return companyData;
}

function authHeaders(extra = {}) {
  return state.session?.token ? { ...extra, authorization: `Bearer ${state.session.token}` } : extra;
}

function roleCanViewAll() {
  return Boolean(state.session?.permissions?.canViewAll || ["admin", "operator"].includes(state.role));
}

function roleCanEdit() {
  return Boolean(state.session?.permissions?.canEdit || ["admin", "operator"].includes(state.role));
}

function roleCanUseUpdateWorkspace() {
  return roleCanEdit();
}

function roleCanEditProgressReport() {
  return roleCanEdit();
}

function roleCanManageMembers() {
  return roleCanEdit();
}

function roleCanManageCompanies() {
  return roleCanEdit();
}

function roleCanUseDetailQuickEdit() {
  return false;
}

function selectedCompany() {
  return companies().find((company) => company.id === state.companyId) || companies()[0];
}

function currentEnrollment(company) {
  return company.enrollment[company.enrollment.length - 1] || 0;
}

function filteredMembers() {
  return selectedCompany().members.filter((member) => {
    const stageOk = state.stage === "all" || member.stage === state.stage;
    const statusOk = state.status === "all" || member.status === state.status;
    const searchOk = member.name.includes(state.search.trim());
    return stageOk && statusOk && searchOk;
  });
}

function averageProgress(list) {
  if (!list.length) return 0;
  return Math.round(list.reduce((sum, member) => sum + member.progress, 0) / list.length);
}

function riskCount(company) {
  return company.members.filter((member) => member.status === "F" || member.progress < 20).length;
}

function statusTone(company) {
  const ratio = riskCount(company) / Math.max(1, company.members.length);
  if (ratio >= 0.45) return ["danger", "要改善"];
  if (ratio >= 0.18) return ["warn", "要観察"];
  return ["good", "順調"];
}

function money(value) {
  const number = Number(value);
  return `${Number.isFinite(number) ? number.toLocaleString("ja-JP") : "0"}円`;
}

function compactMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0円";
  if (number >= 10000) return `${Math.round(number / 10000)}万円`;
  return `${number.toLocaleString("ja-JP")}円`;
}

function memberSeed(member) {
  return [...member.name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function memberDetail(member) {
  if (!member) {
    return {
      followers: months.map(() => null),
      sales: months.map(() => 0),
      latestFollower: null,
      latestSales: 0,
      hasFollowerData: false,
      hasSalesData: false,
      meetings: []
    };
  }
  const seed = memberSeed(member);
  const startFollowers = member.stage === "PR" ? 120 + (seed % 90) : 12 + (seed % 28);
  const monthlyGain = Math.max(4, Math.round(member.progress * (member.stage === "PR" ? 3.4 : 1.7)));
  const generatedFollowers = months.map((_, index) => startFollowers + Math.round(monthlyGain * index * (0.72 + (index % 3) * 0.16)));
  const sourceSales = Number(member.sales || 0);
  const generatedSales = months.map((_, index) => index === months.length - 1 ? sourceSales : 0);
  const explicitFollowers = Array.isArray(member.followerHistory) && member.followerHistory.length === months.length;
  const explicitSales = Array.isArray(member.salesHistory) && member.salesHistory.length === months.length;
  const hasLegacyFollower = Number.isFinite(Number(member.followers));
  const hasLegacySales = Number.isFinite(Number(member.sales));
  const followers = explicitFollowers
    ? member.followerHistory.map((value) => Number.isFinite(Number(value)) ? Number(value) : null)
    : hasLegacyFollower
      ? generatedFollowers
      : months.map(() => null);
  const sales = explicitSales
    ? member.salesHistory.map((value) => Number.isFinite(Number(value)) ? Number(value) : 0)
    : generatedSales;
  const latestFollower = [...followers].reverse().find((value) => value !== null) ?? null;
  const latestSales = Number(sales[sales.length - 1] || 0);
  return {
    followers,
    sales,
    latestFollower,
    latestSales,
    hasFollowerData: followers.some((value) => value !== null),
    hasSalesData: sales.some((value) => Number(value || 0) > 0),
    meetings: member.meetings || []
  };
}

function buildMeetings(member, followers, sales) {
  const dates = ["2026/03/12", "2026/04/09", "2026/05/04"];
  return dates.map((date, index) => {
    const follower = followers[Math.min(followers.length - 1, 2 + index * 2)];
    const sale = sales[Math.min(sales.length - 1, 2 + index * 2)];
    const statusText = index === 0 ? "開始条件の確認" : index === 1 ? missingPoint(member) : actionFor(member);
    const result = member.progress >= 50 && index === 2 ? "改善傾向" : member.status === "F" ? "要フォロー" : "継続";
    return {
      date,
      coach: index === 0 ? "佐藤" : index === 1 ? "田中" : "佐藤",
      follower,
      sale,
      content: statusText,
      next: index === 2 ? actionFor(member) : "次回MTGまでに投稿・アカウント状態を確認",
      result
    };
  });
}

function renderCompanySelect() {
  $("#companySelect").innerHTML = companies().map((company) => `
    <option value="${company.id}">${company.name}</option>
  `).join("");
  $("#companySelect").value = state.companyId;
}

function normalizeCompanyCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function defaultProgressReportForNewCompany(companyName) {
  return {
    good: `${companyName} の研修データを新規作成しました。初回更新後に良い変化を記載します。`,
    issue: "受講生登録後、進捗・アカウント・MTG状況を確認します。",
    action: "運営側で初回登録内容を確認し、更新タブから受講生情報を整備します。",
    request: "受講生名簿、初回面談可否、運用アカウント情報の共有をお願いします。"
  };
}

function createBlankCompany({ name, code, enrollment = 0 }) {
  const count = Number(enrollment || 0);
  return {
    id: code,
    name,
    sourceFile: "platform",
    reportMeta: "対象月: 2026年6月",
    newCount: count,
    buildCount: 0,
    prCount: 0,
    sales: 0,
    enrollment: months.map((_, index) => index === months.length - 1 ? count : 0),
    progressReport: defaultProgressReportForNewCompany(name),
    members: []
  };
}

function createBlankMember({ name, stage = "構築", status = "F", progress = 0 }) {
  return {
    name,
    stage,
    status,
    progress: Number(progress || 0),
    ...milestoneDefaults(Number(progress || 0), stage),
    sales: 0,
    followerHistory: months.map(() => 0),
    salesHistory: months.map(() => 0),
    accountLinks: [],
    clientMemo: `${name} は新規追加されました。更新タブで進捗・アカウント・MTG情報を登録してください。`,
    meetings: [],
    updateFeed: [{
      type: "メンバー",
      member: name,
      company: selectedCompany().name,
      title: `${name} を追加`,
      detail: `段階 ${stage} / 評価 ${status} / 進捗 ${progress}%`,
      time: platformTime()
    }]
  };
}

function renderLoginCompanies() {
  const role = $("#loginRole")?.value || "admin";
  const selectableCompanies = role === "client"
    ? companies().filter((company) => !NON_CLIENT_COMPANY_IDS.has(company.id))
    : companies();
  $("#loginCompany").innerHTML = selectableCompanies.map((company) => `
    <option value="${company.id}">${company.name}</option>
  `).join("");
  if (!selectableCompanies.some((company) => company.id === $("#loginCompany").value)) {
    $("#loginCompany").value = selectableCompanies[0]?.id || "";
  }
}

function renderAuthShell() {
  const isLoggedIn = Boolean(state.session);
  $("#authScreen").classList.toggle("hidden", isLoggedIn);
  $(".app-shell").classList.toggle("locked", !isLoggedIn);
}

function loginUser(role, companyId) {
  const company = companies().find((item) => item.id === companyId) || companies()[0];
  const canViewAll = ["admin", "operator"].includes(role);
  const canEdit = ["admin", "operator"].includes(role);
  const session = {
    role,
    companyId: canViewAll ? state.companyId : company.id,
    name: role === "admin" ? "自社管理者" : role === "operator" ? "運用担当者" : `${company.name} 閲覧者`,
    permissions: { canViewAll, canEdit },
    signedInAt: new Date().toISOString()
  };
  state.session = session;
  state.role = session.role;
  state.companyId = session.companyId;
  saveAuthSession(session);
  $("#roleSelect").value = state.role;
  $("#companySelect").value = state.companyId;
  if (!roleCanViewAll() && activeViewId() === "admin") switchView("dashboard");
  if (!roleCanEdit() && activeViewId() === "updates") switchView("dashboard");
  renderAuthShell();
  renderAll();
}

async function loginWithApiOrLocal(role, companyId, email, password) {
  if (apiAvailable()) {
    try {
      const response = await fetch("/api/companies", {
        method: "GET",
        headers: {
          "x-portal-auth": btoa(`${email}:${password}`),
          "x-company-id": companyId
        }
      });
      if (!response.ok) return false;
      const payload = await response.json();
      if (!payload.session) return false;
      state.session = payload.session;
      state.role = payload.session.role;
      state.companyId = payload.session.companyId;
      saveAuthSession(payload.session);
      $("#roleSelect").value = state.role;
      $("#companySelect").value = state.companyId;
      if (!roleCanViewAll() && activeViewId() === "admin") switchView("dashboard");
      if (!roleCanEdit() && activeViewId() === "updates") switchView("dashboard");
      renderAuthShell();
      await hydratePlatformDataFromApi();
      renderAll();
      return true;
    } catch (error) {
      console.warn("API login failed.", error);
      return false;
    }
  }

  if (!apiAvailable()) return false;
  const normalizedLoginId = email.toLowerCase();
  const clientCompanyId = CLIENT_LOGIN_ALIASES[normalizedLoginId] || (/^[a-z0-9_-]+$/.test(normalizedLoginId) ? normalizedLoginId : "");
  const clientCompany = companies().find((company) => company.id === clientCompanyId && !NON_CLIENT_COMPANY_IDS.has(company.id));
  if (clientCompany && password === `${normalizedLoginId}123`) {
    loginUser("client", clientCompany.id);
    return true;
  }
  return false;
}

function logoutUser() {
  clearAuthSession();
  state.session = null;
  state.role = "admin";
  companyData = cloneData(importedCompanyData);
  mergeImportedAccountLinks();
  state.companyId = companies()[0].id;
  state.updateDrafts = {};
  closeMemberDetail();
  switchView("admin");
  renderCompanySelect();
  renderLoginCompanies();
  renderAuthShell();
}

function renderShell() {
  const company = selectedCompany();
  const canViewAll = roleCanViewAll();
  const canEdit = roleCanEdit();
  const view = activeViewId();
  if (!state.session) return;
  const pageCopy = {
    admin: ["Portfolio command", "全社研修管理", "全社の進捗・確認事項・成果状況を横断して確認します。"],
    dashboard: ["Client decision board", `${company.name} マイページ`, "結論・要確認者・次アクションだけを先に確認できます。"],
    updates: ["Operator workspace", "運用更新", "受講生ごとの進捗、アカウント、数字、MTGを一括更新します。"],
    members: ["Member management", "受講生管理", "受講生単位の状況と詳細を確認します。"]
  };
  const [eyebrow, title, lead] = pageCopy[view] || pageCopy.dashboard;
  $("#pageEyebrow").textContent = eyebrow;
  $("#pageTitle").textContent = canViewAll && view === "admin" ? title : view === "admin" ? `${company.name} マイページ` : title;
  $("#pageLead").textContent = lead;
  $("#sidebarCompany").textContent = canViewAll && view === "admin" ? "全社ポートフォリオ" : company.name;
  $("#sidebarMeta").textContent = canViewAll ? "管理者は全会社を閲覧・管理" : canEdit ? "担当会社を閲覧・更新" : "クライアントは自社のみ閲覧";
  $("#roleSelect").value = state.role;
  $("#companySelect").disabled = !canViewAll;
  $(".nav-tab[data-view='admin']").style.display = canViewAll ? "" : "none";
  $(".nav-tab[data-view='updates']").style.display = roleCanUseUpdateWorkspace() ? "" : "none";
  if (!canViewAll && view === "admin") switchView("dashboard");
  if (!canEdit && view === "updates") switchView("dashboard");
  applyRolePermissions();
}

function applyRolePermissions() {
  const canEdit = roleCanEdit();
  const canManageMembers = roleCanManageMembers();
  const canUseDetailQuickEdit = roleCanUseDetailQuickEdit();
  const memberAdminPanel = $(".member-admin-panel");
  const companyCreatePanel = $(".company-create-panel");
  const detailInputs = $(".detail-inputs");
  const detailUpdateJump = $("#detailUpdateJump");
  const monthlyResetButton = $("#monthlyResetButton");
  if (memberAdminPanel) memberAdminPanel.style.display = canManageMembers ? "" : "none";
  if (companyCreatePanel) companyCreatePanel.style.display = roleCanManageCompanies() ? "" : "none";
  if (detailInputs) detailInputs.style.display = canUseDetailQuickEdit ? "" : "none";
  if (detailUpdateJump) detailUpdateJump.style.display = canEdit ? "" : "none";
  if (monthlyResetButton) monthlyResetButton.style.display = "none";
  $$("#saveUpdateSheet, #discardUpdateDrafts").forEach((button) => {
    button.style.display = canEdit ? "" : "none";
  });
}

function activeViewId() {
  return $(".view.active")?.id || "admin";
}

function switchView(viewId) {
  if (viewId === "admin" && !roleCanViewAll()) viewId = "dashboard";
  if (viewId === "updates" && !roleCanEdit()) viewId = "dashboard";
  $$(".nav-tab").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === viewId));
  renderShell();
}

function memberSalesValue(member) {
  return Number(member.salesHistory?.at?.(-1) ?? member.sales ?? memberDetail(member).latestSales ?? 0);
}

function salesLeadersForCompany(company, limit = 5) {
  return [...(company.members || [])]
    .map((member) => ({ member, sales: memberSalesValue(member) }))
    .filter((item) => item.sales > 0)
    .sort((a, b) => b.sales - a.sales)
    .slice(0, limit);
}

function salesLeadersAllCompanies(limit = 5) {
  return companies()
    .flatMap((company) => salesLeadersForCompany(company, company.members.length).map((item) => ({ ...item, company })))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, limit);
}

function renderSalesLeaderRows(items, emptyText = "売上が登録されている受講生はいません。") {
  if (!items.length) return `<p class="subtext">${emptyText}</p>`;
  const maxSales = Math.max(...items.map((item) => item.sales), 1);
  return items.map((item, index) => `
    <button class="focus-member member-link" data-company="${item.company?.id || selectedCompany().id}" data-member="${item.member.name}" type="button">
      <b class="focus-rank">${index + 1}</b>
      <span>
        <strong>${item.member.name}</strong>
        <small>${item.company ? `${item.company.name}` : selectedCompany().name}</small>
        <small>${item.member.stage} / 評価 ${item.member.status} / 進捗 ${item.member.progress}%</small>
        <i><b style="width:${Math.min(100, Math.max(8, Math.round((item.sales / maxSales) * 100)))}%"></b></i>
      </span>
      <em>${money(item.sales)}</em>
    </button>
  `).join("");
}

function stageCount(companiesList, stage) {
  return companiesList.reduce((sum, company) => sum + company.members.filter((member) => member.stage === stage).length, 0);
}

function follower1000Count(members = []) {
  return members.filter((member) => milestoneDone(member, "f1000")).length;
}

function follower1000CountForCompanies(companiesList = []) {
  return companiesList.reduce((sum, company) => sum + follower1000Count(company.members || []), 0);
}

function renderAdminCommandTop() {
  const list = companies();
  const clientCount = list.filter((company) => !NON_CLIENT_COMPANY_IDS.has(company.id)).length;
  const totalMembers = list.reduce((sum, company) => sum + currentEnrollment(company), 0);
  const totalSales = list.reduce((sum, company) => sum + Number(company.sales || 0), 0);
  const internalSales = list
    .filter((company) => NON_CLIENT_COMPANY_IDS.has(company.id))
    .reduce((sum, company) => sum + Number(company.sales || 0), 0);
  const clientSales = totalSales - internalSales;
  const totalRisk = list.reduce((sum, company) => sum + riskCount(company), 0);
  const avg = Math.round(list.reduce((sum, company) => sum + averageProgress(company.members), 0) / Math.max(1, list.length));
  const prCount = stageCount(list, "PR");
  const buildCount = stageCount(list, "構築");
  const newCount = stageCount(list, "新規");
  const f1000Count = follower1000CountForCompanies(list);
  const topCompanies = [...list].sort((a, b) => Number(b.sales || 0) - Number(a.sales || 0)).slice(0, 6);
  const leaders = salesLeadersAllCompanies(6);
  const topCompanySales = Number(topCompanies[0]?.sales || 0);

  $("#adminFocusFacts").innerHTML = [
    ["クライアント", `${clientCount}社`, `社内管理 ${list.length - clientCount}社`],
    ["在籍", `${totalMembers}名`, `PR ${prCount}名 / 構築 ${buildCount}名`],
    ["当月売上", `<span class="split-sales"><b>NH+VV ${money(internalSales)}</b><b>その他 ${money(clientSales)}</b></span>`, `合計 ${money(totalSales)} / 売上発生 ${list.filter((company) => Number(company.sales || 0) > 0).length}社`],
    ["平均進捗", `${avg}%`, `新規 ${newCount}名`],
    ["当月1000達成", `${f1000Count}名`, "フォロワー1000にチェック済み"],
    ["要確認", `${totalRisk}名`, "確認優先の受講生"]
  ].map(([label, value, caption]) => `
    <div class="summary-fact">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${caption}</small>
    </div>
  `).join("");
  $("#adminSalesLeaders").innerHTML = renderSalesLeaderRows(leaders, "全社で売上登録はありません。");
  $("#adminCompanySnapshot").innerHTML = `
    <div class="company-rank-list">
      ${topCompanies.map((company) => `
        <button class="company-rank-row company-jump" data-company="${company.id}" type="button">
          <span>
            <strong>${company.name}</strong>
            <small><b>在籍 ${currentEnrollment(company)}名</b><b>平均 ${averageProgress(company.members)}%</b><b>要確認 ${riskCount(company)}名</b></small>
          </span>
          <em>
            <strong>${money(company.sales || 0)}</strong>
            <i><b style="width:${Math.min(100, Math.max(5, Math.round((Number(company.sales || 0) / Math.max(1, topCompanySales)) * 100)))}%"></b></i>
          </em>
        </button>
      `).join("")}
    </div>
  `;
  bindMemberLinks();
  bindCompanyJumps();
}

function periodCard(label, value, caption = "") {
  return `
    <article class="period-card">
      <span>${label}</span>
      <strong>${value}</strong>
      ${caption ? `<small>${caption}</small>` : ""}
    </article>
  `;
}

function renderPeriodStrip(targetSelector, list) {
  const target = $(targetSelector);
  if (!target) return;
  const monthKey = currentMonthKey();
  const latest = latestUpdateForCompanies(list);
  const staleCount = list.filter((company) => company.monthlyPeriod && company.monthlyPeriod !== monthKey).length;
  target.innerHTML = [
    periodCard("今日", formatDate(new Date()), "現在の日付"),
    periodCard("対象月", formatMonthLabel(monthKey), staleCount ? `${staleCount}社が月替わり対象` : "当月データを表示"),
    periodCard("今月開始日", monthStartDateLabel(monthKey), "月替わり時に当月数字を0開始"),
    periodCard("最終更新日", latest ? formatDate(latest) : "未登録", latest ? "保存・同期・月次処理の最新日" : "まだ保存履歴がありません")
  ].join("");
}

function renderPeriodStrips() {
  renderPeriodStrip("#adminPeriodStrip", companies());
  renderPeriodStrip("#companyPeriodStrip", [selectedCompany()].filter(Boolean));
}

function kpiData() {
  const company = selectedCompany();
  const active = filteredMembers();
  const fCount = active.filter((member) => member.status === "F").length;
  const f1000Count = follower1000Count(active);
  return [
    { label: "在籍受講生", value: active.length, caption: `最新月の報告値: ${currentEnrollment(company)}名`, tone: "good" },
    { label: "平均進捗率", value: `${averageProgress(active)}%`, caption: "完了項目ベース", tone: fCount > 0 ? "warn" : "good" },
    { label: "要確認", value: fCount, caption: "個人詳細で状況確認", tone: fCount > 0 ? "danger" : "good" },
    { label: "当月1000達成", value: `${f1000Count}名`, caption: "フォロワー1000にチェック済み", tone: f1000Count > 0 ? "good" : "warn" },
    { label: "当月売上", value: money(company.sales), caption: "成果実績の合計", tone: company.sales > 0 ? "good" : "warn" }
  ];
}

function kpiCard(item) {
  return `
    <article class="kpi-card">
      <div class="kpi-top">
        <span class="kpi-label">${item.label}</span>
        <span class="status-dot ${item.tone}"></span>
      </div>
      <strong class="kpi-value">${item.value}</strong>
      <p class="kpi-caption">${item.caption}</p>
    </article>
  `;
}

function renderKpis() {
  if ($("#kpiGrid")) $("#kpiGrid").innerHTML = kpiData().map(kpiCard).join("");
}

function trendVerdict(values, neutralThreshold = 0) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return { label: "判定なし", tone: "" };
  const current = clean.at(-1);
  const previous = clean.at(-2);
  const diff = current - previous;
  if (diff > neutralThreshold) return { label: `伸長 +${diff.toLocaleString("ja-JP")}`, tone: "good" };
  if (diff < -neutralThreshold) return { label: `減少 ${diff.toLocaleString("ja-JP")}`, tone: "danger" };
  return { label: "確認中", tone: "warn" };
}

function topBlockers(members, limit = 5) {
  const all = allDetailMilestones();
  return all
    .map((item) => ({
      ...item,
      count: members.filter((member) => !milestoneDone(member, item.key)).length
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function clientCheckItems(members) {
  const critical = members
    .filter((member) => member.status === "F" || member.progress < 35)
    .sort((a, b) => a.progress - b.progress)
    .slice(0, 3);

  if (!critical.length) {
    return [
      { label: "成果拡大", detail: "PR移行済み受講生の案件化状況を確認", member: null },
      { label: "継続支援", detail: "伸びている投稿の型を次月施策へ展開", member: null }
    ];
  }

  return critical.map((member) => ({
    label: member.name,
    detail: actionFor(member),
    member
  }));
}

function renderExecutiveFocus() {
  const company = selectedCompany();
  const members = company.members;
  const avg = averageProgress(members);
  const prCount = members.filter((member) => member.stage === "PR").length;
  const f1000Count = follower1000Count(members);
  const salesLeaders = salesLeadersForCompany(company, 5);

  $("#focusConclusionFacts").innerHTML = [
    ["在籍", `${currentEnrollment(company)}名`],
    ["売上", money(company.sales)],
    ["平均進捗", `${avg}%`],
    ["当月1000達成", `${f1000Count}名`],
    ["要確認", `${riskCount(company)}名`],
    ["PR", `${prCount}名`]
  ].map(([label, value]) => `
    <div>
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");

  $("#focusPriorityList").innerHTML = renderSalesLeaderRows(salesLeaders, "売上が登録されている受講生はいません。");
  bindMemberLinks();
}

function focusMemberRow(member) {
  return `
    <button class="focus-member member-link" data-member="${member.name}" type="button">
      <span>
        <strong>${member.name}</strong>
        <small>${missingPoint(member)}</small>
        <i><b style="width:${member.progress}%"></b></i>
      </span>
      <em><span class="badge ${member.status.toLowerCase()}">${member.status}</span>${member.progress}%</em>
    </button>
  `;
}

function statusCounts(members) {
  return members.reduce((acc, member) => {
    const key = member.status || "F";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function executiveVerdict(company) {
  const members = company.members;
  const avg = averageProgress(members);
  const risk = riskCount(company);
  const riskRatio = risk / Math.max(1, members.length);
  const sales = company.sales || 0;
  if (riskRatio >= 0.45 || avg < 25) return { label: "要確認", tone: "danger", text: `平均進捗${avg}%、確認優先${risk}名。まず個別フォローと初回導線の再確認を進めます。` };
  if (riskRatio >= 0.2 || avg < 55) return { label: "確認中", tone: "warn", text: `平均進捗${avg}%、確認優先${risk}名。進捗は動いており、一部の受講生で追加確認が必要です。` };
  return { label: "順調", tone: "good", text: `平均進捗${avg}%、確認優先${risk}名。PR移行と成果創出に向けて順調に進んでいます。売上実績は${money(sales)}です。` };
}

function deltaText(current, previous, unit = "") {
  const diff = current - previous;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff}${unit}`;
}

function progressReportDefaults(company) {
  const members = company.members;
  const risk = riskCount(company);
  const pr = members.filter((member) => member.stage === "PR").length;
  const progressed = members.filter((member) => member.progress >= 50).length;
  const priority = members
    .filter((member) => member.status === "F" || member.progress < 35)
    .sort((a, b) => a.progress - b.progress)
    .slice(0, 1);
  const blockers = topBlockers(members, 3);
  const primaryAction = priority[0] ? actionFor(priority[0]) : "PR移行済み受講生の案件化状況を確認";
  return {
    good: `${progressed}名が進捗50%以上。PRフェーズは${pr}名で、成果化に向けた母数があります。`,
    issue: blockers.length ? blockers.map((item) => `${item.label} ${item.count}名`).join(" / ") : "主要項目は順調です。",
    action: `${priority[0]?.name || "成果拡大"}: ${primaryAction}`,
    request: "連絡状況の社内確認、面談可否、投稿素材確認のご協力をお願いします。"
  };
}

function clientSafeText(value) {
  return String(value || "")
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

function activeProgressReport(company) {
  const report = { ...progressReportDefaults(company), ...(company.progressReport || {}) };
  return {
    good: clientSafeText(report.good),
    issue: clientSafeText(report.issue),
    action: clientSafeText(report.action),
    request: clientSafeText(report.request)
  };
}

function renderExecutiveSummary() {
  const company = selectedCompany();
  const members = company.members;
  const verdict = executiveVerdict(company);
  const risk = riskCount(company);
  const pr = members.filter((member) => member.stage === "PR").length;
  const build = members.filter((member) => member.stage === "構築").length;
  const blockers = topBlockers(members, 3);
  const report = activeProgressReport(company);

  $("#execStatusPill").textContent = verdict.label;
  $("#execStatusPill").className = `pill ${verdict.tone === "danger" ? "danger" : ""}`;
  $("#execMessage").textContent = verdict.text;
  $("#execInsights").innerHTML = [
    { title: "良い変化", body: report.good, tone: "good" },
    { title: "確認したい点", body: report.issue, tone: blockers.length ? "danger" : "good" },
    { title: "今後の支援方針", body: report.action, tone: risk > 0 ? "warn" : "good" },
    { title: "貴社への確認事項", body: report.request, tone: "warn" }
  ].map((item) => `
    <article class="insight-card ${item.tone}">
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.body)}</p>
    </article>
  `).join("");
  $("#progressReportForm").style.display = roleCanEditProgressReport() ? "" : "none";
  $("#progressGood").value = report.good;
  $("#progressIssue").value = report.issue;
  $("#progressAction").value = report.action;
  $("#progressRequest").value = report.request;

  renderStageDonut(pr, build, members.length);
  renderStatusTable(statusCounts(members), members.length);
}

function renderStageDonut(pr, build, total) {
  const prRate = total ? Math.round((pr / total) * 100) : 0;
  $("#stageDonut").style.background = `conic-gradient(var(--accent-2) 0 ${prRate}%, var(--accent) ${prRate}% 100%)`;
  $("#stageDonut").innerHTML = `<span>${prRate}%<small>PR</small></span>`;
  $("#stageLegend").innerHTML = [
    ["PR", pr, "案件獲得フェーズ", "green"],
    ["構築", build, "フォロワー獲得フェーズ", "blue"]
  ].map(([label, count, note, color]) => `
    <div class="legend-item">
      <span class="legend-dot ${color}"></span>
      <strong>${label} ${count}名</strong>
      <small>${note}</small>
    </div>
  `).join("");
}

function renderStatusTable(counts, total) {
  const order = ["S", "A", "B", "F"];
  $("#statusTable").innerHTML = order.map((status) => {
    const count = counts[status] || 0;
    const rate = total ? Math.round((count / total) * 100) : 0;
    return `
      <div class="status-row">
        <span class="badge ${status.toLowerCase()}">${status}</span>
        <div class="status-progress"><span style="width:${rate}%"></span></div>
        <strong>${count}名</strong>
        <em>${rate}%</em>
      </div>
    `;
  }).join("");
}

function lastTwelveMonthLabels(date = new Date()) {
  return Array.from({ length: 12 }, (_, index) => {
    const monthDate = new Date(date.getFullYear(), date.getMonth() - 11 + index, 1);
    return {
      label: `${monthDate.getMonth() + 1}月`,
      isCurrent: monthDate.getFullYear() === date.getFullYear() && monthDate.getMonth() === date.getMonth()
    };
  });
}

function renderChart() {
  const company = selectedCompany();
  const labels = lastTwelveMonthLabels();
  const source = Array.isArray(company.enrollment) ? company.enrollment.slice(-12) : [];
  const padded = Array(Math.max(0, 12 - source.length)).fill(null).concat(source).slice(-12);
  const values = padded.map((value) => Number.isFinite(Number(value)) ? Number(value) : null);
  const numericValues = values.filter((value) => value !== null);
  const max = Math.max(...numericValues, 1);
  const verdict = trendVerdict(numericValues, 0);
  $("#trendTitle").textContent = `${company.name} 在籍受講生の推移`;
  $("#enrollmentVerdict").textContent = verdict.label;
  $("#enrollmentVerdict").className = `pill ${verdict.tone === "danger" ? "danger" : verdict.tone === "warn" ? "warn" : ""}`;
  $("#enrollmentChart").innerHTML = values.map((count, index) => {
    const hasValue = count !== null;
    const height = hasValue ? Math.max(18, (count / max) * 190) : 8;
    const current = labels[index].isCurrent ? "current" : "";
    return `
      <div class="bar-wrap">
        <span>${hasValue ? count : "未登録"}</span>
        <div class="bar ${current} ${hasValue ? "" : "empty"}" style="height:${height}px"></div>
        <span>${labels[index].label}</span>
      </div>
    `;
  }).join("");
}

function missingPoint(member) {
  if (!member.daily) return "毎日投稿未完了";
  if (!member.qa) return "Q&A未完了";
  if (!member.mtg) return "MTG未完了";
  if (!member.orient) return "オリエン未完了";
  if (!member.firstMtg) return "初回MTG未完了";
  if (!member.account) return "アカウント作成未完了";
  if (!member.firstPost) return "初回投稿未完了";
  if (!member.f100) return "フォロワー100未完了";
  if (!member.f300) return "フォロワー300未完了";
  if (!member.f500) return "フォロワー500未完了";
  if (!member.f700) return "フォロワー700未完了";
  if (!member.f1000) return "フォロワー1000未完了";
  if (!member.prMtg) return "PR初回MTG未完了";
  if (!member.product) return "商品申請未完了";
  if (!member.prCarousel) return "PRカルーセル未完了";
  if (!member.prVideo) return "PR動画未完了";
  if (!member.prTts) return "PR TTS未完了";
  if (!member.sparkAds) return "スパークアズ未完了";
  if (!member.sakura) return "サクラ連携未完了";
  if (!member.month1) return "月1件獲得未完了";
  if (!member.month10) return "月10件獲得未完了";
  if (!member.month30) return "月30件獲得未完了";
  if (!member.month100) return "月100件獲得未完了";
  return "次のPR施策へ進行可能";
}

function actionFor(member) {
  if (!member.daily) return "投稿頻度を確認し、今週の投稿計画を作成";
  if (!member.qa) return "質問対応の実施状況を確認";
  if (!member.mtg) return "MTG実施日を設定";
  if (!member.orient) return "初回導入日を確定し、参加可否をクライアントへ確認";
  if (!member.firstMtg) return "運用者MTGを設定し、開始条件を整理";
  if (!member.account) return "アカウント作成とログイン確認を完了";
  if (!member.firstPost) return "初回投稿の台本・素材を確認";
  if (!member.f100) return "投稿頻度とプロフィール改善を確認";
  if (!member.f1000) return "伸びた投稿の型を横展開し、フォロワー成長を継続";
  if (!member.prMtg) return "PR初回MTGを設定";
  if (!member.product) return "商品申請に必要な情報を揃える";
  if (!member.prCarousel || !member.prVideo) return "PR投稿の構成と投稿日を決める";
  if (!member.month1) return "初回案件獲得に向けた導線を確認";
  if (member.status === "F") return "連絡状況を確認し、面談要否を判断";
  return "PR申請と案件獲得に向けて加速";
}

function renderRiskList() {
  if (!$("#riskList")) return;
  const risks = filteredMembers()
    .filter((member) => member.status === "F" || member.progress < 20)
    .sort((a, b) => a.progress - b.progress)
    .slice(0, 6);

  $("#riskList").innerHTML = risks.map((member) => `
    <article class="risk-item">
      <div class="risk-row">
        <button class="member-link risk-name" data-member="${member.name}" type="button">${member.name}</button>
        <span class="badge ${member.status.toLowerCase()}">${member.status}</span>
      </div>
      <p class="subtext">${member.stage} / 進捗 ${member.progress}% / ${missingPoint(member)}</p>
    </article>
  `).join("") || `<p class="subtext">現在、優先対応者はいません。</p>`;
  bindMemberLinks();
}

function renderPipeline() {
  const active = filteredMembers();
  const groups = [
    ["PR", active.filter((member) => member.stage === "PR").length, "案件獲得フェーズ"],
    ["構築", active.filter((member) => member.stage === "構築").length, "フォロワー獲得フェーズ"],
    ["良好", active.filter((member) => ["A", "B"].includes(member.status)).length, "順調/要観察"],
    ["確認優先", active.filter((member) => member.status === "F").length, "個別確認"]
  ];

  $("#pipeline").innerHTML = groups.map(([label, count, caption]) => {
    const width = active.length ? Math.round((count / active.length) * 100) : 0;
    return `
      <article class="pipeline-card">
        <strong>${count}名</strong>
        <p class="subtext">${label} / ${caption}</p>
        <div class="progress"><span style="width:${width}%"></span></div>
      </article>
    `;
  }).join("");
}

function renderMembers() {
  const rows = filteredMembers();
  if (!rows.length) {
    $("#memberTable").innerHTML = `
      <tr>
        <td colspan="7">
          <div class="table-empty">
            <strong>表示できる受講生がいません</strong>
            <p>条件に一致する受講生がいないか、まだ受講生が登録されていません。</p>
          </div>
        </td>
      </tr>
    `;
    bindMemberDeleteButtons();
    return;
  }
  $("#memberTable").innerHTML = rows.map((member) => `
    <tr>
      <td><button class="member-link" data-member="${member.name}" type="button">${member.name}</button></td>
      <td>${member.stage}</td>
      <td><span class="badge ${member.status.toLowerCase()}">${member.status}</span></td>
      <td>
        <div class="mini-progress">
          <div class="mini-progress-row"><span>${member.progress}%</span><span>${progressLabel(member.progress)}</span></div>
          <div class="progress"><span style="width:${member.progress}%"></span></div>
        </div>
      </td>
      <td>${missingPoint(member)}</td>
      <td>${actionFor(member)}</td>
      <td>${roleCanManageMembers() ? `<button class="danger-button delete-member-button" data-member="${member.name}" type="button">削除</button>` : ""}</td>
    </tr>
  `).join("");
  bindMemberLinks();
  bindMemberDeleteButtons();
}

function bindMemberDeleteButtons() {
  $$(".delete-member-button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!roleCanManageMembers()) return;
      deleteMember(button.dataset.member);
    });
  });
}

function milestoneKeys() {
  return allDetailMilestones().map((item) => item.key);
}

function memberWithDraft(member) {
  const draft = state.updateDrafts[member.name] || {};
  return {
    ...member,
    ...Object.fromEntries(Object.entries(draft).filter(([key]) => milestoneKeys().includes(key) || ["stage", "clientMemo", "accountLinks"].includes(key)))
  };
}

function calculatedStatus(member) {
  const donePrerequisites = ["daily", "qa", "mtg"].filter((key) => Boolean(member[key])).length;
  if (donePrerequisites === 3) return "S";
  if (donePrerequisites === 2) return "A";
  if (donePrerequisites === 1) return "B";
  return "F";
}

function calculatedProgress(member) {
  const keys = milestoneKeys();
  if (!keys.length) return 0;
  return Math.round((keys.filter((key) => Boolean(member[key])).length / keys.length) * 100);
}

function recalculateMemberFormulas(member) {
  member.status = calculatedStatus(member);
  member.progress = calculatedProgress(member);
}

function sheetColumns() {
  return [
    { key: "name", label: "受講生", type: "name" },
    { key: "stage", label: "段階", type: "select", options: ["構築", "PR"] },
    { key: "status", label: "評価", type: "formula" },
    { key: "progress", label: "進捗", type: "formula" },
    { key: "followers", label: "フォロワー", type: "number" },
    { key: "sales", label: "売上", type: "number" },
    ...allDetailMilestones().map((item) => ({ ...item, type: "check" })),
    { key: "accountLinks", label: "運用アカウント", type: "accounts" },
    { key: "clientMemo", label: "共有メモ", type: "memo" },
    { key: "mtg", label: "MTG", type: "mtg" }
  ];
}

function renderUpdateSheet() {
  const columns = sheetColumns();
  const members = filteredMembers();
  $("#updateSheetHead").innerHTML = `
    <tr class="sheet-group-row">
      <th class="sticky-col">対象</th>
      <th>入力</th>
      <th colspan="2">自動計算</th>
      <th colspan="2">実績</th>
      <th colspan="${allDetailMilestones().length}">達成項目</th>
      <th colspan="2">共有</th>
      <th>MTG</th>
    </tr>
    <tr class="sheet-column-row">
      ${columns.map((column, index) => `<th class="${index === 0 ? "sticky-col" : ""}">${column.label}</th>`).join("")}
    </tr>
  `;
  $("#updateSheetBody").innerHTML = members.map((member) => {
    const effectiveMember = memberWithDraft(member);
    const detail = memberDetail(effectiveMember);
    const status = calculatedStatus(effectiveMember);
    const hasDraft = Boolean(state.updateDrafts[member.name]);
    return `
      <tr data-member="${member.name}" class="${status === "F" ? "needs-care" : ""} ${hasDraft ? "has-draft" : ""}">
        ${columns.map((column, index) => renderUpdateCell(member, detail, column, index, effectiveMember)).join("")}
      </tr>
    `;
  }).join("") || `
    <tr>
      <td colspan="${columns.length}">
        <div class="table-empty">
          <strong>更新対象の受講生がいません</strong>
          <p>受講生タブから新規受講生を追加すると、この更新表に表示されます。</p>
        </div>
      </td>
    </tr>
  `;
  updateDraftStatus();
}

function renderUpdateCell(member, detail, column, index, effectiveMember = member) {
  const sticky = index === 0 ? " sticky-col" : "";
  if (column.type === "name") {
    return `
      <td class="sheet-name${sticky}">
        <button class="member-link" data-member="${member.name}" type="button">${member.name}</button>
        <small>${missingPoint(member)}</small>
      </td>
    `;
  }
  if (column.type === "select") {
    return `
      <td>
        <select class="sheet-input compact-select" data-field="${column.key}">
          ${column.options.map((option) => `<option value="${option}" ${effectiveMember[column.key] === option ? "selected" : ""}>${option}</option>`).join("")}
        </select>
      </td>
    `;
  }
  if (column.type === "formula") {
    const value = column.key === "status" ? calculatedStatus(effectiveMember) : `${calculatedProgress(effectiveMember)}%`;
    const tone = column.key === "status" ? ` ${value.toLowerCase()}` : "";
    return `<td><span class="formula-chip${tone}">${value}</span><small class="formula-note">自動計算</small></td>`;
  }
  if (column.type === "number") {
    const draft = state.updateDrafts[member.name] || {};
    const fallback = column.key === "followers" ? detail.latestFollower : detail.latestSales;
    const value = draft[column.key] ?? (fallback ?? "");
    const pending = hasOwn(draft, column.key) ? " pending" : "";
    return `<td><input class="sheet-input number-input${pending}" data-field="${column.key}" type="number" min="0" value="${value}" /></td>`;
  }
  if (column.type === "check") {
    return `
      <td class="check-cell">
        <input class="sheet-check" data-field="${column.key}" type="checkbox" ${milestoneDone(effectiveMember, column.key) ? "checked" : ""} aria-label="${column.label}" />
      </td>
    `;
  }
  if (column.type === "memo") {
    const pending = hasOwn(state.updateDrafts[member.name] || {}, "clientMemo") ? " pending" : "";
    return `<td><textarea class="sheet-memo${pending}" data-field="clientMemo" rows="2">${effectiveMember.clientMemo || ""}</textarea></td>`;
  }
  if (column.type === "accounts") {
    const pending = hasOwn(state.updateDrafts[member.name] || {}, "accountLinks") ? " pending" : "";
    const links = normalizeAccountLinks(effectiveMember.accountLinks);
    return `<td><textarea class="sheet-memo account-input${pending}" data-field="accountLinks" rows="2" placeholder="最大2件。URLまたはメモを改行で入力">${links.join("\n")}</textarea><small class="sheet-help">最大2件</small></td>`;
  }
  return `<td><button class="text-button mtg-select-button" data-member="${member.name}" type="button">MTG</button></td>`;
}

function renderMtgOps() {
  const members = selectedCompany().members;
  if (!members.length) {
    $("#mtgMemberSelect").innerHTML = "";
    $("#mtgNextAction").value = "";
    $("#mtgOpsHistory").innerHTML = `<p class="subtext">受講生がまだ登録されていません。</p>`;
    return;
  }
  const activeName = state.mtgMemberName || state.activeMemberName || members[0].name;
  const activeMember = members.find((member) => member.name === activeName) || members[0];
  state.mtgMemberName = activeMember.name;
  $("#mtgMemberSelect").innerHTML = members.map((member) => `
    <option value="${member.name}" ${member.name === activeMember.name ? "selected" : ""}>${member.name}</option>
  `).join("");
  $("#mtgNextAction").value = actionFor(activeMember);
  const detail = memberDetail(activeMember);
  renderMtgOpsHistory(activeMember, detail);
}

function renderMtgOpsHistory(member, detail) {
  if (!detail.meetings.length) {
    $("#mtgOpsHistory").innerHTML = `<p class="subtext">MTG・対応履歴はまだ登録されていません。</p>`;
    return;
  }
  $("#mtgOpsHistory").innerHTML = detail.meetings.slice(0, 5).map((meeting) => `
    <article class="meeting-card">
      <div class="risk-row">
        <strong>${escapeHtml(meeting.date)}</strong>
        <span class="pill">${escapeHtml(meeting.result)}</span>
      </div>
      <p class="subtext">${escapeHtml(member.name)} / ${escapeHtml(meeting.coach || "スプシ記録")} / 売上 ${money(Number(meeting.sale || 0))}</p>
      <p>${escapeHtml(meeting.content)}</p>
      ${meeting.next ? `<p class="subtext">次回まで: ${escapeHtml(meeting.next)}</p>` : ""}
    </article>
  `).join("");
}

function normalizeAccountLinks(value) {
  const links = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : String(value || "")
    .split(/\n|,|、/)
    .map((item) => item.trim())
    .filter(Boolean);
  return links.slice(0, 2);
}

function draftCount() {
  return Object.values(state.updateDrafts).reduce((sum, fields) => sum + Object.keys(fields).length, 0);
}

function draftValueMatchesOriginal(member, field, value) {
  const current = currentDraftValue(member, field);
  if (field === "followers") {
    const nextValue = value === "" || value === null || value === undefined ? null : Number(value);
    return ((current === null || current === undefined || current === "") && nextValue === null)
      || Number(current) === nextValue;
  }
  if (field === "sales") return Number(current || 0) === Number(value || 0);
  if (field === "accountLinks") {
    return JSON.stringify(normalizeAccountLinks(current)) === JSON.stringify(normalizeAccountLinks(value));
  }
  if (milestoneKeys().includes(field)) return Boolean(current) === Boolean(value);
  return String(current ?? "") === String(value ?? "");
}

function draftFieldLabel(field) {
  if (field === "followers") return "フォロワー";
  if (field === "sales") return "売上";
  if (field === "stage") return "段階";
  if (field === "accountLinks") return "運用アカウント";
  if (field === "clientMemo") return "共有メモ";
  return allDetailMilestones().find((item) => item.key === field)?.label || field;
}

function draftValueLabel(member, field, value) {
  if (field === "followers") return Number(value).toLocaleString("ja-JP");
  if (field === "sales") return money(Number(value));
  if (field === "accountLinks") {
    const links = normalizeAccountLinks(value);
    const rawCount = Array.isArray(value) ? value.filter((item) => String(item || "").trim()).length : String(value || "").split(/\n|,|、/).map((item) => item.trim()).filter(Boolean).length;
    return links.length ? `${links.length}件${rawCount > 2 ? "（3件目以降は保存しません）" : ""}` : "未登録";
  }
  if (field === "clientMemo") return value ? String(value) : "空欄";
  if (milestoneKeys().includes(field)) return value ? "完了" : "未完了";
  return String(value);
}

function currentDraftValue(member, field) {
  const detail = memberDetail(member);
  if (field === "followers") return detail.latestFollower;
  if (field === "sales") return detail.latestSales;
  if (field === "accountLinks") return member.accountLinks || [];
  return member[field];
}

function renderDraftReview() {
  const target = $("#draftReview");
  if (!target) return;
  const entries = Object.entries(state.updateDrafts);
  if (!entries.length) {
    target.innerHTML = `
      <div class="draft-empty">
        <strong>保存前の確認</strong>
        <p class="subtext">変更すると、ここに差分が表示されます。保存ボタンを押すまで会社ページには反映されません。</p>
      </div>
    `;
    return;
  }

  const company = selectedCompany();
  const total = draftCount();
  target.innerHTML = `
    <div class="draft-review-head">
      <div>
        <p class="eyebrow">保存前チェック</p>
        <h3>${entries.length}名 / ${total}項目の変更があります</h3>
        <p class="subtext">保存すると評価・進捗が自動計算され、各社マイページに反映されます。</p>
      </div>
      <span class="pill warn">保存待ち</span>
    </div>
    <div class="draft-review-list">
      ${entries.map(([memberName, fields]) => {
        const member = company.members.find((item) => item.name === memberName);
        if (!member) return "";
        const effective = memberWithDraft(member);
        const beforeStatus = calculatedStatus(member);
        const afterStatus = calculatedStatus(effective);
        const beforeProgress = calculatedProgress(member);
        const afterProgress = calculatedProgress(effective);
        return `
          <article class="draft-member">
            <div class="draft-member-title">
              <strong>${member.name}</strong>
              <span>${beforeStatus}/${beforeProgress}% → ${afterStatus}/${afterProgress}%</span>
            </div>
            <div class="draft-lines">
              ${Object.entries(fields).map(([field, value]) => `
                <div class="draft-line">
                  <span>${draftFieldLabel(field)}</span>
                  <strong>${draftValueLabel(member, field, currentDraftValue(member, field))} → ${draftValueLabel(member, field, value)}</strong>
                </div>
              `).join("")}
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function updateDraftStatus() {
  const count = draftCount();
  const pill = $("#updateDraftPill");
  const saveButton = $("#saveUpdateSheet");
  const discardButton = $("#discardUpdateDrafts");
  if (!pill || !saveButton || !discardButton) return;
  const people = Object.keys(state.updateDrafts).length;
  pill.textContent = count ? `未保存 ${people}名 / ${count}項目` : "未保存なし";
  pill.className = `pill ${count ? "warn" : ""}`;
  saveButton.disabled = count === 0 || !roleCanEdit();
  discardButton.disabled = count === 0 || !roleCanEdit();
  renderDraftReview();
}

function setUpdateDraft(memberName, field, value) {
  if (!roleCanEdit()) return;
  const member = selectedCompany().members.find((item) => item.name === memberName);
  if (!member) return;
  state.updateDrafts[memberName] = state.updateDrafts[memberName] || {};
  if (draftValueMatchesOriginal(member, field, value)) {
    delete state.updateDrafts[memberName][field];
    if (!Object.keys(state.updateDrafts[memberName]).length) delete state.updateDrafts[memberName];
  } else {
    state.updateDrafts[memberName][field] = value;
  }
  updateDraftStatus();
}

function collectUpdateSheetDraftsFromDom() {
  if (!roleCanEdit()) return;
  $$("#updateSheetBody tr[data-member]").forEach((row) => {
    const memberName = row.dataset.member;
    row.querySelectorAll("[data-field]").forEach((input) => {
      const field = input.dataset.field;
      if (!field) return;
      const value = input.type === "checkbox" ? input.checked : input.value;
      setUpdateDraft(memberName, field, value);
    });
  });
}

function progressLabel(value) {
  if (value >= 70) return "順調";
  if (value >= 50) return "進行中";
  if (value >= 10) return "立ち上げ";
  if (value > 0) return "初期";
  return "未着手";
}

function renderCompanyGrid() {
  const list = [...companies()].sort((a, b) => currentEnrollment(b) - currentEnrollment(a));
  const maxSales = Math.max(...list.map((company) => Number(company.sales || 0)), 1);
  $("#companyGrid").innerHTML = list.map((company) => {
    const [tone, label] = statusTone(company);
    const enrollment = currentEnrollment(company);
    const avg = averageProgress(company.members);
    const risk = riskCount(company);
    const riskRate = Math.round((risk / Math.max(1, company.members.length)) * 100);
    const sales = Number(company.sales || 0);
    return `
      <button class="company-card" data-company="${company.id}" type="button">
        <div class="company-card-head">
          <div>
            <strong>${company.name}</strong>
            <small>${label} / 売上 ${money(sales)}</small>
          </div>
          <span class="status-dot ${tone}"></span>
        </div>
        <div class="company-metrics">
          <span><b>${enrollment}</b>在籍</span>
          <span><b>${company.prCount}</b>PR</span>
          <span><b>${company.buildCount}</b>構築</span>
          <span class="metric-danger"><b>${risk}</b>要確認</span>
        </div>
        <div class="company-card-bars">
          <div>
            <span>平均進捗 ${avg}%</span>
            <i><b style="width:${Math.min(100, Math.max(3, avg))}%"></b></i>
          </div>
          <div>
            <span>売上 ${money(sales)}</span>
            <i><b style="width:${Math.min(100, Math.max(3, Math.round((sales / maxSales) * 100)))}%"></b></i>
          </div>
        </div>
        <p class="subtext">要確認率 ${riskRate}% / クリックで会社ページへ</p>
      </button>
    `;
  }).join("");

  $$(".company-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.companyId = card.dataset.company;
      $("#companySelect").value = state.companyId;
      switchView("dashboard");
      renderAll();
    });
  });
}

function renderCompanyTable() {
  const sortValue = (company, key) => {
    if (key === "name") return company.name;
    if (key === "enrollment") return currentEnrollment(company);
    if (key === "newCount") return Number(company.newCount || 0);
    if (key === "buildCount") return Number(company.buildCount || 0);
    if (key === "prCount") return Number(company.prCount || 0);
    if (key === "progress") return averageProgress(company.members);
    if (key === "risk") return riskCount(company);
    if (key === "sales") return Number(company.sales || 0);
    return 0;
  };
  const rows = companies()
    .filter((company) => company.name.includes(state.companySearch.trim()))
    .sort((a, b) => {
      const aValue = sortValue(a, state.companySort.key);
      const bValue = sortValue(b, state.companySort.key);
      const result = typeof aValue === "string"
        ? aValue.localeCompare(bValue, "ja")
        : aValue - bValue;
      return state.companySort.direction === "asc" ? result : -result;
    });
  $$(".table-sort").forEach((button) => {
    const active = button.dataset.sort === state.companySort.key;
    button.classList.toggle("active", active);
    button.classList.toggle("asc", active && state.companySort.direction === "asc");
    button.classList.toggle("desc", active && state.companySort.direction === "desc");
  });
  $("#companyTable").innerHTML = rows.map((company) => {
    const [tone] = statusTone(company);
    const avg = averageProgress(company.members);
    const risk = riskCount(company);
    return `
      <tr class="company-row" data-company="${company.id}">
        <td><span class="member-name">${company.name}</span></td>
        <td>${currentEnrollment(company)}名</td>
        <td>${company.newCount}名</td>
        <td>${company.buildCount}名</td>
        <td>${company.prCount}名</td>
        <td><span class="table-progress"><b style="width:${Math.min(100, Math.max(3, avg))}%"></b></span><strong>${avg}%</strong></td>
        <td><span class="badge ${tone === "danger" ? "" : "b"}">${risk}名</span></td>
        <td><strong>${money(company.sales || 0)}</strong></td>
      </tr>
    `;
  }).join("");

  $$(".company-row").forEach((row) => {
    row.addEventListener("click", () => {
      state.companyId = row.dataset.company;
      $("#companySelect").value = state.companyId;
      switchView("dashboard");
      renderAll();
    });
  });
}

function renderOperationCenter() {
  if (!$("#opsCompanyName")) return;
  const company = selectedCompany();
  $("#opsCompanyName").textContent = company.name;
  const memberOptions = company.members.map((member) => `
    <option value="${member.name}">${member.name}</option>
  `).join("");
  ["#meetingMemberSelect", "#metricMemberSelect", "#memberUpdateSelect"].forEach((selector) => {
    $(selector).innerHTML = memberOptions;
  });
  const first = company.members[0];
  if (first) {
    $("#memberStageUpdate").value = first.stage;
    $("#memberStatusUpdate").value = first.status;
    $("#memberProgressUpdate").value = first.progress;
  }
  renderOperationFeed();
}

function renderOperationFeed() {
  if (!$("#operationFeed")) return;
  $("#operationFeed").innerHTML = state.operationFeed.map((item) => `
    <article class="feed-item">
      <div class="risk-row">
        <div>
          <span class="feed-type">${item.type}</span>
          <strong>${item.title}</strong>
        </div>
        <span class="subtext">${item.time}</span>
      </div>
      <p class="subtext">${item.company} / ${item.detail}</p>
    </article>
  `).join("");
}

function addOperation(type, title, detail) {
  state.operationFeed.unshift({
    type,
    company: selectedCompany().name,
    title,
    detail,
    time: platformTime()
  });
  renderOperationFeed();
}

function selectedMemberFrom(selectId) {
  const name = $(`#${selectId}`).value;
  return selectedCompany().members.find((member) => member.name === name);
}

function milestoneDefaults(progress, stage) {
  return {
    daily: progress >= 20,
    qa: progress >= 25,
    mtg: progress >= 30,
    orient: progress >= 10,
    firstMtg: progress >= 20,
    account: progress >= 35,
    firstPost: progress >= 45,
    f100: progress >= 55,
    f300: progress >= 62,
    f500: progress >= 70,
    f700: progress >= 78,
    f1000: progress >= 86,
    prMtg: stage === "PR" && progress >= 55,
    product: stage === "PR" && progress >= 62,
    prCarousel: stage === "PR" && progress >= 70,
    prVideo: stage === "PR" && progress >= 76,
    prTts: stage === "PR" && progress >= 80,
    sparkAds: stage === "PR" && progress >= 84,
    sakura: stage === "PR" && progress >= 88,
    month1: stage === "PR" && progress >= 82,
    month10: stage === "PR" && progress >= 94,
    month30: stage === "PR" && progress >= 97,
    month100: stage === "PR" && progress >= 100
  };
}

function recalcCompanyStats(company) {
  company.members = Array.isArray(company.members) ? company.members : [];
  company.enrollment = Array.isArray(company.enrollment) && company.enrollment.length ? company.enrollment : months.map(() => 0);
  company.enrollment[company.enrollment.length - 1] = company.members.length;
  company.prCount = company.members.filter((item) => item.stage === "PR").length;
  company.buildCount = company.members.filter((item) => item.stage === "構築").length;
  company.sales = company.members.reduce((sum, member) => sum + memberDetail(member).latestSales, 0);
}

function updateSheetMember(member, field, rawValue, checked) {
  const detail = memberDetail(member);
  if (field === "followers") {
    member.followerHistory = [...detail.followers];
    const nextValue = rawValue === "" || rawValue === null || rawValue === undefined ? null : Number(rawValue);
    member.followerHistory[member.followerHistory.length - 1] = Number.isFinite(nextValue) ? nextValue : null;
    addDetailUpdate("数字更新", `${member.name} のフォロワーを更新`, `フォロワー ${formatFollowerValue(member.followerHistory.at(-1))}`, member);
    return;
  }
  if (field === "sales") {
    member.salesHistory = [...detail.sales];
    member.salesHistory[member.salesHistory.length - 1] = Number(rawValue);
    addDetailUpdate("数字更新", `${member.name} の売上を更新`, `売上 ${money(Number(rawValue))}`, member);
    return;
  }
  if (field === "stage") {
    member[field] = rawValue;
    addDetailUpdate("評価更新", `${member.name} の段階を更新`, rawValue, member);
    return;
  }
  if (field === "clientMemo") {
    member.clientMemo = rawValue;
    addDetailUpdate("共有メモ", `${member.name} の共有メモを更新`, rawValue || "メモを空欄に更新", member);
    return;
  }
  if (field === "accountLinks") {
    const links = normalizeAccountLinks(rawValue);
    member.accountLinks = links;
    addDetailUpdate("運用アカウント", `${member.name} の運用アカウントを更新`, links.length ? `${links.length}件登録` : "未登録に更新", member);
    return;
  }
  member[field] = checked;
  addDetailUpdate("達成項目", `${member.name} の${allDetailMilestones().find((item) => item.key === field)?.label || field}を更新`, checked ? "完了に変更" : "未完了に変更", member);
}

async function applyUpdateDrafts() {
  if (!roleCanEdit()) return;
  collectUpdateSheetDraftsFromDom();
  const company = selectedCompany();
  const count = draftCount();
  const people = Object.keys(state.updateDrafts).length;
  if (!count) return;
  if (!window.confirm(`${people}名 / ${count}項目を保存して、各社マイページへ反映します。よろしいですか？`)) return;
  const beforeCompanies = cloneData(companyData);
  const beforeDrafts = cloneData(state.updateDrafts);
  const saveButton = $("#saveUpdateSheet");
  const discardButton = $("#discardUpdateDrafts");
  const originalSaveText = saveButton?.textContent || "保存して反映";
  try {
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "保存中...";
    }
    if (discardButton) discardButton.disabled = true;
    Object.entries(state.updateDrafts).forEach(([memberName, fields]) => {
      const member = company.members.find((item) => item.name === memberName);
      if (!member) return;
      Object.entries(fields).forEach(([field, value]) => {
        updateSheetMember(member, field, value, Boolean(value));
      });
      const beforeStatus = member.status;
      const beforeProgress = member.progress;
      recalculateMemberFormulas(member);
      if (beforeStatus !== member.status || beforeProgress !== member.progress) {
        addDetailUpdate("自動計算", `${member.name} の評価・進捗を自動更新`, `評価 ${member.status} / 進捗 ${member.progress}%`, member);
      }
    });
    recalcCompanyStats(company);
    regenerateAutoConclusions(company.members || []);
    await savePlatformData(`${company.name}: ${people}名 / ${count}項目を更新`);
    state.updateDrafts = {};
    renderAll();
    if (apiAvailable()) setTimeout(renderAuditLogs, 450);
  } catch (error) {
    companyData = beforeCompanies;
    state.updateDrafts = beforeDrafts;
    localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      sourceSignature: importedDataSignature,
      companies: companyData
    }));
    renderAll();
    window.alert("保存に失敗しました。通信状況を確認してから、もう一度「保存して反映」を押してください。");
  } finally {
    if (saveButton) saveButton.textContent = originalSaveText;
    updateDraftStatus();
  }
}

function addCompanyFromForm() {
  if (!roleCanManageCompanies()) return;
  const name = $("#newCompanyName").value.trim();
  const code = normalizeCompanyCode($("#newCompanyCode").value);
  const enrollment = Number($("#newCompanyEnrollment").value || 0);
  if (!name || !code) return;
  if (NON_CLIENT_COMPANY_IDS.has(code)) {
    window.alert("このIDは社内管理会社用のため使用できません。");
    return;
  }
  if (companies().some((company) => company.id === code)) {
    window.alert("同じログインIDの会社がすでに存在します。別のIDを入力してください。");
    return;
  }
  const company = createBlankCompany({ name, code, enrollment });
  companyData.push(company);
  state.companyId = company.id;
  state.updateDrafts = {};
  $("#addCompanyForm").reset();
  addOperation("法人追加", `${name} を追加`, `ログインID ${code} / マイページを自動発行`);
  void persistAndRefresh(null, `${name}: 新規法人を追加`);
  renderCompanySelect();
  renderLoginCompanies();
  $("#companySelect").value = state.companyId;
  switchView("dashboard");
}

function deleteMember(memberName) {
  const company = selectedCompany();
  const member = company.members.find((item) => item.name === memberName);
  if (!member) return;
  if (!window.confirm(`${member.name} を削除します。会社ページと受講生一覧から非表示になります。よろしいですか？`)) return;
  company.members = company.members.filter((item) => item.name !== member.name);
  delete state.updateDrafts[member.name];
  if (state.activeMemberName === member.name) closeMemberDetail();
  if (state.mtgMemberName === member.name) state.mtgMemberName = company.members[0]?.name || "";
  recalcCompanyStats(company);
  addOperation("受講生削除", `${member.name} を削除`, `${company.name} の受講生一覧から非表示`);
  void persistAndRefresh(null, `${company.name}: ${member.name} を削除`);
}

async function renderAuditLogs() {
  const list = $("#auditLogList");
  const pill = $("#auditStatusPill");
  if (!list || !pill) return;
  if (!apiAvailable() || !state.session?.token) {
    pill.textContent = "ローカル";
    list.innerHTML = `<p class="subtext">保存履歴は本番URLにログインしたときに表示されます。</p>`;
    return;
  }
  try {
    const response = await fetch("/api/audit-logs", { headers: authHeaders() });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const payload = await response.json();
    const logs = Array.isArray(payload.auditLogs) ? payload.auditLogs.slice(0, 8) : [];
    pill.textContent = `${logs.length}件`;
    pill.className = "pill";
    list.innerHTML = logs.length ? logs.map((log) => `
      <article class="audit-item">
        <div>
          <strong>${log.summary || "更新を保存"}</strong>
          <p class="subtext">${log.actor || "system"} / ${formatAuditTime(log.createdAt)}</p>
        </div>
      </article>
    `).join("") : `<p class="subtext">まだ保存履歴はありません。</p>`;
  } catch (error) {
    pill.textContent = "未接続";
    pill.className = "pill danger";
    list.innerHTML = `<p class="subtext">保存履歴を取得できませんでした。APIサーバーの起動状態を確認してください。</p>`;
  }
}

function formatAuditTime(value) {
  if (!value) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function discardUpdateDrafts() {
  state.updateDrafts = {};
  renderUpdateSheet();
}

function bindMemberLinks() {
  $$(".member-link").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.company && button.dataset.company !== state.companyId) {
        state.companyId = button.dataset.company;
        $("#companySelect").value = state.companyId;
      }
      const member = selectedCompany().members.find((item) => item.name === button.dataset.member);
      if (member) openMemberDetail(member);
    });
  });
}

function bindCompanyJumps() {
  $$(".company-jump").forEach((button) => {
    button.addEventListener("click", () => {
      state.companyId = button.dataset.company;
      $("#companySelect").value = state.companyId;
      switchView("dashboard");
      renderAll();
    });
  });
}

function openMemberDetail(member) {
  state.activeMemberName = member.name;
  const detail = memberDetail(member);
  $("#detailName").textContent = member.name;
  $("#detailMeta").textContent = `${selectedCompany().name} / ${member.stage} / 評価 ${member.status}`;
  renderDetailActionBoard(member, detail);
  renderDetailAccounts(member);
  $("#detailKpis").innerHTML = [
    {
      label: "フォロワー",
      value: formatFollowerValue(detail.latestFollower),
      caption: detail.hasFollowerData ? `前月比 ${metricDeltaText(detail.followers.at(-1), detail.followers.at(-2), "人")}` : "未登録",
      tone: detail.hasFollowerData ? "good" : "warn"
    },
    {
      label: "売上",
      value: compactMoney(detail.latestSales),
      caption: detail.latestSales > 0 ? "成果登録あり" : "売上0円",
      tone: detail.latestSales > 0 ? "good" : "warn"
    }
  ].map(kpiCard).join("");
  renderMiniChart("#followerChart", detail.followers, "followers", "#followerTrendVerdict");
  renderMiniChart("#salesChart", detail.sales, "sales", "#salesTrendVerdict");
  renderMeetings(detail.meetings);
  renderCompletionMap(member);
  fillDetailForms(member, detail);
  renderDetailUpdateFeed(member.name);
  applyRolePermissions();
  $("#detailOverlay").classList.add("open");
  $("#detailOverlay").setAttribute("aria-hidden", "false");
}

function isAccountUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function accountLabel(value, index) {
  const text = String(value || "").trim();
  if (!isAccountUrl(text)) return text || `アカウント${index + 1}`;
  try {
    const url = new URL(text);
    const path = decodeURIComponent(url.pathname || "").replace(/^\/+/, "");
    if (url.hostname.includes("tiktok.com")) return path || "TikTokアカウント";
    if (url.hostname.includes("instagram.com")) return path || "Instagramアカウント";
    return `${url.hostname.replace(/^www\./, "")}/${path}`.replace(/\/$/, "");
  } catch (error) {
    return text;
  }
}

function accountStatusText(value) {
  const text = String(value || "").trim();
  if (isAccountUrl(text)) return text.includes("tiktok.com") ? "TikTok" : text.includes("instagram.com") ? "Instagram" : "外部リンク";
  if (text.includes("見れない") || text.includes("未連携") || text.includes("見つからず")) return "確認必要";
  return "スプシ記載";
}

function renderDetailAccounts(member) {
  const rawLinks = Array.isArray(member.accountLinks) ? member.accountLinks.filter((item) => String(item || "").trim()) : [];
  const links = normalizeAccountLinks(rawLinks);
  const hasLinks = links.length > 0;
  $("#detailAccountPanel").innerHTML = `
    <div class="panel-header compact">
      <div>
        <p class="eyebrow">運用アカウント</p>
        <h3>登録済みアカウント</h3>
      </div>
      <span class="pill ${hasLinks ? "" : "danger"}">${hasLinks ? `${links.length}/2件` : "未登録"}</span>
    </div>
    <p class="account-limit-note">1人につき最大2アカウントまで登録できます。</p>
    <div class="account-link-list">
      ${hasLinks ? links.map((link, index) => {
        const text = String(link).trim();
        const isUrl = isAccountUrl(text);
        const label = accountLabel(text, index);
        return `
          <article class="account-link-card ${isUrl ? "" : "note"}">
            <div>
              <span>${accountStatusText(text)}</span>
              <strong>${escapeHtml(label)}</strong>
              ${isUrl ? `<p>${escapeHtml(text)}</p>` : ""}
            </div>
            ${isUrl ? `<a class="account-open-button" href="${escapeHtml(text)}" target="_blank" rel="noopener noreferrer">開く</a>` : `<em>要確認</em>`}
          </article>
        `;
      }).join("") : `<p class="subtext">この受講生の運用アカウントはまだ登録されていません。</p>`}
    </div>
  `;
}

function memberOneLineConclusion(member) {
  const point = missingPoint(member).replace("未完了", "").replace("未達", "");
  if (member.status === "F" || member.progress < 35) {
    return `${point}を確認中。今週中に「${actionFor(member)}」を確認。`;
  }
  if (member.progress < 60) {
    return `${point}を解消すれば次フェーズへ進めます。`;
  }
  return `順調に進行中。次は成果化に向けて「${actionFor(member)}」。`;
}

function detailClientNeed(member) {
  if (!member.daily) return "投稿時間の確保と社内リマインド可否";
  if (!member.mtg) return "次回MTG候補日と参加可否";
  if (!member.account) return "アカウント作成・ログイン状況";
  if (!member.firstPost) return "初回投稿に使う素材・台本の確認";
  if (!member.f100) return "プロフィール素材と投稿テーマの確認";
  if (!member.product) return "商品申請に必要な情報の準備";
  if (!member.month1) return "案件化に向けた導線・対応可否";
  return "次月の成果拡大に向けた社内協力範囲";
}

function formatFollowerValue(value) {
  return value === null || value === undefined ? "未登録" : `${Number(value).toLocaleString("ja-JP")}人`;
}

function metricDeltaText(current, previous, unit = "") {
  if (current === null || current === undefined || previous === null || previous === undefined) return "未登録";
  const diff = Number(current) - Number(previous);
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toLocaleString("ja-JP")}${unit}`;
}

function detailTone(member) {
  if (member.status === "F" || member.progress < 35) return "danger";
  if (member.progress < 60) return "warn";
  return "good";
}

function autoConclusionStatusLabel(tone) {
  if (tone === "danger") return "重点確認";
  if (tone === "warn") return "改善余地あり";
  return "順調";
}

function generateMemberAutoConclusion(member) {
  const detail = memberDetail(member);
  const all = allDetailMilestones();
  const missingItems = all.filter((item) => !milestoneDone(member, item.key));
  const done = all.length - missingItems.length;
  const latestFollower = detail.latestFollower;
  const prevFollower = detail.followers.length > 1 ? detail.followers.at(-2) : null;
  const latestSales = detail.latestSales;
  const prevSales = detail.sales.length > 1 ? Number(detail.sales.at(-2) || 0) : 0;
  const followerDelta = metricDeltaText(latestFollower, prevFollower, "人");
  const salesDelta = money(latestSales - prevSales);
  const tone = detailTone(member);
  const primaryMissing = missingItems[0];
  const primaryAction = primaryMissing ? blockerAction(primaryMissing.key, member) : actionFor(member);
  const missingSummary = missingItems.slice(0, 3).map((item) => item.label).join("、") || "主要項目完了";
  const accountCount = normalizeAccountLinks(member.accountLinks).length;
  const meetingCount = detail.meetings.length;
  const facts = [
    `${member.stage}フェーズ`,
    `評価${member.status}`,
    `進捗${Number(member.progress || 0)}%`,
    `${done}/${all.length}項目完了`,
    `フォロワー${formatFollowerValue(latestFollower)}`,
    `売上${money(latestSales)}`,
    `MTG${meetingCount}件`,
    `アカウント${accountCount}/2件`
  ];
  const headline = tone === "danger"
    ? `${missingSummary}を優先確認。今週は「${primaryAction}」から着手します。`
    : tone === "warn"
      ? `${missingSummary}を整えると次フェーズへ進みやすい状態です。`
      : `主要項目は進行中です。次は「${primaryAction}」で成果化を強めます。`;
  const evidence = `根拠: ${facts.join(" / ")}。直近変化はフォロワー${followerDelta}、売上${salesDelta}です。`;
  const clientNeed = `貴社確認: ${detailClientNeed(member)}。`;
  return {
    headline,
    evidence,
    nextAction: primaryAction,
    clientNeed: detailClientNeed(member),
    statusLabel: autoConclusionStatusLabel(tone),
    generatedAt: new Date().toISOString(),
    summary: `${headline} ${evidence} ${clientNeed}`
  };
}

function regenerateAutoConclusions(members) {
  (Array.isArray(members) ? members : []).forEach((member) => {
    if (!member) return;
    member.autoConclusion = generateMemberAutoConclusion(member);
  });
}

function activeAutoConclusion(member) {
  return member.autoConclusion || generateMemberAutoConclusion(member);
}

function renderDetailActionBoard(member, detail) {
  const all = allDetailMilestones();
  const missingItems = all.filter((item) => !milestoneDone(member, item.key));
  const done = all.length - missingItems.length;
  const nextItems = missingItems.slice(0, 4);
  const followerDelta = metricDeltaText(detail.followers.at(-1), detail.followers.at(-2), "人");
  const salesDelta = detail.sales.at(-1) - detail.sales.at(-2);
  const tone = detailTone(member);
  const conclusion = activeAutoConclusion(member);

  $("#detailActionBoard").className = `detail-action-board ${tone}`;
  $("#detailActionBoard").innerHTML = `
    <section class="detail-score-panel">
      <div class="score-ring" style="--score:${member.progress * 3.6}deg">
        <span>${member.progress}%</span>
      </div>
      <div>
        <p class="eyebrow">自動結論</p>
        <h3>${escapeHtml(conclusion.headline)}</h3>
        <p>${escapeHtml(conclusion.evidence)}</p>
        <p class="auto-conclusion-note">保存時に自動生成: ${escapeHtml(conclusion.generatedAt ? new Date(conclusion.generatedAt).toLocaleString("ja-JP") : "未保存")}</p>
      </div>
    </section>

    <section class="next-action-panel">
      <p class="eyebrow">次に潰す項目</p>
      <div class="next-action-list">
        ${nextItems.map((item, index) => `
          <article>
            <span>${index + 1}</span>
            <div>
              <strong>${item.label}</strong>
              <p>${blockerAction(item.key, member)}</p>
            </div>
          </article>
        `).join("") || `<p class="subtext">主要項目は完了しています。成果拡大に進めます。</p>`}
      </div>
      <div class="client-need">
        <span>クライアント確認</span>
        <strong>${escapeHtml(conclusion.clientNeed)}</strong>
      </div>
      <p class="subtext">直近: フォロワー${followerDelta} / 売上${salesDelta >= 0 ? "+" : ""}${money(salesDelta)}</p>
    </section>
  `;
}

function allDetailMilestones() {
  return detailMilestoneGroups.flatMap((group) => group.items.map(([key, label]) => ({ key, label, group: group.title })));
}

function milestoneDone(member, key) {
  return Boolean(member[key]);
}

function renderCompletionMap(member) {
  const all = allDetailMilestones();
  const done = all.filter((item) => milestoneDone(member, item.key)).length;
  const rate = all.length ? Math.round((done / all.length) * 100) : 0;
  $("#completionPill").textContent = `${done}/${all.length} 完了`;
  $("#completionPill").className = `pill ${rate < 35 ? "danger" : ""}`;
  $("#completionGrid").innerHTML = detailMilestoneGroups.map((group) => {
    const groupDone = group.items.filter(([key]) => milestoneDone(member, key)).length;
    const groupRate = Math.round((groupDone / group.items.length) * 100);
    return `
      <article class="completion-card">
        <div class="risk-row">
          <strong>${group.title}</strong>
          <span>${groupDone}/${group.items.length}</span>
        </div>
        <div class="progress"><span style="width:${groupRate}%"></span></div>
        <div class="check-list">
          ${group.items.map(([key, label]) => {
            const ok = milestoneDone(member, key);
            return `<span class="check-item ${ok ? "done" : "todo"}">${ok ? "✓" : "未"} ${label}</span>`;
          }).join("")}
        </div>
      </article>
    `;
  }).join("");
  renderBlockers(member);
}

function renderBlockers(member) {
  if (!$("#blockerList")) return;
  const missing = allDetailMilestones().filter((item) => !milestoneDone(member, item.key)).slice(0, 6);
  $("#blockerList").innerHTML = missing.map((item, index) => `
    <article class="blocker-item">
      <span class="blocker-rank">${index + 1}</span>
      <div>
        <strong>${item.label}</strong>
        <p class="subtext">${item.group}で未完了。次アクション: ${blockerAction(item.key, member)}</p>
      </div>
    </article>
  `).join("") || `<p class="subtext">主要項目は完了しています。次の成果創出に進めます。</p>`;
}

function blockerAction(key, member) {
  const actions = {
    daily: "投稿頻度を確認し、週次の投稿計画を作る",
    qa: "質問対応の有無を確認する",
    mtg: "次回MTG日を設定する",
    orient: "オリエン実施日を確定する",
    firstMtg: "初回MTGで運用方針をすり合わせる",
    account: "アカウント作成とログイン確認を完了する",
    firstPost: "初回投稿の素材と台本を確認する",
    f100: "プロフィールと投稿テーマを見直す",
    f300: "伸びた投稿の型を横展開する",
    f500: "投稿頻度と企画の検証を増やす",
    f700: "PR移行に向けた実績整理を行う",
    f1000: "案件獲得に向けて媒体資料を整える",
    prMtg: "PR案件の進め方を運用者と確認する",
    product: "商品申請に必要な情報を揃える",
    prCarousel: "カルーセル構成案を作成する",
    prVideo: "PR動画の構成と投稿日を決める",
    prTts: "PR TTSの台本と音声方針を決める",
    sparkAds: "スパークアズ対象の条件を確認する",
    sakura: "サクラ連携の実施可否を確認する",
    month1: "初回案件獲得に向けた導線を確認する",
    month10: "再現性ある案件獲得フローを作る",
    month30: "高頻度で案件化できる投稿型を固定する",
    month100: "月100件に向けた運用体制を設計する"
  };
  return actions[key] || actionFor(member);
}

function fillDetailForms(member, detail) {
  $("#detailFollowers").value = detail.latestFollower ?? "";
  $("#detailSales").value = detail.latestSales;
  $("#detailStage").value = member.stage;
  $("#detailStatus").value = member.status;
  $("#detailProgress").value = member.progress;
  $("#detailClientMemo").value = member.clientMemo || `${member.name} は${missingPoint(member)}。${actionFor(member)}`;
  renderDetailMilestoneChecks(member);
}

function renderDetailMilestoneChecks(member) {
  $("#detailMilestoneChecks").innerHTML = detailMilestoneGroups.map((group) => `
    <fieldset>
      <legend>${group.title}</legend>
      ${group.items.map(([key, label]) => `
        <label class="milestone-check">
          <input type="checkbox" value="${key}" ${milestoneDone(member, key) ? "checked" : ""} />
          <span>${label}</span>
        </label>
      `).join("")}
    </fieldset>
  `).join("");
}

function activeMember() {
  return selectedCompany().members.find((member) => member.name === state.activeMemberName);
}

function addDetailUpdate(type, title, detail, targetMember = activeMember()) {
  const member = targetMember;
  if (!member) return;
  const item = {
    type,
    member: member.name,
    company: selectedCompany().name,
    title,
    detail,
    time: platformTime()
  };
  member.updateFeed = member.updateFeed || [];
  member.updateFeed.unshift(item);
  state.detailFeed.unshift(item);
  state.operationFeed.unshift(item);
  renderDetailUpdateFeed(member.name);
  renderOperationFeed();
}

function renderDetailUpdateFeed(memberName) {
  const member = selectedCompany().members.find((item) => item.name === memberName);
  const updates = (member?.updateFeed || state.detailFeed.filter((item) => item.member === memberName)).slice(0, 4);
  $("#detailUpdateFeed").innerHTML = updates.map((item) => `
    <article class="feed-item">
      <div class="risk-row">
        <div>
          <span class="feed-type">${item.type}</span>
          <strong>${item.title}</strong>
        </div>
        <span class="subtext">${item.time}</span>
      </div>
      <p class="subtext">${item.detail}</p>
    </article>
  `).join("") || `<p class="subtext">この受講生の更新履歴はまだありません。</p>`;
}

function renderMiniChart(selector, values, type, verdictSelector) {
  const normalized = Array.isArray(values) && values.length ? values : months.map(() => type === "sales" ? 0 : null);
  const numeric = normalized.filter((value) => Number.isFinite(value));
  const max = Math.max(...numeric, 1);
  const verdict = trendVerdict(normalized, type === "sales" ? 0 : 3);
  if (verdictSelector && $(verdictSelector)) {
    $(verdictSelector).textContent = verdict.label;
    $(verdictSelector).className = `pill ${verdict.tone === "danger" ? "danger" : verdict.tone === "warn" ? "warn" : ""}`;
  }
  $(selector).innerHTML = normalized.map((value, index) => {
    const hasValue = Number.isFinite(value);
    const height = hasValue ? Math.max(type === "sales" && value === 0 ? 8 : 10, (value / max) * 126) : 8;
    const label = hasValue ? (type === "sales" ? compactMoney(value) : value.toLocaleString("ja-JP")) : "未登録";
    return `
      <div class="mini-bar-wrap">
        <span>${label}</span>
        <div class="mini-bar ${hasValue ? "" : "empty"}" style="height:${height}px"></div>
        <small>${months[index]}</small>
      </div>
    `;
  }).join("");
}

function renderMeetings(meetings) {
  if (!Array.isArray(meetings) || !meetings.length) {
    $("#meetingList").innerHTML = `
      <article class="empty-state">
        <strong>MTG履歴はまだ登録されていません</strong>
        <p>管理者が更新タブでMTGを登録すると、この受講生の履歴として表示されます。</p>
      </article>
    `;
    return;
  }
  $("#meetingList").innerHTML = meetings.map((meeting) => `
    <article class="meeting-card">
      <div class="risk-row">
        <strong>${escapeHtml(meeting.date)}</strong>
        <span class="pill">${escapeHtml(meeting.result)}</span>
      </div>
      <p class="subtext">記録元: ${escapeHtml(meeting.coach || "スプシ記録")} / 売上 ${money(Number(meeting.sale || 0))}</p>
      <p>${escapeHtml(meeting.content)}</p>
      ${meeting.next ? `<p class="subtext">次回まで: ${escapeHtml(meeting.next)}</p>` : ""}
    </article>
  `).join("");
}

function closeMemberDetail() {
  $("#detailOverlay").classList.remove("open");
  $("#detailOverlay").setAttribute("aria-hidden", "true");
  state.activeMemberName = "";
}

function bindEvents() {
  $("#loginRole").addEventListener("change", (event) => {
    const role = event.target.value;
    $("#loginCompanyField").style.display = role === "admin" ? "none" : "";
    renderLoginCompanies();
  });

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const role = $("#loginRole").value;
    const ok = await loginWithApiOrLocal(
      role,
      $("#loginCompany").value,
      $("#loginEmail").value.trim(),
      $("#loginPassword").value.trim()
    );
    if (!ok) {
      $("#loginError").textContent = "IDまたはパスワードが違います。配布されたログイン情報を確認してください。";
      return;
    }
    $("#loginError").textContent = "";
  });

  $("#logoutButton").addEventListener("click", logoutUser);

  $("#monthlyResetButton").addEventListener("click", () => {
    if (!roleCanEdit()) return;
    const monthKey = currentMonthKey();
    const ok = window.confirm(`${monthKey} の当月数字を0で開始します。\n\nリセット対象: 当月売上、当月1000達成。\n月1/10/30/100件獲得、フォロワー累計、MTG履歴、アカウント、過去履歴は残ります。`);
    if (!ok) return;
    resetCurrentMonthNumbers({ force: true, persist: true });
  });

  $$(".nav-tab").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $("#roleSelect").addEventListener("change", (event) => {
    state.role = event.target.value;
    if (state.role === "client" && ["admin", "updates"].includes(activeViewId())) switchView("dashboard");
    renderAll();
  });

  $("#companySelect").addEventListener("change", (event) => {
    state.companyId = event.target.value;
    state.updateDrafts = {};
    renderAll();
  });

  $("#stageFilter").addEventListener("change", (event) => {
    state.stage = event.target.value;
    renderAll();
  });

  $("#statusFilter").addEventListener("change", (event) => {
    state.status = event.target.value;
    renderAll();
  });

  $("#searchInput").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderMembers();
  });

  $("#companySearchInput").addEventListener("input", (event) => {
    state.companySearch = event.target.value;
    renderCompanyTable();
  });

  $("#newCompanyCode").addEventListener("input", (event) => {
    event.target.value = normalizeCompanyCode(event.target.value);
  });

  $("#addCompanyForm").addEventListener("submit", (event) => {
    event.preventDefault();
    addCompanyFromForm();
  });

  $("#progressReportForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!roleCanEditProgressReport()) return;
    const company = selectedCompany();
    company.progressReport = {
      good: $("#progressGood").value.trim(),
      issue: $("#progressIssue").value.trim(),
      action: $("#progressAction").value.trim(),
      request: $("#progressRequest").value.trim()
    };
    addOperation("進捗報告", "今月の進捗を更新", "会社ページの進捗報告を保存して反映");
    void persistAndRefresh(null, `${company.name}: 今月の進捗を更新`);
  });

  $$(".table-sort").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (state.companySort.key === key) {
        state.companySort.direction = state.companySort.direction === "asc" ? "desc" : "asc";
      } else {
        state.companySort = { key, direction: key === "name" ? "asc" : "desc" };
      }
      renderCompanyTable();
    });
  });

  $("#updateSheetBody").addEventListener("change", (event) => {
    if (!roleCanUseUpdateWorkspace()) return;
    const target = event.target;
    const field = target.dataset.field;
    if (!field) return;
    const row = target.closest("tr");
    const memberName = row?.dataset.member;
    if (!memberName) return;
    setUpdateDraft(memberName, field, target.type === "checkbox" ? target.checked : target.value);
    renderUpdateSheet();
  });

  $("#updateSheetBody").addEventListener("input", (event) => {
    if (!roleCanUseUpdateWorkspace()) return;
    const target = event.target;
    const field = target.dataset.field;
    if (!field || target.type === "checkbox" || target.tagName === "SELECT") return;
    const row = target.closest("tr");
    const memberName = row?.dataset.member;
    if (!memberName) return;
    setUpdateDraft(memberName, field, target.value);
  });

  $("#saveUpdateSheet").addEventListener("click", applyUpdateDrafts);
  $("#discardUpdateDrafts").addEventListener("click", discardUpdateDrafts);

  $("#updateSheetBody").addEventListener("click", (event) => {
    if (!roleCanUseUpdateWorkspace()) return;
    const button = event.target.closest(".mtg-select-button");
    if (!button) return;
    state.mtgMemberName = button.dataset.member;
    renderMtgOps();
  });

  $("#mtgMemberSelect").addEventListener("change", (event) => {
    if (!roleCanUseUpdateWorkspace()) return;
    state.mtgMemberName = event.target.value;
    renderMtgOps();
  });

  $("#addMemberForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!roleCanManageMembers()) return;
    const company = selectedCompany();
    const name = $("#newMemberName").value.trim();
    if (!name) return;
    const stage = $("#newMemberStage").value;
    const status = $("#newMemberStatus").value;
    const progress = Number($("#newMemberProgress").value);
    if (company.members.some((item) => item.name === name)) {
      window.alert("同じ名前の受講生がすでに存在します。");
      return;
    }
    const member = createBlankMember({ name, stage, status, progress });
    company.members.unshift(member);
    recalcCompanyStats(company);
    state.activeMemberName = member.name;
    $("#addMemberForm").reset();
    addOperation("受講生追加", `${member.name} を追加`, `${company.name} / 段階 ${stage} / 評価 ${status}`);
    void persistAndRefresh(member, `${company.name}: ${member.name} を追加`);
  });

  $("#mtgOpsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!roleCanUseUpdateWorkspace()) return;
    const member = selectedCompany().members.find((item) => item.name === $("#mtgMemberSelect").value);
    if (!member) return;
    const detail = memberDetail(member);
    member.meetings = member.meetings || [];
    member.meetings.unshift({
      date: $("#mtgDate").value.replaceAll("-", "/"),
      coach: "運用者",
      follower: detail.latestFollower,
      sale: detail.latestSales,
      content: $("#mtgContent").value,
      next: $("#mtgNextAction").value,
      result: $("#mtgResult").value
    });
    state.mtgMemberName = member.name;
    addDetailUpdate("MTG", `${member.name} のMTGを登録`, `${$("#mtgDate").value} / ${$("#mtgResult").value} / ${$("#mtgContent").value}`, member);
    void persistAndRefresh();
  });

  $("#detailMeetingForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!roleCanUseDetailQuickEdit()) return;
    const member = activeMember();
    if (!member) return;
    const detail = memberDetail(member);
    member.meetings = member.meetings || [];
    member.meetings.unshift({
      date: $("#detailMeetingDate").value.replaceAll("-", "/"),
      coach: "運用者",
      follower: detail.latestFollower,
      sale: detail.latestSales,
      content: $("#detailMeetingMemo").value,
      next: actionFor(member),
      result: $("#detailMeetingResult").value
    });
    addDetailUpdate("MTG", `${member.name} のMTGを追加`, `${$("#detailMeetingDate").value} / ${$("#detailMeetingResult").value} / ${$("#detailMeetingMemo").value}`);
    void persistAndRefresh(member);
  });

  $("#detailMetricForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!roleCanUseDetailQuickEdit()) return;
    const member = activeMember();
    if (!member) return;
    const detail = memberDetail(member);
    member.followerHistory = [...detail.followers];
    member.salesHistory = [...detail.sales];
    const followerInput = $("#detailFollowers").value;
    member.followerHistory[member.followerHistory.length - 1] = followerInput === "" ? null : Number(followerInput);
    member.salesHistory[member.salesHistory.length - 1] = Number($("#detailSales").value);
    addDetailUpdate("数字更新", `${member.name} の数字を更新`, `フォロワー ${formatFollowerValue(member.followerHistory.at(-1))} / 売上 ${money(Number($("#detailSales").value))}`);
    void persistAndRefresh(member);
  });

  $("#detailStatusForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!roleCanUseDetailQuickEdit()) return;
    const member = activeMember();
    if (!member) return;
    member.stage = $("#detailStage").value;
    member.status = $("#detailStatus").value;
    member.progress = Number($("#detailProgress").value);
    addDetailUpdate("評価更新", `${member.name} の評価を更新`, `段階 ${$("#detailStage").value} / 評価 ${$("#detailStatus").value} / 進捗 ${$("#detailProgress").value}%`);
    void persistAndRefresh(member);
  });

  $("#detailMilestoneForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!roleCanUseDetailQuickEdit()) return;
    const member = activeMember();
    if (!member) return;
    const checked = new Set($$("#detailMilestoneChecks input:checked").map((input) => input.value));
    allDetailMilestones().forEach((item) => {
      member[item.key] = checked.has(item.key);
    });
    const done = allDetailMilestones().filter((item) => member[item.key]).length;
    member.progress = Math.round((done / allDetailMilestones().length) * 100);
    addDetailUpdate("達成項目", `${member.name} の達成項目を更新`, `${done}/${allDetailMilestones().length} 項目を完了として保存`);
    void persistAndRefresh(member);
  });

  $("#detailClientMemoForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!roleCanUseDetailQuickEdit()) return;
    const member = activeMember();
    if (!member) return;
    member.clientMemo = $("#detailClientMemo").value;
    addDetailUpdate("共有メモ", `${member.name} のクライアント向けメモを保存`, $("#detailClientMemo").value);
    void persistAndRefresh(member);
  });

  $("#detailClose").addEventListener("click", closeMemberDetail);
  $("#detailUpdateJump").addEventListener("click", () => {
    const member = activeMember();
    if (member) state.mtgMemberName = member.name;
    closeMemberDetail();
    switchView("updates");
    renderAll();
  });
  $("#detailOverlay").addEventListener("click", (event) => {
    if (event.target.id === "detailOverlay") closeMemberDetail();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMemberDetail();
  });
}

function renderAll() {
  if (!state.session) {
    renderAuthShell();
    return;
  }
  ensureMonthlyScheduleState();
  renderShell();
  renderPeriodStrips();
  renderAdminCommandTop();
  renderCompanyGrid();
  renderCompanyTable();
  renderKpis();
  renderExecutiveFocus();
  renderExecutiveSummary();
  renderChart();
  renderRiskList();
  renderUpdateSheet();
  renderMtgOps();
  renderAuditLogs();
  renderMembers();
}

renderCompanySelect();
renderLoginCompanies();
$("#loginCompanyField").style.display = "none";
bindEvents();
renderAuthShell();
renderAll();
hydratePlatformDataFromApi();
