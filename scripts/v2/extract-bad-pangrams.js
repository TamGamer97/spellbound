/**
 * Utility: extract "bad" pangrams from pangram-review.txt into data/bad-pangrams.txt.
 *
 * Expected pangram-review.txt format (one per line, flexible):
 *   WORD<TAB>✓
 *   WORD<TAB>✗
 *
 * Lines with ✗ are treated as bad and written (lowercased) to bad-pangrams.txt.
 *
 * Run from repo root: node scripts/v2/extract-bad-pangrams.js
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const REVIEW_PATH = path.join(DATA_DIR, "pangram-review.txt");
const OUT_PATH = path.join(DATA_DIR, "bad-pangrams.txt");

function main() {
  if (!fs.existsSync(REVIEW_PATH)) {
    console.error("Missing pangram-review file:", REVIEW_PATH);
    process.exit(1);
  }

  const raw = fs.readFileSync(REVIEW_PATH, "utf8");
  const bad = new Set();

  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    // Heuristic: split on whitespace; last token being "✗" or "X" marks bad.
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return;
    const flag = parts[parts.length - 1];
    const word = parts.slice(0, parts.length - 1).join(" ");
    if (!word) return;
    if (flag === "✗" || flag.toLowerCase() === "x" || flag.toLowerCase() === "bad") {
      const clean = word.trim().toLowerCase().replace(/[^a-z]/g, "");
      if (clean) bad.add(clean);
    }
  });

  const list = [...bad].sort();
  fs.writeFileSync(OUT_PATH, list.join("\n") + (list.length ? "\n" : ""), "utf8");
  console.log("Wrote", list.length, "bad pangram(s) to", OUT_PATH);
}

main();

