const fs = require("fs");
const path = require("path");
const https = require("https");

const SPELLBOUND_BLOCKLIST = require(path.join(__dirname, "../../js/proper-noun-blocklist.js"));
const PROPER_NOUN_BLOCKLIST = SPELLBOUND_BLOCKLIST.all;

// ---------------- SETTINGS ----------------
const MIN_WORD_LENGTH = 4;
const MAX_WORD_LENGTH = 12;
const MIN_WORD_COUNT = 20;
const MIN_PANGRAMS = 2;
/** When RARE_LETTER_MODE is true, use these lower thresholds (W/K/J boards are harder to fill). */
const MIN_WORD_COUNT_RARE = 15;
const MIN_PANGRAMS_RARE = 1;
/** Letters that must not appear in any puzzle (no S, Q, X, or Z boards). */
const BANNED_LETTERS = new Set(["s", "q", "x", "z"]);
/**
 * When true, only generate puzzles whose 7-letter set includes at least one
 * of these rare letters (e.g. W, K, J). When false, use the normal v2 rules.
 */
const RARE_LETTER_MODE = true;
const RARE_LETTERS = new Set(["w", "k", "j"]);
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
 * Load the set of allowed words from the 10k list only. Only these words appear in valid_words/pangrams.
 * Uses the Google 10k English list from the repo (no local file, no 20k).
 */
