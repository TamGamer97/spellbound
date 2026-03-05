const fs = require("fs");
const path = require("path");

// Path to puzzles-2.json (from v2 scripts folder)
const PUZZLES_PATH = path.join(__dirname, "../../data/puzzles-2.json");

/** Count how many of the given puzzles contain each letter A–Z (center+outer set). */
function getLetterCounts(puzzles) {
  const counts = {};
  for (let c = 65; c <= 90; c++) counts[String.fromCharCode(c)] = 0;
  for (const p of puzzles) {
    const letters = String(p.center_letter || "").toUpperCase() + String(p.outer_letters || "").toUpperCase();
    const seen = new Set();
    for (let i = 0; i < letters.length; i++) {
      const L = letters[i];
      if (!/[A-Z]/.test(L)) continue;
      if (!seen.has(L)) {
        seen.add(L);
        counts[L] = (counts[L] || 0) + 1;
      }
    }
  }
  return counts;
}

function main() {
  if (!fs.existsSync(PUZZLES_PATH)) {
    console.error("Missing puzzles file:", PUZZLES_PATH);
    process.exit(1);
  }
  const raw = fs.readFileSync(PUZZLES_PATH, "utf8");
  let puzzles;
  try {
    puzzles = JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse puzzles-2.json:", e.message);
    process.exit(1);
  }
  if (!Array.isArray(puzzles)) {
    console.error("puzzles-2.json must be an array");
    process.exit(1);
  }

  const counts = getLetterCounts(puzzles);
  const totalSlots = puzzles.length * 7;
  const fairShare = totalSlots / 26;
  const letters = Object.keys(counts).sort();
  const numPuzzles = puzzles.length;

  console.error(`Analysing ${numPuzzles} puzzles from puzzles-2.json.`);
  console.error(`Letter occurrence (fair share ≈ ${fairShare.toFixed(1)} puzzles per letter):`);
  for (const L of letters) {
    const n = counts[L];
    const pct = ((n / numPuzzles) * 100).toFixed(1);
    const barLen = Math.round((n / numPuzzles) * 20);
    const bar = "#".repeat(barLen) + "-".repeat(20 - barLen);
    console.error(`  ${L}: ${String(n).padStart(3)} puzzles (${String(pct).padStart(5)}%) ${bar}`);
  }
}

main();

