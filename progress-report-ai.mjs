import OpenAI from "openai";

// クライアント向け「今月の進捗」の下書きを生成する。
// 運営が生成ボタンを押したタイミングでのみ実行され、講師が確認・編集してから保存する。
//
// 方針:
// - 数値はすべてこのファイルで確定させ、モデルには計算させない。
// - システムに存在しない指標は「未計測」として明示し、推測で埋めさせない。

const MILESTONES = [
  ["daily", "毎日投稿"], ["qa", "Q&A"], ["mtg", "MTG"],
  ["orient", "オリエン"], ["firstMtg", "初回MTG"], ["account", "アカウント作成"], ["firstPost", "初回投稿"],
  ["f100", "フォロワー100人"], ["f300", "フォロワー300人"], ["f500", "フォロワー500人"],
  ["f700", "フォロワー700人"], ["f1000", "フォロワー1000人"],
  ["prMtg", "PR初回MTG"], ["product", "商品申請"], ["prCarousel", "PRカルーセル"],
  ["prVideo", "PR動画"], ["prTts", "PR TTS"], ["sparkAds", "スパークアズ対象"], ["sakura", "サクラ連携"],
  ["month1", "月1件獲得"], ["month10", "月10件獲得"], ["month30", "月30件獲得"], ["month100", "月100件獲得"]
];

// システムに記録が無く、推測してはいけない指標
const UNMEASURED = [
  "月間売上目標", "進捗率", "目標に対する不足額",
  "投稿本数", "案件提案数", "商談数", "問い合わせ数", "成約数",
  "講師本人の売上と研修生の売上の区分"
];

function monthNumberFromLabel(label, fallbackIndex = 0) {
  const match = String(label ?? "").match(/(\d{1,2})/);
  const value = match ? Number(match[1]) : NaN;
  return value >= 1 && value <= 12 ? value : fallbackIndex + 1;
}

function currentMonthIndexFor(months, date = new Date()) {
  const target = date.getMonth() + 1;
  let fallback = -1;
  for (let index = 0; index < months.length; index += 1) {
    const number = monthNumberFromLabel(months[index], index);
    if (number === target) return index;
    if (number < target) fallback = index;
  }
  return fallback >= 0 ? fallback : 0;
}

function historyValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function recordedIndexAtOrBefore(values, index) {
  const list = Array.isArray(values) ? values : [];
  for (let i = Math.min(index, list.length - 1); i >= 0; i -= 1) {
    if (historyValue(list[i]) !== null) return i;
  }
  return -1;
}

