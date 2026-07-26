import Anthropic from "@anthropic-ai/sdk";

// クライアント向け「今月の進捗」の下書きを生成する。
// 運営が生成ボタンを押したタイミングでのみ実行され、講師が確認・編集してから保存する。

const MILESTONES = [
  ["daily", "毎日投稿"], ["qa", "Q&A"], ["mtg", "MTG"],
  ["orient", "オリエン"], ["firstMtg", "初回MTG"], ["account", "アカウント作成"], ["firstPost", "初回投稿"],
  ["f100", "フォロワー100人"], ["f300", "フォロワー300人"], ["f500", "フォロワー500人"],
  ["f700", "フォロワー700人"], ["f1000", "フォロワー1000人"],
  ["prMtg", "PR初回MTG"], ["product", "商品申請"], ["prCarousel", "PRカルーセル"],
  ["prVideo", "PR動画"], ["prTts", "PR TTS"], ["sparkAds", "スパークアズ対象"], ["sakura", "サクラ連携"],
  ["month1", "月1件獲得"], ["month10", "月10件獲得"], ["month30", "月30件獲得"], ["month100", "月100件獲得"]
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

// AIに渡す事実を、画面と同じ計算根拠から組み立てる（数字はここで確定させ、モデルには計算させない）
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
    const done = MILESTONES.filter(([key]) => member[key] === true);
    const missing = MILESTONES.filter(([key]) => member[key] !== true);
    return {
      name: member.name,
      stage: member.stage,
      evaluation: member.status,
      progressPercent: Number(member.progress || 0),
      currentSales: salesIndex >= 0 ? Number(sales[salesIndex] || 0) : null,
      previousSales: prevSalesIndex >= 0 ? Number(sales[prevSalesIndex] || 0) : null,
      currentFollowers: followerIndex >= 0 ? Number(followers[followerIndex] || 0) : null,
      previousFollowers: prevFollowerIndex >= 0 ? Number(followers[prevFollowerIndex] || 0) : null,
      completedItems: done.map(([, label]) => label),
      missingItems: missing.map(([, label]) => label),
      meetingCount: (member.meetings || []).length,
      latestMeeting: (member.meetings || [])[0]
        ? {
          date: member.meetings[0].date,
          content: member.meetings[0].content,
          nextAction: member.meetings[0].next
        }
        : null,
      accountCount: (member.accountLinks || []).filter(Boolean).length
    };
  });

  const withSales = memberFacts.filter((m) => Number(m.currentSales || 0) > 0);
  const totalSales = memberFacts.reduce((sum, m) => sum + Number(m.currentSales || 0), 0);
  const previousTotalSales = memberFacts.reduce((sum, m) => sum + Number(m.previousSales || 0), 0);
  const totalFollowers = memberFacts.reduce((sum, m) => sum + Number(m.currentFollowers || 0), 0);
  const previousTotalFollowers = memberFacts.reduce((sum, m) => sum + Number(m.previousFollowers || 0), 0);
  const avgProgress = memberFacts.length
    ? Math.round(memberFacts.reduce((sum, m) => sum + m.progressPercent, 0) / memberFacts.length)
    : 0;

  // 未達が多い項目 = 全体のボトルネック
  const blockerCounts = MILESTONES.map(([key, label]) => ({
    label,
    remaining: memberFacts.filter((m) => m.missingItems.includes(label)).length
  })).filter((item) => item.remaining > 0).sort((a, b) => b.remaining - a.remaining).slice(0, 5);

  return {
    companyName: company.name,
    monthLabel,
    previousMonthLabel: previousLabel,
    enrollment: memberFacts.length,
    phaseBreakdown: {
      新規: memberFacts.filter((m) => m.stage === "新規").length,
      構築: memberFacts.filter((m) => m.stage === "構築").length,
      PR: memberFacts.filter((m) => m.stage === "PR").length
    },
    averageProgressPercent: avgProgress,
    totalSales,
    previousTotalSales,
    salesDelta: totalSales - previousTotalSales,
    membersWithSales: withSales.length,
    totalFollowers,
    previousTotalFollowers,
    followerDelta: totalFollowers - previousTotalFollowers,
    needsAttention: memberFacts.filter((m) => m.evaluation === "F" || m.progressPercent < 35).map((m) => m.name),
    topBlockers: blockerCounts,
    totalMeetings: memberFacts.reduce((sum, m) => sum + m.meetingCount, 0),
    members: memberFacts
  };
}

