/**
 * Spellbound — Supabase config
 * Project URL: Supabase Dashboard → Spellbound → Settings → API → Project URL
 */
// NOTE:
// This file intentionally does NOT contain Supabase credentials.
// The values are injected at runtime by the Netlify function:
//   /.netlify/functions/spellbound-config-js
// which reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from Netlify environment variables.
window.__SPELLBOUND_SUPABASE__ = window.__SPELLBOUND_SUPABASE__ || { url: '', anonKey: '' };

/**
 * Dictionary API for fallback word validation. Words not in the puzzle list are
 * checked here: GET https://api.dictionaryapi.dev/api/v2/entries/en/<word>
 */
window.__SPELLBOUND_DICTIONARY_API__ = 'https://api.dictionaryapi.dev/api/v2/entries/en';

/**
 * Profanity/blocklist check. Before accepting a word, we call this API; if it returns "true", the word is rejected.
 * GET https://www.purgomalum.com/service/containsprofanity?text=<word>
 */
window.__SPELLBOUND_PROFANITY_API__ = 'https://www.purgomalum.com/service/containsprofanity';

/**
 * Optional: static blocklist URL (one word per line or JSON array). Loaded at startup; words in this set are also rejected.
 */
window.__SPELLBOUND_BLOCKLIST_URL__ = '';
