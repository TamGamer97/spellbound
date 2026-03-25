/**
 * Consolidate word-review batch files into one annotated file.
 *
 * Writes:
 *   data/word-review-all-batches.txt
 *
 * Source patterns:
 *   data/word-review-batch*.txt
 *   data/word-review-fast-batch*.txt
 *
 * Output format:
 *   # ===== FILE: <filename> =====
 *   <original file content>
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const OUT_PATH = path.join(DATA_DIR, "word-review-all-batches.txt");

function naturalSort(a, b) {
  // Split into digit/non-digit chunks: "batch10" sorts after "batch2".
  const ax = String(a).toLowerCase().split(/(\d+)/).filter(Boolean);
  const bx = String(b).toLowerCase().split(/(\d+)/).filter(Boolean);
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const as = ax[i];
    const bs = bx[i];
    if (as === undefined) return -1;
    if (bs === undefined) return 1;
    const an = String(as).match(/^\d+$/) ? parseInt(as, 10) : null;
    const bn = String(bs).match(/^\d+$/) ? parseInt(bs, 10) : null;
    if (an != null && bn != null) {
      if (an !== bn) return an - bn;
    } else if (String(as) !== String(bs)) {
      return String(as).localeCompare(String(bs));
    }
  }
  return 0;
}

function matches(name) {
  return (
    /^word-review-batch\d+\.txt$/i.test(name) ||
    /^word-review-fast-batch/i.test(name) && /\.txt$/i.test(name)
  );
}

function main() {
  if (!fs.existsSync(DATA_DIR)) throw new Error("Missing data dir: " + DATA_DIR);
  const files = fs.readdirSync(DATA_DIR).filter(matches);
  files.sort(naturalSort);

  const sections = [];
  sections.push(
    "# Consolidated word review batches",
    "# Generated automatically. Each section is one source file.",
    "#",
    "# Source files:",
    ...files.map((f) => "# - " + f),
    "",
    "###############################################################",
    ""
  );

  for (const f of files) {
    const full = path.join(DATA_DIR, f);
    const raw = fs.readFileSync(full, "utf8");
    const trimmed = raw.replace(/\s+$/g, "");
    sections.push("# ===== FILE: " + f + " =====");
    sections.push(trimmed);
    sections.push(""); // blank line between sections
  }

  fs.writeFileSync(OUT_PATH, sections.join("\n"), "utf8");
  console.log("Wrote:", OUT_PATH);
  console.log("Included files:", files.length);
}

main();

