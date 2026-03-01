#!/usr/bin/env node
/**
 * Spellbound — Game board (puzzle) generator
 *
 * Generates 7-letter Spelling Bee puzzles from a word list:
 * - 1 center letter + 6 outer letters
 * - Valid words: 4+ letters, only those 7 letters, must include center
 * - Each puzzle has at least one pangram (word using all 7 letters)
 *
 * Usage:
 *   node scripts/generate-puzzles.js [options]
 *   node scripts/generate-puzzles.js --output puzzles.json
 *   node scripts/generate-puzzles.js --sql --limit 50
 *
 * Options:
 *   --url <url>   Word list URL (default: Google 20k most common English)
 *   --file <path> Use local file instead of URL
 *   --output <path> Write JSON to file (default: stdout)
 *   --sql         Emit SQL INSERT statements for Supabase puzzles table
 *   --limit <n>   Max puzzles to output (default: no limit)
 *   --min-words <n> Min valid words per puzzle (default: 20)
 *   --min-points <n> Min total points per puzzle (default: 0)
 *   --min-pangrams <n> Min pangrams per puzzle (default: 2)
 */

const fs = require('fs');
const https = require('https');
const MIN_LENGTH = 4;
const MAX_LENGTH = 15;
const MIN_WORDS_PER_PUZZLE = 20;
const PANGRAM_BONUS = 5;
const POINTS_PER_LETTER = 1;

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : require('http');
    protocol.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function loadWords(source) {
  if (source.file) {
    return Promise.resolve(fs.readFileSync(source.file, 'utf8'));
  }
  const url = source.url || 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/20k.txt';
  return fetchUrl(url);
}

/** Words to exclude from puzzles (20k list has no no-swears variant). */
const BLOCKLIST = new Set([
  'ASS', 'ASSES', 'HELL', 'CRAP', 'DAMN', 'SHIT', 'SLUT', 'TITS', 'WHORE', 'BITCH', 'DICK', 'COCK', 'PUSSY', 'FUCK', 'FUCKS', 'FUCKED', 'FUCKING',
  'CUNT', 'PISS', 'PISSED', 'NAZI', 'NIGGA', 'NIGGER', 'FAG', 'FAGGOT', 'RETARD', 'RETARDS'
]);

function parseWordList(text) {
  const seen = new Set();
  const words = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const w = line.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (w.length < MIN_LENGTH || w.length > MAX_LENGTH) continue;
    if (seen.has(w)) continue;
    if (BLOCKLIST.has(w)) continue;
    seen.add(w);
    words.push(w);
  }
  return words;
}

/** Returns sorted string of unique letters in word. */
function uniqueLetters(word) {
  const set = new Set();
  for (let i = 0; i < word.length; i++) set.add(word[i]);
  return [...set].sort().join('');
}

/** True if word uses only letters in allowed set. */
function usesOnly(word, allowedSet) {
  for (let i = 0; i < word.length; i++) {
    if (!allowedSet.has(word[i])) return false;
  }
  return true;
}

/** True if word uses all 7 letters (pangram). */
function isPangram(word, sevenSet) {
  if (sevenSet.size !== 7) return false;
  for (const c of sevenSet) {
    if (word.indexOf(c) === -1) return false;
  }
  return true;
}

/** Generate all non-empty subsets of a string of 7 letters, each as sorted string. */
function allSubsetKeys(sevenLetters) {
  const out = [];
  const n = 7;
  for (let mask = 1; mask < (1 << n); mask++) {
    let s = '';
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) s += sevenLetters[i];
    }
    out.push(s.split('').sort().join(''));
  }
  return out;
}