function parseMeetingDate(value) {
  const parsed = new Date(String(value || "").replaceAll("/", "-"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// 未達の原因を1人1分類で振り分ける（合計が未達人数に一致するようにする）
function classifyBlockedMember(member, today) {
  const latest = member.latestMeetingDate;
  const daysSinceMeeting = latest ? Math.floor((today - latest) / 86400000) : null;
  const posting = member.milestones.daily;

  // 初回投稿すら無い人はまず未稼働。連絡状況より手前の問題として扱う
  if (!member.milestones.firstPost) return { key: "未稼働", reason: "初回投稿が未完了" };
  // 連絡が取れず、かつ投稿も止まっている人だけを連絡停止とする
  if (!posting && member.meetingCount === 0) return { key: "連絡停止", reason: "MTG記録がなく投稿も停止" };
  if (!posting && daysSinceMeeting !== null && daysSinceMeeting >= 45) {
    return { key: "連絡停止", reason: `直近MTGから${daysSinceMeeting}日経過し投稿も停止` };
  }
  if (!posting) return { key: "投稿不足", reason: "初回投稿済みだが毎日投稿が未達" };
  if (!member.milestones.f100) return { key: "CR不足", reason: "投稿は継続しているがフォロワー100人未達" };
  return { key: "案件不足", reason: "フォロワーは伸びているが売上が未発生" };
}

export function buildCompanyFacts(company, months, date = new Date()) {
  const monthIndex = currentMonthIndexFor(months, date);
  const monthLabel = months[monthIndex] || `${date.getMonth() + 1}月`;
  const previousLabel = monthIndex > 0 ? months[monthIndex - 1] : null;
  const members = Array.isArray(company.members) ? company.members : [];

  const memberFacts = members.map((member) => {
    const sales = Array.isArray(member.salesHistory) ? member.salesHistory : [];
    const ttoSales = Array.isArray(member.ttoSalesHistory) ? member.ttoSalesHistory : [];
    const ttsSales = Array.isArray(member.ttsSalesHistory) ? member.ttsSalesHistory : [];
    const followers = Array.isArray(member.followerHistory) ? member.followerHistory : [];
    const salesIndex = recordedIndexAtOrBefore(sales, monthIndex);
    const followerIndex = recordedIndexAtOrBefore(followers, monthIndex);
    const prevSalesIndex = salesIndex > 0 ? recordedIndexAtOrBefore(sales, salesIndex - 1) : -1;
    const prevFollowerIndex = followerIndex > 0 ? recordedIndexAtOrBefore(followers, followerIndex - 1) : -1;
    const milestones = Object.fromEntries(MILESTONES.map(([key]) => [key, member[key] === true]));
    const meetings = (member.meetings || []);
    const meetingDates = meetings.map((m) => parseMeetingDate(m.date)).filter(Boolean).sort((a, b) => b - a);
    return {
      name: member.name,
      stage: member.stage,
      evaluation: member.status,
      progressPercent: Number(member.progress || 0),
      currentSales: salesIndex >= 0 ? Number(sales[salesIndex] || 0) : 0,
      previousSales: prevSalesIndex >= 0 ? Number(sales[prevSalesIndex] || 0) : null,
      // 内訳は未入力なら null（0 と区別して「未計測」扱い）
      currentTto: salesIndex >= 0 ? historyValue(ttoSales[salesIndex]) : null,
      currentTts: salesIndex >= 0 ? historyValue(ttsSales[salesIndex]) : null,
      currentFollowers: followerIndex >= 0 ? Number(followers[followerIndex] || 0) : null,
      previousFollowers: prevFollowerIndex >= 0 ? Number(followers[prevFollowerIndex] || 0) : null,
      milestones,
      missingItems: MILESTONES.filter(([key]) => !milestones[key]).map(([, label]) => label),
      meetingCount: meetings.length,
      latestMeetingDate: meetingDates[0] || null,
      latestMeeting: meetings[0] ? {
        date: meetings[0].date,
        coach: meetings[0].coach || null,
        content: meetings[0].content || null,
        nextAction: meetings[0].next || null,
        result: meetings[0].result || null
      } : null,
      accountCount: (member.accountLinks || []).filter(Boolean).length
    };
  });

  const totalSales = memberFacts.reduce((sum, m) => sum + m.currentSales, 0);
  const previousTotalSales = memberFacts.reduce((sum, m) => sum + Number(m.previousSales || 0), 0);
  const sumOrNull = (key) => memberFacts.reduce((sum, m) => (m[key] === null ? sum : (sum || 0) + m[key]), null);
  const totalTto = sumOrNull("currentTto");
  const totalTts = sumOrNull("currentTts");
  const breakdownEnteredCount = memberFacts.filter((m) => m.currentTto !== null || m.currentTts !== null).length;
  const earners = memberFacts.filter((m) => m.currentSales > 0).sort((a, b) => b.currentSales - a.currentSales);
  const blocked = memberFacts.filter((m) => m.currentSales <= 0);

  // 月末着地見込（当月の経過日数からの日割り換算。目標が無いため達成率は出さない）
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const elapsedDays = date.getDate();
  const projectedMonthEndSales = elapsedDays > 0 ? Math.round((totalSales / elapsedDays) * daysInMonth) : totalSales;

  const causeOrder = ["未稼働", "投稿不足", "CR不足", "案件不足", "連絡停止"];
  const causes = Object.fromEntries(causeOrder.map((key) => [key, []]));
  blocked.forEach((member) => {
    const { key, reason } = classifyBlockedMember(member, date);
    causes[key].push({ name: member.name, stage: member.stage, evaluation: member.evaluation, reason });
  });

  const coachCounts = new Map();
  memberFacts.forEach((m) => {
    const coach = m.latestMeeting?.coach;
    if (coach) coachCounts.set(coach, (coachCounts.get(coach) || 0) + 1);
  });

  const topShare = (n) => {
    if (!totalSales) return null;
    const top = earners.slice(0, n).reduce((sum, m) => sum + m.currentSales, 0);
    return Math.round((top / totalSales) * 1000) / 10;
  };

  return {
    companyName: company.name,
    today: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
    monthLabel,
    previousMonthLabel: previousLabel,
    daysRemainingInMonth: daysInMonth - elapsedDays,

    enrollment: memberFacts.length,
    phaseBreakdown: {
      新規: memberFacts.filter((m) => m.stage === "新規").length,
      構築: memberFacts.filter((m) => m.stage === "構築").length,
      PR: memberFacts.filter((m) => m.stage === "PR").length
    },
    averageProgressPercent: memberFacts.length
      ? Math.round(memberFacts.reduce((sum, m) => sum + m.progressPercent, 0) / memberFacts.length) : 0,

    sales: {
      current: totalSales,
      tto: totalTto,
      tts: totalTts,
      breakdownEnteredCount,
      previousReport: previousTotalSales,
      increase: totalSales - previousTotalSales,
      projectedMonthEnd: projectedMonthEndSales,
      earnerCount: earners.length,
      averagePerEarner: earners.length ? Math.round(totalSales / earners.length) : 0,
      topOneSharePercent: topShare(1),
      topThreeSharePercent: topShare(3),
      topEarners: earners.slice(0, 5).map((m) => ({ name: m.name, sales: m.currentSales }))
    },

    kpi: {
      稼働人数: memberFacts.filter((m) => m.milestones.daily).length,
      投稿開始人数: memberFacts.filter((m) => m.milestones.firstPost).length,
      商品申請済み人数: memberFacts.filter((m) => m.milestones.product).length,
      月1件獲得達成人数: memberFacts.filter((m) => m.milestones.month1).length,
      フォロワー1000人達成人数: memberFacts.filter((m) => m.milestones.f1000).length,
      要確認人数: memberFacts.filter((m) => m.evaluation === "F" || m.progressPercent < 35).length,
      F評価人数: memberFacts.filter((m) => m.evaluation === "F").length,
      MTG実施件数: memberFacts.reduce((sum, m) => sum + m.meetingCount, 0),
      アカウント未登録人数: memberFacts.filter((m) => m.accountCount === 0).length
    },

    causes: causeOrder.map((key) => ({ key, count: causes[key].length, members: causes[key] })),
    coaches: [...coachCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    unmeasured: UNMEASURED,
    // 同じ画面に既に出ている数字。報告で繰り返すと重複になる
    dashboardVisible: [
      `在籍数 ${memberFacts.length}名`,
      `当月売上 ${totalSales.toLocaleString("ja-JP")}円`,
      `平均進捗率 ${memberFacts.length ? Math.round(memberFacts.reduce((s, m) => s + m.progressPercent, 0) / memberFacts.length) : 0}%`,
      `要確認人数 ${memberFacts.filter((m) => m.evaluation === "F" || m.progressPercent < 35).length}名`,
      `PR人数 ${memberFacts.filter((m) => m.stage === "PR").length}名 / 構築人数 ${memberFacts.filter((m) => m.stage === "構築").length}名`,
      `フォロワー1000人達成 ${memberFacts.filter((m) => m.milestones.f1000).length}名`,
      `評価分布（S/A/B/F の人数と割合）`,
      `売上上位5名の氏名と金額`,
      `在籍受講生の月別推移`
    ],
    members: memberFacts
  };
}

const SECTIONS = [
  ["numbers", "数値", "前回報告時からの増減と月末着地見込に絞る。現在売上・在籍数・平均進捗・要確認人数は同じ画面に表示済みのため書かない。月間目標が未計測のため進捗率と不足額は「未計測」と明記する"],
  ["salesBreakdown", "売上内訳", "TTO売上とTTS売上の金額と構成比（内訳が未計測ならその旨と入力済み人数）、売上発生人数・売上発生者1人あたり平均・上位への集中率と、そこから読み取れるリスクを書く。上位者の氏名と金額は同じ画面に一覧があるため列挙しない。講師本人と研修生の区分は未計測と明記する"],
  ["kpi", "主要KPI", "画面に出ていないKPIだけを書く（稼働人数・投稿開始人数・商品申請済み人数・MTG実施件数・アカウント未登録人数）。在籍数・PR人数・評価分布・平均進捗・要確認人数は画面に表示済みのため書かない。投稿本数/案件提案数/商談数/成約数は未計測と明記する"],
  ["rootCause", "未達原因", "未稼働・投稿不足・CR不足・案件不足・連絡停止それぞれの人数と、代表的な該当者名・根拠を記載する。感想は書かない"],
  ["actions", "今週の改善施策", "対象者・担当者・実施内容・実施期限・完了条件・改善するKPI・見込売上を必ずセットで、2〜3件記載する"],
  ["decisions", "経営判断が必要なこと", "追加人員・施策変更・顧客確認・対象者の継続判断など、現場だけでは決められないことを具体的に記載する。無い場合はその旨を書く"],
  ["nextReport", "次回報告", "次回報告日と、その時点で確認する数値を具体的に記載する"]
];

const REPORT_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(SECTIONS.map(([key, label, desc]) => [key, { type: "string", description: `${label}: ${desc}` }])),
  required: SECTIONS.map(([key]) => key),
  additionalProperties: false
};

const SYSTEM_PROMPT = `あなたは法人向けSNS運用研修サービスの運営責任者として、クライアント企業へ提出する進捗報告を書きます。

読み手はクライアント企業の担当者です。「この運営に任せておけば数字が動く」と判断できる報告にしてください。

## 絶対に守ること

1. 与えられた数字だけを使う。数字を推測・創作・再計算しない。
2. 「未計測」と指定された指標は、必ず「未計測」と明記する。数字をでっち上げない。存在しない目標や達成率を書かない。
3. 「頑張ってフォローする」「引き続き支援する」「必要に応じて実施する」のような、実行されたか判定できない文は禁止。
4. 改善施策は、以下を必ず全て含める。1つでも欠けたら失格。
   - 対象者（実名。人数だけで済ませない）
   - 担当者（データにある担当者名。不明な場合は「担当者未定（要割当）」と書く）
   - 実施内容（具体的な行動）
   - 実施期限（「今月中」ではなく「7月24日18:00まで」のように日時で書く）
   - 完了条件（何が起きたら完了か。MTGの実施自体を完了条件にしない。投稿再開・案件提案・成約など次の行動が確定した時点を完了とする）
   - 改善するKPI（どの数値がどこまで動くか）
   - 見込売上（金額。根拠として1人あたり平均売上×対象人数などの計算を添える）
5. 未達原因は、感想ではなく原因別の人数と根拠で書く。
6. 目標達成が難しい場合、達成できるように見せない。現実的な着地見込・不足の事実・必要な追加施策を明確に書く。
7. 受講生を否定する表現は使わない。事実を書く。
8. 社内用語は使わない。「要対応」→「要確認」、「停滞」→「進行確認」、「F評価」→「確認優先」と言い換える。
9. 敬体（です・ます）で書く。箇条書きの記号（・や-）は使ってよいが、見出しは付けない（見出しは画面側で付く）。
10. 各項目は事実の密度を優先し、冗長な前置きを書かない。
11. この報告は、同じ画面のグラフやサマリーの下に並んで表示されます。
    「画面に表示済みの数字」として渡された値は、読み手がすぐ上で見ているため繰り返さない。
    それらに触れる必要があるときは数字を再掲せず、「在籍数に対して」のように文脈として使うか、
    画面では分からない差分・比率・原因とセットにして初めて挙げる。
    報告の価値は、画面を見ても分からないこと（前月からの変化、集中リスク、未達の原因、次の打ち手）に置く。

## 施策に必ず含める7点

誰に / 誰が / いつまでに / 何を行い / どの数値を / どこまで改善し / 売上いくらを見込むのか。
この7点が揃っていない施策は書き直してください。

## 悪い例と良い例

悪い: 「確認優先の受講生を中心に個別フォローを行います。」
良い: 「確認優先の12名を、未稼働4名・投稿不足5名・連絡停止3名に分類済みです。担当の佐藤が7月28日18:00までに未稼働4名（山田太郎、鈴木花子、田中一郎、高橋健）へ接触し、投稿再開2名・案件提案1件を完了条件とします。改善KPIは稼働人数（現在18名→20名）、見込売上は1人あたり平均売上62,000円×2名=124,000円です。」

悪い: 「CR改善を中心にフィードバックを行い、売上につなげます。」
良い: 「売上未発生かつ投稿を継続している8名を対象に、直近3投稿のCR・訴求・CTAを確認します。担当は佐藤、期限は7月23日18:00です。改善案を1名につき最低2案提示し、7月24日までに改善投稿を公開します。改善後は再生数・保存率・問い合わせ数・案件提案数を比較し、見込売上は1人あたり平均売上62,000円×2名=124,000円と判定します。」

悪い: 「必要に応じてMTGを実施します。」
良い: 「月内に成果化する可能性が高い上位3名と、停止リスクが高い4名をMTG対象とします。担当者・実施日・確認項目・MTG後のアクションを事前に決めます。MTGの実施自体は成果とせず、投稿再開・案件提案・成約などの次の行動が確定した時点を完了とします。完了目標は7月26日18:00、見込売上は124,000円です。」`;

function yen(value) {
  return `${Number(value || 0).toLocaleString("ja-JP")}円`;
}

// 依頼文の大きさの段階。bot議事録をそのまま貼り付けたMTGは1件で数百〜千文字を超えるため、
// 受講生一覧には要点だけを載せる。大きい会社は段階を下げて、AIの1分あたりの上限に収める。
export const PROMPT_LEVELS = [
  { mtgChars: 140, nextChars: 70, missing: 5 },
  { mtgChars: 80, nextChars: 40, missing: 4 },
  { mtgChars: 40, nextChars: 0, missing: 3 },
  { mtgChars: 0, nextChars: 0, missing: 2 }
];
// 日本語は概ね1文字≒0.8トークン。システム指示と合わせて約1.4万トークン以内に収める
const PROMPT_CHAR_BUDGET = 16000;

// MTG記録の要点。議事録形式（【研修状況】など）は、状況→課題→議題の順に箇条書きを1行へまとめる
export function meetingExcerpt(text, limit) {
  const raw = String(text || "").trim();
  if (!raw || limit <= 0) return "";
  const sections = [...raw.matchAll(/【([^】]+)】([^【]*)/g)].map(([, label, body]) => [label.trim(), body]);
  const order = ["研修状況", "現状の課題", "主な議題", "ネクストアクション", "改善策・施策"];
  const rank = (label) => {
    const index = order.indexOf(label);
    return index < 0 ? order.length : index;
  };
  const flatten = (body) => body.split(/\n+/).map((line) => line.replace(/^[\s・\-*●]+/, "").trim()).filter(Boolean).join("／");
  const joined = sections.length
    ? sections
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([label, body]) => `${label.replace("現状の", "")}: ${flatten(body)}`)
      .join(" ")
    : raw.replace(/\s+/g, " ");
  return joined.length > limit ? `${joined.slice(0, limit)}…` : joined;
}

export function factsToPrompt(facts, level = PROMPT_LEVELS[0]) {
  const memberLines = facts.members.map((m) => {
    const bits = [`${m.name}（${m.stage}/評価${m.evaluation}/進捗${m.progressPercent}%）`];
    bits.push(`当月売上${yen(m.currentSales)}`);
    if (m.currentTto !== null || m.currentTts !== null) {
      bits.push(`内訳 TTO${m.currentTto === null ? "未計測" : yen(m.currentTto)}/TTS${m.currentTts === null ? "未計測" : yen(m.currentTts)}`);
    }
    if (m.previousSales !== null) bits.push(`前月売上${yen(m.previousSales)}`);
    bits.push(m.currentFollowers !== null ? `フォロワー${m.currentFollowers.toLocaleString("ja-JP")}人` : "フォロワー未登録");
    bits.push(`MTG${m.meetingCount}件`);
    if (m.latestMeeting) {
      const content = meetingExcerpt(m.latestMeeting.content, level.mtgChars);
      const next = meetingExcerpt(m.latestMeeting.nextAction, level.nextChars);
      bits.push(`直近MTG ${m.latestMeeting.date}（担当:${m.latestMeeting.coach || "不明"}）`
        + (content ? ` 要点:${content}` : "")
        + (level.nextChars > 0 ? ` 次アクション:${next || "未設定"}` : ""));
    }
    bits.push(`未達:${m.missingItems.slice(0, level.missing).join("、") || "なし"}`);
    return `- ${bits.join(" / ")}`;
  }).join("\n");

  const causeLines = facts.causes.map((c) =>
    `- ${c.key}: ${c.count}名${c.members.length ? `（${c.members.slice(0, 8).map((m) => `${m.name}:${m.reason}`).join(" / ")}${c.members.length > 8 ? " ほか" : ""}）` : ""}`
  ).join("\n");

  return `# 基本情報
本日: ${facts.today}（当月残り${facts.daysRemainingInMonth}日）
会社名: ${facts.companyName}
対象月: ${facts.monthLabel}${facts.previousMonthLabel ? `（前回報告: ${facts.previousMonthLabel}）` : ""}
在籍: ${facts.enrollment}名（新規${facts.phaseBreakdown.新規}名 / 構築${facts.phaseBreakdown.構築}名 / PR${facts.phaseBreakdown.PR}名）
平均進捗率: ${facts.averageProgressPercent}%

# 売上
現在売上: ${yen(facts.sales.current)}
TTO売上: ${facts.sales.tto === null ? "未計測（内訳未入力）" : yen(facts.sales.tto)}
TTS売上: ${facts.sales.tts === null ? "未計測（内訳未入力）" : yen(facts.sales.tts)}
内訳を入力済みの受講生: ${facts.sales.breakdownEnteredCount}名 / ${facts.enrollment}名
前回報告時の売上: ${yen(facts.sales.previousReport)}
増加額: ${facts.sales.increase >= 0 ? "+" : ""}${yen(facts.sales.increase)}
月末着地見込（当月ペースの日割り換算）: ${yen(facts.sales.projectedMonthEnd)}
売上発生人数: ${facts.sales.earnerCount}名
売上発生者1人あたり平均: ${yen(facts.sales.averagePerEarner)}
上位1名への集中率: ${facts.sales.topOneSharePercent === null ? "算出不可（売上0）" : `${facts.sales.topOneSharePercent}%`}
上位3名への集中率: ${facts.sales.topThreeSharePercent === null ? "算出不可（売上0）" : `${facts.sales.topThreeSharePercent}%`}
上位者: ${facts.sales.topEarners.length ? facts.sales.topEarners.map((m) => `${m.name} ${yen(m.sales)}`).join(" / ") : "なし"}

# 主要KPI
${Object.entries(facts.kpi).map(([k, v]) => `${k}: ${v}${k.endsWith("件数") ? "件" : "名"}`).join("\n")}

# 未達原因（当月売上が発生していない受講生の内訳）
${causeLines}

# 担当者（直近MTGの担当）
${facts.coaches.length ? facts.coaches.map((c) => `${c.name}: ${c.count}名を担当`).join(" / ") : "担当者の記録なし（施策には「担当者未定（要割当）」と記載すること）"}

# 画面に表示済みの数字（すぐ上に出ているため、報告で数値を繰り返さないこと）
${facts.dashboardVisible.map((v) => `- ${v}`).join("\n")}

# 未計測の指標（推測禁止。必ず「未計測」と書くこと）
${facts.unmeasured.map((u) => `- ${u}`).join("\n")}

# 受講生一覧
${memberLines || "- 受講生が登録されていません"}

上記の事実だけを使い、指定された各項目を作成してください。`;
}

// 上限内に収まる最初の段階で依頼文を作る（収まらなければ最小の段階）
export function buildPrompt(facts, startLevel = 0) {
  for (let index = startLevel; index < PROMPT_LEVELS.length; index += 1) {
    const prompt = factsToPrompt(facts, PROMPT_LEVELS[index]);
    if (prompt.length <= PROMPT_CHAR_BUDGET || index === PROMPT_LEVELS.length - 1) {
      return { prompt, level: index, chars: prompt.length + SYSTEM_PROMPT.length };
    }
  }
  return { prompt: factsToPrompt(facts, PROMPT_LEVELS.at(-1)), level: PROMPT_LEVELS.length - 1 };
}

export function isAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

// 既定モデル。RenderのOPENAI_MODELで上書きできる。
export function configuredModel() {
  return process.env.OPENAI_MODEL || "gpt-5.5";
}

function createClient(apiKey) {
  return new OpenAI({
    apiKey,
    ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {})
  });
}

// 設定すべきモデルIDを画面から確認できるようにする（推測でIDを決めないため）
export async function listAvailableModels(options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error("AIのAPIキーが設定されていません。RenderでOPENAI_API_KEYをご確認ください。");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }
  let models;
  try {
    const page = await createClient(apiKey).models.list();
    models = (page.data || []).map((m) => m.id);
  } catch (cause) {
    throw aiRequestError(cause);
  }
  const current = configuredModel();
  return {
    current,
    currentIsAvailable: models.includes(current),
    // 会話生成に使えるモデルを先頭に寄せる（埋め込み・音声・画像系は後ろへ）
    models: models.slice().sort((a, b) => {
      const rank = (id) => (/embed|whisper|tts|dall|moderation|audio|image|realtime/.test(id) ? 1 : 0);
      return rank(a) - rank(b) || a.localeCompare(b);
    })
  };
}

