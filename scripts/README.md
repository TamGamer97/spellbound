# Spellbound — Scripts

## Puzzle generator (`generate-puzzles.js`)

Generates 7-letter Spelling Bee–style game boards from a word list. Each puzzle has:

- **1 center letter** and **6 outer letters**
- **Valid words**: 4+ letters, use only those 7 letters, and must include the center letter
- **At least one pangram** (a word that uses all 7 letters at least once)

Words are loaded from a text file (one word per line) or from a URL. The default source is [dwyl/english-words](https://github.com/dwyl/english-words) `words_alpha.txt`.

### Usage

```bash
# Generate puzzles (JSON to stdout)
node scripts/generate-puzzles.js

# Save to file
node scripts/generate-puzzles.js --output puzzles.json

# Emit SQL for Supabase
node scripts/generate-puzzles.js --sql --output puzzles.sql

# Limit number of puzzles
node scripts/generate-puzzles.js --limit 50

# Require at least 20 words and 200 points per puzzle
node scripts/generate-puzzles.js --min-words 20 --min-points 200 --limit 100

# Use a local word list
node scripts/generate-puzzles.js --file path/to/words.txt --output puzzles.json
```

### Options

| Option | Description |
|--------|-------------|
| `--url <url>` | Word list URL (default: dwyl english-words) |
| `--file <path>` | Use a local word list file instead |
| `--output <path>` | Write output to file (default: stdout) |
| `--sql` | Emit SQL `INSERT` statements for `public.puzzles` |
| `--limit <n>` | Maximum number of puzzles to output |
| `--min-words <n>` | Minimum valid words per puzzle (default: 20) |
| `--min-points <n>` | Minimum total points per puzzle |

### Seeding Supabase

1. Generate SQL:  
   `node scripts/generate-puzzles.js --sql --min-points 200 --limit 100 --output supabase/seed-puzzles.sql`
2. Run the generated SQL in the Supabase SQL Editor (Dashboard → SQL Editor), or apply it via migrations if you prefer.

### How it works

1. **Load words** (4–15 letters, letters only, deduplicated).
2. **Index by letter set**: for each word, compute the sorted set of unique letters; group words by that set.
3. **Find 7-letter sets** that have at least one word (those words are pangrams for that set).
4. **For each 7-letter set**, consider each of the 7 letters as the center; the other 6 are outer letters.
5. **Valid words** for that puzzle = all words in the index whose letter set is a subset of the 7 letters and that contain the center letter.
6. **Pangrams** = valid words that use all 7 letters.
7. Keep only puzzles with ≥1 pangram and ≥`min-words` valid words (and optionally ≥`min-points`).

This ensures every possible word from the word list that fits the rules is included (no missing valid words for the chosen letters).