/** Fisher–Yates shuffle in place. */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function generatePuzzles(words, minWordsPerPuzzle = MIN_WORDS_PER_PUZZLE, minPangrams = 2) {
  // Index: letter set (sorted string) -> list of words that use exactly those letters
  const letterSetToWords = new Map();
  for (const w of words) {
    const key = uniqueLetters(w);
    if (key.length > 7) continue;
    if (!letterSetToWords.has(key)) letterSetToWords.set(key, []);
    letterSetToWords.get(key).push(w);
  }

  // Only 7-letter sets can have pangrams; get those that have at least one word (pangram)
  const sevenLetterKeys = [];
  for (const [key, list] of letterSetToWords) {
    if (key.length === 7 && list.length > 0) sevenLetterKeys.push(key);
  }
  shuffleArray(sevenLetterKeys);

  const puzzles = [];
  const seenPuzzles = new Set();

  for (const letterSetKey of sevenLetterKeys) {
    const allSeven = new Set(letterSetKey);
    const letters = [...allSeven];

    // All words that use only these 7 letters: union over all subset keys
    const candidateSet = new Set();
    for (const subKey of allSubsetKeys(letterSetKey)) {
      const list = letterSetToWords.get(subKey);
      if (list) for (const w of list) candidateSet.add(w);
    }
    const candidateWords = [...candidateSet];

    // For each letter as center, build one puzzle
    for (let c = 0; c < 7; c++) {
      const center = letters[c];
      const outer = letters.filter((_, i) => i !== c).sort().join('');
      const puzzleKey = center + outer;
      if (seenPuzzles.has(puzzleKey)) continue;
      seenPuzzles.add(puzzleKey);

      const validWords = candidateWords.filter((w) => w.indexOf(center) !== -1);
      const pangrams = validWords.filter((w) => isPangram(w, allSeven));

      if (pangrams.length < minPangrams) continue;
      if (validWords.length < minWordsPerPuzzle) continue;

      const totalPoints = validWords.reduce((sum, w) => sum + w.length * POINTS_PER_LETTER, 0) +
        pangrams.length * PANGRAM_BONUS;

      puzzles.push({
        center_letter: center,
        outer_letters: outer,
        valid_words: validWords.sort(),
        pangrams: pangrams.sort(),
        total_points: totalPoints,
      });
    }
  }

  return puzzles;
}

function toSql(puzzles) {
  const rows = puzzles.map((p) => {
    const vw = JSON.stringify(p.valid_words);
    const pg = JSON.stringify(p.pangrams);
    return `  ('${p.center_letter}', '${p.outer_letters}', '${vw}'::jsonb, '${pg}'::jsonb, ${p.total_points})`;
  });
  return (
    '-- Generated by scripts/generate-puzzles.js\n' +
    'INSERT INTO public.puzzles (center_letter, outer_letters, valid_words, pangrams, total_points)\n' +
    'VALUES\n' + rows.join(',\n') + '\n;'
  );
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { minWords: MIN_WORDS_PER_PUZZLE };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      opts.url = args[++i];
    } else if (args[i] === '--file' && args[i + 1]) {
      opts.file = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      opts.output = args[++i];
    } else if (args[i] === '--sql') {
      opts.sql = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
      opts.limit = parseInt(args[++i], 10);
    } else if (args[i] === '--min-words' && args[i + 1]) {
      opts.minWords = parseInt(args[++i], 10);
    } else if (args[i] === '--min-points' && args[i + 1]) {
      opts.minPoints = parseInt(args[++i], 10);
    } else if (args[i] === '--min-pangrams' && args[i + 1]) {
      opts.minPangrams = parseInt(args[++i], 10);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const source = opts.file ? { file: opts.file } : { url: opts.url };
  process.stderr.write('Loading word list...\n');
  const text = await loadWords(source);
  const words = parseWordList(text);
  process.stderr.write(`Loaded ${words.length} words (${MIN_LENGTH}+ letters).\n`);

  const minWords = opts.minWords != null ? opts.minWords : MIN_WORDS_PER_PUZZLE;
  const minPangrams = opts.minPangrams != null ? opts.minPangrams : 2;
  let puzzles = generatePuzzles(words, minWords, minPangrams);

  if (opts.minPoints != null && opts.minPoints > 0) {
    puzzles = puzzles.filter((p) => p.total_points >= opts.minPoints);
  }
  // Prefer puzzles with lots of words and multiple pangrams: sort by word count then pangram count
  puzzles.sort((a, b) => {
    const aWords = a.valid_words.length;
    const bWords = b.valid_words.length;
    if (bWords !== aWords) return bWords - aWords;
    return (b.pangrams.length - a.pangrams.length);
  });
  const poolSize = opts.limit ? Math.min(puzzles.length, Math.max(opts.limit * 3, 50)) : puzzles.length;
  const pool = puzzles.slice(0, poolSize);
  shuffleArray(pool);
  if (opts.limit) {
    puzzles = pool.slice(0, opts.limit);
  } else {
    puzzles = pool;
  }
  process.stderr.write(`Generated ${puzzles.length} puzzles (each with ≥${minPangrams} pangrams, ≥${minWords} words).\n`);

  let out;
  if (opts.sql) {
    out = toSql(puzzles);
  } else {
    out = JSON.stringify(puzzles, null, 2);
  }

  if (opts.output) {
    fs.writeFileSync(opts.output, out, 'utf8');
    process.stderr.write(`Wrote ${opts.output}\n`);
  } else {
    console.log(out);
  }
}

main().catch((err) => {
  process.stderr.write(err.message + '\n');
  process.exit(1);
});