function loadAllowedWords() {
  return new Promise((resolve, reject) => {
    https.get(ALLOWED_WORDS_10K_URL, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error("Failed to fetch allowed words: " + res.statusCode));
        return;
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const set = new Set();
        raw.split(/\r?\n/).forEach(line => {
          const w = line.trim().toLowerCase();
          if (w && /^[a-z]+$/.test(w)) set.add(w);
        });
        resolve(set);
      });
      res.on("error", reject);
    }).on("error", reject);
  });
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

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
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
function generatePuzzle(wordList, allowedSet) {
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
    let withRare = 0;
    for (const w of rawPangrams) {
      const letters = getUniqueLetters(w);
      let bannedHit = false;
      for (const L of BANNED_LETTERS) {
        if (letters.includes(L)) {
          bannedHit = true;
          break;
        }
      }
      if (!bannedHit) {
        afterBanned++;
        for (const R of RARE_LETTERS) {
          if (letters.includes(R)) {
            withRare++;
            break;
          }
        }
      }
    }
    console.log("DEBUG pangrams (7-letter words in allowedSet):", totalRaw);
    console.log("DEBUG pangrams after excluding banned letters", Array.from(BANNED_LETTERS).join(","), ":", afterBanned);
    if (RARE_LETTER_MODE) {
      console.log("DEBUG pangrams after requiring at least one rare letter", Array.from(RARE_LETTERS).join(","), ":", withRare);
    }
    const sample = rawPangrams.slice(0, 30).map(w => {
      const letters = getUniqueLetters(w);
      const hasRare = Array.from(RARE_LETTERS).some(r => letters.includes(r));
      const hasBanned = Array.from(BANNED_LETTERS).some(b => letters.includes(b));
      return `${w} [${letters}] rare=${hasRare ? "Y" : "N"} banned=${hasBanned ? "Y" : "N"}`;
    });
    console.log("DEBUG sample pangrams (first 30):");
    sample.forEach(line => console.log("  ", line));
    loggedPangramDebug = true;
  }

  // Step 2: apply banned/rare filters to pangrams actually used for boards.
  let pangrams = rawPangrams.filter(w => {
    const letters = getUniqueLetters(w);
    for (const L of BANNED_LETTERS) {
      if (letters.includes(L)) return false;
    }
    if (RARE_LETTER_MODE) {
      let hasRare = false;
      for (const R of RARE_LETTERS) {
        if (letters.includes(R)) {
          hasRare = true;
          break;
        }
      }
      if (!hasRare) return false;
    }
    return true;
  });

  if (pangrams.length === 0) {
    throw new Error("No pangrams found (in allowed list and without S/Q).");
  }

  // Try every pangram (in random order) and, for each, try all 7 possible center letters.
  // Pre-filtering baseCandidates per pangram keeps this fast.
  const shuffledPangrams = shuffle([...pangrams]);
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

    const centers = shuffle([...letters]);

    for (const center of centers) {
      const outer = letters.filter((ch) => ch !== center);

      const candidateWords = baseCandidates.filter((w) => w.includes(center));
      const validWords = candidateWords.filter((w) => allowedSet.has(w));
      const pangramWords = validWords.filter(
        (w) => getUniqueLetters(w).length === 7
      );

      const minWords = RARE_LETTER_MODE ? MIN_WORD_COUNT_RARE : MIN_WORD_COUNT;
      const minPangrams = RARE_LETTER_MODE ? MIN_PANGRAMS_RARE : MIN_PANGRAMS;
      if (
        validWords.length >= minWords &&
        pangramWords.length >= minPangrams
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
const POINTS_PER_LETTER = 1;
const PANGRAM_BONUS = 5;
/** Run generation for this many milliseconds (e.g. 20 minutes). Set to 0 to use TARGET_PUZZLE_COUNT. */
const GENERATE_DURATION_MS = 2 * 60 * 1000;
/** When GENERATE_DURATION_MS is 0, generate exactly this many puzzles. */
const TARGET_PUZZLE_COUNT = 50;

function letterSetKey(puzzle) {
  if (puzzle.letters && Array.isArray(puzzle.letters) && puzzle.letters.length === 7) {
    return puzzle.letters.slice().sort().join("");
  }
  const raw = String(puzzle.center_letter || "") + String(puzzle.outer_letters || "");
  return raw.toUpperCase().replace(/[^A-Z]/g, "").split("").sort().join("");
}

async function main() {
  console.log("Loading word list from wiki-100k.txt, allowed 10k list, and common-7-letter-words...");
  const [wordList, allowedSet, common7] = await Promise.all([
    Promise.resolve(loadWordList()),
    loadAllowedWords(),
    loadCommon7Words(),
  ]);
  console.log("Loaded wiki words:", wordList.length);
  console.log("Allowed words (10k list):", allowedSet.size);
  console.log("Loaded common-7-letter-words:", common7.length);

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
    seenLetterSets.add(letterSetKey(p));
  }
  const startTime = Date.now();
  let count = 0;
  let lastLogAtPuzzle = -1;
  let lastLogAtSec = -1;

  while ((useTimeLimit && Date.now() - startTime < GENERATE_DURATION_MS) || (!useTimeLimit && count < TARGET_PUZZLE_COUNT)) {
    let puzzle;
    try {
      puzzle = generatePuzzle(wordList, allowedSet);
    } catch (e) {
      console.log("WARN generatePuzzle failed:", e && e.message ? e.message : e);
      if (!useTimeLimit) {
        // If we're in fixed-count mode and can't find more puzzles, stop cleanly.
        break;
      }
      // In time-limited mode, just try again with remaining time.
      continue;
    }
    let key = letterSetKey(puzzle);
    let attempts = 0;
    while (seenLetterSets.has(key) && attempts < 50) {
      if (useTimeLimit && Date.now() - startTime >= GENERATE_DURATION_MS) break;
      if (!useTimeLimit && count >= TARGET_PUZZLE_COUNT) break;
      puzzle = generatePuzzle(wordList, allowedSet);
      key = letterSetKey(puzzle);
      attempts++;
    }
    if (useTimeLimit && Date.now() - startTime >= GENERATE_DURATION_MS) break;
    if (!useTimeLimit && count >= TARGET_PUZZLE_COUNT) break;
    seenLetterSets.add(key);

    const enrichedValid = enrichValidWords(puzzle.center, puzzle.outer, wordList);
    const totalPoints =
      enrichedValid.reduce((sum, w) => sum + w.length * POINTS_PER_LETTER, 0) +
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

  console.log("  Done. Generated " + count + " new puzzles. Total (before filters): " + output.length + ".");

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
        p.valid_words.reduce((sum, w) => sum + w.length * POINTS_PER_LETTER, 0) +
        p.pangrams.length * PANGRAM_BONUS;
    }
  }
  if (removedCount > 0) {
    console.log("\nRemoved", removedCount, "blocklisted word(s) from puzzles.");
  }

  // Remove any puzzle that has fewer than min pangrams (e.g. after blocklist removal)
  const beforeCount = output.length;
  const minPangramsFilter = RARE_LETTER_MODE ? MIN_PANGRAMS_RARE : MIN_PANGRAMS;
  const filtered = output.filter(p => (p.pangrams || []).length >= minPangramsFilter);
  const removedPuzzles = beforeCount - filtered.length;
  if (removedPuzzles > 0) {
    console.log("\nRemoved", removedPuzzles, "puzzle(s) with fewer than", minPangramsFilter, "pangram(s). Writing", filtered.length, "puzzles.");
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

  // Letter occurrence: how many puzzles contain each letter (in the 7 letters: center + outer)
  const counts = {};
  for (let c = 65; c <= 90; c++) counts[String.fromCharCode(c)] = 0;
  for (const p of output) {
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
  const numPuzzles = output.length;
  const totalSlots = numPuzzles * 7;
  const fairShare = totalSlots / 26;
  console.log("\nLetter occurrence (in outer 7 letters; fair share ≈ " + fairShare.toFixed(1) + " per letter):");
  for (const L of Object.keys(counts).sort()) {
    const n = counts[L];
    const pct = ((n / numPuzzles) * 100).toFixed(1);
    const bar = "#".repeat(Math.round((n / numPuzzles) * 20)) + "-".repeat(20 - Math.round((n / numPuzzles) * 20));
    console.log("  " + L + ": " + String(n).padStart(2) + " puzzles (" + String(pct).padStart(5) + "%) " + bar);
  }

  const dataDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");

  console.log("\nWrote", output.length, "puzzles to", OUTPUT_PATH);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
