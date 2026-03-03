# Spellbound scripts — v2

Wiki-100k–based puzzle generator: `index.js`. Uses NYT Spelling Bee rules (7 letters, center required, ≥4 letters, at least one pangram). **Valid words and pangrams are restricted to a list of common English words** (100k most frequent) so only real, familiar words appear.

**Requirements:** Node.js.

**Word lists:**
- `data/wiki-100k.txt` — used to discover 7-letter sets and candidates (plaintext, one word per line).
- `data/100k-most-frequent.txt` — optional; only words in this file appear in `valid_words` and `pangrams`. If missing, the script fetches the 20k common-English list from the internet as fallback.

**Run from project root:**
```bash
node scripts/v2/index.js
```

Output: `data/puzzles-2.json`. Settings (min/max word length, obscure suffix filter, allowed-list path/URL) are at the top of `index.js`.
