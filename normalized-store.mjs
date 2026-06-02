import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

const reverseMilestoneMap = {
  daily: "daily",
  qa: "qa",
  mtg: "mtg",
  orient: "orient",
  first_mtg: "firstMtg",
  account: "account",
  first_post: "firstPost",
  f100: "f100",
  f300: "f300",
  f500: "f500",
  f700: "f700",
  f1000: "f1000",
  pr_mtg: "prMtg",
  product: "product",
  pr_carousel: "prCarousel",
  pr_video: "prVideo",
  pr_tts: "prTts",
  spark_ads: "sparkAds",
  sakura: "sakura",
  month1: "month1",
  month10: "month10",
  month30: "month30",
  month100: "month100"
};

const legacyMilestoneMap = Object.fromEntries(Object.entries(reverseMilestoneMap).map(([dbKey, legacyKey]) => [legacyKey, dbKey]));

const stageToLegacy = {
  new: "新規",
  build: "構築",
  pr: "PR"
};

const legacyToStage = {
  "新規": "new",
  "構築": "build",
  "PR": "pr"
};

const legacyToResult = {
  "注力": "focus",
  "要対応": "follow_required",
  "完了": "done",
  "継続": "continued"
};

const resultToLegacy = {
  focus: "注力",
  follow_required: "要対応",
  done: "完了",
  continued: "継続"
};

function toLegacyDate(value) {
  return String(value || "").replaceAll("-", "/");
}

function latestBy(rows, key, dateKey) {
  const result = new Map();
  rows.forEach((row) => {
    const current = result.get(row[key]);
    if (!current || String(row[dateKey]) > String(current[dateKey])) {
      result.set(row[key], row);
    }
  });
  return result;
}

function groupBy(rows, key) {
  const result = new Map();
  rows.forEach((row) => {
    const value = row[key];
    if (!result.has(value)) result.set(value, []);
    result.get(value).push(row);
  });
  return result;
}

