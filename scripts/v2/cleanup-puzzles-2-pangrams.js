/**
 * Cleanup: remove bad / foreign / proper-noun pangrams from puzzles-2.json.
 * - If a puzzle loses all pangrams → drop the puzzle.
 * - Otherwise, drop only the bad pangram words and recompute total_points.
 *
 * This is a streamlined v2 version that uses:
 * - data/bad-pangrams.txt  (explicit bad pangram list)
 * - js/proper-noun-blocklist.js (shared proper-noun blocklist)
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const PUZZLES_PATH = path.join(DATA_DIR, "puzzles-2.json");
const BAD_PANGRAMS_PATH = path.join(DATA_DIR, "bad-pangrams.txt");

// Shared proper-noun blocklist used by the game and generators.
const SPELLBOUND_BLOCKLIST = require(path.join(
  __dirname,
  "..",
  "..",
  "js",
  "proper-noun-blocklist.js"
));
const PROPER_NOUN_BLOCKLIST = SPELLBOUND_BLOCKLIST.all;

/** Points by word length: 4→4, 5→6, 6→8, 7→10, 8→12, ... (2*len - 4 for len >= 4). */
function pointsForWordLength(len) {
  return len >= 4 ? 2 * len - 4 : 0;
}
const PANGRAM_BONUS = 5;

function loadBadPangrams() {
  const set = new Set();
  if (!fs.existsSync(BAD_PANGRAMS_PATH)) return set;
  const raw = fs.readFileSync(BAD_PANGRAMS_PATH, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const w = line.trim().toLowerCase();
    if (w && /^[a-z]+$/.test(w)) set.add(w);
  });
  return set;
}

function main() {
  const badPangrams = loadBadPangrams();
  console.log("Bad pangrams loaded:", badPangrams.size);

  const raw = fs.readFileSync(PUZZLES_PATH, "utf8");
  const puzzles = JSON.parse(raw);
  if (!Array.isArray(puzzles)) {
    throw new Error("puzzles-2.json must be an array");
  }
  console.log("Puzzles before cleanup:", puzzles.length);

  const kept = [];
  let removedPuzzles = 0;

  puzzles.forEach((p, i) => {
    const valid = Array.isArray(p.valid_words) ? p.valid_words.slice() : [];
    const pangrams = Array.isArray(p.pangrams) ? p.pangrams.slice() : [];

    // Mark pangrams as bad if they are in badPangrams list OR proper-noun blocklist.
    const badSet = new Set();
    pangrams.forEach((w) => {
      const lower = String(w || "").toLowerCase();
      if (badPangrams.has(lower) || PROPER_NOUN_BLOCKLIST.has(lower.toUpperCase())) {
        badSet.add(w);
      }
    });

    if (badSet.size === 0) {
      kept.push(p);
      return;
    }

    // Remove bad pangrams. If none left, drop the puzzle entirely.
    const remainingPangrams = pangrams.filter((w) => !badSet.has(w));
    if (remainingPangrams.length === 0) {
      removedPuzzles++;
      return;
    }

    // Also remove bad pangrams from valid_words (if they appear there).
    const remainingValid = valid.filter((w) => !badSet.has(w));

    const totalPoints =
      remainingValid.reduce((sum, w) => sum + pointsForWordLength(String(w || "").length), 0) +
      remainingPangrams.length * PANGRAM_BONUS;

    kept.push({
      center_letter: p.center_letter,
      outer_letters: p.outer_letters,
      valid_words: remainingValid,
      pangrams: remainingPangrams,
      total_points: totalPoints,
    });
  });

  fs.writeFileSync(PUZZLES_PATH, JSON.stringify(kept, null, 2), "utf8");
  console.log("Removed puzzles (no pangrams left):", removedPuzzles);
  console.log("Kept puzzles:", kept.length);
}

main();

