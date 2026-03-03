/**
 * Spellbound — Last 2 game boards (letter sets) for variety.
 * Used by game (solo pick priority, save on load) and lobby (preferred indices for match/challenge).
 */
(function (global) {
  'use strict';

  var KEY = 'spellbound_recent_boards';
  var MAX = 2;

  function getRecentLetterSets() {
    try {
      if (typeof localStorage === 'undefined') return [];
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (s) { return typeof s === 'string' && s.length === 7; }).slice(0, MAX);
    } catch (e) { return []; }
  }

  function saveRecentLetterSet(letterSet) {
    try {
      if (typeof localStorage === 'undefined') return;
      if (!letterSet || typeof letterSet !== 'string' || letterSet.length !== 7) return;
      var recent = getRecentLetterSets();
      recent = recent.filter(function (s) { return s !== letterSet; });
      recent.unshift(letterSet);
      localStorage.setItem(KEY, JSON.stringify(recent.slice(0, MAX)));
    } catch (e) { /* ignore */ }
  }

  function getPuzzleLetterSet(puzzle) {
    if (!puzzle) return '';
    var s = (puzzle.center_letter + (puzzle.outer_letters || '')).toUpperCase().replace(/[^A-Z]/g, '');
    return s.split('').sort().join('');
  }

  function letterOverlap(lettersA, lettersB) {
    var setA = new Set((lettersA || '').split(''));
    var count = 0;
    for (var i = 0; i < (lettersB || '').length; i++) { if (setA.has(lettersB[i])) count++; }
    return count;
  }

  /**
   * Returns puzzle indices (into puzzles array) with lowest total overlap with recent boards.
   * If no recent boards, returns all indices. Used by lobby for findMatch/sendChallenge.
   */
  function getPreferredPuzzleIndices(puzzles) {
    if (!puzzles || !puzzles.length) return [];
    var recent = getRecentLetterSets();
    var indices = [];
    var i;
    if (recent.length === 0) {
      for (i = 0; i < puzzles.length; i++) indices.push(i);
      return indices;
    }
    var minScore = 1e9;
    for (i = 0; i < puzzles.length; i++) {
      var set = getPuzzleLetterSet(puzzles[i]);
      var score = 0;
      for (var j = 0; j < recent.length; j++) score += letterOverlap(recent[j], set);
      if (score < minScore) minScore = score;
    }
    for (i = 0; i < puzzles.length; i++) {
      var s = getPuzzleLetterSet(puzzles[i]);
      var sc = 0;
      for (var k = 0; k < recent.length; k++) sc += letterOverlap(recent[k], s);
      if (sc === minScore) indices.push(i);
    }
    return indices.length ? indices : (function () { for (var n = 0; n < puzzles.length; n++) indices.push(n); return indices; })();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getRecentLetterSets: getRecentLetterSets,
      saveRecentLetterSet: saveRecentLetterSet,
      getPuzzleLetterSet: getPuzzleLetterSet,
      getPreferredPuzzleIndices: getPreferredPuzzleIndices
    };
  } else if (typeof global !== 'undefined') {
    global.SpellboundRecentBoards = {
      getRecentLetterSets: getRecentLetterSets,
      saveRecentLetterSet: saveRecentLetterSet,
      getPuzzleLetterSet: getPuzzleLetterSet,
      getPreferredPuzzleIndices: getPreferredPuzzleIndices
    };
  }
})(typeof window !== 'undefined' ? window : this);