function normalizeName(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function reportMonthFromLegacy(legacyCompany) {
  const match = String(legacyCompany.reportMeta || "").match(/(\d{4})年\s*(\d{1,2})月/);
  if (!match) return "2026-06-01";
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-01`;
}

function findOrCreateCompany(tables, legacyCompany) {
  let company = tables.companies.find((item) => item.code === legacyCompany.id);
  if (company) return company;
  const now = new Date().toISOString();
  company = {
    id: crypto.randomUUID(),
    code: legacyCompany.id,
    name: legacyCompany.name,
    legal_name: legacyCompany.name,
    company_kind: "client",
    contract_status: "active",
    report_month: reportMonthFromLegacy(legacyCompany),
    source_file: legacyCompany.sourceFile || "platform",
    created_at: now,
    updated_at: now,
    deleted_at: null
  };
  tables.companies.push(company);
  return company;
}

function latestSummaryForCompany(tables, companyId) {
  return tables.company_monthly_summaries
    .filter((summary) => summary.company_id === companyId)
    .sort((a, b) => String(b.summary_month).localeCompare(String(a.summary_month)))[0];
}

function latestReportForCompany(tables, companyId) {
  return (tables.client_reports || [])
    .filter((report) => report.company_id === companyId)
    .sort((a, b) => String(b.report_month).localeCompare(String(a.report_month)) || String(b.updated_at).localeCompare(String(a.updated_at)))[0];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotCompanyTables(tables, companyId) {
  return {
    company: clone(tables.companies.find((company) => company.id === companyId) || null),
    summaries: clone(tables.company_monthly_summaries.filter((summary) => summary.company_id === companyId)),
    reports: clone((tables.client_reports || []).filter((report) => report.company_id === companyId)),
    members: clone(tables.members.filter((member) => member.company_id === companyId)),
    accounts: clone(tables.member_accounts.filter((account) => tables.members.some((member) => member.company_id === companyId && member.id === account.member_id))),
    milestones: clone(tables.member_milestones.filter((milestone) => tables.members.some((member) => member.company_id === companyId && member.id === milestone.member_id))),
    metrics: clone(tables.member_metrics.filter((metric) => tables.members.some((member) => member.company_id === companyId && member.id === metric.member_id))),
    sessions: clone(tables.coaching_sessions.filter((session) => session.company_id === companyId))
  };
}

function findOrCreateMember(tables, company, legacyMember) {
  const normalizedName = normalizeName(legacyMember.name);
  let member = tables.members.find((item) => item.company_id === company.id && item.normalized_name === normalizedName && !item.deleted_at);
  if (!member) {
    member = {
      id: crypto.randomUUID(),
      company_id: company.id,
      display_name: legacyMember.name,
      normalized_name: normalizedName,
      stage: legacyToStage[legacyMember.stage] || "build",
      evaluation_status: legacyMember.status && ["S", "A", "B", "F"].includes(legacyMember.status) ? legacyMember.status : "unrated",
      progress_percent: Number(legacyMember.progress || 0),
      client_memo: legacyMember.clientMemo || null,
      internal_memo: null,
      active: true,
      source_ref: { source: "frontend" },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null
    };
    tables.members.push(member);
  }
  return member;
}

function upsertMemberMetric(tables, memberId, metricMonth, salesAmount, followerCount = 0) {
  let metric = tables.member_metrics.find((item) => item.member_id === memberId && item.metric_month === metricMonth);
  if (!metric) {
    metric = {
      member_id: memberId,
      metric_month: metricMonth,
      follower_count: 0,
      sales_amount: 0,
      deals_count: 0,
      source_kind: "manual",
      source_ref: { source: "frontend" },
      updated_by: null,
      updated_at: new Date().toISOString()
    };
    tables.member_metrics.push(metric);
  }
  metric.follower_count = Number(followerCount || 0);
  metric.sales_amount = Number(salesAmount || 0);
  metric.updated_at = new Date().toISOString();
  metric.source_kind = "manual";
}

function replaceMemberAccounts(tables, memberId, links, stage) {
  const existing = tables.member_accounts.filter((account) => account.member_id === memberId);
  const activeSlots = new Set();
  (links || []).slice(0, 2).forEach((url, index) => {
    if (!url) return;
    const slot = index + 1;
    activeSlots.add(slot);
    let account = existing.find((item) => item.slot === slot);
    if (!account) {
      account = {
        id: crypto.randomUUID(),
        member_id: memberId,
        slot,
        created_at: new Date().toISOString()
      };
      tables.member_accounts.push(account);
    }
    account.platform = String(url).includes("tiktok") ? "tiktok" : "other";
    account.handle = String(url).match(/@([^/?#]+)/)?.[0] || null;
    account.url = url;
    account.account_stage = legacyToStage[stage] || "build";
    account.active = true;
    account.source_ref = { source: "frontend", slot };
    account.updated_at = new Date().toISOString();
  });
  existing.forEach((account) => {
    if (activeSlots.has(account.slot)) return;
    account.active = false;
    account.updated_at = new Date().toISOString();
  });
}

function sameSession(session, meeting) {
  const occurredOn = String(meeting.date || "").replaceAll("/", "-");
  return session.occurred_on === occurredOn
    && session.content === meeting.content
    && (session.next_action || "") === (meeting.next || "");
}

function replaceMemberSessions(tables, companyId, memberId, meetings) {
  const existing = tables.coaching_sessions.filter((session) => memberId === session.member_id);
  const usedIds = new Set();
  (meetings || []).forEach((meeting) => {
    if (!meeting.content) return;
    let session = existing.find((item) => !usedIds.has(item.id) && sameSession(item, meeting));
    if (!session) {
      session = {
        id: crypto.randomUUID(),
        company_id: companyId,
        member_id: memberId,
        created_at: new Date().toISOString()
      };
      tables.coaching_sessions.push(session);
    }
    usedIds.add(session.id);
    session.company_id = companyId;
    session.member_id = memberId;
    session.occurred_on = String(meeting.date || new Date().toISOString().slice(0, 10)).replaceAll("/", "-");
    session.session_type = "status_report";
    session.result = legacyToResult[meeting.result] || "continued";
    session.coach_name = meeting.coach || "画面更新";
    session.content = meeting.content;
    session.next_action = meeting.next || null;
    session.visibility = "client";
    session.source_kind = "manual";
    session.source_ref = { source: "frontend" };
    session.created_by = null;
    session.updated_at = new Date().toISOString();
    session.deleted_at = null;
  });
  existing.forEach((session) => {
    if (usedIds.has(session.id)) return;
    session.deleted_at = new Date().toISOString();
    session.updated_at = new Date().toISOString();
  });
}

function upsertMemberMilestones(tables, memberId, legacyMember) {
  Object.entries(legacyMilestoneMap).forEach(([legacyKey, dbKey]) => {
    let milestone = tables.member_milestones.find((item) => item.member_id === memberId && item.milestone_key === dbKey);
    if (!milestone) {
      milestone = {
        member_id: memberId,
        milestone_key: dbKey,
        done: false,
        achieved_at: null,
        updated_by: null,
        updated_at: new Date().toISOString()
      };
      tables.member_milestones.push(milestone);
    }
    const done = Boolean(legacyMember[legacyKey]);
    milestone.done = done;
    milestone.achieved_at = done ? milestone.achieved_at || new Date().toISOString() : null;
    milestone.updated_at = new Date().toISOString();
  });
}

export async function ensureNormalizedDb(root) {
  const dbDir = join(root, "db");
  const normalizedPath = join(dbDir, "normalized-db.json");
  const seedPath = join(dbDir, "production-seed.json");
  await mkdir(dbDir, { recursive: true });
  try {
    await stat(normalizedPath);
  } catch {
    const seed = JSON.parse(await readFile(seedPath, "utf8"));
    await writeFile(normalizedPath, JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: seed.source,
      generatedAt: seed.generated_at,
      tables: seed.tables
    }, null, 2));
  }
}

export async function readNormalizedDb(root) {
  await ensureNormalizedDb(root);
  const db = JSON.parse(await readFile(join(root, "db", "normalized-db.json"), "utf8"));
  const seed = JSON.parse(await readFile(join(root, "db", "production-seed.json"), "utf8"));
  let changed = false;
  Object.entries(seed.tables || {}).forEach(([table, rows]) => {
    if (!Array.isArray(db.tables[table])) {
      db.tables[table] = rows;
      changed = true;
    }
  });
  if (changed) await writeNormalizedDb(root, db);
  return db;
}

export async function writeNormalizedDb(root, db) {
  db.updatedAt = new Date().toISOString();
  await writeFile(join(root, "db", "normalized-db.json"), JSON.stringify(db, null, 2));
}

export function hydrateLegacyCompanies(normalizedDb, months, legacyCompanies = []) {
  const tables = normalizedDb.tables;
  const legacyByCode = new Map(legacyCompanies.map((company) => [company.id, company]));
  const membersByCompany = groupBy(tables.members, "company_id");
  const accountsByMember = groupBy(tables.member_accounts, "member_id");
  const milestonesByMember = groupBy(tables.member_milestones, "member_id");
  const sessionsByMember = groupBy(tables.coaching_sessions, "member_id");
  const latestMetricByMember = latestBy(tables.member_metrics, "member_id", "metric_month");
  const latestSummaryByCompany = latestBy(tables.company_monthly_summaries, "company_id", "summary_month");
  const latestReportByCompany = latestBy(tables.client_reports || [], "company_id", "report_month");

  return tables.companies
    .filter((company) => !company.deleted_at)
    .map((company) => {
      const summary = latestSummaryByCompany.get(company.id);
      const report = latestReportByCompany.get(company.id);
      const legacyCompany = legacyByCode.get(company.code);
      const members = (membersByCompany.get(company.id) || [])
        .filter((member) => !member.deleted_at)
        .map((member) => {
          const metric = latestMetricByMember.get(member.id);
          const milestoneValues = {};
          (milestonesByMember.get(member.id) || []).forEach((milestone) => {
            const legacyKey = reverseMilestoneMap[milestone.milestone_key];
            if (legacyKey) milestoneValues[legacyKey] = Boolean(milestone.done);
          });
          const accountLinks = (accountsByMember.get(member.id) || [])
            .filter((account) => account.active)
            .sort((a, b) => a.slot - b.slot)
            .map((account) => account.url || account.handle)
            .filter(Boolean)
            .slice(0, 2);
          const meetings = (sessionsByMember.get(member.id) || [])
            .filter((session) => !session.deleted_at)
            .sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)))
            .map((session) => ({
              date: toLegacyDate(session.occurred_on),
              coach: session.coach_name || "スプシ記録",
              follower: metric?.follower_count || 0,
              sale: metric?.sales_amount || 0,
              content: session.content,
              next: session.next_action || "",
              result: resultToLegacy[session.result] || session.result,
              source: session.source_ref?.sheet || session.source_kind,
              stage: stageToLegacy[session.source_ref?.stage] || session.source_ref?.stage || stageToLegacy[member.stage]
            }));

          return {
            name: member.display_name,
            status: member.evaluation_status === "unrated" ? "未評価" : member.evaluation_status,
            stage: stageToLegacy[member.stage] || "構築",
            progress: member.progress_percent,
            sales: metric?.sales_amount || 0,
            followerHistory: months.map((_, index) => index === months.length - 1 ? metric?.follower_count || 0 : 0),
            salesHistory: months.map((_, index) => index === months.length - 1 ? metric?.sales_amount || 0 : 0),
            accountLinks,
            clientMemo: member.client_memo || undefined,
            meetings,
            ...milestoneValues
          };
        });

      const currentEnrollment = summary?.enrollment_count ?? members.length;
      const enrollment = Array.isArray(legacyCompany?.enrollment) && legacyCompany.enrollment.length === months.length
        ? [...legacyCompany.enrollment.slice(0, -1), currentEnrollment]
        : months.map(() => currentEnrollment);

      return {
        id: company.code,
        name: company.name,
        sourceFile: company.source_file,
        reportMeta: legacyCompany?.reportMeta || `対象月: ${company.report_month}`,
        newCount: summary?.new_count ?? members.filter((member) => member.stage === "新規").length,
        buildCount: summary?.build_count ?? members.filter((member) => member.stage === "構築").length,
        prCount: summary?.pr_count ?? members.filter((member) => member.stage === "PR").length,
        sales: summary?.total_sales_amount ?? members.reduce((sum, member) => sum + member.sales, 0),
        enrollment,
        progressReport: report ? {
          good: report.progress_good_text || "",
          issue: report.field_issue_text || "",
          action: report.operator_action_text || "",
          request: report.client_request_text || ""
        } : legacyCompany?.progressReport,
        members
      };
    });
}

export function normalizedCompanyDashboard(normalizedDb, companyCodeOrId) {
  const tables = normalizedDb.tables;
  const company = tables.companies.find((item) => item.id === companyCodeOrId || item.code === companyCodeOrId);
  if (!company) return null;
  const latestSummaryByCompany = latestBy(tables.company_monthly_summaries, "company_id", "summary_month");
  const summary = latestSummaryByCompany.get(company.id);
  const members = tables.members.filter((member) => member.company_id === company.id && !member.deleted_at);
  const sessions = tables.coaching_sessions.filter((session) => session.company_id === company.id && !session.deleted_at);
  return { company, summary, memberCount: members.length, sessionCount: sessions.length };
}

export function normalizedMembers(normalizedDb, companyCodeOrId) {
  const tables = normalizedDb.tables;
  const company = tables.companies.find((item) => item.id === companyCodeOrId || item.code === companyCodeOrId);
  if (!company) return null;
  return {
    company,
    members: tables.members.filter((member) => member.company_id === company.id && !member.deleted_at)
  };
}

export function normalizedMemberDetail(normalizedDb, memberId) {
  const tables = normalizedDb.tables;
  const member = tables.members.find((item) => item.id === memberId);
  if (!member || member.deleted_at) return null;
  return {
    member,
    accounts: tables.member_accounts.filter((item) => item.member_id === member.id),
    milestones: tables.member_milestones.filter((item) => item.member_id === member.id),
    metrics: tables.member_metrics.filter((item) => item.member_id === member.id),
    sessions: tables.coaching_sessions.filter((item) => item.member_id === member.id && !item.deleted_at)
  };
}

export function applyLegacyCompaniesToNormalized(normalizedDb, legacyCompanies, actor = "prototype", summary = "frontend save") {
  const tables = normalizedDb.tables;
  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  tables.update_batches.unshift({
    id: batchId,
    company_id: null,
    actor_id: null,
    summary,
    status: "committed",
    created_at: now
  });

  legacyCompanies.forEach((legacyCompany) => {
    const existingCompany = tables.companies.find((item) => item.code === legacyCompany.id);
    const beforeSnapshot = existingCompany ? snapshotCompanyTables(tables, existingCompany.id) : null;
    const company = findOrCreateCompany(tables, legacyCompany);
    const reportMonth = company.report_month;
    company.name = legacyCompany.name;
    company.source_file = legacyCompany.sourceFile || company.source_file;
    company.updated_at = now;

    const activeMemberIds = new Set();
    (legacyCompany.members || []).forEach((legacyMember) => {
      const member = findOrCreateMember(tables, company, legacyMember);
      activeMemberIds.add(member.id);
      member.display_name = legacyMember.name;
      member.stage = legacyToStage[legacyMember.stage] || "build";
      member.evaluation_status = legacyMember.status && ["S", "A", "B", "F"].includes(legacyMember.status) ? legacyMember.status : "unrated";
      member.progress_percent = Number(legacyMember.progress || 0);
      member.client_memo = legacyMember.clientMemo || null;
      member.active = true;
      member.updated_at = now;
      member.deleted_at = null;

      const latestSales = Array.isArray(legacyMember.salesHistory) && legacyMember.salesHistory.length
        ? legacyMember.salesHistory.at(-1)
        : legacyMember.sales;
      const latestFollowers = Array.isArray(legacyMember.followerHistory) && legacyMember.followerHistory.length
        ? legacyMember.followerHistory.at(-1)
        : 0;

      replaceMemberAccounts(tables, member.id, legacyMember.accountLinks, legacyMember.stage);
      upsertMemberMilestones(tables, member.id, legacyMember);
      upsertMemberMetric(tables, member.id, reportMonth, latestSales, latestFollowers);
      replaceMemberSessions(tables, company.id, member.id, legacyMember.meetings);
    });

    tables.members.forEach((member) => {
      if (member.company_id === company.id && !activeMemberIds.has(member.id)) {
        member.active = false;
        member.deleted_at = now;
      }
    });

    let summaryRow = latestSummaryForCompany(tables, company.id);
    if (!summaryRow) {
      summaryRow = {
        company_id: company.id,
        summary_month: reportMonth,
        enrollment_count: 0,
        new_count: 0,
        build_count: 0,
        pr_count: 0,
        avg_progress_percent: 0,
        total_sales_amount: 0,
        risk_member_count: 0,
        source_kind: "manual",
        source_ref: {},
        calculated_at: now
      };
      tables.company_monthly_summaries.push(summaryRow);
    }
    const activeMembers = tables.members.filter((member) => member.company_id === company.id && !member.deleted_at);
    summaryRow.enrollment_count = legacyCompany.enrollment?.[legacyCompany.enrollment.length - 1] ?? activeMembers.length;
    summaryRow.new_count = Number(legacyCompany.newCount || 0);
    summaryRow.build_count = Number(legacyCompany.buildCount || 0);
    summaryRow.pr_count = Number(legacyCompany.prCount || 0);
    summaryRow.avg_progress_percent = activeMembers.length
      ? Number((activeMembers.reduce((sum, member) => sum + Number(member.progress_percent || 0), 0) / activeMembers.length).toFixed(2))
      : 0;
    summaryRow.total_sales_amount = Number(legacyCompany.sales || 0);
    summaryRow.risk_member_count = activeMembers.filter((member) => member.evaluation_status === "F").length;
    summaryRow.source_kind = "manual";
    summaryRow.source_ref = { source: "frontend", actor };
    summaryRow.calculated_at = now;

    if (legacyCompany.progressReport) {
      let reportRow = latestReportForCompany(tables, company.id);
      if (!reportRow || reportRow.report_month !== reportMonth) {
        reportRow = {
          id: crypto.randomUUID(),
          company_id: company.id,
          report_month: reportMonth,
          executive_summary: null,
          focus_points: [],
          wins: [],
          risks: [],
          requests_to_client: [],
          source_kind: "manual",
          source_ref: {},
          status: "published",
          published_at: now,
          confirmed_at: null,
          created_by: null,
          updated_by: null,
          created_at: now,
          updated_at: now
        };
        tables.client_reports = tables.client_reports || [];
        tables.client_reports.push(reportRow);
      }
      reportRow.progress_good_text = legacyCompany.progressReport.good || "";
      reportRow.field_issue_text = legacyCompany.progressReport.issue || "";
      reportRow.operator_action_text = legacyCompany.progressReport.action || "";
      reportRow.client_request_text = legacyCompany.progressReport.request || "";
      reportRow.source_kind = "manual";
      reportRow.source_ref = { source: "frontend", actor };
      reportRow.status = "published";
      reportRow.published_at = reportRow.published_at || now;
      reportRow.updated_at = now;
    }

    tables.audit_logs.unshift({
      id: crypto.randomUUID(),
      batch_id: batchId,
      actor_id: null,
      company_id: company.id,
      target_type: "company",
      target_id: company.id,
      action: "update",
      before_json: beforeSnapshot,
      after_json: {
        source: "frontend",
        actor,
        summary,
        members: activeMembers.length,
        sales: summaryRow.total_sales_amount,
        snapshot: snapshotCompanyTables(tables, company.id)
      },
      created_at: now
    });
  });

  return normalizedDb;
}
