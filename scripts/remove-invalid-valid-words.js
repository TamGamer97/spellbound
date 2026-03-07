/**
 * Remove nonsense/fragment words from valid_words (and pangrams) in puzzles-2.json.
 * Reads blocklist from data/invalid-valid-words.txt; also removes from pangrams and recomputes total_points.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const PUZZLES_PATH = path.join(DATA_DIR, "puzzles-2.json");
const BLOCKLIST_PATH = path.join(DATA_DIR, "invalid-valid-words.txt");

function pointsForWordLength(len) {
  return len >= 4 ? 2 * len - 4 : 0;
}
const PANGRAM_BONUS = 5;

function totalPoints(validWords, pangrams) {
  const wordPt = (validWords || []).reduce((s, w) => s + pointsForWordLength(w.length), 0);
  const pangramBonus = (pangrams || []).length * PANGRAM_BONUS;
  return wordPt + pangramBonus;
}

function loadBlocklist() {
  const set = new Set(["effi"]);
  if (!fs.existsSync(BLOCKLIST_PATH)) return set;
  const lines = fs.readFileSync(BLOCKLIST_PATH, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const w = line.trim().toLowerCase().replace(/#.*$/, "").trim();
    if (w && /^[a-z]+$/.test(w)) set.add(w);
  });
  return set;
}

function main() {
  const blocklist = loadBlocklist();
  console.log("Blocklist size:", blocklist.size);

  const puzzles = JSON.parse(fs.readFileSync(PUZZLES_PATH, "utf8"));
  const kept = [];
  let removedPuzzles = 0;
  const removedCount = new Map();

  for (let i = 0; i < puzzles.length; i++) {
    const p = puzzles[i];
    const validWords = p.valid_words || [];
    const pangrams = p.pangrams || [];

    const goodValid = validWords.filter((w) => !blocklist.has(w.toLowerCase()));
    const goodPangrams = pangrams.filter((w) => !blocklist.has(w.toLowerCase()));

    validWords.filter((w) => blocklist.has(w.toLowerCase())).forEach((w) => {
      removedCount.set(w.toLowerCase(), (removedCount.get(w.toLowerCase()) || 0) + 1);
    });
    pangrams.filter((w) => blocklist.has(w.toLowerCase())).forEach((w) => {
      removedCount.set(w.toLowerCase(), (removedCount.get(w.toLowerCase()) || 0) + 1);
    });

    if (goodPangrams.length === 0) {
      removedPuzzles++;
      continue;
    }

    kept.push({
      center_letter: p.center_letter,
      outer_letters: p.outer_letters,
      valid_words: goodValid,
      pangrams: goodPangrams,
      total_points: totalPoints(goodValid, goodPangrams),
    });
  }

  fs.writeFileSync(PUZZLES_PATH, JSON.stringify(kept, null, 2), "utf8");

  console.log("Puzzles removed (no pangram left):", removedPuzzles);
  console.log("Puzzles kept:", kept.length);
  if (removedCount.size > 0) {
    console.log("Words removed (valid_words/pangrams):");
    [...removedCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([w, n]) => console.log(" ", w, ":", n));
  }
}

main();
