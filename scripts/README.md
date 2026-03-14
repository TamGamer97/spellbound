# Scripts

## Puzzle generation

| Folder | Purpose | Output |
|--------|---------|--------|
| **v1** | Original word-list puzzle generator. | `data/puzzles.json` (legacy; see [v1/README.md](v1/README.md)). |
| **v2** | **Main generator** — wiki-100k + common-7, blocklist filtering. | `data/puzzles-2.json` (canonical). See [v2/README.md](v2/README.md). |
| **v3** | Python generator (SCOWL/ENABLE). | `data/archive/puzzles-v3-experimental.json`. |

## Maintenance (puzzle data)

Run from repo root, e.g.:

```bash
node scripts/v2/cleanup-puzzles-2-pangrams.js
```

The entrypoints now live alongside the v2 generator; the legacy filenames in `scripts/` are kept as thin wrappers for backwards compatibility.

| Script (v2) | Purpose |
|-------------|---------|
| `v2/cleanup-puzzles-2-pangrams.js` | Remove bad pangrams from `data/puzzles-2.json` (uses `data/bad-pangrams.txt` + proper-noun blocklist). Drops puzzles that end up with no valid pangram. |
| `v2/enrich-puzzles-2.js` | Recompute `valid_words` and `total_points` for every puzzle in `data/puzzles-2.json`. |
| `v2/remove-invalid-valid-words.js` | Remove fragment / nonsense words from `valid_words` / `pangrams` using `data/invalid-valid-words.txt`. |
| `v2/extract-bad-pangrams.js` | One-time: extract words marked ✗ from `pangram-review.txt` into `data/bad-pangrams.txt`. |
| `v2/find-invalid-words.js` | Inspect `valid_words` that don’t appear in `wiki-100k.txt` for manual review. |
| `v2/test-board-selection.js` | Test random board selection from `data/puzzles-2.json`. |

## Analysis

| Script | Purpose |
|--------|---------|
| `v2/letter-stats-2.js` | Letter frequency stats across all puzzles in `data/puzzles-2.json`. |
