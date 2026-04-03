const fs = require("fs");
const path = require("path");
const https = require("https");

const SPELLBOUND_BLOCKLIST = require(path.join(__dirname, "../../js/proper-noun-blocklist.js"));
const PROPER_NOUN_BLOCKLIST = SPELLBOUND_BLOCKLIST.all;

// ---------------- SETTINGS ----------------
const MIN_WORD_LENGTH = 4;
const MAX_WORD_LENGTH = 12;
const MIN_WORD_COUNT = 15;
const MIN_PANGRAMS = 2;
/**
 * Letters that must not appear in any generated puzzle.
 * NYT-style: no S (easy plurals). Q/X/Z/J/etc. are allowed for more varied boards.
 */
const BANNED_LETTERS = new Set(["s"]);

/** Scrabble tile values — used to try pangrams / centers with rarer letters more often. */
const SCRABBLE_VALUES = {
  a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3,
  n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10,
};

function raritySumForLetterString(lowerSevenLetters) {
  let sum = 0;
  for (let i = 0; i < lowerSevenLetters.length; i++) {
    const ch = lowerSevenLetters[i];
    sum += SCRABBLE_VALUES[ch] || 0;
  }
  return sum;
}
const WIKI_WORD_LIST_PATH = path.join(__dirname, "../../data/wiki-100k.txt");

/** Only words in the 10k list are allowed in valid_words and pangrams. No local file or 20k—only this 10k source. */
const ALLOWED_WORDS_10K_URL = "https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english.txt";
/** Extra pangram source: common 7-letter words (TWL2006 & CSW2007 intersection from poslarchive.com). */
const COMMON_7_PATH = path.join(__dirname, "../../data/common-7-letter-words.txt");

/** Optional: remove words ending in these obscure suffixes (e.g. scientific/technical). */
const OBSCURE_SUFFIXES = [
  "idae", "aceae", "ology", "ologist", "otomy", "itis", "osis",
  "mentum", "tional", "ative", "escence"
];
const FILTER_OBSCURE_SUFFIXES = true;
// ------------------------------------------

/**
 * Load and clean words from wiki-100k.txt (one word per line).
 * - Lowercase
 * - 4–12 letters, alphabetic only
 * - Optionally remove words ending in OBSCURE_SUFFIXES
 */