const REPORT_SCHEMA = {
  type: "object",
  properties: {
    good: { type: "string", description: "今月の良い変化。定量的な数字と、それが何を意味するかの定性的な解釈をあわせて記載する。" },
    issue: { type: "string", description: "確認したい点。現状の課題を、責める表現を避けて事実ベースで記載する。" },
    action: { type: "string", description: "今後の支援方針。講師側が『何を』『いつまでに』行うかを具体的に記載する。" },
    request: { type: "string", description: "貴社への確認事項。クライアントに依頼したいことを、期限と理由をつけて記載する。" }
  },
  required: ["good", "issue", "action", "request"],
  additionalProperties: false
};

const SYSTEM_PROMPT = `あなたは法人向けSNS運用研修サービスの運営責任者として、クライアント企業へ提出する月次進捗報告を書きます。

読み手はクライアント企業の担当者です。研修を任せてよかった、この運営に任せておけば安心だ、と感じられる報告にしてください。

必ず守ること:
- 与えられた数字だけを使う。数字を推測・創作・再計算しない。渡されていない指標には言及しない。
- 定量（人数・金額・フォロワー数・前月比・達成率）と定性（それが何を意味するか、現場で何が起きているか）を必ず両方入れる。
- 「今後の支援方針」には、講師側が何をいつまでに行うかを必ず具体的に書く。「引き続き支援します」のような曖昧な表現は禁止。対象者名・施策・期限をいれる。
- 「貴社への確認事項」には、依頼内容・期限・なぜ必要かをセットで書く。
- 受講生を否定する表現は使わない。課題は「確認したい点」として事実ベースで書く。
- 社内用語は使わない。「要対応」→「要確認」、「停滞」→「進行確認」、「F評価」→「確認優先」と言い換える。
- 各項目は2〜4文、全体で読みやすい分量にする。箇条書き記号や見出しは使わず、そのまま報告書に載る文章として書く。
- 敬体（です・ます）で書く。`;

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString("ja-JP")}円`;
}

function factsToPrompt(facts) {
  const memberLines = facts.members.map((m) => {
    const parts = [
      `- ${m.name}: ${m.stage}フェーズ / 評価${m.evaluation} / 進捗${m.progressPercent}%`,
      m.currentFollowers !== null ? `フォロワー${m.currentFollowers.toLocaleString("ja-JP")}人` : "フォロワー未登録",
      m.currentSales !== null ? `売上${formatCurrency(m.currentSales)}` : "売上未登録"
    ];
    if (m.previousFollowers !== null && m.currentFollowers !== null) {
      parts.push(`フォロワー前月比${m.currentFollowers - m.previousFollowers >= 0 ? "+" : ""}${(m.currentFollowers - m.previousFollowers).toLocaleString("ja-JP")}人`);
    }
    if (m.previousSales !== null && m.currentSales !== null) {
      parts.push(`売上前月比${m.currentSales - m.previousSales >= 0 ? "+" : ""}${formatCurrency(m.currentSales - m.previousSales)}`);
    }
    parts.push(`MTG${m.meetingCount}件`);
    parts.push(`未達項目: ${m.missingItems.slice(0, 5).join("、") || "なし"}`);
    if (m.latestMeeting) {
      parts.push(`直近MTG(${m.latestMeeting.date}): ${m.latestMeeting.content || "記録なし"} / 次アクション: ${m.latestMeeting.nextAction || "未設定"}`);
    }
    return parts.join(" / ");
  }).join("\n");

  return `# 報告対象
会社名: ${facts.companyName}
対象月: ${facts.monthLabel}${facts.previousMonthLabel ? `（比較対象: ${facts.previousMonthLabel}）` : ""}

# 全体の数字
在籍: ${facts.enrollment}名（新規${facts.phaseBreakdown.新規}名 / 構築${facts.phaseBreakdown.構築}名 / PR${facts.phaseBreakdown.PR}名）
平均進捗率: ${facts.averageProgressPercent}%
今月の売上合計: ${formatCurrency(facts.totalSales)}（前月 ${formatCurrency(facts.previousTotalSales)} / 前月比 ${facts.salesDelta >= 0 ? "+" : ""}${formatCurrency(facts.salesDelta)}）
売上が発生した受講生: ${facts.membersWithSales}名
フォロワー合計: ${facts.totalFollowers.toLocaleString("ja-JP")}人（前月比 ${facts.followerDelta >= 0 ? "+" : ""}${facts.followerDelta.toLocaleString("ja-JP")}人）
今月のMTG実施数: ${facts.totalMeetings}件
個別確認が必要な受講生: ${facts.needsAttention.length ? facts.needsAttention.join("、") : "なし"}

