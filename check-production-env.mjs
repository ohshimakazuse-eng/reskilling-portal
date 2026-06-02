const required = [
  "NODE_ENV",
  "HOST",
  "PUBLIC_URL",
  "FORCE_HTTPS",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ADMIN_PASSWORD",
  "OPERATOR_PASSWORD"
];

const missing = required.filter((key) => !process.env[key]);
const warnings = [];

if (process.env.NODE_ENV !== "production") warnings.push("NODE_ENV should be production.");
if (process.env.HOST !== "0.0.0.0") warnings.push("HOST should be 0.0.0.0 on production hosting.");
if (!String(process.env.PUBLIC_URL || "").startsWith("https://")) warnings.push("PUBLIC_URL should start with https://.");
if (process.env.FORCE_HTTPS !== "true") warnings.push("FORCE_HTTPS should be true.");
if (!String(process.env.SUPABASE_URL || "").startsWith("https://")) warnings.push("SUPABASE_URL should start with https://.");

if (missing.length || warnings.length) {
  console.log(JSON.stringify({ ok: false, missing, warnings }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  publicUrl: process.env.PUBLIC_URL,
  supabaseUrl: process.env.SUPABASE_URL.replace(/^(https:\/\/[^.]+).+$/, "$1...")
}, null, 2));
