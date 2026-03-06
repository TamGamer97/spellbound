/**
 * Add puzzles built from a list of pangram candidate words.
 * Usage: node add-pangram-puzzles.js <words-file>
 *   words-file: UTF-8 text file, one word per line (e.g. "project", "certain"). Lines are trimmed and lowercased.
 *
 * For each word:
 * - Must have exactly 7 unique letters and no banned letters (s,q,x,z).
 * - Must yield a valid puzzle: at least MIN_WORD_COUNT valid words and MIN_PANGRAMS pangrams
 *   (valid words from the same 10k allowed list as the main generator).
 * - If the 7-letter set is already in puzzles-2.json, the word is skipped (no repeats).
 *
 * New puzzles are appended; the file is then deduplicated by 7-letter set and written back.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const PROPER_NOUN_BLOCKLIST = require(path.join(__dirname, "../../js/proper-noun-blocklist.js")).all;

const MIN_WORD_LENGTH = 4;
const MAX_WORD_LENGTH = 12;
const MIN_WORD_COUNT = 15;
const MIN_PANGRAMS = 2;
const BANNED_LETTERS = new Set(["s", "q", "x", "z"]);
/** Points by word length: 4→4, 5→6, 6→8, 7→10, 8→12, ... (2*len - 4 for len >= 4). */
function pointsForWordLength(len) {
  return len >= 4 ? 2 * len - 4 : 0;
}
const PANGRAM_BONUS = 5;

const WIKI_WORD_LIST_PATH = path.join(__dirname, "../../data/wiki-100k.txt");
const OUTPUT_PATH = path.join(__dirname, "../../data/puzzles-2.json");
const OBSCURE_SUFFIXES = [
  "idae", "aceae", "ology", "ologist", "otomy", "itis", "osis",
  "mentum", "tional", "ative", "escence"
];
const FILTER_OBSCURE_SUFFIXES = true;

function getUniqueLetters(word) {
  return [...new Set(String(word).toLowerCase())].sort().join("");
}

function loadWordList() {
  if (!fs.existsSync(WIKI_WORD_LIST_PATH)) {
    throw new Error("Missing word list: " + WIKI_WORD_LIST_PATH);
  }
  const raw = fs.readFileSync(WIKI_WORD_LIST_PATH, "utf8");
  const words = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const word = line.trim().toLowerCase();
    if (word.length < MIN_WORD_LENGTH || word.length > MAX_WORD_LENGTH) continue;
    if (!/^[a-z]+$/.test(word)) continue;
    if (FILTER_OBSCURE_SUFFIXES && OBSCURE_SUFFIXES.some((s) => word.endsWith(s))) continue;
    words.add(word);
  }
  return Array.from(words);
}

// Legacy: previously we used a remote 10k word list as the allowed set.
// Now we simply reuse the cleaned wiki-100k word list as allowed words.
function loadAllowedWords() {
  const words = loadWordList();
  return Promise.resolve(new Set(words));
}

function isValidWord(word, lettersSet, centerLetter) {
  if (word.length < MIN_WORD_LENGTH) return false;
  if (!word.includes(centerLetter)) return false;
  for (const ch of word) {
    if (!lettersSet.has(ch)) return false;
  }
  return true;
}

function letterSetKey(puzzle) {
  const raw =
    String(puzzle.center_letter || "") + String(puzzle.outer_letters || "");
  return raw
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .split("")
    .sort()
    .join("");
}

function enrichValidWords(center, outer, wordList) {
  const letters = [center, ...outer];
  const lettersSet = new Set(letters);
  const valid = wordList.filter((w) => isValidWord(w, lettersSet, center));
  const withoutBlocklist = valid.filter(
    (w) => !PROPER_NOUN_BLOCKLIST.has(String(w).trim().toUpperCase())
  );
  const deduped = Array.from(new Set(withoutBlocklist));
  deduped.sort();
  return deduped;
}

/**
 * Check if a word is a suitable pangram candidate: 7 unique letters, no banned letters,
 * and not blocklisted.
 */
function isSuitablePangramCandidate(word) {
  const w = String(word).trim().toLowerCase();
  if (!/^[a-z]+$/.test(w)) return false;
  const letters = getUniqueLetters(w);
  if (letters.length !== 7) return false;
  for (const b of BANNED_LETTERS) {
    if (letters.includes(b)) return false;
  }
  if (PROPER_NOUN_BLOCKLIST.has(w.toUpperCase())) return false;
  return true;
}

/**
 * Try to build a puzzle from a 7-letter pangram word. Returns null if no center
 * yields enough valid words/pangrams; otherwise { center, outer, validWords, pangramWords }.
 */
