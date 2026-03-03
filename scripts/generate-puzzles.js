#!/usr/bin/env node
/**
 * Spellbound — Game board (puzzle) generator
 *
 * Generates 7-letter Spelling Bee puzzles from a word list:
 * - 1 center letter + 6 outer letters
 * - Valid words: 4+ letters, only those 7 letters, must include center
 * - Each puzzle has at least one pangram (word using all 7 letters)
 *
 * Usage:
 *   node scripts/generate-puzzles.js [options]
 *   node scripts/generate-puzzles.js --output puzzles.json
 *   node scripts/generate-puzzles.js --sql --limit 50
 *
 * Options:
 *   --url <url>   Word list URL (default: Google 20k most common English)
 *   --file <path> Use local file instead of URL
 *   --output <path> Write JSON to file (default: stdout)
 *   --sql         Emit SQL INSERT statements for Supabase puzzles table
 *   --limit <n>   Max puzzles to output (default: 100; uses letter-balanced selection with min % per letter)
 *   --min-words <n> Min valid words per puzzle (default: 20)
 *   --min-points <n> Min total points per puzzle (default: 0)
 *   --min-pangrams <n> Min pangrams per puzzle (default: 2)
 *   --blocklist-url <url>  URL to fetch blocklist (one word per line or JSON array)
 *   --blocklist-file <path> Local file for blocklist (one word per line or JSON array)
 *   --url-20k <url>   Word list for discovering 7-letter sets (default: 20k; use a 35k+ frequency-ordered list for more J/K boards). Valid words/pangrams stay 10k-only.
 *   --file-20k <path> Local file for discovery list instead of URL
 *
 * Dual word list: Use 20k to discover more 7-letter sets (more boards with J, K, B, etc.). Valid words and
 * pangrams in each puzzle are filtered to 10k only so no difficult words appear in the game.
 *
 * How the 50-puzzle letter-balanced generation works:
 * 1. Word list: Load words (e.g. Google 10k); only 4–15 letter words. English is E-heavy, so the raw
 *    set of "valid 7-letter sets" has many more puzzles containing E than B, F, J, K, etc.
 * 2. generatePuzzles: For each 7-letter set that appears in the word list and has ≥1 pangram, build
 *    one puzzle per center letter. Keep only puzzles with ≥20 valid words and ≥2 pangrams. So the
 *    *pool* is biased toward common letters (E, T, A, O, N, S) because those letters appear in more
 *    words; rare letters (B, F, J, K, etc.) appear in fewer valid puzzles.
 * 3. Pool: We use puzzles in a relaxed point range (e.g. 100–500) so more E-free and rare-letter
 *    puzzles are available for rebalancing.
 * 4. selectFiftyWithMinLetterPercent:
 *    - Phase 1 (coverage): Add puzzles until every letter A–Z appears in at least one puzzle.
 *    - Phase 2 (fill to 50): Greedily add puzzles that prefer underused letters, but *never* add a
 *      puzzle that would push any letter over the max cap (e.g. 75% of 50 = 38). That forces E (and
 *      other over-used letters) down and leaves room for B, F, G, H, K, L, M, P, etc.
 *    - Phase 3 (rebalance): Swap out puzzles that use over-represented letters and swap in puzzles
 *      that use under-represented letters until each letter is between min% and max% of fair share.
 * 5. Why B, F, J, L, M, P, H, G, K were low: The pool had fewer puzzles containing them (word-list
 *    frequency), and Phase 2 didn’t cap E, so E-heavy puzzles kept being added. Capping at 75% and
 *    enforcing it during fill fixes that; expanding the pool gives more E-free and rare-letter options.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SPELLBOUND_BLOCKLIST = require(path.join(__dirname, '../js/proper-noun-blocklist.js'));
const PROPER_NOUN_BLOCKLIST = SPELLBOUND_BLOCKLIST.all;

const MIN_LENGTH = 4;
const MAX_LENGTH = 15;
const MIN_WORDS_PER_PUZZLE = 20;
const PANGRAM_BONUS = 5;
const POINTS_PER_LETTER = 1;

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : require('http');
    protocol.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

const URL_10K = 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa-no-swears.txt';
const URL_20K = 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/20k.txt';

function loadWords(source) {
  if (source.file) {
    return Promise.resolve(fs.readFileSync(source.file, 'utf8'));
  }
  const url = source.url || URL_10K;
  return fetchUrl(url);
}

/** Load blocklist from URL or file. Returns Set of uppercase words. Empty if no source. */
function parseBlocklistContent(raw) {
  const set = new Set();
  const trimmed = raw.trim();
  if (!trimmed) return set;
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        for (const item of arr) {
          const w = String(item).trim().toUpperCase().replace(/[^A-Z]/g, '');
          if (w) set.add(w);
        }
      }
      return set;
    } catch (_) { /* fall through to line-by-line */ }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const w = line.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (w) set.add(w);
  }
  return set;
}

