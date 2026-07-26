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
    members: memberFacts
  };
}

const SECTIONS = [
  ["verdict", "判定", "順調 / 要注意 / 危険 のいずれか1語のみ"],
  ["verdictReason", "判定の根拠", "なぜその判定なのかを、数字を挙げて2〜3文で述べる"],
  ["numbers", "数値", "現在売上・前回報告時の売上・増加額・月末着地見込を記載する。月間目標が未計測のため進捗率と不足額は「未計測」と明記する"],
  ["salesBreakdown", "売上内訳", "売上発生人数・1人あたり平均売上・上位者への集中率・上位者名と金額。講師本人と研修生の区分は未計測と明記する"],
  ["kpi", "主要KPI", "稼働人数・投稿開始人数・商品申請済み人数・月1件獲得達成人数・要確認人数・F評価人数・MTG実施件数。投稿本数/案件提案数/商談数/成約数は未計測と明記する"],
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

export function factsToPrompt(facts) {
  const memberLines = facts.members.map((m) => {
    const bits = [`${m.name}（${m.stage}/評価${m.evaluation}/進捗${m.progressPercent}%）`];
    bits.push(`当月売上${yen(m.currentSales)}`);
    if (m.previousSales !== null) bits.push(`前月売上${yen(m.previousSales)}`);
    bits.push(m.currentFollowers !== null ? `フォロワー${m.currentFollowers.toLocaleString("ja-JP")}人` : "フォロワー未登録");
    bits.push(`MTG${m.meetingCount}件`);
    if (m.latestMeeting) {
      bits.push(`直近MTG ${m.latestMeeting.date}（担当:${m.latestMeeting.coach || "不明"}）内容:${m.latestMeeting.content || "記録なし"} 次アクション:${m.latestMeeting.nextAction || "未設定"}`);
    }
    bits.push(`未達:${m.missingItems.slice(0, 6).join("、") || "なし"}`);
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

# 未計測の指標（推測禁止。必ず「未計測」と書くこと）
${facts.unmeasured.map((u) => `- ${u}`).join("\n")}

# 受講生一覧
${memberLines || "- 受講生が登録されていません"}

上記の事実だけを使い、指定された各項目を作成してください。`;
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
  const verdict = facts.sales.current <= 0 ? "危険"
    : facts.sales.increase < 0 ? "要注意"
      : facts.kpi.F評価人数 > facts.enrollment * 0.3 ? "要注意" : "順調";
  return {
    verdict,
    verdictReason: `当月売上は${yen(facts.sales.current)}で前回報告時から${facts.sales.increase >= 0 ? "+" : ""}${yen(facts.sales.increase)}です。売上発生は${facts.sales.earnerCount}名、確認優先は${facts.kpi.F評価人数}名です。`,
    numbers: `現在売上 ${yen(facts.sales.current)} / 前回報告時 ${yen(facts.sales.previousReport)} / 増加額 ${facts.sales.increase >= 0 ? "+" : ""}${yen(facts.sales.increase)} / 月末着地見込 ${yen(facts.sales.projectedMonthEnd)}（当月ペースの日割り換算、残り${facts.daysRemainingInMonth}日）。月間売上目標が未計測のため、進捗率と不足額は未計測です。`,
    salesBreakdown: `売上発生人数 ${facts.sales.earnerCount}名 / 1人あたり平均 ${yen(facts.sales.averagePerEarner)} / 上位1名への集中率 ${facts.sales.topOneSharePercent ?? "算出不可"}% / 上位3名 ${facts.sales.topThreeSharePercent ?? "算出不可"}%。上位者は${facts.sales.topEarners.map((m) => `${m.name} ${yen(m.sales)}`).join("、") || "なし"}です。講師本人と研修生の売上区分は未計測です。`,
    kpi: `${Object.entries(facts.kpi).map(([k, v]) => `${k} ${v}`).join(" / ")}。投稿本数・案件提案数・商談数・成約数は未計測です。`,
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

function aiRequestError(cause) {
  const build = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.publicMessage = message;
    error.cause = cause;
    return error;
  };
  const status = cause?.status;
  if (status === 429) return build("AIの利用が混み合っています。1分ほど待ってからもう一度お試しください。", 429);
  if (status === 401 || status === 403) return build("AIの認証設定に問題があります。管理者にAPIキーの確認をご依頼ください。", 502);
  if (status === 404) return build(`指定されたAIモデル「${configuredModel()}」は、このAPIキーでは利用できません。RenderのOPENAI_MODELを、利用可能なモデルIDに変更してください。`, 502);
  if (status === 400) return build("AIへの依頼内容に問題がありました。管理者にご連絡ください。", 502);
  if (status >= 500) return build("AIが一時的に応答していません。少し待ってからもう一度お試しください。", 503);
  if (cause instanceof OpenAI.APIConnectionError) return build("AIに接続できませんでした。通信状況を確認して、もう一度お試しください。", 503);
  return build("下書きの生成に失敗しました。もう一度お試しください。", 500);
}

export async function generateProgressReport(facts, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) return { report: fallbackProgressReport(facts), source: "fallback" };

  const client = createClient(apiKey);
  const model = configuredModel();

  let response;
  try {
    response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: factsToPrompt(facts) }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "progress_report", strict: true, schema: REPORT_SCHEMA }
      }
    });
  } catch (cause) {
    throw aiRequestError(cause);
  }

  const choice = response.choices?.[0];
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
    usage: response.usage || null
  };
}

export const REPORT_SECTIONS = SECTIONS;