function buildPuzzleFromPangramWord(word, wordList, allowedSet) {
  const letters = getUniqueLetters(word).split("");
  const lettersSet = new Set(letters);

  const baseCandidates = wordList.filter((w) => {
    if (w.length < MIN_WORD_LENGTH) return false;
    for (const ch of w) {
      if (!lettersSet.has(ch)) return false;
    }
    return true;
  });

  for (const center of letters) {
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
        center,
        outer,
        validWords: validWords.sort(),
        pangramWords: pangramWords.sort(),
      };
    }
  }
  return null;
}

async function main() {
  const wordsPath = process.argv[2];
  if (!wordsPath || !fs.existsSync(wordsPath)) {
    console.error("Usage: node add-pangram-puzzles.js <words-file>");
    console.error("  words-file: one word per line.");
    process.exit(1);
  }

  let rawInput = fs.readFileSync(wordsPath, "utf8");
  if (rawInput.charCodeAt(0) === 0xfeff) rawInput = rawInput.slice(1);
  const inputWords = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((w) => w.length > 0);

  const uniqueInput = [...new Set(inputWords)];
  console.log("Input words (unique):", uniqueInput.length);

  console.log("Loading word list and allowed 10k...");
  const [wordList, allowedSet] = await Promise.all([
    Promise.resolve(loadWordList()),
    loadAllowedWords(),
  ]);
  console.log("Loaded wiki words:", wordList.length, "| allowed:", allowedSet.size);

  let existing = [];
  const existingKeys = new Set();
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      const raw = fs.readFileSync(OUTPUT_PATH, "utf8");
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        existing = arr;
        existing.forEach((p) => existingKeys.add(letterSetKey(p)));
      }
    } catch (e) {
      console.warn("Could not load existing puzzles:", e.message);
    }
  }
  console.log("Existing puzzles:", existing.length, "| unique letter sets:", existingKeys.size);

  const added = [];
  const skipped = { notSuitable: [], noPuzzle: [], duplicate: [] };

  for (const word of uniqueInput) {
    if (!isSuitablePangramCandidate(word)) {
      skipped.notSuitable.push(word);
      continue;
    }

    const key = getUniqueLetters(word);
    if (existingKeys.has(key)) {
      skipped.duplicate.push(word);
      continue;
    }

    const puzzle = buildPuzzleFromPangramWord(word, wordList, allowedSet);
    if (!puzzle) {
      skipped.noPuzzle.push(word);
      continue;
    }

    existingKeys.add(key);

    const enrichedValid = enrichValidWords(
      puzzle.center,
      puzzle.outer,
      wordList
    );
    const pangramsFromEnriched = enrichedValid.filter(
      (w) => getUniqueLetters(w).length === 7
    );
    const totalPoints =
      enrichedValid.reduce((s, w) => s + pointsForWordLength(w.length), 0) +
      pangramsFromEnriched.length * PANGRAM_BONUS;

    added.push({
      center_letter: puzzle.center,
      outer_letters: puzzle.outer.join(""),
      valid_words: enrichedValid,
      pangrams: pangramsFromEnriched,
      total_points: totalPoints,
    });
  }

  if (added.length === 0) {
    console.log("\nNo new puzzles to add.");
    if (skipped.notSuitable.length) {
      console.log("Not suitable (wrong length/banned/blocklist):", skipped.notSuitable.length);
    }
    if (skipped.noPuzzle.length) {
      console.log("No valid puzzle (need " + MIN_WORD_COUNT + "+ words, " + MIN_PANGRAMS + "+ pangrams):", skipped.noPuzzle.length);
    }
    if (skipped.duplicate.length) {
      console.log("Duplicate 7-letter set (already in file):", skipped.duplicate.length);
    }
    return;
  }

  const combined = [...existing, ...added];

  const byKey = new Map();
  for (const p of combined) {
    const key = letterSetKey(p);
    if (!byKey.has(key)) byKey.set(key, p);
  }
  const uniquePuzzles = Array.from(byKey.values());
  const dupesRemoved = combined.length - uniquePuzzles.length;

  const dataDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(uniquePuzzles, null, 2),
    "utf8"
  );

  console.log("\nAdded", added.length, "puzzle(s) from your word list.");
  if (dupesRemoved > 0) {
    console.log("Deduplicated:", dupesRemoved, "repeat(s) removed; total unique:", uniquePuzzles.length);
  } else {
    console.log("Total puzzles in file:", uniquePuzzles.length);
  }
  if (skipped.notSuitable.length) {
    console.log("Skipped (not suitable):", skipped.notSuitable.length, skipped.notSuitable.slice(0, 5).join(", ") + (skipped.notSuitable.length > 5 ? "..." : ""));
  }
  if (skipped.noPuzzle.length) {
    console.log("Skipped (no valid puzzle):", skipped.noPuzzle.length, skipped.noPuzzle.slice(0, 5).join(", ") + (skipped.noPuzzle.length > 5 ? "..." : ""));
  }
  if (skipped.duplicate.length) {
    console.log("Skipped (already in file):", skipped.duplicate.length);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
