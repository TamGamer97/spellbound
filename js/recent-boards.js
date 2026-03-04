/**
 * Spellbound — Last 100 game board indices (puzzle indices) for variety.
 * Stored locally; used so we don't repeat a board for that user (solo) or for either player (match/challenge).
 */
(function (global) {
  'use strict';

  var KEY = 'spellbound_recent_board_indices';
  var MAX = 100;

  /**
   * Returns the list of puzzle indices the user has played recently (newest first), max 100.
   * @returns {number[]}
   */
  function getRecentBoardIndices() {
    try {
      if (typeof localStorage === 'undefined') return [];
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (n) { return typeof n === 'number' && n >= 0 && (n | 0) === n; }).slice(0, MAX);
    } catch (e) { return []; }
  }

  /**
   * Appends a puzzle index to the recent list (prepends, keeps max 100).
   * @param {number} index - Puzzle index into the puzzles array.
   */
  function saveRecentBoardIndex(index) {
    try {
      if (typeof localStorage === 'undefined') return;
      if (typeof index !== 'number' || (index | 0) !== index || index < 0) return;
      var recent = getRecentBoardIndices();
      recent = recent.filter(function (n) { return n !== index; });
      recent.unshift(index);
      localStorage.setItem(KEY, JSON.stringify(recent.slice(0, MAX)));
    } catch (e) { /* ignore */ }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getRecentBoardIndices: getRecentBoardIndices,
      saveRecentBoardIndex: saveRecentBoardIndex
    };
  } else if (typeof global !== 'undefined') {
    global.SpellboundRecentBoards = {
      getRecentBoardIndices: getRecentBoardIndices,
      saveRecentBoardIndex: saveRecentBoardIndex
    };
  }
})(typeof window !== 'undefined' ? window : this);
