/**
 * Fast filter puzzles-2.json for "common, not weird" words.
 *
 * Goal (speed over perfect manual review):
 * - Never allow words from `data/invalid-valid-words.txt`.
 * - Never allow words from `js/proper-noun-blocklist.js`.
 * - For non-pangram valid_words, keep only:
 *    - words in Google 10k list (`data/google-10000-english.txt`)
 *    - wiki rank <= WIKI_MAX_RANK (default: 85000)
 * - For pangrams, we only apply the invalid/proper-noun filters (so we don't
 *   delete hundreds of puzzles just because a pangram isn't in Google 10k).
 *
 * For each batch:
 * - Write `data/word-review-fast-batch<batchNum>_puzzles<start>-<end>.txt`
 *   containing `word<TAB>KEEP/REMOVE<TAB>reason`
 * - Overwrite `data/puzzles-2.json` with the updated batch.
 *
 * Usage:
 *   node scripts/v2/fast-filter-puzzles-2.js --batchSize 100 --startIndex 0
 *
 * Notes:
 * - This script preserves puzzle ordering by index (does NOT drop puzzles).
 * - total_points is recomputed after each batch.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const PUZZLES_PATH = path.join(DATA_DIR, "puzzles-2.json");
const INVALID_BLOCKLIST_PATH = path.join(DATA_DIR, "invalid-valid-words.txt");
const WIKI_PATH = path.join(DATA_DIR, "wiki-100k.txt");
const GOOGLE_10K_PATH = path.join(DATA_DIR, "google-10000-english.txt");

const SPELLBOUND_BLOCKLIST = require(path.join(__dirname, "..", "..", "js", "proper-noun-blocklist.js"));
const PROPER_NOUN_BLOCKLIST = SPELLBOUND_BLOCKLIST.all;

const GOOGLE_10K_URL =
  "https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english.txt";

// Defaults chosen after quick experiments to remove names like "cecil/cecile/cellini"
// while keeping playable pangrams.
const DEFAULT_WIKI_MAX_RANK = 85000;
const PANGRAM_BONUS = 5;

function pointsForWordLength(len) {
  return len >= 4 ? 2 * len - 4 : 0;
}

function totalPoints(validWords, pangrams) {
  const wordPt = (validWords || []).reduce((s, w) => s + pointsForWordLength(String(w || "").length), 0);
  const pangramBonus = (pangrams || []).length * PANGRAM_BONUS;
  return wordPt + pangramBonus;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

function loadInvalidBlocklist() {
  const set = new Set();
  if (!fs.existsSync(INVALID_BLOCKLIST_PATH)) return set;
  const lines = fs.readFileSync(INVALID_BLOCKLIST_PATH, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const w = line.trim().toLowerCase().replace(/#.*$/, "").trim();
    if (w && /^[a-z]+$/.test(w)) set.add(w);
  });
  return set;
}

function loadWikiRanks() {
  const ranks = new Map();
  if (!fs.existsSync(WIKI_PATH)) throw new Error("Missing wiki list: " + WIKI_PATH);
  const lines = fs.readFileSync(WIKI_PATH, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const w = lines[i].trim().toLowerCase();
    if (!w) continue;
    // wiki-100k.txt is one word per line; rank is 1-indexed
    ranks.set(w, i + 1);
  }
  return ranks;
}

function downloadText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error("HTTP " + res.statusCode + " downloading: " + url));
          return;
        }
        let d = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
      })
      .on("error", reject);
  });
}

async function ensureGoogle10k() {
  if (fs.existsSync(GOOGLE_10K_PATH)) return;
  const raw = await downloadText(GOOGLE_10K_URL);
  fs.writeFileSync(GOOGLE_10K_PATH, raw, "utf8");
}

function loadGoogle10k() {
  if (!fs.existsSync(GOOGLE_10K_PATH)) throw new Error("Missing google 10k list: " + GOOGLE_10K_PATH);
  const raw = fs.readFileSync(GOOGLE_10K_PATH, "utf8");
  const set = new Set();
  raw
    .split(/\r?\n/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .forEach((w) => set.add(w));
  return set;
}

function getDecisionForWord(word, opts) {
  const wl = String(word || "").toLowerCase();
  if (!wl) return { keep: false, reason: "empty" };

  if (opts.invalidBlocklist.has(wl)) return { keep: false, reason: "in invalid-valid-words.txt" };
  if (opts.properNounBlocklist.has(wl.toUpperCase())) return { keep: false, reason: "in proper-noun-blocklist.js" };

  if (opts.isPangram) {
    return { keep: true, reason: "pangram kept (only invalid/proper filters applied)" };
  }

  if (!opts.google10k.has(wl)) return { keep: false, reason: "not in Google 10k list" };

  const r = opts.wikiRanks.get(wl) || 999999;
  if (r > opts.wikiMaxRank) return { keep: false, reason: "wiki-rank too high (uncommon)" };

  return { keep: true, reason: "passes common filters" };
}

async function main() {
  const args = parseArgs();
  const batchSize = parseInt(args.batchSize || "100", 10);
  const startIndex = parseInt(args.startIndex || "0", 10);
  const endIndex = args.endIndex != null ? parseInt(args.endIndex, 10) : null;
  const wikiMaxRank = parseInt(args.wikiMaxRank || String(DEFAULT_WIKI_MAX_RANK), 10);

  await ensureGoogle10k();

  const invalidBlocklist = loadInvalidBlocklist();
  const wikiRanks = loadWikiRanks();
  const google10k = loadGoogle10k();
  const properNounBlocklist = PROPER_NOUN_BLOCKLIST;

  console.log("Loaded:");
  console.log(" - puzzles:", PUZZLES_PATH);
  console.log(" - invalid blocklist size:", invalidBlocklist.size);
  console.log(" - proper noun blocklist size:", properNounBlocklist.size);
  console.log(" - google 10k size:", google10k.size);
  console.log(" - wiki ranks:", wikiRanks.size);
  console.log(" - wikiMaxRank:", wikiMaxRank);

  const puzzles = JSON.parse(fs.readFileSync(PUZZLES_PATH, "utf8"));
  if (!Array.isArray(puzzles)) throw new Error("puzzles-2.json must be an array");
  const total = puzzles.length;
  const effectiveEnd = endIndex == null ? total : Math.min(endIndex, total);
  if (startIndex < 0 || startIndex >= total) throw new Error("Bad startIndex");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(DATA_DIR, "puzzles-2.json.bak-fast-filter-" + timestamp);
  fs.writeFileSync(backupPath, JSON.stringify(puzzles, null, 2), "utf8");
  console.log("Backup written:", backupPath);

  let batchNum = 1;
  for (let batchStart = startIndex; batchStart < effectiveEnd; batchStart += batchSize) {
    const batchEnd = Math.min(effectiveEnd, batchStart + batchSize);
    console.log("\nBatch", batchNum, "puzzles", batchStart, "to", batchEnd - 1);

    const lines = [];

    for (let puzzleIndex = batchStart; puzzleIndex < batchEnd; puzzleIndex++) {
      const p = puzzles[puzzleIndex];
      const validWords = Array.isArray(p.valid_words) ? p.valid_words.slice() : [];
      const pangrams = Array.isArray(p.pangrams) ? p.pangrams.slice() : [];

      const pangSet = new Set(pangrams.map((w) => String(w || "").toLowerCase()));

      const newValid = [];
      // Decision export: list decisions for words in original `valid_words` order.
      for (let vi = 0; vi < validWords.length; vi++) {
        const w = validWords[vi];
        const wl = String(w || "").toLowerCase();
        const isPangram = pangSet.has(wl);
        const decision = getDecisionForWord(w, {
          isPangram,
          invalidBlocklist,
          properNounBlocklist,
          google10k,
          wikiRanks,
          wikiMaxRank,
        });
        lines.push(wl + "\t" + (decision.keep ? "KEEP" : "REMOVE") + "\t" + decision.reason);
        if (decision.keep) newValid.push(wl);
      }

      const newPangrams = [];
      for (let pi2 = 0; pi2 < pangrams.length; pi2++) {
        const w = pangrams[pi2];
        const decision = getDecisionForWord(w, {
          isPangram: true,
          invalidBlocklist,
          properNounBlocklist,
          google10k,
          wikiRanks,
          wikiMaxRank,
        });
        if (decision.keep) newPangrams.push(String(w).toLowerCase());
      }

      puzzles[puzzleIndex] = {
        center_letter: p.center_letter,
        outer_letters: p.outer_letters,
        valid_words: newValid,
        pangrams: newPangrams,
        total_points: totalPoints(newValid, newPangrams),
      };
    }

    const outTxt = path.join(
      DATA_DIR,
      "word-review-fast-batch" + String(batchNum).padStart(2, "0") + "_puzzles" + batchStart + "-" + (batchEnd - 1) + ".txt"
    );
    fs.writeFileSync(outTxt, lines.join("\n") + "\n", "utf8");
    console.log("Wrote decisions:", outTxt);

    // Overwrite puzzles after each batch to meet your "step-by-step" requirement.
    fs.writeFileSync(PUZZLES_PATH, JSON.stringify(puzzles, null, 2), "utf8");
    console.log("Updated puzzles-2.json after batch", batchNum);

    batchNum++;
  }

  console.log("\nDone. Final puzzles-2.json updated.");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

