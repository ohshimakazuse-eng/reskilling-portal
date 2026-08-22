// クライアント用ログインIDの決定ロジック。
// 画面表示（app.js）とログイン判定（server.mjs）が必ず同じ結果になるよう、
// 1か所にまとめてブラウザ・Nodeの双方へ公開する。
//
// 決定順序:
//   1. 別名表に登録があればそれを使う（既存クライアントのIDを変えないため）
//   2. 会社コードがそのままIDとして使えるならそれを使う
//   3. 使えない場合は社名の英字から自動発行する
//   4. 社名に英字が無ければ会社コードから安定したIDを組み立てる
// 最後に全社で重複が無いことを保証する（重複時は -2, -3 … を付ける）。
(function (root) {
  // 既存クライアントの互換用。会社コードが日本語のため個別に割り当てている。
  const CLIENT_LOGIN_ALIASES = {
    iberis: "イベリス",
    exceed: "エクシードキャリア",
    recrea: "レクレア",
    rower: "ローワー"
  };

  // 社名から落としても意味が変わらない語。IDを短く読みやすく保つ。
  const NAME_STOPWORDS = new Set([
    "inc", "co", "ltd", "llc", "corp", "corporation", "company",
    "holdings", "holding", "group", "japan", "kk", "the"
  ]);

  const LEGAL_FORMS = /株式会社|有限会社|合同会社|合資会社|一般社団法人|ホールディングス/g;

  const LOGIN_ID_PATTERN = /^[a-z0-9_-]+$/;

  function isUsableLoginId(value) {
    return LOGIN_ID_PATTERN.test(String(value || ""));
  }

  function aliasFor(companyId) {
    const found = Object.entries(CLIENT_LOGIN_ALIASES).find(([, id]) => id === companyId);
    return found ? found[0] : "";
  }

  // 会社コードごとに安定した短い識別子。社名に英字が無い会社の最後の受け皿。
  function stableSuffix(seed) {
    let hash = 0;
    const text = String(seed || "");
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return hash.toString(36).slice(0, 6).padStart(6, "0");
  }

  function loginIdFromName(name) {
    const words = String(name || "")
      .replace(LEGAL_FORMS, " ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((word) => word && !NAME_STOPWORDS.has(word));
    if (!words.length) return "";
    return words.slice(0, 2).join("").slice(0, 14);
  }

  // 重複解決の前の素案。auto=true なら自動発行（管理画面で注意表示する）。
  function baseLoginIdFor(company) {
    const companyId = String(company?.id || "");
    const alias = aliasFor(companyId);
    if (alias) return { loginId: alias, auto: false };
    if (isUsableLoginId(companyId)) return { loginId: companyId, auto: false };

    const fromName = loginIdFromName(company?.name);
    if (fromName && isUsableLoginId(fromName)) return { loginId: fromName, auto: true };

    return { loginId: `client${stableSuffix(companyId || company?.name)}`, auto: true };
  }

  // 全社分のログインIDを一度に決める。会社コード順に処理するため、
  // 会社の並び替えや表示順が変わってもIDは変わらない。
  //
  // 確定ID（別名表・そのまま使える会社コード）を先に押さえてから自動発行分を割り当てる。
  // 逆順にすると、後から追加した会社の社名が既存クライアントのIDを奪い、
  // 配布済みのIDが変わってしまう。
  function buildClientLoginMap(companies) {
    const list = (Array.isArray(companies) ? companies : [])
      .filter(Boolean)
      .slice()
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const taken = new Set();
    const byCompanyId = new Map();
    const pending = [];

    list.forEach((company) => {
      const base = baseLoginIdFor(company);
      if (base.auto || taken.has(base.loginId)) {
        pending.push({ company, base });
        return;
      }
      taken.add(base.loginId);
      byCompanyId.set(String(company.id), { loginId: base.loginId, auto: false });
    });

    pending.forEach(({ company, base }) => {
      let candidate = base.loginId;
      let attempt = 2;
      while (taken.has(candidate)) {
        candidate = `${base.loginId}-${attempt}`;
        attempt += 1;
      }
      taken.add(candidate);
      byCompanyId.set(String(company.id), { loginId: candidate, auto: base.auto || candidate !== base.loginId });
    });

    return byCompanyId;
  }

  function clientLoginFor(companies, companyId) {
    const entry = buildClientLoginMap(companies).get(String(companyId));
    const loginId = entry ? entry.loginId : String(companyId || "");
    return { loginId, password: `${loginId}123`, auto: Boolean(entry && entry.auto) };
  }

  function findCompanyByLoginId(companies, loginId) {
    const normalized = String(loginId || "").trim().toLowerCase();
    if (!normalized) return null;
    const map = buildClientLoginMap(companies);
    for (const [companyId, entry] of map.entries()) {
      if (entry.loginId === normalized) {
        return (companies || []).find((company) => String(company.id) === companyId) || null;
      }
    }
    return null;
  }

  root.CLIENT_LOGIN_ALIASES = CLIENT_LOGIN_ALIASES;
  root.buildClientLoginMap = buildClientLoginMap;
  root.clientLoginFor = clientLoginFor;
  root.findCompanyByLoginId = findCompanyByLoginId;
  root.isUsableLoginId = isUsableLoginId;
})(typeof window !== "undefined" ? window : globalThis);
