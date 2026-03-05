/**
 * One-off: Remove proper-noun and non-English pangrams from puzzles-2.json.
 * - If a puzzle's only pangram(s) are bad → remove the entire puzzle.
 * - Otherwise remove only the bad pangram(s) and drop those words from valid_words; recompute total_points.
 */

const fs = require("fs");
const path = require("path");

const POINTS_PER_LETTER = 1;
const PANGRAM_BONUS = 5;

const BAD_PANGRAMS = new Set([
  // Proper nouns (places, people, etc.)
  "auckland", "broadway", "cameron", "capitol", "catalonia", "connecticut",
  "cornwall", "crawford", "cremona", "endicott", "franklin", "geraint",
  "giacinto", "gironde", "grandet", "grandier", "lanciotto", "newport",
  "nicolette", "perpignan", "pierpont", "tangier", "teutonic", "argentine", "highland",
  "hampton",
  // Non-English / strange
  "aanleiding", "apparemment", "appartement", "atteindre", "attendri", "capitolo",
  "conveniente", "contenir", "continua", "continuait", "continuant", "convient",
  "corentin", "corriente", "courent", "coururent", "croient", "daarentegen", "demandaient",
  "demandait", "demanderai", "encuentro", "garantie", "gardent", "gardien", "gardiner",
  "incognita",
  "gegeneinander", "heftiger", "immediatement", "mendiant", "permanente",
  "poitrine", "politica", "precipita", "reconnut", "regardent", "regnait",
  "rendaient", "rendait", "rendrait", "vingtaine", "inmediatamente",
].map((w) => w.toLowerCase()));

const DATA_DIR = path.join(__dirname, "..", "data");
const INPUT_PATH = path.join(DATA_DIR, "puzzles-2.json");

function normalize(w) {
  return String(w).trim().toLowerCase();
}

function totalPoints(validWords, pangrams) {
  const wordPt = (validWords || []).reduce((s, w) => s + w.length * POINTS_PER_LETTER, 0);
  const pangramBonus = (pangrams || []).length * PANGRAM_BONUS;
  return wordPt + pangramBonus;
}

function main() {
  const raw = fs.readFileSync(INPUT_PATH, "utf8");
  const puzzles = JSON.parse(raw);

  const kept = [];
  let removedPuzzles = 0;
  let removedPangramsOnly = 0;
  const removedWordsLog = new Map();

  for (let i = 0; i < puzzles.length; i++) {
    const p = puzzles[i];
    const pangrams = p.pangrams || [];
    const validWords = p.valid_words || [];

    const goodPangrams = pangrams.filter((w) => !BAD_PANGRAMS.has(normalize(w)));
    const badPangramSet = new Set(
      pangrams.filter((w) => BAD_PANGRAMS.has(normalize(w))).map(normalize)
    );

    if (goodPangrams.length === 0) {
      removedPuzzles++;
      continue;
    }

    if (badPangramSet.size > 0) {
      removedPangramsOnly += badPangramSet.size;
      badPangramSet.forEach((w) => removedWordsLog.set(w, (removedWordsLog.get(w) || 0) + 1));
    }

    const goodValidWords = validWords.filter((w) => !BAD_PANGRAMS.has(normalize(w)));
    const newPoints = totalPoints(goodValidWords, goodPangrams);

    kept.push({
      center_letter: p.center_letter,
      outer_letters: p.outer_letters,
      valid_words: goodValidWords,
      pangrams: goodPangrams,
      total_points: newPoints,
    });
  }

  fs.writeFileSync(INPUT_PATH, JSON.stringify(kept, null, 2), "utf8");

  console.log("Cleanup complete.");
  console.log("Puzzles removed (no valid pangram left):", removedPuzzles);
  console.log("Puzzles kept:", kept.length);
  console.log("Pangrams removed (puzzle kept):", removedPangramsOnly);
  if (removedWordsLog.size > 0) {
    console.log("\nWords removed (as pangram or from valid_words):");
    const sorted = [...removedWordsLog.entries()].sort((a, b) => b[1] - a[1]);
    sorted.forEach(([w, count]) => console.log("  ", w, ":", count));
  }
}

main();
