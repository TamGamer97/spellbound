const fs = require("fs");
const path = require("path");

// ---------------- SETTINGS ----------------
const MIN_WORD_LENGTH = 4;
const MIN_WORD_COUNT = 25;
// ------------------------------------------

function loadWordNetWords() {
  const dictPath = path.join(
    __dirname,
    "node_modules",
    "wordnet-db",
    "dict"
  );

  const indexFiles = [
    "index.noun",
    "index.verb",
    "index.adj",
    "index.adv"
  ];

  let words = new Set();

  indexFiles.forEach(file => {
    const filePath = path.join(dictPath, file);

    if (!fs.existsSync(filePath)) {
      console.error("Missing file:", filePath);
      return;
    }

    const lines = fs.readFileSync(filePath, "utf8").split("\n");

    lines.forEach(line => {
      if (!line.startsWith(" ") && line.trim().length > 0) {
        const word = line.split(" ")[0];

        if (
          word.length >= MIN_WORD_LENGTH &&
          /^[a-z]+$/.test(word) &&
          word === word.toLowerCase()
        ) {
          words.add(word);
        }
      }
    });
  });

  return Array.from(words);
}

function getUniqueLetters(word) {
  return [...new Set(word)].sort().join("");
}

function isValidWord(word, lettersSet, centerLetter) {
  if (word.length < MIN_WORD_LENGTH) return false;
  if (!word.includes(centerLetter)) return false;

  for (let char of word) {
    if (!lettersSet.has(char)) return false;
  }

  return true;
}

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

function generatePuzzle(wordList) {
  const pangrams = wordList.filter(
    w => getUniqueLetters(w).length === 7
  );

  if (pangrams.length === 0) {
    throw new Error("No pangrams found.");
  }

  while (true) {
    const randomPangram =
      pangrams[Math.floor(Math.random() * pangrams.length)];

    const letters = getUniqueLetters(randomPangram).split("");
    const shuffled = shuffle([...letters]);

    const center = shuffled[0];
    const outer = shuffled.slice(1);
    const lettersSet = new Set(letters);

    const validWords = wordList.filter(w =>
      isValidWord(w, lettersSet, center)
    );

    const pangramWords = validWords.filter(
      w => getUniqueLetters(w).length === 7
    );

    if (
      validWords.length >= MIN_WORD_COUNT &&
      pangramWords.length >= 1
    ) {
      return {
        letters,
        center,
        outer,
        validWords: validWords.sort(),
        pangramWords
      };
    }
  }
}

// ---------------- RUN ----------------

console.log("Loading WordNet...");
const wordList = loadWordNetWords();
console.log("Loaded words:", wordList.length);

console.log("Generating puzzle...");
const puzzle = generatePuzzle(wordList);

console.log("\n=== PUZZLE ===");
console.log("Letters:", puzzle.letters.join(" "));
console.log("Center:", puzzle.center);
console.log("Total Valid Words:", puzzle.validWords.length);
console.log("Pangrams:", puzzle.pangramWords);

console.log("\n=== VALID WORDS ===");
console.log(puzzle.validWords.join(", "));