# 全体のボトルネック（未達者が多い順）
${facts.topBlockers.length ? facts.topBlockers.map((b) => `- ${b.label}: 未達${b.remaining}名`).join("\n") : "- 主要項目は完了しています"}

# 受講生ごとの状況
${memberLines || "- 受講生が登録されていません"}

上記の事実だけを使って、クライアントへ提出する「今月の進捗」の4項目を作成してください。`;
}

export function isAiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// APIキー未設定でも運用が止まらないよう、数字ベースの下書きを返す
export function fallbackProgressReport(facts) {
  const deltaText = facts.salesDelta === 0
    ? "前月と同水準です"
    : `前月比${facts.salesDelta > 0 ? "+" : ""}${formatCurrency(facts.salesDelta)}です`;
  const blocker = facts.topBlockers[0];
  const target = facts.needsAttention[0];
  return {
    good: `${facts.monthLabel}は在籍${facts.enrollment}名（PR${facts.phaseBreakdown.PR}名 / 構築${facts.phaseBreakdown.構築}名）で、平均進捗率は${facts.averageProgressPercent}%です。`
      + `売上は合計${formatCurrency(facts.totalSales)}で${deltaText}。${facts.membersWithSales}名が成果につながっています。`,
    issue: blocker
      ? `${blocker.label}が未達の受講生が${blocker.remaining}名います。${facts.needsAttention.length ? `特に${facts.needsAttention.join("、")}は個別の確認が必要な状況です。` : "全体としては進行できています。"}`
      : "主要項目は順調に進んでおり、現時点で大きな停滞はありません。",
    action: blocker
      ? `今月中に${blocker.label}が未達の${blocker.remaining}名へ個別MTGを設定し、次回投稿までの具体的な手順を講師から提示します。`
        + `${target ? `${target}については週次で進捗を確認します。` : ""}`
      : `PRフェーズの受講生を対象に、今月中に案件化に向けた個別MTGを実施します。`,
    request: "受講生の連絡状況のご確認と、面談可否・投稿素材のご共有について、今月中にご協力をお願いいたします。"
  };
}

// SDKの型付き例外を、利用者に出せる日本語メッセージへ変換する（内部エラーはそのまま見せない）
function aiRequestError(cause) {
  const build = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.publicMessage = message;
    error.cause = cause;
    return error;
  };
  if (cause instanceof Anthropic.RateLimitError) {
    return build("AIの利用が混み合っています。1分ほど待ってからもう一度お試しください。", 429);
  }
  if (cause instanceof Anthropic.AuthenticationError || cause instanceof Anthropic.PermissionDeniedError) {
    return build("AIの認証設定に問題があります。管理者にAPIキーの確認をご依頼ください。", 502);
  }
  if (cause instanceof Anthropic.BadRequestError || cause instanceof Anthropic.NotFoundError) {
    return build("AIへの依頼内容に問題がありました。管理者にご連絡ください。", 502);
  }
  if (cause instanceof Anthropic.APIConnectionError) {
    return build("AIに接続できませんでした。通信状況を確認して、もう一度お試しください。", 503);
  }
  if (cause instanceof Anthropic.APIError) {
    return build("AIが一時的に応答していません。少し待ってからもう一度お試しください。", 503);
  }
  return build("下書きの生成に失敗しました。もう一度お試しください。", 500);
}

export async function generateProgressReport(facts, options = {}) {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { report: fallbackProgressReport(facts), source: "fallback" };
  }
  const client = new Anthropic({
    apiKey,
    ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {})
  });
  let response;
  try {
    response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: REPORT_SCHEMA }
      },
      messages: [{ role: "user", content: factsToPrompt(facts) }]
    });
  } catch (cause) {
    throw aiRequestError(cause);
  }

  if (response.stop_reason === "refusal") {
    const error = new Error("AIが生成を拒否しました。入力内容をご確認ください。");
    error.statusCode = 422;
    throw error;
  }
  const textBlock = (response.content || []).find((block) => block.type === "text");
  if (!textBlock?.text) {
    const error = new Error("AIから内容を取得できませんでした。もう一度お試しください。");
    error.statusCode = 502;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    const error = new Error("AIの応答を解釈できませんでした。もう一度お試しください。");
    error.statusCode = 502;
    throw error;
  }
  return {
    report: {
      good: String(parsed.good || ""),
      issue: String(parsed.issue || ""),
      action: String(parsed.action || ""),
      request: String(parsed.request || "")
    },
    source: "ai",
    usage: response.usage || null
  };
}
