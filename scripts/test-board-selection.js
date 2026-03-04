const fs = require("fs");
const path = require("path");

const PUZZLES_PATH = path.join(__dirname, "../data/puzzles-2.json");

function loadPuzzles() {
  const raw = fs.readFileSync(PUZZLES_PATH, "utf8");
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error("puzzles-2.json must be an array");
  return arr;
}

/** Mirror game.js: pick random index, retry if in recent (max 200), then allow any. */
function pickSoloPuzzleIndex(puzzles, recentIndices) {
  if (!puzzles || puzzles.length === 0) return -1;
  const recentSet = new Set(recentIndices || []);
  const n = puzzles.length;
  const maxTries = 200;
  for (let t = 0; t < maxTries; t++) {
    const idx = Math.floor(Math.random() * n);
    if (!recentSet.has(idx)) return idx;
  }
  return Math.floor(Math.random() * n);
}

function main() {
  const puzzles = loadPuzzles();
  console.log("Total puzzles:", puzzles.length);

  const recentIndices = [];
  const chosenIndices = new Set();

  const NUM_PICKS = 50;
  for (let i = 0; i < NUM_PICKS; i++) {
    const idx = pickSoloPuzzleIndex(puzzles, recentIndices);
    if (idx < 0) break;
    const puzzle = puzzles[idx];
    const center = String(puzzle.center_letter || "").toUpperCase();
    const outer = String(puzzle.outer_letters || "").toUpperCase();
    console.log(
      (i + 1) + ":",
      "index=" + idx,
      "center=" + center,
      "outer=" + outer
    );
    if (chosenIndices.has(idx)) {
      console.log("  -> DUPLICATE INDEX DETECTED");
    }
    chosenIndices.add(idx);

    recentIndices.unshift(idx);
    if (recentIndices.length > 100) recentIndices.length = 100;
  }

  console.log("\nTotal picks:", NUM_PICKS);
  console.log("Unique indices picked:", chosenIndices.size);
  console.log(chosenIndices.size === NUM_PICKS ? "All unique." : "Duplicates: " + (NUM_PICKS - chosenIndices.size));
}

main();
