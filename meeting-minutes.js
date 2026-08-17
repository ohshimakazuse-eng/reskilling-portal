// AIが要約したMTG議事録を、そのまま貼り付けてMTG記録の各欄へ振り分けるための解析。
// ブラウザ(app.js)とNode(テスト)の双方から使えるようグローバルへ公開する。
(function (root) {

  const SECTION_RULES = [
    { key: "overview", words: ["会議の概要"] },
    { key: "company", words: ["サーバー"] },
    { key: "datetime", words: ["日時"] },
    { key: "duration", words: ["時間"] },
    { key: "participants", words: ["参加したユーザー", "参加者"] },
    { key: "topics", words: ["主な議題", "議題"] },
    { key: "status", words: ["研修状況"] },
    { key: "decisions", words: ["決定事項"] },
    { key: "issues", words: ["現状の課題"] },
    { key: "improvements", words: ["改善策", "施策"] },
    { key: "nextActions", words: ["ネクストアクション", "次のアクション"] },
    { key: "consultations", words: ["その他相談事項", "相談事項"] },
    { key: "unresolved", words: ["未解決", "確認待ち"] }
  ];

  // 「🗂 主な議題 — 5件」のような行から節名を判定する
  function detectSection(line) {
    const cleaned = line.replace(/^[^\p{L}\p{N}]+/u, "").trim();
    if (!cleaned) return null;
    // 「— 5件」「- 3件」などの件数表記を落とす
    const head = cleaned.split(/[—–\-]\s*\d+\s*件/)[0].trim();
    if (head.length > 24) return null;
    for (const rule of SECTION_RULES) {
      if (rule.words.some((word) => head.includes(word))) return rule.key;
    }
    return null;
  }

  function stripBullet(line) {
    return line.replace(/^[\s]*[・\-*•]+\s*/u, "").trim();
  }

  function toBullets(lines) {
    return lines.map(stripBullet).filter(Boolean);
  }

  function parseDate(text) {
    const match = String(text || "").match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
    if (!match) return "";
    const [, y, m, d] = match;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // 「山口美里樹　｜　期限 未定」のような行から担当者名だけ取り出す
  function nameFromActionLine(line) {
    const head = stripBullet(line).split(/[｜|]/)[0];
    return head.replace(/\s+/g, " ").trim();
  }

  function parseMeetingMinutes(rawText) {
    const text = String(rawText || "");
    const lines = text.split(/\r?\n/);
    const sections = {};
    let current = null;
    for (const line of lines) {
      const detected = detectSection(line);
      if (detected) {
        current = detected;
        sections[current] = sections[current] || [];
        // 「日時」など、見出し行の後ろに値が続く形式にも対応する
        const inline = line.replace(/^[^\p{L}\p{N}]+/u, "").replace(/^[^\s]*\s*/u, "").trim();
        if (inline && !/^[—–\-]\s*\d+\s*件$/.test(inline)) sections[current].push(inline);
        continue;
      }
      if (!current) continue;
      if (!line.trim()) continue;
      sections[current].push(line);
    }

    const get = (key) => toBullets(sections[key] || []);
    const joined = (key) => get(key).join("\n");

    const dateSource = [joined("datetime"), joined("overview"), text].find((v) => parseDate(v));

    // 「担当者｜期限」の行と、その次の行の実施内容を1件にまとめる
    const rawActionLines = get("nextActions");
    const nextActionItems = [];
    const owners = [];
    for (let i = 0; i < rawActionLines.length; i += 1) {
      const line = rawActionLines[i];
      if (/[｜|]/.test(line)) {
        const owner = nameFromActionLine(line);
        const due = line.split(/[｜|]/).slice(1).join(" ").replace(/\s+/g, " ").trim();
        const body = rawActionLines[i + 1] && !/[｜|]/.test(rawActionLines[i + 1]) ? rawActionLines[++i] : "";
        if (owner && owner.length <= 20 && !owners.includes(owner)) owners.push(owner);
        nextActionItems.push([body, owner ? `担当:${owner}` : "", due].filter(Boolean).join(" / "));
      } else {
        nextActionItems.push(line);
      }
    }

    const participants = get("participants")
      .flatMap((line) => line.split(/[\/／、,]/))
      .map((v) => v.replace(/\s+/g, " ").trim())
      // 「— 2名」のような件数表記は参加者ではない
      .filter((v) => v && !/^[—–\-]?\s*\d+\s*名$/.test(v));

    // 今回の確認内容 = 議題・研修状況・課題。次アクション = ネクストアクションと改善策。
    const contentParts = [
      ["主な議題", get("topics")],
      ["研修状況", get("status")],
      ["現状の課題", get("issues")]
    ].filter(([, items]) => items.length)
      .map(([label, items]) => `【${label}】\n${items.map((i) => `・${i}`).join("\n")}`);

    const nextParts = [
      ["ネクストアクション", nextActionItems],
      ["改善策・施策", get("improvements")]
    ].filter(([, items]) => items.length)
      .map(([label, items]) => `【${label}】\n${items.map((i) => `・${i}`).join("\n")}`);

    const issueCount = get("issues").length;
    const decisionText = joined("decisions");
    const hasDecision = Boolean(decisionText) && !/ありませんでした|なし/.test(decisionText);
    // 課題が多ければ要フォロー、決定事項があれば改善傾向、それ以外は継続
    const result = issueCount >= 3 ? "要フォロー" : hasDecision ? "改善傾向" : "継続";

    return {
      date: parseDate(dateSource || ""),
      companyHint: joined("company").replace(/研修$/, "").trim(),
      participants,
      owners,
      content: contentParts.join("\n\n"),
      nextAction: nextParts.join("\n\n"),
      result,
      sectionsFound: Object.keys(sections).filter((k) => (sections[k] || []).length),
      raw: text.trim()
    };
  }

  root.parseMeetingMinutes = parseMeetingMinutes;
})(typeof window !== "undefined" ? window : globalThis);
