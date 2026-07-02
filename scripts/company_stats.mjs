#!/usr/bin/env node
// 実績集計エンジン
// data.js(スプシ正本から生成される全社データ)を読み、営業資料・月次報告・週次QAで
// 使い回せるKPIサマリーを出力する。読み取り専用で、DBにもファイルにも書き込まない。
//
// 使い方:
//   node scripts/company_stats.mjs                  # 全社サマリー(Markdown)
//   node scripts/company_stats.mjs --format json    # 全社サマリー(JSON)
//   node scripts/company_stats.mjs --company bl     # 1社の詳細(Markdown)
//   node scripts/company_stats.mjs --data path.js   # data.jsのパス指定(既定: ./data.js)

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MILESTONES = [
  ["orient", "オリエン"],
  ["firstMtg", "初回MTG"],
  ["account", "アカウント開設"],
  ["firstPost", "初投稿"],
  ["f100", "フォロワー100"],
  ["f300", "フォロワー300"],
  ["f500", "フォロワー500"],
  ["f700", "フォロワー700"],
  ["f1000", "フォロワー1000"],
  ["prMtg", "PR移行MTG"],
  ["product", "商品決定"],
  ["month1", "月商1万"],
  ["month10", "月商10万"],
  ["month30", "月商30万"],
  ["month100", "月商100万"]
];

function parseArgs(argv) {
  const args = { format: "md", company: "", data: "data.js" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--format") args.format = argv[++i] || "md";
    else if (arg === "--company") args.company = (argv[++i] || "").toLowerCase();
    else if (arg === "--data") args.data = argv[++i] || "data.js";
    else if (arg === "--help" || arg === "-h") args.help = true;
    else {
      console.error(`不明な引数: ${arg} (--help で使い方を表示)`);
      process.exit(1);
    }
  }
  return args;
}

async function loadData(dataPath) {
  let text;
  try {
    text = await fs.readFile(dataPath, "utf8");
  } catch (error) {
    throw new Error(`${dataPath} を読み込めません: ${error.message}`);
  }
  const match = text.match(/window\.RESKILLING_DATA\s*=\s*(\{[\s\S]*\});\s*$/);
  if (!match) throw new Error(`${dataPath} を解析できません(window.RESKILLING_DATA が見つからない)`);
  const data = JSON.parse(match[1]);
  if (!Array.isArray(data.companies)) throw new Error("companies 配列がありません");
  return data;
}

function memberNeedsFollow(member) {
  return member.status === "F" || Number(member.progress || 0) < 35;
}

function pendingMeetingActions(member) {
  return (member.meetings || []).filter((meeting) => meeting?.result === "要対応");
}

function summarizeMembers(members) {
  const list = Array.isArray(members) ? members : [];
  const stages = {};
  const statuses = {};
  const milestones = {};
  let progressSum = 0;
  let memberSales = 0;
  const followUps = [];
  const pendingActions = [];
  for (const member of list) {
    stages[member.stage || "不明"] = (stages[member.stage || "不明"] || 0) + 1;
    statuses[member.status || "不明"] = (statuses[member.status || "不明"] || 0) + 1;
    progressSum += Number(member.progress || 0);
    memberSales += Number(member.sales || 0);
    for (const [key] of MILESTONES) {
      if (member[key]) milestones[key] = (milestones[key] || 0) + 1;
    }
    if (memberNeedsFollow(member)) {
      followUps.push({ name: member.name, status: member.status, stage: member.stage, progress: Number(member.progress || 0) });
    }
    for (const meeting of pendingMeetingActions(member)) {
      pendingActions.push({ name: member.name, date: meeting.date || "", content: (meeting.content || "").slice(0, 120) });
    }
  }
  return {
    total: list.length,
    stages,
    statuses,
    milestones,
    avgProgress: list.length ? Math.round(progressSum / list.length) : 0,
    memberSales,
    followUps,
    pendingActions
  };
}

function summarizeCompany(company) {
  const summary = summarizeMembers(company.members);
  const enrollment = Array.isArray(company.enrollment) ? company.enrollment : [];
  return {
    id: company.id,
    name: company.name,
    reportMeta: company.reportMeta || "",
    sales: Number(company.sales || 0),
    latestEnrollment: enrollment.length ? Number(enrollment[enrollment.length - 1] || 0) : summary.total,
    ...summary
  };
}

function overall(data) {
  const companies = data.companies.map(summarizeCompany);
  const totals = {
    generatedAt: data.generatedAt || "",
    companies: companies.length,
    members: companies.reduce((sum, c) => sum + c.total, 0),
    sales: companies.reduce((sum, c) => sum + c.sales, 0),
    followUps: companies.reduce((sum, c) => sum + c.followUps.length, 0),
    pendingActions: companies.reduce((sum, c) => sum + c.pendingActions.length, 0),
    stages: {},
    milestones: {}
  };
  for (const company of companies) {
    for (const [stage, count] of Object.entries(company.stages)) {
      totals.stages[stage] = (totals.stages[stage] || 0) + count;
    }
    for (const [key, count] of Object.entries(company.milestones)) {
      totals.milestones[key] = (totals.milestones[key] || 0) + count;
    }
  }
  return { totals, companies };
}