// APIキー未設定でも運用が止まらないよう、数字ベースの下書きを返す
export function fallbackProgressReport(facts) {
  const cause = [...facts.causes].sort((a, b) => b.count - a.count)[0];
  const targets = cause?.members.slice(0, 4).map((m) => m.name).join("、") || "対象者なし";
  const coach = facts.coaches[0]?.name || "担当者未定（要割当）";
  return {
    // 画面に出ている数字（現在売上・在籍・平均進捗・要確認・上位者名）は繰り返さない
    numbers: `前回報告時から ${facts.sales.increase >= 0 ? "+" : ""}${yen(facts.sales.increase)} の増減です（前回報告時 ${yen(facts.sales.previousReport)}）。`
      + `当月ペースの日割り換算による月末着地見込は ${yen(facts.sales.projectedMonthEnd)}、残り${facts.daysRemainingInMonth}日です。`
      + `月間売上目標が未計測のため、進捗率と目標に対する不足額は未計測です。`,
    salesBreakdown: `${facts.sales.tto === null && facts.sales.tts === null
      ? `TTO/TTSの内訳は未計測です（内訳入力済み ${facts.sales.breakdownEnteredCount}名）。`
      : `内訳はTTO ${facts.sales.tto === null ? "未計測" : yen(facts.sales.tto)}、TTS ${facts.sales.tts === null ? "未計測" : yen(facts.sales.tts)}${facts.sales.current > 0 && facts.sales.tto !== null && facts.sales.tts !== null ? `（TTO比率 ${Math.round((facts.sales.tto / facts.sales.current) * 100)}%）` : ""}です。`}`
      + `売上が発生しているのは ${facts.sales.earnerCount}名、売上発生者1人あたり平均は ${yen(facts.sales.averagePerEarner)} です。`
      + `上位1名への集中率は ${facts.sales.topOneSharePercent ?? "算出不可"}%、上位3名で ${facts.sales.topThreeSharePercent ?? "算出不可"}% です。`
      + `${Number(facts.sales.topOneSharePercent) >= 50 ? "特定の受講生への依存度が高く、その1名の稼働が止まると当月着地が大きく下振れします。" : ""}`
      + `講師本人と研修生の売上区分は未計測です。`,
    kpi: `稼働人数 ${facts.kpi.稼働人数}名 / 投稿開始人数 ${facts.kpi.投稿開始人数}名 / 商品申請済み人数 ${facts.kpi.商品申請済み人数}名 / `
      + `MTG実施件数 ${facts.kpi.MTG実施件数}件 / アカウント未登録人数 ${facts.kpi.アカウント未登録人数}名です。`
      + `投稿本数・案件提案数・商談数・成約数は未計測です。`,
    rootCause: facts.causes.map((c) => `${c.key} ${c.count}名`).join(" / ") + `。${cause && cause.count ? `最多は${cause.key}の${cause.count}名で、${targets}が該当します。` : ""}`,
    actions: cause && cause.count
      ? `対象者: ${targets}（${cause.key} ${cause.count}名のうち優先4名） / 担当者: ${coach} / 実施内容: 個別接触のうえ${cause.key}の解消手順を提示 / 実施期限: ${facts.today}から3日以内 / 完了条件: 投稿再開または案件提案が確定した時点 / 改善KPI: 稼働人数（現在${facts.kpi.稼働人数}名） / 見込売上: ${yen(facts.sales.averagePerEarner * 2)}（1人あたり平均${yen(facts.sales.averagePerEarner)}×2名）`
      : "当月売上が未発生の受講生はいません。上位者の案件継続を優先します。",
    decisions: facts.causes.find((c) => c.key === "連絡停止" && c.count > 0)
      ? `連絡停止${facts.causes.find((c) => c.key === "連絡停止").count}名について、継続支援の可否をご判断いただく必要があります。`
      : "現時点で経営判断が必要な事項はありません。",
    nextReport: `次回報告時に、現在売上・売上発生人数・稼働人数・未達原因別人数の4点を確認します。`
  };
}

