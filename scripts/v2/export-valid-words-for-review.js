/**
 * Export unique valid_words for manual/AI review.
 *
 * - `data/valid-words-export.txt`:
 *    WORD<TAB>WIKI_RANK (rank is 1-based in data/wiki-100k.txt)
 * - `data/word-review-candidates.txt`:
 *    WORD<TAB>WIKI_RANK (only words beyond the chosen rank threshold)
 *
 * Usage:
 *   node scripts/v2/export-valid-words-for-review.js --threshold 20000
 *
 * Defaults:
 *   --threshold 20000  (approx. "fairly common")
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const PUZZLES_PATH = path.join(DATA_DIR, "puzzles-2.json");
const WIKI_PATH = path.join(DATA_DIR, "wiki-100k.txt");
const INVALID_VALID_WORDS_PATH = path.join(DATA_DIR, "invalid-valid-words.txt");

const PROPER_NOUN_BLOCKLIST = require(path.join(__dirname, "..", "..", "js", "proper-noun-blocklist.js")).all;

// Keep this in sync with the profanity list in js/game.js (client-side).
const LOCAL_PROFANITY = new Set([
  "damn", "hell", "crap", "bastard", "bitch", "bloody", "bugger", "bullshit",
  "cunt", "dick", "fuck", "fucked", "fucking", "piss", "pissed", "shit", "shitty",
  "slut", "whore", "wanker", "bollocks", "darn", "dang", "freaking", "effing",
  // Note: the full client list includes the same items; we just keep it here for scripts.
]);

function parseArgs() {
  var threshold = 20000;
  var args = process.argv.slice(2);
  for (var i = 0; i < args.length; i++) {
    if (args[i] === "--threshold" && args[i + 1]) {
      var n = parseInt(args[i + 1], 10);
      if (!isNaN(n)) threshold = n;
    }
  }
  return { threshold: threshold };
}

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
}

function main() {
  var opts = parseArgs();

  if (!fs.existsSync(PUZZLES_PATH)) throw new Error("Missing: " + PUZZLES_PATH);
  if (!fs.existsSync(WIKI_PATH)) throw new Error("Missing: " + WIKI_PATH);

  var wikiLines = readLines(WIKI_PATH).map(function (w) { return w.toLowerCase(); });
  var rankByWord = new Map();
  wikiLines.forEach(function (w, i) {
    if (!rankByWord.has(w)) rankByWord.set(w, i + 1);
  });

  var invalidAlready = new Set();
  if (fs.existsSync(INVALID_VALID_WORDS_PATH)) {
    readLines(INVALID_VALID_WORDS_PATH).forEach(function (w) {
      invalidAlready.add(String(w).trim().toLowerCase());
    });
  }

  var puzzles = JSON.parse(fs.readFileSync(PUZZLES_PATH, "utf8"));
  var words = new Set();
  puzzles.forEach(function (p) {
    (p.valid_words || []).forEach(function (w) {
      words.add(String(w).toUpperCase());
    });
  });

  // Export all.
  var exportLines = [];
  var candidates = [];

  Array.from(words)
    .sort()
    .forEach(function (W) {
      var w = String(W).toLowerCase();
      var rank = rankByWord.get(w);
      if (!rank) rank = 999999;

      exportLines.push(W + "\t" + rank);

      // Already-excluded words don't need review.
      if (invalidAlready.has(w)) return;
      if (LOCAL_PROFANITY.has(w)) return;
      if (PROPER_NOUN_BLOCKLIST.has(String(W).toUpperCase())) return;

      // Frequency threshold defines review candidates.
      if (rank > opts.threshold) {
        candidates.push(W + "\t" + rank);
      }
    });

  fs.writeFileSync(path.join(DATA_DIR, "valid-words-export.txt"), exportLines.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(DATA_DIR, "word-review-candidates.txt"), candidates.join("\n") + "\n", "utf8");

  console.log("Unique valid_words:", words.size);
  console.log("Threshold:", opts.threshold);
  console.log("Candidates to review:", candidates.length);
  console.log("Wrote:");
  console.log(" - data/valid-words-export.txt");
  console.log(" - data/word-review-candidates.txt");
}

main();

