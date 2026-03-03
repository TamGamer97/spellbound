# Spellbound scripts — v1

Word-list–based puzzle generator: `generate-puzzles.js`, plus `sample-puzzles.sql`.

### Usage

```bash
# From project root
node scripts/v1/generate-puzzles.js --output data/puzzles.json

# Or from this folder
cd scripts/v1 && node generate-puzzles.js --output ../../data/puzzles.json
```

### Options

See the main [scripts README](../README.md) for full options (`--limit`, `--min-words`, `--min-pangrams`, `--sql`, etc.).
