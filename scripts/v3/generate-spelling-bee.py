#!/usr/bin/env python3
"""
Spelling Bee Puzzle Generator
==============================
Uses SCOWL (size 60, ~86k common English words, no proper nouns) as the
primary "allowed" dictionary — the closest freely available match to the
NYT Spelling Bee word list.

Uses the ENABLE public-domain word list (~170k words) as the full corpus
for valid_words enrichment (same role wiki-100k played before).

Requirements:
    pip install requests

Usage:
    python generate-spelling-bee.py               # generates 150 puzzles
    python generate-spelling-bee.py --count 200   # custom count
    python generate-spelling-bee.py --append      # append to existing puzzles-2.json

Output:
    puzzles-2.json  (same format as your existing file)

Word list choices (why these?):
    SCOWL-60:  ~86k common English words, no proper nouns, widely used as
               the closest open approximation to the NYT Spelling Bee dict.
    ENABLE:    ~170k public-domain word list, used for enriching valid_words
               (finds all possible answers, not just "nice" ones).
"""

import argparse
import json
import os
import random
import re
import ssl
import sys
import urllib.request
from collections import defaultdict

# Bypass SSL verification (fixes Windows certificate issues)
SSL_CONTEXT = ssl.create_default_context()
SSL_CONTEXT.check_hostname = False
SSL_CONTEXT.verify_mode = ssl.CERT_NONE

# ── Word list URLs ────────────────────────────────────────────────────────────
# SCOWL size-60 plain word list (American English, no proper nouns)
SCOWL_60_URL = (
    "https://raw.githubusercontent.com/en-wl/wordlist/master/scowl/final/"
    "english-words.60"
)
# Fallback mirrors for SCOWL-60
SCOWL_60_MIRRORS = [
    # Kevin Atkinson's original SourceForge release (plain list)
    "https://sourceforge.net/projects/wordlist/files/scrabble/2019.10.06/"
    "sowpods.txt/download",
    # Pre-built plain SCOWL-60 from aspell.net
    "https://downloads.sourceforge.net/project/wordlist/speller/2020.12.07/"
    "en_US-large.txt",
]
# ENABLE word list (public domain, ~170k words)
ENABLE_URL = (
    "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt"
)
# Supplementary: common 7-letter words (TWL/CSW intersection)
COMMON7_URL = (
    "https://raw.githubusercontent.com/zeisler/scrabble/master/db/dictionary.txt"
)

# ── Puzzle settings ───────────────────────────────────────────────────────────
MIN_WORD_LEN = 4
MAX_WORD_LEN = 12
MIN_VALID_WORDS = 15        # minimum words in allowed dict (was 20, relaxed slightly)
MIN_PANGRAMS = 1            # minimum pangrams (NYT requires at least 1)
PREFERRED_PANGRAMS = 2      # prefer 2+ pangrams when possible
BANNED_LETTERS = set("sqxz")
POINTS_PER_LETTER = 1
PANGRAM_BONUS = 7           # NYT awards 7 pts for pangrams



# Obscure suffix filter (keeps word list clean)
OBSCURE_SUFFIXES = [
    "idae", "aceae", "ologist", "otomy", "itis", "osis",
    "mentum", "escence",
]

# ── Output ────────────────────────────────────────────────────────────────────
# Writes to archive; canonical puzzle set is data/puzzles-2.json (from scripts/v2).
OUTPUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../data/archive/puzzles-v3-experimental.json")


# ─────────────────────────────────────────────────────────────────────────────
# Word list loading
# ─────────────────────────────────────────────────────────────────────────────

def fetch_url(url: str, label: str) -> str:
    """Download text from URL, return as string."""
    print(f"  Downloading {label}…", end=" ", flush=True)
    try:
        with urllib.request.urlopen(url, timeout=30, context=SSL_CONTEXT) as r:
            data = r.read().decode("utf-8", errors="ignore")
        print(f"✓ ({len(data)//1024} KB)")
        return data
    except Exception as e:
        print(f"✗ ({e})")
        return ""


