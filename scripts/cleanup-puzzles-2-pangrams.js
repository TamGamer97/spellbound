/**
 * One-off: Remove proper-noun and non-English pangrams from puzzles-2.json.
 * - If a puzzle's only pangram(s) are bad → remove the entire puzzle.
 * - Otherwise remove only the bad pangram(s) and drop those words from valid_words; recompute total_points.
 */

const fs = require("fs");
const path = require("path");

/** Points by word length: 4→4, 5→6, 6→8, 7→10, 8→12, ... (2*len - 4 for len >= 4). */
function pointsForWordLength(len) {
  return len >= 4 ? 2 * len - 4 : 0;
}
const PANGRAM_BONUS = 5;

// Shared proper-noun blocklist used elsewhere in the app (countries, months, names, cities, etc.)
const SPELLBOUND_BLOCKLIST = require(path.join(__dirname, "../js/proper-noun-blocklist.js"));
const PROPER_NOUN_BLOCKLIST = SPELLBOUND_BLOCKLIST.all;

const BAD_PANGRAMS = new Set([
  // Proper nouns (places, people, etc.)
  "auckland", "broadway", "cameron", "capitol", "catalonia", "connecticut",
  "cornwall", "crawford", "cremona", "endicott", "franklin", "geraint",
  "giacinto", "gironde", "grandet", "grandier", "lanciotto", "newport",
  "nicolette", "perpignan", "pierpont", "tangier", "teutonic", "argentine", "highland",
  "hampton",
  // Extra clear proper nouns and name-like words from wiki-100k pangrams
  "abingdon", "addington", "agricola", "algerian", "algerine", "alleghany", "allegheny",
  "amerigo", "armitage", "babylonia", "babylonian", "bretagne", "britannic", "britannica",
  "brumaire", "buckner", "caribbean", "carinthia", "carolina", "carolyn", "cuthbert",
  "dalmatian", "denonville", "dudevant", "fenimore", "ferdinand", "fielding", "gutenberg",
  "michelet", "micheline", "magdalen", "magdalena", "magdalene", "martino", "mcdonald",
  "mcdowell", "montmartre", "nicaragua", "patagonia", "patagonian", "perigord", "perrault",
  "roumania", "roumanian", "scandian", "scandinavian", "sicilian", "silesian", "valencia",
  "valencian", "valencia", "valenciennes",
  // Non-English / strange
  "aanleiding", "apparemment", "appartement", "atteindre", "attendri", "capitolo",
  "conveniente", "contenir", "continua", "continuait", "continuant", "convient",
  "corentin", "corriente", "courent", "coururent", "croient", "daarentegen", "demandaient",
  "demandait", "demanderai", "encuentro", "garantie", "gardent", "gardien", "gardiner",
  "incognita",
  "gegeneinander", "heftiger", "immediatement", "mendiant", "permanente",
  "poitrine", "politica", "precipita", "reconnut", "regardent", "regnait",
  "rendaient", "rendait", "rendrait", "vingtaine", "inmediatamente",
  // Extra obviously non-English or very foreign-looking words
  "aehnlich", "allgemein", "allgemeine", "allgemeinen", "allmaehlich", "antworten",
  "antwortete", "aufgaben", "aufgeben", "aufgegeben", "aufnahme", "aufregung", "arbeiten",
  "bedingungen", "begriffen", "bildung", "domenico", "domaine", "domaine", "egalement",
  "empfangen", "encontrar", "encuentra", "encuentran", "endlich", "endormi", "endormie",
  "endroit", "erhalten", "erlauben", "erlaubt", "etablir", "maedchen", "maerchen",
  "mittelalter", "moechten", "nachdem", "nachricht", "neugierde", "niente", "nobilita",
  "patrie", "patria", "patiente", "perdues", "permettrait", "pouvoir", "profiter",
  "reconforte", "remercier", "remercie", "remords", "rechteckig", "rechtsanwalt",
  "regisseur", "religieuse", "rempli", "reprenait", "retourna", "retourner", "revenaient",
  "revenait", "reviendra", "reviendrai", "ruecken", "russische", "satisfait", "savourer",
  "schlafen", "schonungslos", "schulemeister", "seiten", "semaine", "sensualite",
  "sensuelle", "sindaco", "sindicato", "sindical", "staedtchen", "stimme", "stimmen",
  "strassenbahn", "traurig", "tristezza", "ufficio", "ungluecklich", "verlangen",
  "verliebt", "vermuthlich", "versprochen", "verstandnis", "verwundert", "vielleicht",
  "volkstum", "vorbereitet", "vorkommen", "vornehm", "vornehmen", "waarheid", "wellicht",
  "wohnung", "wozu", "wunderlich",
  // Extra unusual/archaic forms you called out explicitly
  "anither", "afternoone",
  // Batch 3: additional proper nouns / foreign or very unusual forms
  "caterina", "catiline", "catriona",
  "cavalerie", "cavaliere", "cavallier",
  "celinda",
  "chaldaean", "chaldean",
  "chambre", "chandelle", "changeant", "chapelet",
  "charakter", "charaktere",
  "charing", "charite", "charmant", "charmian",
  "chauffer",
  "cherchait", "cherchant", "chretien",
  "citadelle",
  "clarenden", "clarinda", "claudet", "claudian",
  "clephane", "clifton",
  "cochrane",
  "comanche",
  "combien",
  "commande",
  "compania",
  "comparer", "complet", "complice", "comprit", "compromettre", "compter", "comptoir",
  "concernant", "concevoir",
  "concierge", "conciergerie", "concilier",
  "condamne", "condorcet",
  "confiant", "confier", "confondre",
  "congreve",
  "conocimiento",
  "conrade",
  "contarini",
  "contenait", "contentait",
  // Batch 4: additional proper nouns / foreign or very unusual forms
  "crittenden", "croatian",
  "croyait", "croyant",
  "cuarenta",
  "cuchulain", "cuchulainn",
  "cytherea",
  "dachten",
  "dakerlia",
  "dalgetty",
  "dampier",
  "danville",
  "darnley",
  "darunter",
  "davantage",
  "dearborn",
  "dechartre",
  "decidement",
  "demnach",
  "derjenige", "derjenigen",
  "devaient", "devenaient", "devenait", "deviendra",
  "devinait", "devinrent",
  "devonian",
  "dichter",
  "dietrich",
  "dijeron",
  "diminuer",
  "dingley",
  "directeur", "directoire", "dirigeait",
  "dochter", "docteur", "doivent",
  "dominait", "dominer", "dominey",
  "dominican", "domitian",
  "donatello",
  "donegal",
  "donnaient", "donnerai",
  "dorante", "dorothea",
  "dowling",
  "dufferin", "dunmore",
  "durante",
  "durement",
  "earldom",
  "earthward",
  "ecrivait",
  // Batch 5: additional proper nouns / foreign or very unusual forms
  "enfermedad",
  "enviado",
  "englander",
  "enguerrand",
  "enright",
  "ernauton",
  "erwacht", "erwachte",
  "ethelberta",
  "evangeline",
  "familien",
  "fanciulla",
  "fauville",
  "feierlich",
  "feraient",
  "federigo",
  "ferragut",
  "flandre",
  "folgende", "folgenden",
  "follement",
  "folliard",
  "freilich",
  "freundin",
  "froment",
  "fuerchte",
  "gabriel", "gabriele", "gabriella", "gabrielle",
  "gelderland",
  "georgian", "georgiana", "georgina",
  "glaubte",
  // Batch 7: pangrams 1201-1400 — proper nouns, foreign, unusual
  "infolge", "informe", "inhalte", "innerlich", "interroger", "intirely", "intreated",
  "invloed", "irgendeinem", "jardinier", "joindre", "kapitein", "kapteeni", "kapteenin",
  "kardinal", "kleidern", "krijgen", "lachend", "laechelnd", "lendemain",
  "lebendig", "lebendigen", "lebhaft", "lebhafte", "leichten", "leichter", "leitung",
  "levendig", "literatur", "litteratur", "litterature", "lointaine", "llegando", "llegaron",
  "ingeborg", "ingolby", "iphigenia", "jardine", "jourdan", "katerina", "katrine",
  "kildare", "kirkland", "lamberg", "lambeth", "lantier", "laporte", "larpent", "latimer",
  "laurence", "laurent", "lawford", "leandro", "legrand", "lemminkainen", "leonard",
  "leonarda", "leonardo", "leonilda", "lepanto", "levantine", "liberian", "lichfield",
  "ligurian", "lilienthal", "lingard", "lionardo", "lithuanian", "logotheti", "loignac",
  "lothair", "lothario", "lothian", "lucinda", "ludovic", "ludovico",
  // Batch 7b: pangrams 1401-1600 — proper nouns, foreign, unusual (was skipped earlier)
  "melicent", "melinda", "mellefont", "militaire", "millicent", "minorca", "mirabeau",
  "mitchel", "mitchell", "mitunter", "mobilier", "mochten", "moindre", "mondaine",
  "mondragon", "mongolian", "montagne", "montaient", "montebello", "montrait", "monture",
  "morland", "mortellement", "muratori", "naething", "nathaniel", "nationale", "nationalen",
  "naturel", "naturelle", "naufrage", "neradol", "newbury", "nibelungen", "niebuhr",
  "norgate", "normale", "normande", "northcote", "notaire", "nourriture", "oberlin",
  "occupait", "octavian", "olympic", "ordinaire", "ordonnance", "ortlieb", "oughter",
  "ouvrait", "ouvrant", "padrone", "paiement", "pallieter", "parcourut", "pardieu",
  "pardonne", "pardonner", "paremmin", "partaient", "parteien", "partirent", "parurent",
  "parvenu", "parvenue", "paternel",
  // Batch 8: pangrams 1601-1800 — proper nouns, foreign, unusual
  "paternelle", "patiemment", "patriote", "patronne",
  "pavilion", "pavillon",
  "peignoir", "peinture",
  "pendaient", "pendait",
  "pennington", "pentaur", "pentland",
  "permettrait", "permettait",
  "petrarch", "piccadilly",
  "pitcairn",
  "plaignait", "plainte", "planche",
  "platero",
  "pleinement", "plonger",
  "poignet",
  "pontiac",
  "praefect",
  "precedente",
  "prenaient", "prenait",
  "pretoria",
  "primavera",
  "pringle",
  "probleme",
  "prodige", "produire",
  "profeta",
  "profita", "profite",
  "profundo",
  "prolonge", "prolonger",
  "promptement",
  "proprement", "proprietaire",
  "prudente",
  "pudiera",
  "pythian",
  "rabbinical",
  "racontait", "raconte", "raconter",
  "ragione",
  "ramenait",
  "rangely",
  "rapidite",
  "rappelait", "rappelant",
  "rapproche", "rapprocher",
  "ratione",
  // Batch 9: pangrams 1801-2000 — proper nouns, foreign, unusual
  "rejoindre",
  "relatif", "relativ",
  "relevait",
  "remonta", "remontant",
  "remplace", "remplacer",
  "remuait",
  "renaldo", "renault", "rencontra",
  "repondu",
  "reproduire",
  "retomba", "retournant", "retrouva",
  "richten", "richtige",
  "rinaldo", "rinehart",
  "riverdale",
  "robrecht",
  "rockefeller",
  "romaine", "romancer", "romayne",
  "rotherwood",
  "rowland",
  "rudement",
  "ruhigen",
  "tablier",
  "taillefer", "tailleur",
  "tambien",
  "tamerlane",
  "tancred",
  "tarentum", "tarleton",
  "tarvinnut",
  "teilung",
  "tembarom",
  "temperatur",
  "templar", "templeton",
  "theodora",
  "theologie",
  "theophan",
  "thracian",
  "thuillier",
  "tillemont",
  "timoleon",
  "tiverton",
  "tottenham",
  "touchait", "touchant",
  "tourment", "tourmente", "tourmenter",
  "trachten",
  "traitement",
  "tranche",
  "tranmore",
  "traurige",
  "travaille", "travailler",
  "trompait",
  // Batch 10: pangrams 2001-2156 — proper nouns, foreign, unusual
  "ungeduldig",
  "untergang", "unterredung",
  "urtheil",
  "vaderland",
  "vaincre", "vainement",
  "valdemar", "valentia", "valentin", "valentine", "valentinian",
  "valiente",
  "vandover",
  "vautrin",
  "vendait",
  "verdedigingen", "verdediging",
  "verdient",
  "vereinigt", "vereinigung",
  "verlaten",
  "vermoegen", "vermogen",
  "vertrauen",
  "vervolgde",
  "verwonderd",
  "victoire",
  "vieillard",
  "viendra",
  "violette", "violetta",
  "violoncello",
  "vitamine",
  "viterbo",
  "vlaanderen",
  "volgden", "volgende", "volgenden",
  "volkomen",
  "vollkommen",
  "volterra",
  "voorkomen",
  "vorgenommen",
  "vornehme",
  "vorteil", "vorteile",
  "waldorf", "waldron",
  "walther",
  "warrenton",
  "waterman", "watermen", "watertown",
  "weinberg",
  "wendover",
  "weyburn",
  "wharton", "whately", "wheatley",
  "whitehall", "whitelaw", "whittington",
  "wichtige",
  "wilfred",
  "wrangel",
].map((w) => w.toLowerCase()));

