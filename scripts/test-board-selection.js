const fs = require("fs");
const path = require("path");

// Use the same helpers as the app for letter sets
const RB = require(path.join(__dirname, "../js/recent-boards.js"));

const PUZZLES_PATH = path.join(__dirname, "../data/puzzles-2.json");

function loadPuzzles() {
  const raw = fs.readFileSync(PUZZLES_PATH, "utf8");
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error("puzzles-2.json must be an array");
  return arr;
}

function letterOverlap(a, b) {
  const setA = new Set((a || "").split(""));
  let count = 0;
  for (let i = 0; i < (b || "").length; i++) {
    if (setA.has(b[i])) count++;
  }
  return count;
}

/** Pick one puzzle using the same logic as pickSoloPuzzle, but with an explicit recent list of letter sets. */
function pickPuzzle(puzzles, recentSets) {
  if (!puzzles || puzzles.length === 0) return null;
  if (!recentSets || recentSets.length === 0) {
    return puzzles[Math.floor(Math.random() * puzzles.length)];
  }
  let minScore = Infinity;
  for (let i = 0; i < puzzles.length; i++) {
    const set = RB.getPuzzleLetterSet(puzzles[i]);
    let score = 0;
    for (let j = 0; j < recentSets.length; j++) {
      score += letterOverlap(recentSets[j], set);
    }
    if (score < minScore) minScore = score;
  }

  const recentSet = new Set(recentSets);
  const best = [];
  const bestLetterSets = new Set();

  for (let i = 0; i < puzzles.length; i++) {
    const set = RB.getPuzzleLetterSet(puzzles[i]);
    let score = 0;
    for (let j = 0; j < recentSets.length; j++) {
      score += letterOverlap(recentSets[j], set);
    }
    if (score !== minScore) continue;
    if (recentSet.has(set)) continue;
    if (bestLetterSets.has(set)) continue;
    bestLetterSets.add(set);
    best.push(puzzles[i]);
  }

  if (best.length === 0) {
    for (let i = 0; i < puzzles.length; i++) {
      const set = RB.getPuzzleLetterSet(puzzles[i]);
      let score = 0;
      for (let j = 0; j < recentSets.length; j++) {
        score += letterOverlap(recentSets[j], set);
      }
      if (score !== minScore) continue;
      if (recentSet.has(set)) continue;
      if (bestLetterSets.has(set)) continue;
      bestLetterSets.add(set);
      best.push(puzzles[i]);
    }
  }

  if (best.length > 0) return best[Math.floor(Math.random() * best.length)];
  // Fallback: pick from any puzzle not in recent (same as game.js)
  const notRecent = [];
  const notRecentSets = new Set();
  for (let i = 0; i < puzzles.length; i++) {
    const set = RB.getPuzzleLetterSet(puzzles[i]);
    if (recentSet.has(set)) continue;
    if (notRecentSets.has(set)) continue;
    notRecentSets.add(set);
    notRecent.push(puzzles[i]);
  }
  return notRecent.length
    ? notRecent[Math.floor(Math.random() * notRecent.length)]
    : puzzles[Math.floor(Math.random() * puzzles.length)];
}

function main() {
  const puzzles = loadPuzzles();
  console.log("Total puzzles:", puzzles.length);

  const recentSets = [];
  const chosenSets = new Set();

  const NUM_PICKS = 50;
  for (let i = 0; i < NUM_PICKS; i++) {
    const puzzle = pickPuzzle(puzzles, recentSets);
    if (!puzzle) break;
    const set = RB.getPuzzleLetterSet(puzzle);
    console.log(
      (i + 1) + ":",
      "center=" + String(puzzle.center_letter).toUpperCase(),
      "outer=" + String(puzzle.outer_letters).toUpperCase(),
      "set=" + set
    );
    if (chosenSets.has(set)) {
      console.log("  -> DUPLICATE SET DETECTED");
    }
    chosenSets.add(set);

    recentSets.unshift(set);
    if (recentSets.length > 100) recentSets.length = 100;
  }

  console.log("\nTotal picks:", NUM_PICKS);
  console.log("Unique sets picked:", chosenSets.size);
  console.log(chosenSets.size === NUM_PICKS ? "All unique." : "Duplicates: " + (NUM_PICKS - chosenSets.size));
}

main();