def parse_words(raw: str, min_len=MIN_WORD_LEN, max_len=MAX_WORD_LEN) -> set:
    """Parse a raw word list into a filtered set of lowercase words."""
    words = set()
    for line in raw.splitlines():
        w = line.strip().lower()
        # alphabetic only, correct length
        if not w or not re.fullmatch(r"[a-z]+", w):
            continue
        if not (min_len <= len(w) <= max_len):
            continue
        # drop obscure suffixes
        if any(w.endswith(s) for s in OBSCURE_SUFFIXES):
            continue
        words.add(w)
    return words


def load_word_lists():
    """
    Returns (allowed_set, corpus_set) where:
      allowed_set  — SCOWL-60 common words used as the "nice" dictionary
      corpus_set   — ENABLE words used for full valid_words enrichment
    """
    print("\nFetching word lists…")

    # 1. SCOWL-60 (primary allowed dictionary)
    scowl_raw = fetch_url(SCOWL_60_URL, "SCOWL-60")
    if not scowl_raw:
        # Try mirrors
        for mirror in SCOWL_60_MIRRORS:
            scowl_raw = fetch_url(mirror, "SCOWL-60 (mirror)")
            if scowl_raw:
                break

    allowed_set = parse_words(scowl_raw) if scowl_raw else set()

    # 2. ENABLE (full corpus for enrichment)
    enable_raw = fetch_url(ENABLE_URL, "ENABLE word list")
    corpus_set = parse_words(enable_raw, max_len=15) if enable_raw else set()

    # If SCOWL failed, fall back to ENABLE as allowed set too
    if not allowed_set:
        print("  ⚠  SCOWL-60 unavailable — using ENABLE as allowed set (quality may differ)")
        allowed_set = corpus_set.copy()

    # Supplement SCOWL with ENABLE for higher recall on rare-letter words
    # (adds ENABLE words that appear in both as a cross-check)
    combined_allowed = allowed_set | (corpus_set & allowed_set)

    print(f"\n  SCOWL-60 words loaded : {len(allowed_set):,}")
    print(f"  ENABLE words loaded   : {len(corpus_set):,}")
    print(f"  Combined allowed set  : {len(combined_allowed):,}")

    return combined_allowed, corpus_set


# ─────────────────────────────────────────────────────────────────────────────
# Puzzle logic
# ─────────────────────────────────────────────────────────────────────────────

def unique_letters(word: str) -> str:
    return "".join(sorted(set(word)))


def is_pangram(word: str) -> bool:
    return len(set(word)) == 7


def valid_for_puzzle(word: str, letter_set: frozenset, center: str) -> bool:
    return (
        len(word) >= MIN_WORD_LEN
        and center in word
        and all(c in letter_set for c in word)
    )


def score_puzzle(valid_words, pangrams):
    base = sum(len(w) * POINTS_PER_LETTER for w in valid_words)
    return base + len(pangrams) * PANGRAM_BONUS


