/**
 * Enrich puzzles-2.json: for each puzzle, find ALL valid words from the project
 * word list (wiki-100k) that match the 7 letters + center rule, then update
 * valid_words and total_points. Pangrams are left unchanged. Removes proper nouns (blocklist).
 *
 * Run from repo root or scripts/: node scripts/enrich-puzzles-2.js
 */

const fs = require("fs");
const path = require("path");

const PROPER_NOUN_BLOCKLIST = require(path.join(__dirname, "../js/proper-noun-blocklist.js")).all;
const WIKI_WORD_LIST_PATH = path.join(__dirname, "../data/wiki-100k.txt");
const PUZZLES_PATH = path.join(__dirname, "../data/puzzles-2.json");

const MIN_WORD_LENGTH = 4;
const MAX_WORD_LENGTH = 15;
const POINTS_PER_LETTER = 1;
const PANGRAM_BONUS = 5;

const OBSCURE_SUFFIXES = [
  "idae", "aceae", "ology", "ologist", "otomy", "itis", "osis",
  "mentum", "tional", "ative", "escence"
];
const FILTER_OBSCURE_SUFFIXES = true;

function loadWordList() {
  if (!fs.existsSync(WIKI_WORD_LIST_PATH)) {
    throw new Error("Missing word list: " + WIKI_WORD_LIST_PATH);
  }
  const raw = fs.readFileSync(WIKI_WORD_LIST_PATH, "utf8");
  const lines = raw.split(/\r?\n/);
  const words = new Set();
  for (const line of lines) {
    const word = line.trim().toLowerCase();
    if (word.length < MIN_WORD_LENGTH || word.length > MAX_WORD_LENGTH) continue;
    if (!/^[a-z]+$/.test(word)) continue;
    if (FILTER_OBSCURE_SUFFIXES && OBSCURE_SUFFIXES.some(s => word.endsWith(s))) continue;
    words.add(word);
  }
  return Array.from(words);
}

function isValidForPuzzle(word, lettersSet, centerLetter) {
  if (word.length < MIN_WORD_LENGTH || !word.includes(centerLetter)) return false;
  for (const c of word) {
    if (!lettersSet.has(c)) return false;
  }
  return true;
}

function enrichPuzzle(puzzle, wordList) {
  const center = String(puzzle.center_letter || "").toLowerCase();
  const outer = typeof puzzle.outer_letters === "string"
    ? puzzle.outer_letters.split("")
    : (puzzle.outer_letters || []).map(c => String(c).toLowerCase());
  const letters = [center, ...outer];
  const lettersSet = new Set(letters);

  const validWords = wordList.filter(w => isValidForPuzzle(w, lettersSet, center));
  const withoutBlocklist = validWords.filter(w => !PROPER_NOUN_BLOCKLIST.has(w.toUpperCase()));
  const validWordsSorted = [...new Set(withoutBlocklist)].sort();

  const originalPangrams = Array.isArray(puzzle.pangrams) ? puzzle.pangrams : [];
  const totalPoints =
    validWordsSorted.reduce((sum, w) => sum + w.length * POINTS_PER_LETTER, 0) +
    originalPangrams.length * PANGRAM_BONUS;

  return {
    center_letter: center,
    outer_letters: outer.join(""),
    valid_words: validWordsSorted,
    pangrams: originalPangrams,
    total_points: totalPoints,
  };
}

function main() {
  console.log("Loading word list from wiki-100k.txt...");
  const wordList = loadWordList();
  console.log("Word list size:", wordList.length);

  console.log("Loading", PUZZLES_PATH, "...");
  const raw = fs.readFileSync(PUZZLES_PATH, "utf8");
  const puzzles = JSON.parse(raw);
  if (!Array.isArray(puzzles)) {
    throw new Error("puzzles-2.json must be a JSON array");
  }
  console.log("Puzzles to enrich:", puzzles.length);

  const totalWordsBefore = puzzles.reduce((sum, p) => sum + (p.valid_words || []).length, 0);

  const results = [];
  for (let i = 0; i < puzzles.length; i++) {
    results.push(enrichPuzzle(puzzles[i], wordList));
    if ((i + 1) % 100 === 0 || i === 0) {
      console.log("  Enriched", i + 1, "of", puzzles.length);
    }
  }

  const totalWordsAfter = results.reduce((sum, p) => sum + (p.valid_words || []).length, 0);
  const wordsAdded = totalWordsAfter - totalWordsBefore;
  console.log("\nWords: " + totalWordsBefore + " before → " + totalWordsAfter + " after (+" + wordsAdded + " total)");

  fs.writeFileSync(PUZZLES_PATH, JSON.stringify(results, null, 2), "utf8");
  console.log("Wrote", results.length, "puzzles to", PUZZLES_PATH);
}

main();