const DATA_DIR = path.join(__dirname, "..", "data");
const INPUT_PATH = path.join(DATA_DIR, "puzzles-2.json");

function normalize(w) {
  return String(w).trim().toLowerCase();
}

function isProperNoun(w) {
  const upper = String(w).trim().toUpperCase();
  return PROPER_NOUN_BLOCKLIST.has(upper);
}

function isBadWord(w) {
  return BAD_PANGRAMS.has(normalize(w)) || isProperNoun(w);
}

function totalPoints(validWords, pangrams) {
  const wordPt = (validWords || []).reduce((s, w) => s + pointsForWordLength(w.length), 0);
  const pangramBonus = (pangrams || []).length * PANGRAM_BONUS;
  return wordPt + pangramBonus;
}

function main() {
  const raw = fs.readFileSync(INPUT_PATH, "utf8");
  const puzzles = JSON.parse(raw);

  const kept = [];
  let removedPuzzles = 0;
  let removedPangramsOnly = 0;
  const removedWordsLog = new Map();

  for (let i = 0; i < puzzles.length; i++) {
    const p = puzzles[i];
    const pangrams = p.pangrams || [];
    const validWords = p.valid_words || [];

    // Bad pangrams are any that are in BAD_PANGRAMS OR appear in the shared proper-noun blocklist.
    const goodPangrams = pangrams.filter((w) => !isBadWord(w));
    const badPangramSet = new Set(
      pangrams.filter((w) => isBadWord(w)).map(normalize)
    );

    if (goodPangrams.length === 0) {
      removedPuzzles++;
      continue;
    }

    if (badPangramSet.size > 0) {
      removedPangramsOnly += badPangramSet.size;
      badPangramSet.forEach((w) => removedWordsLog.set(w, (removedWordsLog.get(w) || 0) + 1));
    }

    // Also strip those same bad words out of valid_words.
    const goodValidWords = validWords.filter((w) => !isBadWord(w));
    const newPoints = totalPoints(goodValidWords, goodPangrams);

    kept.push({
      center_letter: p.center_letter,
      outer_letters: p.outer_letters,
      valid_words: goodValidWords,
      pangrams: goodPangrams,
      total_points: newPoints,
    });
  }

  fs.writeFileSync(INPUT_PATH, JSON.stringify(kept, null, 2), "utf8");

  console.log("Cleanup complete.");
  console.log("Puzzles removed (no valid pangram left):", removedPuzzles);
  console.log("Puzzles kept:", kept.length);
  console.log("Pangrams removed (puzzle kept):", removedPangramsOnly);
  if (removedWordsLog.size > 0) {
    console.log("\nWords removed (as pangram or from valid_words):");
    const sorted = [...removedWordsLog.entries()].sort((a, b) => b[1] - a[1]);
    sorted.forEach(([w, count]) => console.log("  ", w, ":", count));
  }
}

main();
