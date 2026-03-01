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
 * Optional: blocklist URL for dictionary fallback (one word per line or JSON array).
 * Words that appear here are never accepted, even if the dictionary API returns them.
 */
window.__SPELLBOUND_BLOCKLIST_URL__ = '';