function yen(value) {
  return `${Number(value || 0).toLocaleString("ja-JP")}円`;
}

function milestoneLabel(key) {
  const found = MILESTONES.find(([k]) => k === key);
  return found ? found[1] : key;
}

function renderOverallMarkdown({ totals, companies }) {
  const lines = [];
  lines.push(`# Next Ramp 全社実績サマリー`);
  lines.push("");
  lines.push(`データ生成日: ${totals.generatedAt || "不明"} / 集計対象: ${totals.companies}社 ${totals.members}名`);
  lines.push("");
  lines.push(`## ハイライト(営業資料向け)`);
  lines.push("");
  lines.push(`- 導入企業: ${totals.companies}社 / 受講生: ${totals.members}名`);
  lines.push(`- 受講生売上合計: ${yen(totals.sales)}`);
  const f1000 = totals.milestones.f1000 || 0;
  const monthAny = (totals.milestones.month1 || 0);
  lines.push(`- フォロワー1000達成: ${f1000}名 / 月商1万円以上達成: ${monthAny}名`);
  lines.push(`- ステージ分布: ${Object.entries(totals.stages).map(([k, v]) => `${k} ${v}名`).join(" / ") || "なし"}`);
  lines.push("");
  lines.push(`## マイルストーン到達人数(全社)`);
  lines.push("");
  lines.push(`| マイルストーン | 到達人数 |`);
  lines.push(`| --- | ---: |`);
  for (const [key, label] of MILESTONES) {
    lines.push(`| ${label} | ${totals.milestones[key] || 0} |`);
  }
  lines.push("");
  lines.push(`## 会社別サマリー`);
  lines.push("");
  lines.push(`| 会社 | 受講生 | 平均進捗 | 売上 | 要フォロー | 要対応MTG |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: |`);
  const sorted = [...companies].sort((a, b) => b.sales - a.sales || b.total - a.total);
  for (const company of sorted) {
    lines.push(`| ${company.name} (${company.id}) | ${company.total} | ${company.avgProgress}% | ${yen(company.sales)} | ${company.followUps.length} | ${company.pendingActions.length} |`);
  }
  lines.push("");
  lines.push(`## 全社の要対応事項`);
  lines.push("");
  if (totals.pendingActions === 0) {
    lines.push(`- 要対応MTGはありません。`);
  } else {
    for (const company of sorted) {
      for (const action of company.pendingActions) {
        lines.push(`- [${company.name}] ${action.name} (${action.date}): ${action.content}`);
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderCompanyMarkdown(company) {
  const lines = [];
  lines.push(`# ${company.name} 実績詳細`);
  lines.push("");
  lines.push(`${company.reportMeta || ""}`.trim());
  lines.push("");
  lines.push(`- 受講生: ${company.total}名(最新月の報告在籍: ${company.latestEnrollment}名)`);
  lines.push(`- 平均進捗: ${company.avgProgress}%`);
  lines.push(`- 会社売上: ${yen(company.sales)} / 受講生売上合計: ${yen(company.memberSales)}`);
  lines.push(`- ステージ: ${Object.entries(company.stages).map(([k, v]) => `${k} ${v}名`).join(" / ") || "なし"}`);
  lines.push(`- 評価: ${Object.entries(company.statuses).map(([k, v]) => `${k} ${v}名`).join(" / ") || "なし"}`);
  lines.push("");
  lines.push(`## マイルストーン到達`);
  lines.push("");
  lines.push(`| マイルストーン | 到達人数 |`);
  lines.push(`| --- | ---: |`);
  for (const [key, label] of MILESTONES) {
    lines.push(`| ${label} | ${company.milestones[key] || 0} |`);
  }
  lines.push("");
  lines.push(`## 要フォロー受講生(評価F または 進捗35%未満)`);
  lines.push("");
  if (!company.followUps.length) {
    lines.push(`- なし`);
  } else {
    for (const member of company.followUps) {
      lines.push(`- ${member.name}: ${member.stage} / 評価${member.status} / 進捗${member.progress}%`);
    }
  }
  lines.push("");
  lines.push(`## 要対応MTG`);
  lines.push("");
  if (!company.pendingActions.length) {
    lines.push(`- なし`);
  } else {
    for (const action of company.pendingActions) {
      lines.push(`- ${action.name} (${action.date}): ${action.content}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("使い方: node scripts/company_stats.mjs [--format md|json] [--company <id>] [--data <path>]");
    return;
  }
  const data = await loadData(path.resolve(args.data));
  const result = overall(data);

  if (args.company) {
    const company = result.companies.find((c) => (c.id || "").toLowerCase() === args.company);
    if (!company) {
      const ids = result.companies.map((c) => c.id).join(", ");
      throw new Error(`会社ID "${args.company}" が見つかりません。有効なID: ${ids}`);
    }
    console.log(args.format === "json" ? JSON.stringify(company, null, 2) : renderCompanyMarkdown(company));
    return;
  }
  console.log(args.format === "json" ? JSON.stringify(result, null, 2) : renderOverallMarkdown(result));
}

main().catch((error) => {
  console.error(`エラー: ${error.message}`);
  process.exit(1);
});
