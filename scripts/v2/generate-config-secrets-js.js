/**
 * Generate gitignored frontend Supabase config for local dev.
 *
 * Reads `/.env.local` (gitignored) and writes:
 *   /js/config.secrets.js
 *
 * This is only meant for local/static hosting (when Netlify functions
 * aren't available).
 */

const fs = require("fs");

function parseEnvFile(raw) {
  const env = {};
  raw.split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const m = t.match(/^([^=]+)=(.*)$/);
    if (!m) return;
    const k = m[1].trim();
    let v = m[2].trim();
    // Strip surrounding quotes if present.
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  });
  return env;
}

function main() {
  const envPath = ".env.local";
  if (!fs.existsSync(envPath)) {
    console.error("Missing " + envPath + ". Create it from .env.example and fill values.");
    process.exit(1);
  }

  const raw = fs.readFileSync(envPath, "utf8");
  const env = parseEnvFile(raw);

  const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];
  for (const k of required) {
    if (!env[k]) {
      console.error("Missing env var: " + k);
      process.exit(1);
    }
  }

  const outPath = "js/config.secrets.js";
  const supa = { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY };

  const contents = [
    "// Auto-generated from .env.local (gitignored)",
    "window.__SPELLBOUND_SUPABASE__ = " + JSON.stringify(supa) + ";",
    "// Optional endpoints",
    "window.__SPELLBOUND_DICTIONARY_API__ = window.__SPELLBOUND_DICTIONARY_API__ || " + JSON.stringify(env.SPELLBOUND_DICTIONARY_API || "") + ";",
    "window.__SPELLBOUND_PROFANITY_API__ = window.__SPELLBOUND_PROFANITY_API__ || " + JSON.stringify(env.SPELLBOUND_PROFANITY_API || "") + ";",
    "window.__SPELLBOUND_BLOCKLIST_URL__ = window.__SPELLBOUND_BLOCKLIST_URL__ || " + JSON.stringify(env.SPELLBOUND_BLOCKLIST_URL || "") + ";",
    "",
  ].join("\n");

  fs.writeFileSync(outPath, contents, "utf8");
  console.log("Wrote:", outPath);
}

main();

