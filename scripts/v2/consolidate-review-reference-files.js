/**
 * Consolidate "reference" review files into one annotated file.
 *
 * Output:
 *   data/review-reference-all.txt
 *
 * This intentionally does NOT delete/move source files.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const OUT_PATH = path.join(DATA_DIR, "review-reference-all.txt");

const FILES = [
  "invalid-valid-words.txt",
  "pangram-review.txt",
  "bad-pangrams.txt",
  "valid-words-export.txt",
  "word-review-candidates.txt",
];

function main() {
  if (!fs.existsSync(DATA_DIR)) throw new Error("Missing data dir: " + DATA_DIR);

  const sections = [];
  sections.push("# Consolidated review reference data");
  sections.push("# Generated automatically. Each section is one source file.");
  sections.push("#");
  sections.push("# Included:");
  for (const f of FILES) sections.push("# - " + f);
  sections.push("");
  sections.push("###############################################################");
  sections.push("");

  for (const f of FILES) {
    const full = path.join(DATA_DIR, f);
    if (!fs.existsSync(full)) {
      sections.push("# ===== FILE: " + f + " =====");
      sections.push("# (missing)");
      sections.push("");
      continue;
    }
    const raw = fs.readFileSync(full, "utf8");
    const trimmed = raw.replace(/\s+$/g, "");
    sections.push("# ===== FILE: " + f + " =====");
    sections.push(trimmed);
    sections.push("");
    sections.push("###############################################################");
    sections.push("");
  }

  fs.writeFileSync(OUT_PATH, sections.join("\n"), "utf8");
  console.log("Wrote:", OUT_PATH);
}

main();

