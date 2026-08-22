import { readFileSync, existsSync } from "node:fs";

// .dockerignore の評価（後勝ち。! で除外解除）
const rules = readFileSync(".dockerignore", "utf8").split("\n")
  .map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

function toRegExp(pattern) {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, ".");
  return new RegExp(`^${body}$`);
}
function isExcluded(path) {
  let excluded = false;
  for (const rule of rules) {
    const negate = rule.startsWith("!");
    const pattern = negate ? rule.slice(1) : rule;
    const clean = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
    if (toRegExp(clean).test(path) || path.startsWith(`${clean}/`)) excluded = !negate;
  }
  return excluded;
}

// Dockerfile の COPY 行から対象ファイルを抽出
const dockerfile = readFileSync("Dockerfile", "utf8");
const copied = [];
for (const line of dockerfile.split("\n")) {
  const m = line.match(/^COPY\s+(.+)$/);
  if (!m) continue;
  const parts = m[1].trim().split(/\s+/);
  parts.slice(0, -1).forEach((p) => copied.push(p));
}

let ok = true;
console.log("Dockerfile が COPY するファイル:");
for (const file of copied) {
  const missing = !existsSync(file);
  const ignored = isExcluded(file);
  const bad = missing || ignored;
  if (bad) ok = false;
  console.log(`  ${bad ? "NG" : "OK"}  ${file}${missing ? "  <- ファイルが存在しない" : ""}${ignored ? "  <- .dockerignore で除外されている" : ""}`);
}
// index.html が読み込むローカルファイルが COPY 対象に含まれているか
// （含まれていないと本番だけ 404 になり、機能が静かに死ぬ）
const copiedSet = new Set(copied);
const html = readFileSync("index.html", "utf8");
const referenced = new Set();
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const raw = m[1].split("?")[0];
  if (/^(https?:)?\/\//.test(raw) || raw.startsWith("data:") || raw.startsWith("#")) continue;
  const path = raw.replace(/^\.\//, "").replace(/^\//, "");
  if (!path) continue;
  referenced.add(path);
}

console.log("\nindex.html が読み込むローカルファイル:");
for (const path of [...referenced].sort()) {
  const inImage = copiedSet.has(path) || [...copiedSet].some((c) => path.startsWith(`${c}/`));
  const missing = !existsSync(path);
  const bad = missing || !inImage;
  if (bad) ok = false;
  console.log(`  ${bad ? "NG" : "OK"}  ${path}${missing ? "  <- ファイルが存在しない" : ""}${!missing && !inImage ? "  <- Dockerfile の COPY に入っていない" : ""}`);
}

console.log(ok ? "\nビルドコンテキスト: 問題なし" : "\nビルドコンテキスト: このままだとビルドが失敗します");
process.exit(ok ? 0 : 1);
