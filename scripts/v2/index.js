const fs = require("fs");
const path = require("path");
const https = require("https");

const SPELLBOUND_BLOCKLIST = require(path.join(__dirname, "../../js/proper-noun-blocklist.js"));
const PROPER_NOUN_BLOCKLIST = SPELLBOUND_BLOCKLIST.all;

// ---------------- SETTINGS ----------------
const MIN_WORD_LENGTH = 4;
const MAX_WORD_LENGTH = 12;
const MIN_WORD_COUNT = 25;
const MIN_PANGRAMS = 2;
/** Letters that must not appear in any puzzle (no S or Q boards). */
const BANNED_LETTERS = new Set(["s", "q"]);
const WIKI_WORD_LIST_PATH = path.join(__dirname, "../../data/wiki-100k.txt");

/** Only words in the 10k list are allowed in valid_words and pangrams. No local file or 20k—only this 10k source. */
const ALLOWED_WORDS_10K_URL = "https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english.txt";

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
 * - validWords and pangramWords are restricted to allowedSet (e.g. 100k most frequent English)
 * Returns { letters, center, outer, validWords (sorted), pangramWords }.
 */
function generatePuzzle(wordList, allowedSet) {
  let pangrams = wordList.filter(
    w => getUniqueLetters(w).length === 7 && allowedSet.has(w)
  );
  pangrams = pangrams.filter(w => {
    const letters = getUniqueLetters(w);
    for (const L of BANNED_LETTERS) {
      if (letters.includes(L)) return false;
    }
    return true;
  });

  if (pangrams.length === 0) {
    throw new Error("No pangrams found (in allowed list and without S/Q).");
  }

  while (true) {
    const randomPangram =
      pangrams[Math.floor(Math.random() * pangrams.length)];

    const letters = getUniqueLetters(randomPangram).split("");
    const shuffled = shuffle([...letters]);

    const center = shuffled[0];
    const outer = shuffled.slice(1);
    const lettersSet = new Set(letters);

    const candidateWords = wordList.filter(w =>
      isValidWord(w, lettersSet, center)
    );
    const validWords = candidateWords.filter(w => allowedSet.has(w));
    const pangramWords = validWords.filter(
      w => getUniqueLetters(w).length === 7
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

// ---------------- RUN ----------------

const OUTPUT_PATH = path.join(__dirname, "../../data/puzzles-2.json");
const POINTS_PER_LETTER = 1;
const PANGRAM_BONUS = 5;
/** Run generation for this many milliseconds (e.g. 5 minutes). Set to 0 to use TARGET_PUZZLE_COUNT. */
const GENERATE_DURATION_MS = 30 * 60 * 1000;
/** When GENERATE_DURATION_MS is 0, generate exactly this many puzzles. */
const TARGET_PUZZLE_COUNT = 50;

function letterSetKey(puzzle) {
  return puzzle.letters.slice().sort().join("");
}

async function main() {
  console.log("Loading word list from wiki-100k.txt...");
  const wordList = loadWordList();
  console.log("Loaded words:", wordList.length);

  console.log("Loading allowed words (10k list only)...");
  const allowedSet = await loadAllowedWords();
  console.log("Allowed words:", allowedSet.size);

  const useTimeLimit = GENERATE_DURATION_MS > 0;
  if (useTimeLimit) {
    console.log("Generating puzzles for " + (GENERATE_DURATION_MS / 60000) + " minute(s)...");
  } else {
    console.log("Generating " + TARGET_PUZZLE_COUNT + " puzzles...");
  }
  const output = [];
  const seenLetterSets = new Set();
  const startTime = Date.now();
  let count = 0;
  let lastLogAtPuzzle = -1;
  let lastLogAtSec = -1;

  while ((useTimeLimit && Date.now() - startTime < GENERATE_DURATION_MS) || (!useTimeLimit && count < TARGET_PUZZLE_COUNT)) {
    let puzzle = generatePuzzle(wordList, allowedSet);
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

    const totalPoints =
      puzzle.validWords.reduce((sum, w) => sum + w.length * POINTS_PER_LETTER, 0) +
      puzzle.pangramWords.length * PANGRAM_BONUS;

    output.push({
      center_letter: puzzle.center,
      outer_letters: puzzle.outer.join(""),
      valid_words: puzzle.validWords,
      pangrams: puzzle.pangramWords,
      total_points: totalPoints,
    });
    count++;
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    const shouldLogEvery10 = count === 1 || count % 10 === 0;
    const shouldLogEvery30s = useTimeLimit && elapsedSec >= 30 && Math.floor(elapsedSec / 30) > lastLogAtSec;
    if (shouldLogEvery10 || shouldLogEvery30s) {
      if (shouldLogEvery10) lastLogAtPuzzle = count;
      if (shouldLogEvery30s) lastLogAtSec = Math.floor(elapsedSec / 30);
      console.log("  " + count + " puzzles (" + elapsedSec + "s elapsed)");
    }
  }

  console.log("  Done. Generated " + output.length + " puzzles.");

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

  // Remove any puzzle that has fewer than 2 pangrams (e.g. after blocklist removal)
  const beforeCount = output.length;
  const filtered = output.filter(p => (p.pangrams || []).length >= MIN_PANGRAMS);
  const removedPuzzles = beforeCount - filtered.length;
  if (removedPuzzles > 0) {
    console.log("\nRemoved", removedPuzzles, "puzzle(s) with fewer than", MIN_PANGRAMS, "pangrams. Writing", filtered.length, "puzzles.");
  }
  output.length = 0;
  output.push(...filtered);

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
