/**
 * Find valid_words entries that are not present in wiki-100k.txt.
 * Used for spotting unusual words to potentially move into invalid-valid-words.txt.
 *
 * Run from repo root: node scripts/v2/find-invalid-words.js
 */

const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "..", "data", "puzzles-2.json");
const wikiPath = path.join(__dirname, "..", "..", "data", "wiki-100k.txt");

const puzzles = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const wikiLines = fs.readFileSync(wikiPath, "utf8").split(/\r?\n/);
const wikiSet = new Set();
wikiLines.forEach(function (l) {
  const w = l.trim().toLowerCase();
  if (w && !w.startsWith("#") && /^[a-z]+$/.test(w)) wikiSet.add(w);
});

const invalid = new Set();
puzzles.forEach(function (p) {
  (p.valid_words || []).forEach(function (w) {
    const lower = w.toLowerCase();
    if (lower.length >= 4 && lower.length <= 15 && !wikiSet.has(lower)) {
      invalid.add(lower);
    }
  });
});

const list = [...invalid].sort();
console.log("valid_words not in wiki-100k (" + list.length + "):");
console.log(list.slice(0, 120).join(", "));
if (list.length > 120) {
  console.log("... and", list.length - 120, "more");
}

