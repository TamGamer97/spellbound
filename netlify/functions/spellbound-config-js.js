/**
 * Serve client-side config as a JS file.
 *
 * This prevents Supabase credentials (anon key + project URL) from being
 * hardcoded in repo-tracked frontend JS.
 *
 * The HTML pages load this script before `js/db.js`.
 */

exports.handler = async function (event) {
  // Basic hardening: only GET (script tag).
  if (event.httpMethod && event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "Allow": "GET" },
      body: "Method Not Allowed",
    };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
  const BLOCKLIST_URL = process.env.SPELLBOUND_BLOCKLIST_URL || "";

  // Non-secret constants (kept here for single source of truth).
  const DICTIONARY_API = process.env.SPELLBOUND_DICTIONARY_API || "https://api.dictionaryapi.dev/api/v2/entries/en";
  const PROFANITY_API = process.env.SPELLBOUND_PROFANITY_API || "https://www.purgomalum.com/service/containsprofanity";

  // Keep output deterministic and easy to debug.
  const payload = `
window.__SPELLBOUND_SUPABASE__ = {
  url: ${JSON.stringify(SUPABASE_URL)},
  anonKey: ${JSON.stringify(SUPABASE_ANON_KEY)}
};
window.__SPELLBOUND_DICTIONARY_API__ = ${JSON.stringify(DICTIONARY_API)};
window.__SPELLBOUND_PROFANITY_API__ = ${JSON.stringify(PROFANITY_API)};
window.__SPELLBOUND_BLOCKLIST_URL__ = ${JSON.stringify(BLOCKLIST_URL)};
`;

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/javascript",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
    body: payload,
  };
};