async function loadBlocklist(opts) {
  if (opts.blocklistFile) {
    const raw = fs.readFileSync(opts.blocklistFile, 'utf8');
    return parseBlocklistContent(raw);
  }
  if (opts.blocklistUrl) {
    const raw = await fetchUrl(opts.blocklistUrl);
    return parseBlocklistContent(raw);
  }
  return new Set();
}

function parseWordList(text, blocklist = new Set()) {
  const seen = new Set();
  const words = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const w = line.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (w.length < MIN_LENGTH || w.length > MAX_LENGTH) continue;
    if (seen.has(w)) continue;
    if (blocklist.has(w)) continue;
    seen.add(w);
    words.push(w);
  }
  return words;
}

/** Returns sorted string of unique letters in word. */
function uniqueLetters(word) {
  const set = new Set();
  for (let i = 0; i < word.length; i++) set.add(word[i]);
  return [...set].sort().join('');
}

/** True if word uses only letters in allowed set. */
function usesOnly(word, allowedSet) {
  for (let i = 0; i < word.length; i++) {
    if (!allowedSet.has(word[i])) return false;
  }
  return true;
}

/** True if word uses all 7 letters (pangram). */
function isPangram(word, sevenSet) {
  if (sevenSet.size !== 7) return false;
  for (const c of sevenSet) {
    if (word.indexOf(c) === -1) return false;
  }
  return true;
}

/** Generate all non-empty subsets of a string of 7 letters, each as sorted string. */
function allSubsetKeys(sevenLetters) {
  const out = [];
  const n = 7;
  for (let mask = 1; mask < (1 << n); mask++) {
    let s = '';
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) s += sevenLetters[i];
    }
    out.push(s.split('').sort().join(''));
  }
  return out;
}

/** Fisher–Yates shuffle in place. */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Letter rarity for diversity: higher = rarer in English (so we prefer varied letter sets).
 *  Based on rough English letter frequency: E,T,A,O,I,N,S very common → J,Z,X,Q very rare. */
const LETTER_RARITY = {
  E: 1, T: 2, A: 3, O: 4, I: 5, N: 6, S: 7, H: 8, R: 9, D: 10, L: 11, C: 12, U: 13, M: 14,
  W: 15, F: 16, G: 17, Y: 18, P: 19, B: 20, V: 21, K: 22, X: 23, J: 24, Q: 25, Z: 26
};

/** Score for how varied/rare the puzzle's letters are (higher = more varied, less A/E/R/T-heavy). */
function letterDiversityScore(puzzle) {
  const letters = puzzle.center_letter + puzzle.outer_letters;
  let score = 0;
  for (let i = 0; i < letters.length; i++) {
    score += LETTER_RARITY[letters[i]] || 13;
  }
  return score;
}