function loadWordList() {
  const filePath = WIKI_WORD_LIST_PATH;
    if (!fs.existsSync(filePath)) {
    throw new Error("Missing word list: " + filePath);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const words = new Set();

  for (const line of lines) {
    const word = line.trim().toLowerCase();
    if (word.length < MIN_WORD_LENGTH || word.length > MAX_WORD_LENGTH) continue;
    if (!/^[a-z]+$/.test(word)) continue;

    if (FILTER_OBSCURE_SUFFIXES && OBSCURE_SUFFIXES.some(s => word.endsWith(s))) {
      continue;
    }
          words.add(word);
        }

  return Array.from(words);
}

/**
 * Legacy: previously we loaded a separate 10k \"allowed\" list from GitHub.
 * Now we simply use the cleaned wiki-100k list (loadWordList) as the allowed set.
 * This function is kept for backwards compatibility but no longer performs a network request.
 */
function loadAllowedWords() {
  const words = loadWordList();
  return Promise.resolve(new Set(words));
}

/** Load common-7-letter-words.txt (poslarchive) as an array of lowercase words. */
function loadCommon7Words() {
  return fs.promises.readFile(COMMON_7_PATH, "utf8").then((raw) => {
    const out = [];
    raw.split(/\r?\n/).forEach((line) => {
      const w = line.trim().toLowerCase();
      if (w && /^[a-z]+$/.test(w)) out.push(w);
    });
    return out;
  });
}

function getUniqueLetters(word) {
  return [...new Set(word)].sort().join("");
}

function isValidWord(word, lettersSet, centerLetter) {
  if (word.length < MIN_WORD_LENGTH) return false;
  if (!word.includes(centerLetter)) return false;

  for (const char of word) {
    if (!lettersSet.has(char)) return false;
  }

  return true;
}

/**
 * Generate one Spelling Bee puzzle (NYT rules):
 * - Exactly 7 unique letters, one center letter
 * - Words must include center and use only those 7 letters, ≥ 4 letters
 * - At least one pangram (word using all 7 letters)
 * - validWords and pangramWords are restricted to allowedSet (e.g. 10k list) for selection
 * Returns { letters, center, outer, validWords (sorted), pangramWords }.
 */
let loggedPangramDebug = false;
let COMMON7_ALLOWED = null;
/**
 * @param {Set<string>} [excludeLetterSets] - Optional set of 7-letter keys (uppercase, sorted) to skip; only tries pangrams that could yield new puzzles.
 */
function generatePuzzle(wordList, allowedSet, excludeLetterSets) {
  // Step 1: pangrams that are in the 10k allowed list (7 unique letters)
  let rawPangrams = wordList.filter(
    w => getUniqueLetters(w).length === 7 && allowedSet.has(w)
  );

  // Mix in extra 7-letter candidates from common-7-letter-words.
  if (COMMON7_ALLOWED && COMMON7_ALLOWED.length) {
    rawPangrams = Array.from(new Set([...rawPangrams, ...COMMON7_ALLOWED]));
  }

  // One-time debug dump so we can see what the filters are doing.
  if (!loggedPangramDebug) {
    const totalRaw = rawPangrams.length;
    let afterBanned = 0;
    for (const w of rawPangrams) {
      const letters = getUniqueLetters(w);
      let bannedHit = false;
      for (const L of BANNED_LETTERS) {
        if (letters.includes(L)) {
          bannedHit = true;
          break;
        }
      }
      if (!bannedHit) afterBanned++;
    }
    console.log("DEBUG pangrams (7-letter words in allowedSet):", totalRaw);
    console.log("DEBUG pangrams after excluding banned letters (no S):", afterBanned);
    const sample = rawPangrams.slice(0, 30).map(w => {
      const letters = getUniqueLetters(w);
      const hasBanned = Array.from(BANNED_LETTERS).some(b => letters.includes(b));
      return `${w} [${letters}] banned=${hasBanned ? "Y" : "N"}`;
    });
    console.log("DEBUG sample pangrams (first 30):");
    sample.forEach(line => console.log("  ", line));
    loggedPangramDebug = true;
  }

  // Step 2: apply banned-letter filter to pangrams used for boards.
  let pangrams = rawPangrams.filter(w => {
    const letters = getUniqueLetters(w);
    for (const L of BANNED_LETTERS) {
      if (letters.includes(L)) return false;
    }
    return true;
  });

  // Step 2b: skip pangrams whose 7-letter set we already have (so we only try new ones).
  if (excludeLetterSets && excludeLetterSets.size > 0) {
    pangrams = pangrams.filter(w => {
      const key = getUniqueLetters(w);
      return !excludeLetterSets.has(key);
    });
  }

  if (pangrams.length === 0) {
    if (excludeLetterSets && excludeLetterSets.size > 0) {
      console.log(
        "DEBUG generatePuzzle: all pangram candidates are already used (excludeLetterSets size =",
        excludeLetterSets.size + ")."
      );
    }
    throw new Error("No pangrams found (in allowed list; boards exclude S only).");
  }

  // Try pangrams in an order biased toward rarer letter sets (with noise for variety).
  // Pre-filtering baseCandidates per pangram keeps this fast.
  const shuffledPangrams = [...pangrams].sort((a, b) => {
    const ra = raritySumForLetterString(getUniqueLetters(a)) + Math.random() * 14;
    const rb = raritySumForLetterString(getUniqueLetters(b)) + Math.random() * 14;
    return rb - ra;
  });
  for (const randomPangram of shuffledPangrams) {
    const letters = getUniqueLetters(randomPangram).split("");
    const lettersSet = new Set(letters);

    // Pre-filter all words that can possibly fit these 7 letters (ignoring center for now).
    const baseCandidates = wordList.filter((w) => {
      if (w.length < MIN_WORD_LENGTH) return false;
      for (const ch of w) {
        if (!lettersSet.has(ch)) return false;
      }
      return true;
    });

    const centers = [...letters].sort((a, b) => {
      const sa = (SCRABBLE_VALUES[a] || 0) + Math.random() * 4;
      const sb = (SCRABBLE_VALUES[b] || 0) + Math.random() * 4;
      return sb - sa;
    });

    for (const center of centers) {
      const outer = letters.filter((ch) => ch !== center);

      const candidateWords = baseCandidates.filter((w) => w.includes(center));
      const validWords = candidateWords.filter((w) => allowedSet.has(w));
    const pangramWords = validWords.filter(
        (w) => getUniqueLetters(w).length === 7
    );

    if (
      validWords.length >= MIN_WORD_COUNT &&
        pangramWords.length >= MIN_PANGRAMS
    ) {
      return {
        letters,
        center,
        outer,
        validWords: validWords.sort(),
          pangramWords: pangramWords.sort(),
        };
      }
    }
  }

  throw new Error(
    "No suitable puzzle found for current pangram pool (try relaxing MIN_WORD_COUNT/MIN_PANGRAMS or filters)."
  );
}

/**
 * Enrich valid_words for a puzzle using the full wiki-100k word list (like scripts/enrich-puzzles-2.js):
 * - Includes all words that fit the 7 letters + center rule
 * - Removes proper nouns via PROPER_NOUN_BLOCKLIST
 * - Returns sorted, de-duplicated list
 */
function enrichValidWords(center, outer, wordList) {
  const letters = [center, ...outer];
  const lettersSet = new Set(letters);
  const valid = wordList.filter(w => isValidWord(w, lettersSet, center));
  const withoutBlocklist = valid.filter(
    w => !PROPER_NOUN_BLOCKLIST.has(String(w).trim().toUpperCase())
  );
  const deduped = Array.from(new Set(withoutBlocklist));
  deduped.sort();
  return deduped;
}

// ---------------- RUN ----------------

const OUTPUT_PATH = path.join(__dirname, "../../data/puzzles-2.json");
/** Points by word length: 4→4, 5→6, 6→8, 7→10, 8→12, ... (2*len - 4 for len >= 4). */
function pointsForWordLength(len) {
  return len >= 4 ? 2 * len - 4 : 0;
}
const PANGRAM_BONUS = 5;
/** Run generation for this many milliseconds (e.g. 20 minutes). Set to 0 to use TARGET_PUZZLE_COUNT. */
const GENERATE_DURATION_MS = 5 * 60 * 1000;
/** When GENERATE_DURATION_MS is 0, generate exactly this many puzzles. */
const TARGET_PUZZLE_COUNT = 50;

function letterSetKey(puzzle) {
  if (puzzle.letters && Array.isArray(puzzle.letters) && puzzle.letters.length === 7) {
    return puzzle.letters.slice().sort().join("");
  }
  const raw = String(puzzle.center_letter || "") + String(puzzle.outer_letters || "");
  return raw.toUpperCase().replace(/[^A-Z]/g, "").split("").sort().join("");
}

/**
 * Generate a single puzzle object shaped like data/puzzles-2.json
 * using the same pipeline as the CLI script, but without writing to disk.
 */
async function generateSinglePuzzle() {
  const [wordList, allowedSetFromWiki, common7] = await Promise.all([
    Promise.resolve(loadWordList()),
    loadAllowedWords(),
    loadCommon7Words(),
  ]);

  const allowedSet = allowedSetFromWiki;
  COMMON7_ALLOWED = common7.filter((w) => getUniqueLetters(w).length === 7);

  const puzzle = generatePuzzle(wordList, allowedSet);
  const enrichedValid = enrichValidWords(puzzle.center, puzzle.outer, wordList);
  const totalPoints =
    enrichedValid.reduce((sum, w) => sum + pointsForWordLength(w.length), 0) +
    puzzle.pangramWords.length * PANGRAM_BONUS;

  return {
    center_letter: String(puzzle.center || "").toUpperCase(),
    outer_letters: puzzle.outer.join("").toUpperCase(),
    valid_words: enrichedValid.map((w) => String(w || "").toUpperCase()),
    pangrams: puzzle.pangramWords.map((w) => String(w || "").toUpperCase()),
    total_points: totalPoints,
  };
}

async function main() {
  console.log("Loading word list from wiki-100k.txt (used for allowed words), and common-7-letter-words...");
  const [wordList, allowedSetFromWiki, common7] = await Promise.all([
    Promise.resolve(loadWordList()),
    loadAllowedWords(),
    loadCommon7Words(),
  ]);
  console.log("Loaded wiki words:", wordList.length);
  console.log("Allowed words (wiki-100k cleaned):", allowedSetFromWiki.size);
  console.log("Loaded common-7-letter-words:", common7.length);

  const allowedSet = allowedSetFromWiki;
  COMMON7_ALLOWED = common7.filter((w) => getUniqueLetters(w).length === 7);
  console.log("Common-7 pangrams (7 unique letters) from common-7 list:", COMMON7_ALLOWED.length);

  // Load existing puzzles so we append instead of replacing, and avoid duplicate boards.
  let existing = [];
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      const rawExisting = fs.readFileSync(OUTPUT_PATH, "utf8");
      const arr = JSON.parse(rawExisting);
      if (Array.isArray(arr)) existing = arr;
    } catch (e) {
      existing = [];
    }
  }
  console.log("Existing puzzles in", OUTPUT_PATH + ":", existing.length);

  const useTimeLimit = GENERATE_DURATION_MS > 0;
  if (useTimeLimit) {
    console.log("Generating puzzles for " + (GENERATE_DURATION_MS / 60000) + " minute(s) and appending to existing set...");
  } else {
    console.log("Generating " + TARGET_PUZZLE_COUNT + " new puzzles and appending to existing set...");
  }
  const output = existing.slice();
  const seenLetterSets = new Set();
  for (const p of existing) {
    seenLetterSets.add(letterSetKey(p).toLowerCase());
  }
  const startTime = Date.now();
  let count = 0;
  let lastLogAtPuzzle = -1;
  let lastLogAtSec = -1;
  let duplicateSkips = 0;
  let generateFailures = 0;

  while ((useTimeLimit && Date.now() - startTime < GENERATE_DURATION_MS) || (!useTimeLimit && count < TARGET_PUZZLE_COUNT)) {
    let puzzle;
    try {
      puzzle = generatePuzzle(wordList, allowedSet, seenLetterSets);
    } catch (e) {
      console.log("WARN generatePuzzle failed:", e && e.message ? e.message : e);
      generateFailures++;
      if (!useTimeLimit) {
        // If we're in fixed-count mode and can't find more puzzles, stop cleanly.
        break;
      }
      // In time-limited mode, just try again with remaining time.
      continue;
    }
    let key = letterSetKey(puzzle).toLowerCase();
    if (seenLetterSets.has(key)) {
      duplicateSkips++;
      if (duplicateSkips % 50 === 0) {
        console.log(
          "DEBUG main loop: skipped",
          duplicateSkips,
          "duplicate puzzle(s) so far (seenLetterSets size =",
          seenLetterSets.size + ")."
        );
      }
      continue;
    }
    seenLetterSets.add(key);

    const enrichedValid = enrichValidWords(puzzle.center, puzzle.outer, wordList);
    const totalPoints =
      enrichedValid.reduce((sum, w) => sum + pointsForWordLength(w.length), 0) +
      puzzle.pangramWords.length * PANGRAM_BONUS;

    output.push({
      center_letter: puzzle.center,
      outer_letters: puzzle.outer.join(""),
      valid_words: enrichedValid,
      pangrams: puzzle.pangramWords,
      total_points: totalPoints,
    });
    count++;
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    const totalSoFar = existing.length + count;
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    const timeStr = mins + "m " + String(secs).padStart(2, "0") + "s";
    const shouldLogEvery10 = count === 1 || count % 10 === 0;
    const shouldLogEvery30s = useTimeLimit && elapsedSec >= 30 && Math.floor(elapsedSec / 30) > lastLogAtSec;
    if (shouldLogEvery10 || shouldLogEvery30s) {
      if (shouldLogEvery10) lastLogAtPuzzle = count;
      if (shouldLogEvery30s) lastLogAtSec = Math.floor(elapsedSec / 30);
      console.log("  " + count + " new puzzles (" + totalSoFar + " total, " + timeStr + ")");
    }
  }

  console.log("  Done. Generated " + count + " new unique puzzle(s) this run.");
  console.log("  DEBUG summary: seenLetterSets size =", seenLetterSets.size, ", duplicate skips =", duplicateSkips, ", generatePuzzle failures =", generateFailures, ".");
  console.log("  Total puzzles before blocklist/min-pangram filters:", output.length + ".");

  // Remove any valid_words or pangrams that are in the proper-noun blocklist; log and recompute points
  let removedCount = 0;
  for (let i = 0; i < output.length; i++) {
    const p = output[i];
    const check = (w) => PROPER_NOUN_BLOCKLIST.has(String(w).trim().toUpperCase());
    const blockedValid = (p.valid_words || []).filter(check);
    const blockedPangrams = (p.pangrams || []).filter(check);
    if (blockedValid.length > 0 || blockedPangrams.length > 0) {
      [...new Set([...blockedValid, ...blockedPangrams])].forEach(w =>
        console.log("  Blocked (proper noun): " + w)
      );
      removedCount += blockedValid.length + blockedPangrams.length;
      p.valid_words = (p.valid_words || []).filter(w => !check(w));
      p.pangrams = (p.pangrams || []).filter(w => !check(w));
      p.total_points =
        p.valid_words.reduce((sum, w) => sum + pointsForWordLength(w.length), 0) +
        p.pangrams.length * PANGRAM_BONUS;
    }
  }
  if (removedCount > 0) {
    console.log("\nRemoved", removedCount, "blocklisted word(s) from puzzles.");
  }

  // Remove any puzzle that has fewer than min pangrams (e.g. after blocklist removal)
  const beforeCount = output.length;
  const filtered = output.filter(p => (p.pangrams || []).length >= MIN_PANGRAMS);
  const removedPuzzles = beforeCount - filtered.length;
  if (removedPuzzles > 0) {
    console.log("\nRemoved", removedPuzzles, "puzzle(s) with fewer than", MIN_PANGRAMS, "pangram(s). Writing", filtered.length, "puzzles.");
  }
  output.length = 0;
  output.push(...filtered);

  // Remove duplicate puzzles (same 7-letter set); keep first occurrence, log the rest.
  const byKey = new Map();
  for (const p of output) {
    const key = letterSetKey(p);
    if (byKey.has(key)) {
      byKey.get(key).dupes++;
    } else {
      byKey.set(key, { puzzle: p, dupes: 1 });
    }
  }
  const uniquePuzzles = Array.from(byKey.values()).map((v) => v.puzzle);
  const removedDupes = output.length - uniquePuzzles.length;
  if (removedDupes > 0) {
    console.log("\nRemoved", removedDupes, "duplicate puzzle(s) (same 7-letter set).");
    const dupList = Array.from(byKey.entries())
      .filter(([, v]) => v.dupes > 1)
      .sort((a, b) => b[1].dupes - a[1].dupes);
    dupList.forEach(([key, v]) => {
      console.log("  ", key.toLowerCase() + ":", v.dupes, "copy/copies (kept 1, removed", v.dupes - 1 + ")");
    });
  }
  output.length = 0;
  output.push(...uniquePuzzles);

  const dataDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");

  console.log("\nWrote", output.length, "puzzles to", OUTPUT_PATH);

  // Letter occurrence: analyse ALL puzzles in the file (not just this run's output)
  let allPuzzles = output;
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      const raw = fs.readFileSync(OUTPUT_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) allPuzzles = parsed;
    } catch (e) {
      // fallback to output if read fails
    }
  }
  const counts = {};
  for (let c = 65; c <= 90; c++) counts[String.fromCharCode(c)] = 0;
  for (const p of allPuzzles) {
    const letters = (p.center_letter + (p.outer_letters || "")).toUpperCase();
    const seen = new Set();
    for (let i = 0; i < letters.length; i++) {
      const L = letters[i];
      if (!seen.has(L)) {
        seen.add(L);
        counts[L] = (counts[L] || 0) + 1;
      }
    }
  }
  const numPuzzles = allPuzzles.length;
  const totalSlots = numPuzzles * 7;
  const fairShare = totalSlots / 26;
  console.log("\nLetter occurrence (all " + numPuzzles + " puzzles in file; fair share ≈ " + fairShare.toFixed(1) + " per letter):");
  for (const L of Object.keys(counts).sort()) {
    const n = counts[L];
    const pct = ((n / numPuzzles) * 100).toFixed(1);
    const bar = "#".repeat(Math.round((n / numPuzzles) * 20)) + "-".repeat(20 - Math.round((n / numPuzzles) * 20));
    console.log("  " + L + ": " + String(n).padStart(2) + " puzzles (" + String(pct).padStart(5) + "%) " + bar);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  generateSinglePuzzle,
};