def try_build_puzzle(pangram_word: str, allowed_set: set, corpus_set: set,
                     relaxed: bool = False):
    """
    Try all 7 center-letter choices for a given pangram word.
    Returns the best (most valid_words) puzzle dict, or None.
    """
    letters = list(set(pangram_word))
    if len(letters) != 7:
        return None

    letter_set = frozenset(letters)
    min_words = (MIN_VALID_WORDS // 2) if relaxed else MIN_VALID_WORDS
    min_pans = 1  # always just 1 minimum

    best = None
    best_score = -1

    for center in letters:
        # valid_words: from allowed_set (the "nice" dict)
        valid_words = sorted(
            w for w in allowed_set
            if valid_for_puzzle(w, letter_set, center)
        )
        pangrams = [w for w in valid_words if is_pangram(w)]

        if len(valid_words) < min_words or len(pangrams) < min_pans:
            continue

        # enriched_valid: from full corpus (all possible answers)
        enriched = sorted(
            w for w in corpus_set
            if valid_for_puzzle(w, letter_set, center)
        )
        enriched_pangrams = [w for w in enriched if is_pangram(w)]

        sc = score_puzzle(enriched, enriched_pangrams)
        if sc > best_score:
            best_score = sc
            best = {
                "center_letter": center,
                "outer_letters": "".join(l for l in letters if l != center),
                "valid_words": enriched,
                "pangrams": enriched_pangrams,
                "total_points": sc,
            }

    return best


def letter_set_key(puzzle: dict) -> str:
    raw = puzzle["center_letter"] + puzzle["outer_letters"]
    return "".join(sorted(raw.lower()))


def generate_puzzles(allowed_set: set, corpus_set: set, target: int):
    """
    Main generation loop. Produces `target` unique puzzles from the full
    letter distribution — no letter forcing or boosting.
    """
    print(f"\nGenerating {target} puzzles…\n")

    all_pangrams = [
        w for w in (allowed_set | corpus_set)
        if (len(set(w)) == 7
            and MIN_WORD_LEN <= len(w) <= MAX_WORD_LEN
            and not any(c in BANNED_LETTERS for c in w))
    ]
    random.shuffle(all_pangrams)
    print(f"  Total pangram candidates : {len(all_pangrams):,}\n")

    output = []
    seen = set()
    pangram_iter = iter(all_pangrams)
    attempts = 0
    max_attempts = target * 200

    while len(output) < target and attempts < max_attempts:
        attempts += 1

        try:
            pangram_word = next(pangram_iter)
        except StopIteration:
            random.shuffle(all_pangrams)
            pangram_iter = iter(all_pangrams)
            pangram_word = next(pangram_iter)

        puzzle = try_build_puzzle(pangram_word, allowed_set, corpus_set)
        if puzzle is None:
            continue

        key = letter_set_key(puzzle)
        if key in seen:
            continue

        seen.add(key)
        output.append(puzzle)

        n = len(output)
        if n % 10 == 0 or n == target:
            print(f"  [{n:>3}/{target}]")

    print(f"\n  ✓ Generated {len(output)} puzzles in {attempts} attempts")
    return output


# ─────────────────────────────────────────────────────────────────────────────
# Stats
# ─────────────────────────────────────────────────────────────────────────────

def print_stats(puzzles):
    n = len(puzzles)
    if n == 0:
        return

    counts: dict = defaultdict(int)
    for p in puzzles:
        seen_in_puzzle = set()
        for c in (p["center_letter"] + p["outer_letters"]).lower():
            if c not in seen_in_puzzle:
                counts[c] += 1
                seen_in_puzzle.add(c)

    total_words = sum(len(p["valid_words"]) for p in puzzles)
    avg_words = total_words / n
    avg_pts = sum(p["total_points"] for p in puzzles) / n

    print(f"\n{'─'*55}")
    print(f"  Puzzles       : {n}")
    print(f"  Avg words     : {avg_words:.1f}")
    print(f"  Avg points    : {avg_pts:.0f}")
    print(f"{'─'*55}")
    print(f"  Letter occurrence (fair share ≈ {n*7/26:.1f} per letter):")

    bar_scale = 20
    for c in sorted(counts):
        cnt = counts[c]
        pct = cnt / n * 100
        filled = round(cnt / n * bar_scale)
        bar = "#" * filled + "-" * (bar_scale - filled)
        print(f"    {c.upper()}: {cnt:>4} ({pct:>5.1f}%) {bar}")
    print()


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Spelling Bee puzzle generator")
    parser.add_argument("--count", type=int, default=150,
                        help="Number of new puzzles to generate (default: 150)")
    parser.add_argument("--append", action="store_true",
                        help="Append to existing puzzles-2.json instead of replacing")
    parser.add_argument("--output", default=OUTPUT_PATH,
                        help=f"Output JSON path (default: {OUTPUT_PATH})")
    args = parser.parse_args()

    # Load existing if appending
    existing = []
    if args.append and os.path.exists(args.output):
        with open(args.output, "r") as f:
            existing = json.load(f)
        print(f"Loaded {len(existing)} existing puzzles from {args.output}")

    # Fetch word lists
    allowed_set, corpus_set = load_word_lists()

    if not allowed_set:
        print("\n✗ Failed to load word lists. Check your internet connection.")
        sys.exit(1)

    # Generate
    new_puzzles = generate_puzzles(allowed_set, corpus_set, args.count)

    # Merge
    all_puzzles = existing + new_puzzles

    # Write output
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(all_puzzles, f, indent=2)

    print(f"Wrote {len(all_puzzles)} total puzzles to {args.output}")
    print_stats(all_puzzles)


if __name__ == "__main__":
    main()