/** True if the puzzle's 7 letters are too common (A/E heavy) — we drop these for variety. */
function isTooCommon(puzzle) {
  const letters = puzzle.center_letter + puzzle.outer_letters;
  const commonCount = { A: 0, E: 0, I: 0, O: 0, R: 0, T: 0 };
  for (let i = 0; i < letters.length; i++) {
    if (commonCount.hasOwnProperty(letters[i])) commonCount[letters[i]]++;
  }
  const hasBothAandE = commonCount.A >= 1 && commonCount.E >= 1;
  const commonVowels = (commonCount.A + commonCount.E + commonCount.I + commonCount.O);
  return hasBothAandE || commonVowels >= 4;
}

/** Return puzzle key (unique id: center + outer). */
function puzzleKey(p) {
  return p.center_letter + p.outer_letters;
}

/** Return 7-letter set key (sorted). One puzzle per letter set so the same pangram never appears in multiple puzzles. */
function letterSetKey(p) {
  const letters = (p.center_letter + p.outer_letters).split('').sort().join('');
  return letters;
}

/** True if the puzzle has any valid_words or pangrams that are in the blocklist (proper nouns). */
function puzzleHasBlocklistedWord(puzzle, blocklist) {
  const words = (puzzle.valid_words || []).concat(puzzle.pangrams || []);
  for (let i = 0; i < words.length; i++) {
    const w = String(words[i]).trim().toUpperCase();
    if (w && blocklist.has(w)) return true;
  }
  return false;
}

/** Replace any puzzle in selected that contains blocklisted words with a clean one from pool (same letter-set uniqueness). */
function replacePuzzlesWithBlocklistedWords(selected, pool, blocklist) {
  const selectedLetterSets = new Set();
  for (let i = 0; i < selected.length; i++) selectedLetterSets.add(letterSetKey(selected[i]));

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < selected.length; i++) {
      if (!puzzleHasBlocklistedWord(selected[i], blocklist)) continue;
      const oldSet = letterSetKey(selected[i]);
      let replacement = null;
      for (let j = 0; j < pool.length; j++) {
        const p = pool[j];
        const key = letterSetKey(p);
        if (selectedLetterSets.has(key)) continue;
        if (puzzleHasBlocklistedWord(p, blocklist)) continue;
        replacement = p;
        break;
      }
      if (replacement) {
        selectedLetterSets.delete(oldSet);
        selectedLetterSets.add(letterSetKey(replacement));
        selected[i] = replacement;
        changed = true;
        process.stderr.write(`Replaced puzzle with blocklisted word (letter set ${oldSet}) with clean puzzle (${letterSetKey(replacement)}).\n`);
      }
    }
  }
}

/** Count how many of the given puzzles contain each letter A–Z. */
function getLetterCounts(puzzles) {
  const counts = {};
  for (let c = 65; c <= 90; c++) counts[String.fromCharCode(c)] = 0;
  for (const p of puzzles) {
    const letters = p.center_letter + p.outer_letters;
    const seen = new Set();
    for (let i = 0; i < letters.length; i++) {
      const L = letters[i];
      if (!seen.has(L)) {
        seen.add(L);
        counts[L] = (counts[L] || 0) + 1;
      }
    }
  }
  return counts;
}

/** Build index: letter -> array of puzzles (from pool) that contain that letter. */
function indexPoolByLetter(pool) {
  const byLetter = {};
  for (let c = 65; c <= 90; c++) byLetter[String.fromCharCode(c)] = [];
  for (let i = 0; i < pool.length; i++) {
    const letters = pool[i].center_letter + pool[i].outer_letters;
    const seen = new Set();
    for (let j = 0; j < letters.length; j++) {
      const L = letters[j];
      if (!seen.has(L)) {
        seen.add(L);
        byLetter[L].push(i);
      }
    }
  }
  return byLetter;
}

/**
 * Select exactly targetCount puzzles (e.g. 50) so that:
 * - Every letter A–Z appears in at least one puzzle.
 * - Each letter has at least minPercent of its "fair share" of the 350 letter slots (50*7).
 * - If any letter is below that minimum, swap out over-represented puzzles for ones that use under-represented letters.
 */
