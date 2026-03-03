/**
 * Spellbound — Supabase config
 * Project URL: Supabase Dashboard → Spellbound → Settings → API → Project URL
 */
window.__SPELLBOUND_SUPABASE__ = {
  url: 'https://wzhdutwkcqaabkbbltyk.supabase.co',
  anonKey: 'sb_publishable_BBAiZj0TNkQkTbJbCY-KlQ_EBXHxeCr'
};

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

/**
 * Proper-noun detection via POS tagging. This should point to a Netlify Function
 * that wraps wink-pos-tagger, e.g.:
 *   https://spellbound-game.netlify.app/.netlify/functions/pos-proper-noun
 */
window.__SPELLBOUND_POS_API__ = 'https://spellbound-game.netlify.app/.netlify/functions/pos-proper-noun';