// OpenAIのエラー本文。組織IDとAPIキーの一部は画面・ログに出さない
function openAiErrorDetail(cause) {
  const raw = String(cause?.error?.message || cause?.message || "");
  return raw
    .replace(/org-[A-Za-z0-9]+/g, "org-***")
    .replace(/sk-[A-Za-z0-9_*\-]+/g, "sk-***")
    .slice(0, 400);
}

function secondsUntilRetry(cause, detail) {
  const headers = cause?.headers;
  const ms = Number(headers?.get?.("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return Math.ceil(ms / 1000);
  const seconds = Number(headers?.get?.("retry-after"));
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  // 本文の「Please try again in 1h2m3.5s」「in 20ms」等
  const match = detail.match(/try again in ((?:\d+(?:\.\d+)?(?:ms|h|m|s))+)/i);
  if (!match) return null;
  let total = 0;
  for (const [, value, unit] of match[1].matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    total += Number(value) * ({ ms: 0.001, s: 1, m: 60, h: 3600 }[unit]);
  }
  return Math.max(1, Math.ceil(total));
}

function waitText(seconds) {
  if (!seconds) return "しばらく";
  if (seconds < 90) return `約${seconds}秒`;
  if (seconds < 5400) return `約${Math.ceil(seconds / 60)}分`;
  return `約${Math.round(seconds / 360) / 10}時間`;
}

// 429 は「残高不足」「1回の依頼が大きすぎる」「一時的な上限」のどれかで、対処が全く違う。
// それぞれを見分けて、管理者がそのまま行動できる文にする。
export function aiRequestError(cause) {
  const status = cause?.status;
  const code = String(cause?.code || cause?.error?.code || "");
  const type = String(cause?.type || cause?.error?.type || "");
  const detail = openAiErrorDetail(cause);
  const build = (kind, message, statusCode, extra = {}) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.publicMessage = message;
    error.code = `ai_${kind}`;
    error.detail = detail;
    error.requestId = cause?.requestID || null;
    error.openAiStatus = status ?? null;
    Object.assign(error, extra);
    error.cause = cause;
    return error;
  };

  if (status === 429) {
    if (code === "insufficient_quota" || type === "insufficient_quota" || /exceeded your current quota|check your plan and billing/i.test(detail)) {
      return build("insufficient_quota",
        "OpenAIの利用残高（クレジット）が不足しているか、設定した利用上限額に達しています。待っても解消しません。OpenAIの管理画面（Settings → Billing / Limits）で残高と上限額をご確認ください。",
        429);
    }
    const tooLarge = detail.match(/Request too large[\s\S]*?Limit\s*([\d,]+)[\s\S]*?Requested\s*([\d,]+)/i);
    if (tooLarge || /request too large/i.test(detail)) {
      const limit = tooLarge ? Number(tooLarge[1].replace(/,/g, "")) : null;
      const requested = tooLarge ? Number(tooLarge[2].replace(/,/g, "")) : null;
      return build("request_too_large",
        `1回の依頼が、AIの1分あたりの利用上限を超えています${limit ? `（上限 ${limit.toLocaleString("ja-JP")} / 依頼 ${requested.toLocaleString("ja-JP")} トークン）` : ""}。依頼内容を縮小しても収まりませんでした。OpenAIの利用ティア（Usage tier）を上げると上限が広がります。`,
        429, { limit, requested });
    }
    const retryAfterSeconds = secondsUntilRetry(cause, detail);
    const perDay = /per day|\(TPD\)|\(RPD\)/i.test(detail);
    return build("rate_limited",
      perDay
        ? `AIの1日あたりの利用上限に達しています。${waitText(retryAfterSeconds)}後に解消します。急ぐ場合はOpenAIの利用ティアを上げてください。`
        : `AIの1分あたりの利用上限に達しています。${waitText(retryAfterSeconds)}待ってからもう一度お試しください（複数社を続けて生成すると起きやすくなります）。`,
      429, { retryAfterSeconds, perDay });
  }
  if (status === 401 || status === 403) return build("auth", "OpenAIのAPIキーが無効か、このキーに権限がありません。RenderのOPENAI_API_KEYをご確認ください。", 502);
  if (status === 404) return build("model_not_found", `指定されたAIモデル「${configuredModel()}」は、このAPIキーでは利用できません。RenderのOPENAI_MODELを、利用可能なモデルIDに変更してください。`, 502);
  if (status === 400) return build("bad_request", "AIへの依頼内容がOpenAIに受け付けられませんでした。下の詳細を管理者にお伝えください。", 502);
  if (status >= 500) return build("upstream", "OpenAI側で一時的な障害が起きています。少し待ってからもう一度お試しください。", 502);
  if (cause instanceof OpenAI.APIConnectionTimeoutError) return build("timeout", "AIの応答に時間がかかりすぎたため中断しました。もう一度お試しください。", 504);
  if (cause instanceof OpenAI.APIConnectionError) return build("connection", "OpenAIに接続できませんでした。少し待ってからもう一度お試しください。", 502);
  return build("unknown", "下書きの生成に失敗しました。もう一度お試しください。", 500);
}

function logAiFailure(context, error, extra = {}) {
  console.error(`[AI] ${context} failed`, JSON.stringify({
    code: error.code,
    openAiStatus: error.openAiStatus,
    requestId: error.requestId,
    detail: error.detail,
    ...extra
  }));
}

const MAX_AI_ATTEMPTS = 3;
const MAX_AUTO_WAIT_SECONDS = 25;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function generateProgressReport(facts, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) return { report: fallbackProgressReport(facts), source: "fallback" };

  const client = createClient(apiKey);
  const model = configuredModel();

  let response;
  let built = buildPrompt(facts);
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      // 再試行は原因に合わせて下で判断する（SDKの一律の再試行は、残高不足など待っても直らない時にも繰り返してしまう）
      response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: built.prompt }
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "progress_report", strict: true, schema: REPORT_SCHEMA }
        }
      }, { maxRetries: 0 });
      break;
    } catch (cause) {
      const error = aiRequestError(cause);
      logAiFailure("progress report", error, { company: facts.companyName, promptChars: built.chars, level: built.level, attempt });
      // 1回の依頼が上限を超えた：依頼文をさらに縮めて送り直す（待っても通らないため）
      if (error.code === "ai_request_too_large" && built.level < PROMPT_LEVELS.length - 1) {
        built = buildPrompt(facts, built.level + 1);
        continue;
      }
      if (attempt < MAX_AI_ATTEMPTS) {
        // 1分あたりの上限：OpenAIが示す待ち時間が短ければ、待ってから自動で再試行する
        const wait = error.retryAfterSeconds ?? 5;
        if (error.code === "ai_rate_limited" && !error.perDay && wait <= MAX_AUTO_WAIT_SECONDS) {
          await sleep(wait * 1000 + 500);
          continue;
        }
        // OpenAI側の一時的な障害・通信エラーは、少し間をおいて再試行する
        if (["ai_upstream", "ai_connection", "ai_timeout"].includes(error.code)) {
          await sleep(2000 * attempt);
          continue;
        }
      }
      // 残高不足・1日の上限・認証・モデル不可は、待っても直らないのですぐに伝える
      throw error;
    }
  }

  const choice = response.choices?.[0];
  if (choice?.finish_reason === "length") {
    const error = new Error("AIの出力が長くなりすぎて途中で止まりました。もう一度お試しください。");
    error.statusCode = 502;
    error.publicMessage = error.message;
    error.code = "ai_truncated";
    throw error;
  }
  if (choice?.finish_reason === "content_filter") {
    const error = new Error("AIが生成を拒否しました。入力内容をご確認ください。");
    error.statusCode = 422;
    error.publicMessage = error.message;
    throw error;
  }
  const text = choice?.message?.content;
  if (!text) {
    const error = new Error("AIから内容を取得できませんでした。もう一度お試しください。");
    error.statusCode = 502;
    error.publicMessage = error.message;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const error = new Error("AIの応答を解釈できませんでした。もう一度お試しください。");
    error.statusCode = 502;
    error.publicMessage = error.message;
    throw error;
  }
  return {
    report: Object.fromEntries(SECTIONS.map(([key]) => [key, String(parsed[key] ?? "")])),
    source: "ai",
    model,
    usage: response.usage || null,
    promptLevel: built.level
  };
}