function selectFiftyWithMinLetterPercent(pool, targetCount, minPercent) {
  const TOTAL_SLOTS = targetCount * 7;
  const fairShare = TOTAL_SLOTS / 26;
  const minCountPerLetter = Math.max(1, Math.floor(fairShare * minPercent));
  const minJKB = Math.ceil(0.10 * targetCount);   // J, K, B minimum 10% (5 of 50) — focus on J/K without forcing too high
  const getMinForLetter = (L) => (L === 'J' || L === 'K' || L === 'B') ? minJKB : minCountPerLetter;
  const defaultMax = Math.ceil(0.75 * targetCount); // 75% e.g. 38 of 50
  const capNandS = Math.ceil(0.30 * targetCount);   // N and S at 30% (15 of 50)
  const capTRIO = Math.ceil(0.35 * targetCount);    // T, R, I, O at 35% (18 of 50)
  const getMaxForLetter = (L) => {
    if (L === 'N' || L === 'S') return capNandS;
    if (L === 'T' || L === 'R' || L === 'I' || L === 'O') return capTRIO;
    return defaultMax;
  };
  const byLetter = indexPoolByLetter(pool);
  const selected = [];
  const selectedKeys = new Set();
  const selectedLetterSets = new Set();
  const letterCounts = {};
  for (let c = 65; c <= 90; c++) letterCounts[String.fromCharCode(c)] = 0;

  function addPuzzle(p) {
    selected.push(p);
    selectedKeys.add(puzzleKey(p));
    selectedLetterSets.add(letterSetKey(p));
    const letters = p.center_letter + p.outer_letters;
    const seen = new Set();
    for (let i = 0; i < letters.length; i++) {
      const L = letters[i];
      if (!seen.has(L)) {
        seen.add(L);
        letterCounts[L]++;
      }
    }
  }

  function removePuzzle(idx) {
    const p = selected[idx];
    selectedKeys.delete(puzzleKey(p));
    selectedLetterSets.delete(letterSetKey(p));
    const letters = p.center_letter + p.outer_letters;
    const seen = new Set();
    for (let i = 0; i < letters.length; i++) {
      const L = letters[i];
      if (!seen.has(L)) {
        seen.add(L);
        letterCounts[L]--;
      }
    }
    selected[idx] = selected[selected.length - 1];
    selected.pop();
  }

  // Phase 1: Ensure every letter appears at least once (coverage). Prefer puzzles that don't push N or S over cap.
  const lettersMissing = new Set();
  for (let c = 65; c <= 90; c++) lettersMissing.add(String.fromCharCode(c));
  while (lettersMissing.size > 0 && selected.length < targetCount) {
    let bestIdx = -1;
    let bestCover = 0;
    let bestWouldExceed = true;
    for (let i = 0; i < pool.length; i++) {
      if (selectedKeys.has(puzzleKey(pool[i]))) continue;
      if (selectedLetterSets.has(letterSetKey(pool[i]))) continue;
      const letters = pool[i].center_letter + pool[i].outer_letters;
      let wouldExceed = false;
      for (let j = 0; j < letters.length; j++) {
        const L = letters[j];
        if ((letterCounts[L] || 0) >= getMaxForLetter(L)) { wouldExceed = true; break; }
      }
      let cover = 0;
      for (let j = 0; j < letters.length; j++) {
        if (lettersMissing.has(letters[j])) cover++;
      }
      const prefer = cover > bestCover || (cover === bestCover && !wouldExceed && bestWouldExceed);
      if (prefer) {
        bestCover = cover;
        bestWouldExceed = wouldExceed;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const p = pool[bestIdx];
    addPuzzle(p);
    const letters = p.center_letter + p.outer_letters;
    for (let j = 0; j < letters.length; j++) lettersMissing.delete(letters[j]);
  }

  // Phase 2: Fill to targetCount with balance-aware greedy. Never add a puzzle that would push any letter over its cap (75% default; N and S at 30%). At most one puzzle per 7-letter set (no duplicate boards/pangrams).
  while (selected.length < targetCount) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
      if (selectedKeys.has(puzzleKey(pool[i]))) continue;
      if (selectedLetterSets.has(letterSetKey(pool[i]))) continue;
      const letters = pool[i].center_letter + pool[i].outer_letters;
      let wouldExceed = false;
      for (let j = 0; j < letters.length; j++) {
        const L = letters[j];
        if ((letterCounts[L] || 0) >= getMaxForLetter(L)) {
          wouldExceed = true;
          break;
        }
      }
      if (wouldExceed) continue;
      let score = 0;
      for (let j = 0; j < letters.length; j++) {
        score += 1 / (1 + (letterCounts[letters[j]] || 0));
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    addPuzzle(pool[bestIdx]);
  }

  // Phase 2b: If we couldn't reach targetCount (caps too tight), fill the rest without cap so we have 50; Phase 3 will rebalance.
  while (selected.length < targetCount) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
      if (selectedKeys.has(puzzleKey(pool[i]))) continue;
      if (selectedLetterSets.has(letterSetKey(pool[i]))) continue;
      const letters = pool[i].center_letter + pool[i].outer_letters;
      let score = 0;
      for (let j = 0; j < letters.length; j++) {
        score += 1 / (1 + (letterCounts[letters[j]] || 0));
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    addPuzzle(pool[bestIdx]);
  }

  // Phase 3: Rebalance — (a) raise letters below min (e.g. J,K,B ≥13%); (b) lower letters above max.
  const maxIterations = 1200;
  for (let iter = 0; iter < maxIterations; iter++) {
    const under = [];
    const over = [];
    for (let c = 65; c <= 90; c++) {
      const L = String.fromCharCode(c);
      if (letterCounts[L] < getMinForLetter(L)) under.push(L);
      if (letterCounts[L] > getMaxForLetter(L)) over.push(L);
    }
    over.sort((a, b) => {
      const overA = (letterCounts[a] || 0) - getMaxForLetter(a);
      const overB = (letterCounts[b] || 0) - getMaxForLetter(b);
      return overB - overA;
    });
    let didSwap = false;

    for (const L of under) {
      const candidates = byLetter[L].filter((i) => !selectedKeys.has(puzzleKey(pool[i])) && !selectedLetterSets.has(letterSetKey(pool[i])));
      if (candidates.length === 0) continue;
      let bestRemoveIdx = -1;
      let bestRemoveScore = -1;
      for (let r = 0; r < selected.length; r++) {
        const letters = selected[r].center_letter + selected[r].outer_letters;
        let overScore = 0;
        for (let j = 0; j < letters.length; j++) {
          const count = letterCounts[letters[j]] || 0;
          if (count > fairShare) overScore += count - fairShare;
        }
        if (overScore > bestRemoveScore) {
          bestRemoveScore = overScore;
          bestRemoveIdx = r;
        }
      }
      if (bestRemoveIdx < 0) continue;
      let bestAddPoolIdx = -1;
      let bestAddScore = -1;
      for (const i of candidates) {
        const p = pool[i];
        const letters = p.center_letter + p.outer_letters;
        let score = 0;
        for (let j = 0; j < letters.length; j++) {
          const count = letterCounts[letters[j]] || 0;
          if (count < getMinForLetter(letters[j])) score += 10;
          score += 1 / (1 + count);
        }
        if (score > bestAddScore) {
          bestAddScore = score;
          bestAddPoolIdx = i;
        }
      }
      if (bestAddPoolIdx < 0) continue;
      removePuzzle(bestRemoveIdx);
      addPuzzle(pool[bestAddPoolIdx]);
      didSwap = true;
      break;
    }

    if (!didSwap && over.length > 0) {
      for (const L of over) {
        let bestRemoveIdx = -1;
        let bestRemoveScore = -1;
        for (let r = 0; r < selected.length; r++) {
          const letters = selected[r].center_letter + selected[r].outer_letters;
          if (letters.indexOf(L) === -1) continue;
          let overScore = 0;
          for (let j = 0; j < letters.length; j++) {
            const count = letterCounts[letters[j]] || 0;
            if (count > fairShare) overScore += count - fairShare;
          }
          if (overScore > bestRemoveScore) {
            bestRemoveScore = overScore;
            bestRemoveIdx = r;
          }
        }
        if (bestRemoveIdx < 0) continue;
        let bestAddPoolIdx = -1;
        let bestAddScore = -1;
        for (let i = 0; i < pool.length; i++) {
          if (selectedKeys.has(puzzleKey(pool[i]))) continue;
          if (selectedLetterSets.has(letterSetKey(pool[i]))) continue;
          const letters = pool[i].center_letter + pool[i].outer_letters;
          if (letters.indexOf(L) !== -1) continue;
          let score = 0;
          for (let j = 0; j < letters.length; j++) {
            const count = letterCounts[letters[j]] || 0;
            if (count < getMinForLetter(letters[j])) score += 15;
            score += 1 / (1 + count);
          }
          if (score > bestAddScore) {
            bestAddScore = score;
            bestAddPoolIdx = i;
          }
        }
        if (bestAddPoolIdx < 0) continue;
        removePuzzle(bestRemoveIdx);
        addPuzzle(pool[bestAddPoolIdx]);
        didSwap = true;
        break;
      }
    }

    if (!didSwap) break;
  }

  return selected;
}

/**
 * Select puzzles so each letter A–Z appears in a similar number of puzzles (balanced usage).
 * Used when not in "50 with min percent" mode.
 */
function selectBalancedLetterDistribution(puzzles, targetCount) {
  if (puzzles.length === 0 || targetCount <= 0) return [];
  const count = Math.min(targetCount, puzzles.length);
  const letterCounts = {};
  for (let c = 65; c <= 90; c++) letterCounts[String.fromCharCode(c)] = 0;

  const selected = [];
  const remaining = puzzles.slice();

  for (let s = 0; s < count && remaining.length > 0; s++) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      const letters = p.center_letter + p.outer_letters;
      let score = 0;
      for (let j = 0; j < letters.length; j++) {
        const L = letters[j];
        score += 1 / (1 + (letterCounts[L] || 0));
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const chosen = remaining[bestIdx];
    selected.push(chosen);
    const letters = chosen.center_letter + chosen.outer_letters;
    for (let j = 0; j < letters.length; j++) {
      letterCounts[letters[j]] = (letterCounts[letters[j]] || 0) + 1;
    }
    remaining[bestIdx] = remaining[remaining.length - 1];
    remaining.pop();
  }
  return selected;
}

/**
 * Generate puzzles. Letter sets are discovered from wordsForLetterSets (e.g. 20k); valid_words and
 * pangrams are restricted to words in wordsForValidWordsSet (e.g. 10k) so no difficult words appear.
 */
function generatePuzzles(wordsForLetterSets, wordsForValidWordsSet, minWordsPerPuzzle = MIN_WORDS_PER_PUZZLE, minPangrams = 2) {
  const validSet = wordsForValidWordsSet instanceof Set ? wordsForValidWordsSet : new Set(wordsForValidWordsSet);
  // Index: letter set (sorted string) -> list of words from the letter-set list (20k)
  const letterSetToWords = new Map();
  for (const w of wordsForLetterSets) {
    const key = uniqueLetters(w);
    if (key.length > 7) continue;
    if (!letterSetToWords.has(key)) letterSetToWords.set(key, []);
    letterSetToWords.get(key).push(w);
  }

  const sevenLetterKeys = [];
  for (const [key] of letterSetToWords) {
    if (key.length === 7) sevenLetterKeys.push(key);
  }
  shuffleArray(sevenLetterKeys);

  const puzzles = [];
  const seenPuzzles = new Set();

  for (const letterSetKey of sevenLetterKeys) {
    const allSeven = new Set(letterSetKey);
    const letters = [...allSeven];

    const candidateSet = new Set();
    for (const subKey of allSubsetKeys(letterSetKey)) {
      const list = letterSetToWords.get(subKey);
      if (list) for (const w of list) candidateSet.add(w);
    }
    // Restrict to 10k only; exclude countries, months, and names (shared blocklist: js/proper-noun-blocklist.js)
    const candidateWords = [...candidateSet].filter((w) => validSet.has(w) && !PROPER_NOUN_BLOCKLIST.has(w));

    const hasRareLetter = /[JKB]/.test(letterSetKey);
    const minW = hasRareLetter ? 15 : minWordsPerPuzzle;
    const minP = hasRareLetter ? 1 : minPangrams;

    for (let c = 0; c < 7; c++) {
      const center = letters[c];
      const outer = letters.filter((_, i) => i !== c).sort().join('');
      const puzzleKey = center + outer;
      if (seenPuzzles.has(puzzleKey)) continue;
      seenPuzzles.add(puzzleKey);

      const validWords = candidateWords.filter((w) => w.indexOf(center) !== -1);
      const pangrams = validWords.filter((w) => isPangram(w, allSeven));

      if (pangrams.length < minP) continue;
      if (validWords.length < minW) continue;

      const totalPoints = validWords.reduce((sum, w) => sum + w.length * POINTS_PER_LETTER, 0) +
        pangrams.length * PANGRAM_BONUS;

      puzzles.push({
        center_letter: center,
        outer_letters: outer,
        valid_words: validWords.sort(),
        pangrams: pangrams.sort(),
        total_points: totalPoints,
      });
    }
  }

  return puzzles;
}

function toSql(puzzles) {
  const rows = puzzles.map((p) => {
    const vw = JSON.stringify(p.valid_words);
    const pg = JSON.stringify(p.pangrams);
    return `  ('${p.center_letter}', '${p.outer_letters}', '${vw}'::jsonb, '${pg}'::jsonb, ${p.total_points})`;
  });
  return (
    '-- Generated by scripts/generate-puzzles.js\n' +
    'INSERT INTO public.puzzles (center_letter, outer_letters, valid_words, pangrams, total_points)\n' +
    'VALUES\n' + rows.join(',\n') + '\n;'
  );
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { minWords: MIN_WORDS_PER_PUZZLE };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      opts.url = args[++i];
    } else if (args[i] === '--file' && args[i + 1]) {
      opts.file = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      opts.output = args[++i];
    } else if (args[i] === '--sql') {
      opts.sql = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
      opts.limit = parseInt(args[++i], 10);
    } else if (args[i] === '--min-words' && args[i + 1]) {
      opts.minWords = parseInt(args[++i], 10);
    } else if (args[i] === '--min-points' && args[i + 1]) {
      opts.minPoints = parseInt(args[++i], 10);
    } else if (args[i] === '--min-pangrams' && args[i + 1]) {
      opts.minPangrams = parseInt(args[++i], 10);
    } else if (args[i] === '--blocklist-url' && args[i + 1]) {
      opts.blocklistUrl = args[++i];
    } else if (args[i] === '--blocklist-file' && args[i + 1]) {
      opts.blocklistFile = args[++i];
    } else if (args[i] === '--url-20k' && args[i + 1]) {
      opts.url20k = args[++i];
    } else if (args[i] === '--file-20k' && args[i + 1]) {
      opts.file20k = args[++i];
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const blocklist = await loadBlocklist(opts);
  if (blocklist.size > 0) {
    process.stderr.write(`Blocklist: ${blocklist.size} words (from ${opts.blocklistUrl ? 'URL' : 'file'}).\n`);
  }

  const source10k = opts.file ? { file: opts.file } : { url: opts.url || URL_10K };
  const sourceDiscovery = opts.file20k ? { file: opts.file20k } : { url: opts.url20k || URL_20K };
  process.stderr.write('Loading 10k (valid words only) and discovery list (20k default; use --url-20k for a 35k+ list)...\n');
  const [text10k, textDiscovery] = await Promise.all([
    loadWords(source10k),
    loadWords(sourceDiscovery),
  ]);
  const words10k = parseWordList(text10k, blocklist);
  const wordsDiscovery = parseWordList(textDiscovery, blocklist);
  process.stderr.write(`Loaded 10k: ${words10k.length} words (for valid_words/pangrams). Discovery: ${wordsDiscovery.length} words (for board discovery).\n`);

  const validWordsSet = new Set(words10k);
  const minWords = opts.minWords != null ? opts.minWords : MIN_WORDS_PER_PUZZLE;
  const minPangrams = opts.minPangrams != null ? opts.minPangrams : 2;
  let puzzles = generatePuzzles(wordsDiscovery, validWordsSet, minWords, minPangrams);

  if (opts.minPoints != null && opts.minPoints > 0) {
    puzzles = puzzles.filter((p) => p.total_points >= opts.minPoints);
  }
  const POOL_MIN_POINTS = 100;
  const POOL_MAX_POINTS = 700;
  puzzles = puzzles.filter((p) => p.total_points >= POOL_MIN_POINTS && p.total_points <= POOL_MAX_POINTS);

  // Prefer letter variety: sort by diversity score first so balance selection has good candidates.
  puzzles.sort((a, b) => {
    const aDiv = letterDiversityScore(a);
    const bDiv = letterDiversityScore(b);
    if (bDiv !== aDiv) return bDiv - aDiv;
    const aWords = a.valid_words.length;
    const bWords = b.valid_words.length;
    if (bWords !== aWords) return bWords - aWords;
    const aPangs = a.pangrams.length;
    const bPangs = b.pangrams.length;
    if (bPangs !== aPangs) return bPangs - aPangs;
    const aLetters = (a.center_letter + a.outer_letters);
    const bLetters = (b.center_letter + b.outer_letters);
    const aS = (aLetters.match(/S/g) || []).length;
    const bS = (bLetters.match(/S/g) || []).length;
    return aS - bS;
  });

  // Generate exactly 100 puzzles with per-letter minimum: every letter used, each at least minPercent of fair share.
  const TARGET_PUZZLE_COUNT = 100;
  const MIN_LETTER_PERCENT = 0.3;  // each letter in at least 30% of fair share (~8 of 100 puzzles when fair share ≈ 27)
  const targetCount = opts.limit != null ? Math.min(opts.limit, puzzles.length) : Math.min(TARGET_PUZZLE_COUNT, puzzles.length);
  const fullPool = puzzles.slice();
  puzzles = selectFiftyWithMinLetterPercent(puzzles, targetCount, MIN_LETTER_PERCENT);
  shuffleArray(puzzles);
  replacePuzzlesWithBlocklistedWords(puzzles, fullPool, PROPER_NOUN_BLOCKLIST);

  const counts = getLetterCounts(puzzles);
  const totalSlots = puzzles.length * 7;
  const fairShare = totalSlots / 26;
  const minRequired = Math.max(1, Math.floor(fairShare * MIN_LETTER_PERCENT));
  process.stderr.write(`Generated ${puzzles.length} puzzles (letter-balanced; each with ≥${minPangrams} pangrams, ≥${minWords} words).\n`);
  process.stderr.write(`Letter occurrence (min ${minRequired} per letter, fair share ≈ ${fairShare.toFixed(1)}):\n`);
  const letters = Object.keys(counts).sort();
  const numPuzzles = puzzles.length;
  for (const L of letters) {
    const n = counts[L];
    const pct = ((n / numPuzzles) * 100).toFixed(1);
    const bar = '#'.repeat(Math.round((n / numPuzzles) * 20)) + '-'.repeat(20 - Math.round((n / numPuzzles) * 20));
    process.stderr.write(`  ${L}: ${String(n).padStart(2)} puzzles (${String(pct).padStart(5)}%) ${bar}\n`);
  }

  let out;
  if (opts.sql) {
    out = toSql(puzzles);
  } else {
    out = JSON.stringify(puzzles, null, 2);
  }

  if (opts.output) {
    fs.writeFileSync(opts.output, out, 'utf8');
    process.stderr.write(`Wrote ${opts.output}\n`);
  } else {
    console.log(out);
  }
}

main().catch((err) => {
  process.stderr.write(err.message + '\n');
  process.exit(1);
});
