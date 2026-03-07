# Data archive

This folder holds **legacy and experimental** data files that are not used by the live app or canonical scripts.

- **puzzles-v1-legacy.json** — Output of `scripts/v1/generate-puzzles.js`. Superseded by `data/puzzles-2.json`.
- **puzzles-v3-experimental.json** — Output of `scripts/v3/generate-spelling-bee.py`. Alternative generator; app uses `puzzles-2.json`.
- **pangram-words-extract.txt** — Raw list of unique pangrams; superseded by `data/pangram-review.txt` (which adds ✓/✗ and comments).
- **pangram-candidates.txt** — Small manual list of pangram candidates (reference only).

Do not reference these from the game or from the main puzzle pipeline unless you intend to restore or compare.