// 管理ツールの「AIの接続を確認」。ごく短い依頼を1回だけ送り、
// つながるか・残高があるか・1分あたりの上限がいくつかを返す（費用はごくわずか）
export async function checkAiConnection(facts = null, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  const model = configuredModel();
  const promptInfo = facts ? (() => {
    const built = buildPrompt(facts);
    // 日本語は概ね1文字≒0.8トークン（実測）
    return { company: facts.companyName, level: built.level, estimatedTokens: Math.round(built.chars * 0.8) };
  })() : null;
  if (!apiKey) {
    return { ok: false, code: "ai_not_configured", model, message: "OpenAIのAPIキーが設定されていません。RenderでOPENAI_API_KEYを設定してください。", prompt: promptInfo };
  }
  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  try {
    const { response } = await createClient(apiKey).chat.completions.create({
      model,
      messages: [{ role: "user", content: "接続確認です。「OK」とだけ返してください。" }],
      max_completion_tokens: 64
    }, { maxRetries: 0 }).withResponse();
    const header = (name) => response.headers.get(name);
    return {
      ok: true,
      model,
      limits: {
        tokensPerMinute: number(header("x-ratelimit-limit-tokens")),
        remainingTokens: number(header("x-ratelimit-remaining-tokens")),
        requestsPerMinute: number(header("x-ratelimit-limit-requests")),
        remainingRequests: number(header("x-ratelimit-remaining-requests")),
        resetTokens: header("x-ratelimit-reset-tokens")
      },
      prompt: promptInfo
    };
  } catch (cause) {
    const error = aiRequestError(cause);
    logAiFailure("connection check", error);
    return { ok: false, code: error.code, model, message: error.publicMessage, detail: error.detail, retryAfterSeconds: error.retryAfterSeconds ?? null, prompt: promptInfo };
  }
}

export const REPORT_SECTIONS = SECTIONS;
