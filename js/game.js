/**
 * Spellbound — Spelling Bee
 *
 * Round 1 rules:
 * - 10-minute timer (from DB started_at in versus, or first interaction in solo)
 * - 4-letter minimum; scoring 4→4, 5→6, 6→8, 7→10… pts, +5 pangram
 */

(function () {
  'use strict';

  var gameId = (function () {
    var p = typeof window !== 'undefined' && window.location && window.location.search && window.location.search.slice(1);
    var params = p ? new URLSearchParams(p) : null;
    return params && params.get('gameId') ? params.get('gameId') : null;
  })();

  // Bot mode (local opponent, no Supabase):
  // - bot=1 is just a mode flag.
  // - botLevel is 1|2|3 in the URL (Wordsmith/Literate/Covfefe),
  //   but we also accept the older 0|1|2 for backward compatibility.
  var botLevel = (function () {
    var p = typeof window !== 'undefined' && window.location && window.location.search && window.location.search.slice(1);
    var params = p ? new URLSearchParams(p) : null;
    if (!params) return null;
    var botFlag = params.get('bot');
    if (!botFlag) return null;
    var levelRaw = params.get('botLevel');
    if (levelRaw === null || typeof levelRaw === 'undefined') return null;
    var n = parseInt(levelRaw, 10);
    if (isNaN(n)) return null;

    // Accept:
    // - 1|2|3 (current): map to 0|1|2
    // - 0|1|2 (legacy): map to 0|1|2
    //
    // IMPORTANT: prioritize the current scheme first so that:
    //   botLevel=1 => Wordsmith (index 0)
    //   botLevel=2 => Literate (index 1)
    //   botLevel=3 => Covfefe (index 2)
    if (n >= 1 && n <= 3) return n - 1;
    if (n >= 0 && n < 3) return n;

    return null;
  })();

  /** Local puzzle set (data/puzzles-2.json). Loaded before init; used for versus (puzzle_index) and solo (random). */
  var LOCAL_PUZZLES = [];
  /** Last 100 game boards (any mode) for variety — see js/recent-boards.js */
  var RB = typeof window !== 'undefined' && window.SpellboundRecentBoards ? window.SpellboundRecentBoards : null;
  /** Blocklist for dictionary fallback: words in this set are never accepted. */
  var DICTIONARY_BLOCKLIST = new Set();
  /** Abort previous dictionary API request when the player submits a different word. */
  var dictionaryFetchController = null;
  /**
   * Incremented on each dictionary-path submit so async completions from an older attempt
   * never accept/clear the wrong word (avoids "freeze then only first word counts").
   */
  var activeDictionaryReqId = 0;
  /** Words we've confirmed as valid via dictionary this session (skip re-fetch on retry). */
  var dictionaryValidCache = new Set();

  /** Local profanity blocklist (lowercase). Add words here; no external API. */
  var LOCAL_PROFANITY = new Set([
    'damn', 'hell', 'crap', 'bastard', 'bitch', 'bloody', 'bugger', 'bullshit',
    'cunt', 'dick', 'fuck', 'fucked', 'fucking', 'piss', 'pissed', 'shit', 'shitty',
    'slut', 'whore', 'wanker', 'bollocks', 'darn', 'dang', 'freaking', 'effing'
  ]);

  /** Sync: true if the word is blocked by the local profanity list. */
  function isProfanityBlocked(word) {
    var key = String(word).trim().toLowerCase();
    return LOCAL_PROFANITY.has(key);
  }

  /** Returns a Promise<boolean>: true if the word is in the local profanity blocklist. No network. */
  function checkProfanity(word) {
    return Promise.resolve(isProfanityBlocked(word));
  }

  /** Returns true if the word (case-insensitive) is in the shared blocklist (countries, months, names). See js/proper-noun-blocklist.js */
  function isProperNoun(word) {
    if (!word || typeof word !== 'string') return false;
    var w = word.trim().toUpperCase();
    if (!w) return false;
    var blocklist = typeof window !== 'undefined' && window.SpellboundBlocklist && window.SpellboundBlocklist.all;
    return blocklist ? blocklist.has(w) : false;
  }

  /* ========================================================================
     Configuration: letter set & word list (set from DB in versus, else default)
     ======================================================================== */

  var LETTER_SET = {
    center: 'E',
    outer: ['R', 'T', 'A', 'L', 'N', 'P'],
  };

  var VALID_WORDS = new Set([
    'REAL', 'RATE', 'LATE', 'TEAR', 'NEAR', 'PEAR', 'LEAN', 'PEAL', 'LEAP', 'PALE',
    'PANE', 'TAPE', 'REEL', 'PEER', 'LEER', 'RANT', 'ANTE', 'LANE', 'PEARL', 'LEARN',
    'PLANE', 'PANEL', 'PLANET', 'REPEAT', 'REPEAL', 'REPLANT', 'PLANTER', 'PARENT',
    'TREAT', 'ALTER', 'LATER', 'RENAL', 'APERT', 'PETAL', 'PLEAT', 'PLATE', 'REAP',
  ]);

  var PANGRAMS = new Set(
    Array.from(VALID_WORDS).filter(function (w) { return usesAllSeven(w, LETTER_SET.center, LETTER_SET.outer); })
  );

  const MIN_LENGTH = 4;
  /** Points by word length: 4→4, 5→6, 6→8, 7→10, 8→12, ... (2*len - 4 for len >= 4). */
  function pointsForWordLength(len) {
    return len >= MIN_LENGTH ? 2 * len - 4 : 0;
  }
  const PANGRAM_BONUS = 5;
  const TOTAL_SECONDS = 5 * 60;

  // Bot difficulties: base seconds between found words in minute 0.
  // Then it gets 1 second slower (interval increases by +1 each minute).
  var BOT_LEVELS = [
    { name: 'Wordsmith', baseSeconds: 4 },   // best
    { name: 'Literate', baseSeconds: 7 },    // medium
    { name: 'Covfefe', baseSeconds: 10 },     // worst
  ];

  /* ========================================================================
     DOM references (optional elements may be null if not in layout)
     ======================================================================== */
  const $ = (id) => document.getElementById(id);
  const timerEl = $('timer');
  const scoreEl = $('score');
  const opponentScoreEl = $('opponent-score');
  const wordsListEl = $('words-list');
  const honeycomb = $('honeycomb');
  const wordInput = $('word-input');
  const validationEl = $('validation-message');
  const btnDelete = $('btn-delete');
  const btnShuffle = $('btn-shuffle');
  const btnEnter = $('btn-enter');
  const btnLeave = $('btn-leave');
  const leaveOverlay = $('leave-overlay');
  const btnLeaveCancel = $('btn-leave-cancel');
  const btnLeaveConfirm = $('btn-leave-confirm');
  const opponentLeftEl = $('opponent-left-msg');
  const opponentWordsPlaceholder = $('opponent-words-placeholder');
  const opponentWordsListEl = document.getElementById('opponent-words-list');
  const playerUsernameEl = $('player-username');
  const opponentUsernameEl = $('opponent-username');
  const challengeNotifOverlay = $('challenge-notif-overlay');
  const challengeNotifMsg = $('challenge-notif-msg');
  const challengeNotifJoinGame = $('challenge-notif-join-game');
  const challengeNotifRejectGame = $('challenge-notif-reject-game');
  const loadingEl = $('game-loading');
  const gameMainEl = $('game-main');
  var unsubscribeGamePlayers = null;
  var unsubscribeChallenges = null;

  function setLoadingText(text) {
    var t = loadingEl && loadingEl.querySelector('.game-loading-text');
    if (t) t.textContent = text || 'Loading…';
  }

  function hideGameLoading() {
    if (loadingEl) {
      loadingEl.classList.add('game-loading-hidden');
      loadingEl.setAttribute('aria-busy', 'false');
    }
    if (gameMainEl) gameMainEl.setAttribute('aria-hidden', 'false');
    if (typeof updateMobileWordDisplay === 'function') updateMobileWordDisplay();
  }

  function openLeaveModal() {
    if (leaveOverlay) { leaveOverlay.classList.add('open'); leaveOverlay.setAttribute('aria-hidden', 'false'); }
  }
  function closeLeaveModal() {
    if (leaveOverlay) { leaveOverlay.classList.remove('open'); leaveOverlay.setAttribute('aria-hidden', 'true'); }
  }
  function doLeave() {
    if (gameId && window.db && window.db.leaveGame) {
      window.db.leaveGame(gameId).then(function () { window.location.href = 'lobby.html'; }).catch(function () { window.location.href = 'lobby.html'; });
    } else {
      window.location.href = 'lobby.html';
    }
  }

  if (btnLeave && leaveOverlay) {
    btnLeave.addEventListener('click', openLeaveModal);
    if (btnLeaveCancel) btnLeaveCancel.addEventListener('click', closeLeaveModal);
    if (btnLeaveConfirm) btnLeaveConfirm.addEventListener('click', doLeave);
    leaveOverlay.addEventListener('click', function (e) {
      if (e.target === leaveOverlay) closeLeaveModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && leaveOverlay && leaveOverlay.classList.contains('open')) closeLeaveModal();
    });
  }

  /** Mobile: toggle Words found dropdown */
  function setupWordsDropdownToggle(toggleId, dropdownId) {
    var btn = document.getElementById(toggleId);
    var dropdown = document.getElementById(dropdownId);
    if (!btn || !dropdown) return;
    btn.addEventListener('click', function () {
      var isOpen = dropdown.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }
  setupWordsDropdownToggle('words-toggle-player', 'words-dropdown-player');
  setupWordsDropdownToggle('words-toggle-opponent', 'words-dropdown-opponent');

  var roundEndOverlay = $('round-end-overlay');
  var roundEndMessage = $('round-end-message');
  var roundEndWinner = $('round-end-winner');
  var roundEndScores = $('round-end-scores');
  var btnRoundKeepPlaying = $('btn-round-keep-playing');
  var btnRoundClose = $('btn-round-close');
  var btnRoundLeave = $('btn-round-leave');
  var opponentLeftNotifOverlay = $('opponent-left-notif-overlay');
  var btnOpponentLeftBack = $('btn-opponent-left-back');

  if (btnRoundKeepPlaying) {
    btnRoundKeepPlaying.addEventListener('click', function () {
      state.gameOver = false;
      if (roundEndOverlay) {
        roundEndOverlay.classList.remove('open');
        roundEndOverlay.setAttribute('aria-hidden', 'true');
      }
      if (timerEl) {
        timerEl.textContent = '—';
        timerEl.classList.add('bitter-end');
      }
      if (state.isBotGame) scheduleBotNextWord();
    });
  }
  if (btnRoundClose) {
    btnRoundClose.addEventListener('click', function () {
      if (roundEndOverlay) {
        roundEndOverlay.classList.remove('open');
        roundEndOverlay.setAttribute('aria-hidden', 'true');
      }
    });
  }
  if (btnRoundLeave) {
    btnRoundLeave.addEventListener('click', function () {
      if (gameId && window.db && window.db.leaveGame) {
        window.db.leaveGame(gameId).then(function () { window.location.href = 'lobby.html'; }).catch(function () { window.location.href = 'lobby.html'; });
      } else {
        window.location.href = 'lobby.html';
      }
    });
  }
  if (btnOpponentLeftBack) {
    btnOpponentLeftBack.addEventListener('click', function () {
      if (opponentLeftNotifOverlay) {
        opponentLeftNotifOverlay.classList.remove('open');
        opponentLeftNotifOverlay.setAttribute('aria-hidden', 'true');
      }
      if (gameId && window.db && window.db.leaveGame) {
        window.db.leaveGame(gameId).then(function () { window.location.href = 'lobby.html'; }).catch(function () { window.location.href = 'lobby.html'; });
      } else {
        window.location.href = 'lobby.html';
      }
    });
  }
  if (roundEndOverlay) {
    roundEndOverlay.addEventListener('click', function (e) {
      if (e.target === roundEndOverlay) {
        roundEndOverlay.classList.remove('open');
        roundEndOverlay.setAttribute('aria-hidden', 'true');
      }
    });
  }

  /** Game state. */
  var state = {
    score: 0,
    found: new Set(),
    letters: [],
    timerId: null,
    secondsLeft: TOTAL_SECONDS,
    gameOver: false,
    roundOver: false,
    gameId: gameId,
    isBotGame: botLevel !== null && typeof botLevel !== 'undefined' && botLevel >= 0 && botLevel < 3,
    botLevel: botLevel,
    botTimerStarted: false,
    botStartTs: null,
    botFindTimeoutId: null,
    botName: null,
    botBaseSeconds: null,
    myUserId: null,
    opponentWords: new Set(),
    roundPhase: 'round_1',
    totalBoardPoints: 0,
    opponentScore: 0,
    myUsername: null,
    opponentUsername: null,

    // Bot: extra pool after exhausting puzzle `VALID_WORDS`.
    botExtraWordsPool: null, // array of UPPERCASE words
    botExtraWordsReady: false,
  };

  /**
   * Index of the center hex in the layout.
   * Order: hex-0, hex-1, hex-2, hex-center, hex-3, hex-4, hex-5.
   */
  const CENTER_INDEX = 3;

  /* ========================================================================
     Helpers: letters & validation
     ======================================================================== */

  /** Returns [center, ...outer] for the current puzzle. */
  function getAllLetters() {
    return [state.letters[CENTER_INDEX], ...state.letters.slice(0, CENTER_INDEX), ...state.letters.slice(CENTER_INDEX + 1, 7)];
  }

  /** True if word uses all 7 letters (center + outer) at least once. */
  function usesAllSeven(word, center, outer) {
    const all = new Set([center.toUpperCase(), ...(outer || []).map(function (c) { return String(c).toUpperCase(); })]);
    const w = String(word).toUpperCase();
    for (var i = 0; i < w.length; i++) {
      all.delete(w[i]);
    }
    return all.size === 0;
  }

  /** True if word is a pangram for the current puzzle (uses all 7 letters at least once). */
  function isPangram(word) {
    if (!word || !LETTER_SET || !LETTER_SET.center) return false;
    var outer = LETTER_SET.outer;
    if (typeof outer === 'string') outer = outer.split('');
    return usesAllSeven(word, LETTER_SET.center, outer);
  }

  /** Returns the 6 outer letters in random order (center is never shuffled). */
  function getShuffledOuterOnly() {
    var outer = LETTER_SET.outer.slice ? LETTER_SET.outer.slice() : LETTER_SET.outer;
    if (!outer.slice) outer = Array.from(outer);
    for (var i = outer.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = outer[i]; outer[i] = outer[j]; outer[j] = t;
    }
    return outer;
  }

  /** Compute total points available on the board (for 95% competitive win). */
  function computeTotalBoardPoints() {
    var total = 0;
    VALID_WORDS.forEach(function (w) {
      total += pointsForWordLength(w.length);
      if (isPangram(w)) total += PANGRAM_BONUS;
    });
    return total;
  }

  /** Set puzzle from DB (versus mode). Pangrams derived by definition (word uses all 7 letters). Normalize to uppercase so validation matches. */
  function setPuzzleFromData(puzzle) {
    if (!puzzle) return;
    var center = String(puzzle.center_letter || '').toUpperCase();
    var outerRaw = typeof puzzle.outer_letters === 'string' ? puzzle.outer_letters.split('') : (puzzle.outer_letters || []);
    var outer = outerRaw.map(function (c) { return String(c).toUpperCase(); });
    LETTER_SET = { center: center, outer: outer };
    var words = Array.isArray(puzzle.valid_words) ? puzzle.valid_words : [];
    VALID_WORDS = new Set(words.map(function (w) { return String(w).toUpperCase(); }));
    PANGRAMS = new Set(Array.from(VALID_WORDS).filter(isPangram));
    state.totalBoardPoints = computeTotalBoardPoints();
  }

  function getUsernameFromRow(row) {
    if (!row || !row.users) return null;
    var u = row.users;
    if (typeof u === 'object' && u !== null && typeof u.username === 'string') return u.username;
    if (Array.isArray(u) && u[0] && typeof u[0].username === 'string') return u[0].username;
    return null;
  }

  /** Update opponent panel: score, username, and "opponent left". Opponent words are not shown; we only store them for validation (no reusing except pangrams). */
  function applyOpponentPlayers(players, myUserId) {
    if (!players || !players.length || !myUserId) return;
    var myRow = players.filter(function (p) { return p.user_id === myUserId; })[0];
    var opponent = players.filter(function (p) { return p.user_id !== myUserId; })[0];
    if (myRow) {
      var myName = getUsernameFromRow(myRow);
      if (myName) {
        state.myUsername = myName;
        if (playerUsernameEl) playerUsernameEl.textContent = myName;
      }
    }
    if (!opponent) return;
    state.opponentScore = opponent.score || 0;
    if (opponentScoreEl) opponentScoreEl.textContent = state.opponentScore;
    state.opponentUsername = getUsernameFromRow(opponent) || 'Opponent';
    if (opponentUsernameEl) opponentUsernameEl.textContent = state.opponentUsername;
    if (opponent.words_found && Array.isArray(opponent.words_found)) {
      state.opponentWords = new Set(opponent.words_found.map(function (w) { return String(w).toUpperCase(); }));
    }
    if (opponent.left_at && opponentLeftEl) {
      opponentLeftEl.style.display = 'block';
      if (opponentWordsPlaceholder) opponentWordsPlaceholder.style.display = 'none';
    }
  }

  /** Timer driven by DB started_at so both players stay in sync. */
  function startTimerFromDB(startedAtIso, durationSeconds) {
    if (state.timerId) return;
    var startMs = new Date(startedAtIso).getTime();
    var durationMs = (durationSeconds || 600) * 1000;
    function tickFromDB() {
      if (state.gameOver) return;
      var elapsed = Date.now() - startMs;
      state.secondsLeft = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
      var m = Math.floor(state.secondsLeft / 60);
      var s = state.secondsLeft % 60;
      if (timerEl) {
        timerEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
        timerEl.classList.remove('warning', 'danger', 'timer-countdown', 'timer-pulse');
        if (state.secondsLeft <= 10 && state.secondsLeft > 0) {
          timerEl.classList.add('timer-countdown');
          timerEl.classList.remove('timer-pulse');
          void timerEl.offsetWidth;
          timerEl.classList.add('timer-pulse');
        } else if (state.secondsLeft <= 60) timerEl.classList.add('danger');
        else if (state.secondsLeft <= 120) timerEl.classList.add('warning');
      }
      if (state.secondsLeft <= 0) endGame('Time\'s up!');
    }
    tickFromDB();
    state.timerId = setInterval(tickFromDB, 1000);
  }

  /* ========================================================================
     Honeycomb: render letters
     ======================================================================== */

  /**
   * Updates the 7 hex elements with current letters.
   * @param {boolean} [shuffleOuterLettersOnly] - If true, only reorder outer letters; center stays the same.
   */
  function renderHoneycomb(shuffleOuterLettersOnly) {
    const center = LETTER_SET.center;
    if (shuffleOuterLettersOnly && state.letters.length === 7) {
      const outer = [state.letters[0], state.letters[1], state.letters[2], state.letters[4], state.letters[5], state.letters[6]];
      const shuffled = getShuffledOuterOnly();
      state.letters = [shuffled[0], shuffled[1], shuffled[2], center, shuffled[3], shuffled[4], shuffled[5]];
    } else {
      const outer = getShuffledOuterOnly();
      state.letters = [outer[0], outer[1], outer[2], center, outer[3], outer[4], outer[5]];
    }
    const hexIds = ['hex-0', 'hex-1', 'hex-2', 'hex-center', 'hex-3', 'hex-4', 'hex-5'];
    hexIds.forEach((id, i) => {
      const el = $(id);
      if (!el) return;
      const letter = state.letters[i];
      el.textContent = letter ? letter.toUpperCase() : letter;
      el.dataset.letter = letter ? letter.toUpperCase() : letter;
    });
  }

  /** Syncs the mobile-only word strip with the current input value (no placeholder). */
  function updateMobileWordDisplay() {
    var el = document.getElementById('mobile-word-display');
    if (!el || !wordInput) return;
    el.textContent = wordInput.value || '';
  }

  /** Appends a letter to the input (e.g. when clicking a hex). Cursor is moved to end. */
  function addLetter(letter) {
    if (state.gameOver) return;
    const val = wordInput.value.toUpperCase();
    if (val.length < 15) {
      wordInput.value = val + letter;
      wordInput.setSelectionRange(wordInput.value.length, wordInput.value.length);
      updateMobileWordDisplay();
    }
  }

  /** Shows validation message (Great, Taken, Pangram, or error). */
  var validationClearTimeoutId = null;
  function showValidation(message, className) {
    if (validationClearTimeoutId) {
      clearTimeout(validationClearTimeoutId);
      validationClearTimeoutId = null;
    }
    if (validationEl) {
      validationEl.textContent = message;
      validationEl.className = 'validation-message ' + (className || '');
    }
    validationClearTimeoutId = setTimeout(function () {
      validationClearTimeoutId = null;
      if (validationEl) {
        validationEl.textContent = '';
        validationEl.className = 'validation-message';
      }
    }, 2200);
  }

  /* ========================================================================
     Submit word: validate and add to list
     ======================================================================== */

  function submitWord() {
    const raw = wordInput.value.trim().toUpperCase();
    if (validationClearTimeoutId) {
      clearTimeout(validationClearTimeoutId);
      validationClearTimeoutId = null;
    }
    if (validationEl) {
      validationEl.textContent = '';
      validationEl.className = 'validation-message';
    }

    if (!raw) return;

    // If the player has already found all valid words, we simply don't
    // trigger any special "win" flow here. Further submits will be handled
    // normally (e.g. "Taken" for already-found words) and the game ends
    // via the timer/normal round logic.

    if (raw.length < MIN_LENGTH) {
      showValidation('Too short', 'invalid');
      wordInput.value = '';
      updateMobileWordDisplay();
      return;
    }

    const center = state.letters[CENTER_INDEX];
    const allowed = new Set(getAllLetters());
    for (const c of raw) {
      if (!allowed.has(c)) {
        showValidation('Invalid letters', 'invalid');
        wordInput.value = '';
        updateMobileWordDisplay();
        return;
      }
    }
    if (!raw.includes(center)) {
      showValidation('Must use center letter', 'invalid');
      wordInput.value = '';
      updateMobileWordDisplay();
      return;
    }

    if (isProperNoun(raw)) {
      showValidation('Proper nouns are not allowed', 'invalid');
      wordInput.value = '';
      updateMobileWordDisplay();
      return;
    }

    if (state.found.has(raw)) {
      showValidation('Taken', 'taken');
      wordInput.value = '';
      updateMobileWordDisplay();
      return;
    }

    if ((gameId || state.isBotGame) && state.opponentWords && state.opponentWords.has(raw) && !isPangram(raw)) {
      showValidation('Already found by opponent', 'invalid');
      wordInput.value = '';
      updateMobileWordDisplay();
      return;
    }

    if (state.gameOver) return;

    var inPuzzleList = VALID_WORDS.has(raw);
    if (inPuzzleList) {
      if (isProfanityBlocked(raw)) {
        showValidation("That word isn't allowed", 'invalid');
        wordInput.value = '';
        updateMobileWordDisplay();
        return;
      }
      acceptAndRecordWord(raw);
      return;
    }

    if (DICTIONARY_BLOCKLIST.has(raw)) {
      showValidation('Not a word', 'invalid');
      wordInput.value = '';
      updateMobileWordDisplay();
      return;
    }

    activeDictionaryReqId++;
    var reqId = activeDictionaryReqId;
    if (dictionaryFetchController) {
      try {
        dictionaryFetchController.abort();
      } catch (e) { /* ignore */ }
    }
    dictionaryFetchController = new AbortController();
    var signal = dictionaryFetchController.signal;

    var apiBase = typeof window.__SPELLBOUND_DICTIONARY_API__ !== 'undefined' && window.__SPELLBOUND_DICTIONARY_API__
      ? window.__SPELLBOUND_DICTIONARY_API__
      : 'https://api.dictionaryapi.dev/api/v2/entries/en';
    var apiUrl = apiBase.replace(/\/$/, '') + '/' + encodeURIComponent(raw.toLowerCase());

    function doProfanityThenAccept(word) {
      dictionaryValidCache.add(word);
      return checkProfanity(word).then(function (hasProfanity) {
        if (reqId !== activeDictionaryReqId) return;
        if (hasProfanity) {
          showValidation("That word isn't allowed", 'invalid');
          wordInput.value = '';
          updateMobileWordDisplay();
        } else {
          acceptAndRecordWord(word);
        }
      });
    }

    if (dictionaryValidCache.has(raw)) {
      doProfanityThenAccept(raw).catch(function () {});
      return;
    }

    fetch(apiUrl, { signal: signal })
      .then(function (res) {
        if (reqId !== activeDictionaryReqId) return;
        if (!res.ok) {
          showValidation('Not a word', 'invalid');
          wordInput.value = '';
          updateMobileWordDisplay();
          return;
        }
        return doProfanityThenAccept(raw);
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        if (reqId !== activeDictionaryReqId) return;
        showValidation('Not a word', 'invalid');
        wordInput.value = '';
        updateMobileWordDisplay();
      });
  }

  function acceptAndRecordWord(raw) {
    state.found.add(raw);
    var basePoints = pointsForWordLength(raw.length);
    var bonus = isPangram(raw) ? PANGRAM_BONUS : 0;
    state.score += basePoints + bonus;

    wordInput.value = '';
    updateMobileWordDisplay();
    if (scoreEl) scoreEl.textContent = state.score;
    if (!gameId || !window.db || !window.db.updateMyGamePlayer) {
      // Solo mode only: keep opponent panel in sync (bot mode manages opponentScore separately).
      if (!state.isBotGame && opponentScoreEl) opponentScoreEl.textContent = state.score;
    }
    if (gameId && window.db && window.db.updateMyGamePlayer) {
      window.db.updateMyGamePlayer(gameId, { score: state.score, words_found: Array.from(state.found) }).catch(function () {});
    }

    var li = document.createElement('li');
    li.textContent = raw;
    if (isPangram(raw)) li.classList.add('pangram');
    if (wordsListEl) {
      wordsListEl.appendChild(li);
      li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    var isMobile = typeof window.matchMedia !== 'undefined' && window.matchMedia('(max-width: 600px)').matches;
    if (isMobile) {
      var wordsDropdown = document.getElementById('words-dropdown-player');
      var wordsToggle = document.getElementById('words-toggle-player');
      if (wordsDropdown && wordsToggle && !wordsDropdown.classList.contains('is-open')) {
        wordsDropdown.classList.add('is-open');
        wordsToggle.setAttribute('aria-expanded', 'true');
      }
    }

    if (isPangram(raw)) {
      showValidation('Pangram!', 'pangram');
    } else {
      showValidation('Great!', 'great');
    }

    checkWin();
  }

  /** If all valid words found in Round 1 and round not already over, end the game. */
  function checkWin() {
    if (!state || state.gameOver || state.roundOver || state.roundPhase !== 'round_1') return;
    // End only when the player has found all puzzle words AND score is at
    // least 10× the puzzle maximum (`totalBoardPoints`).
    if (state.found.size !== VALID_WORDS.size) return;

    var maxPoints = typeof state.totalBoardPoints === 'number' && !isNaN(state.totalBoardPoints)
      ? state.totalBoardPoints
      : computeTotalBoardPoints();

    if (state.score >= 10 * maxPoints) {
      endGame('All words found!');
    }
  }

  /** Reveal opponent's words in the opponent panel (at end of round). */
  function revealOpponentWords() {
    if (!opponentWordsListEl || !(gameId || state.isBotGame)) return;
    if (opponentWordsPlaceholder) opponentWordsPlaceholder.style.display = 'none';
    opponentWordsListEl.innerHTML = '';
    var words = state.opponentWords ? Array.from(state.opponentWords) : [];
    words.sort();
    words.forEach(function (w) {
      var li = document.createElement('li');
      li.textContent = w;
      if (isPangram(w)) li.classList.add('pangram');
      opponentWordsListEl.appendChild(li);
    });
  }

  /** Stops timer and shows game-over overlay with winner, scores, and Keep finding words / Leave. */
  function endGame(message) {
    if (state.gameOver) return;
    state.gameOver = true;
    state.roundOver = true;
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    if (state.botFindTimeoutId) {
      clearTimeout(state.botFindTimeoutId);
      state.botFindTimeoutId = null;
    }
    if (timerEl) {
      timerEl.textContent = '0:00';
      timerEl.classList.remove('timer-countdown', 'timer-pulse');
    }
    if (gameId && window.db && window.db.setGameFinished) {
      var endReason = (message === 'All words found!') ? 'all_words_found' : 'time_up';
      window.db.setGameFinished(gameId, endReason).catch(function () {});
    }
    function showOverlay() {
      var overlay = $('round-end-overlay');
      var messageEl = $('round-end-message');
      var winnerEl = $('round-end-winner');
      var scoresEl = $('round-end-scores');
      if (!overlay) {
        alert(message + '\nFinal score: ' + state.score);
        return;
      }
      if (messageEl) messageEl.textContent = message;
      var btnKeepPlaying = $('btn-round-keep-playing');
      if (btnKeepPlaying) {
        btnKeepPlaying.style.display = (message === 'All words found!') ? 'none' : '';
      }
      var myName = state.myUsername || 'You';
      var oppName = state.opponentUsername || 'Opponent';
      var oppScore = ((gameId || state.isBotGame) && state.opponentScore != null) ? state.opponentScore : state.score;
      if (scoresEl) {
        scoresEl.textContent = myName + ': ' + state.score + ((gameId || state.isBotGame) ? ' · ' + oppName + ': ' + oppScore : '');
      }
      var winnerText = '';
      if ((gameId || state.isBotGame) && state.opponentScore != null) {
        var myHasPangram = false;
        state.found.forEach(function (w) {
          if (!myHasPangram && isPangram(w)) myHasPangram = true;
        });
        var opponentHasPangram = false;
        if (state.opponentWords && state.opponentWords.forEach) {
          state.opponentWords.forEach(function (w) {
            if (!opponentHasPangram && isPangram(w)) opponentHasPangram = true;
          });
        }
        if (!myHasPangram && !opponentHasPangram) {
          winnerText = 'No winner (no pangrams found).';
        } else if (myHasPangram && opponentHasPangram) {
          if (state.score > state.opponentScore) {
            winnerText = (myName === 'You' ? 'You win!' : myName + ' wins!');
          } else if (state.score < state.opponentScore) {
            winnerText = oppName + ' wins!';
          } else {
            winnerText = 'It\'s a tie!';
          }
        } else if (myHasPangram && !opponentHasPangram) {
          if (state.opponentScore > state.score) {
            winnerText = (myName === 'You' ? 'You win! ' + oppName + ' had more points but failed to find a pangram.' : myName + ' wins! ' + oppName + ' had more points but failed to find a pangram.');
          } else {
            winnerText = (myName === 'You' ? 'You win (pangram)!' : myName + ' wins (pangram)!');
          }
        } else if (!myHasPangram && opponentHasPangram) {
          if (state.score > state.opponentScore) {
            winnerText = oppName + ' wins! ' + (myName === 'You' ? 'You' : myName) + ' had more points but failed to find a pangram.';
          } else {
            winnerText = oppName + ' wins (pangram)!';
          }
        }
      } else {
        winnerText = 'Final score: ' + state.score;
      }
      if (winnerEl) winnerEl.textContent = winnerText;
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
    }

    if (gameId && window.db && window.db.getGamePlayers) {
      window.db.getGamePlayers(gameId).then(function (players) {
        if (players && state.myUserId) {
          var opponent = players.filter(function (p) { return p.user_id !== state.myUserId; })[0];
          if (opponent && opponent.words_found && Array.isArray(opponent.words_found)) {
            state.opponentWords = new Set(opponent.words_found.map(function (w) { return String(w).toUpperCase(); }));
          }
          if (opponent && opponent.score != null) state.opponentScore = opponent.score;
        }
        revealOpponentWords();
        showOverlay();
      }).catch(function () {
        revealOpponentWords();
        showOverlay();
      });
    } else {
      if (gameId || state.isBotGame) revealOpponentWords();
      showOverlay();
    }
  }

  /** Timer tick: update display, end game when time runs out. */
  function tick() {
    if (state.gameOver) return;
    state.secondsLeft--;
    const m = Math.floor(state.secondsLeft / 60);
    const s = state.secondsLeft % 60;
    if (timerEl) {
      timerEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
      timerEl.classList.remove('warning', 'danger', 'timer-countdown', 'timer-pulse');
      if (state.secondsLeft <= 10 && state.secondsLeft > 0) {
        timerEl.classList.add('timer-countdown');
        timerEl.classList.remove('timer-pulse');
        void timerEl.offsetWidth;
        timerEl.classList.add('timer-pulse');
      } else if (state.secondsLeft <= 60) timerEl.classList.add('danger');
      else if (state.secondsLeft <= 120) timerEl.classList.add('warning');
    }
    if (state.secondsLeft <= 0) endGame('Time\'s up!');
  }

  /** Starts the countdown (solo only, once). Updates display immediately. */
  function startTimer() {
    if (state.timerId) return;
    if (timerEl) {
      var m = Math.floor(state.secondsLeft / 60);
      var s = state.secondsLeft % 60;
      timerEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
      timerEl.classList.remove('warning', 'danger', 'bitter-end', 'timer-countdown', 'timer-pulse');
      if (state.secondsLeft <= 10 && state.secondsLeft > 0) {
        timerEl.classList.add('timer-countdown');
        timerEl.classList.add('timer-pulse');
      } else if (state.secondsLeft <= 60) timerEl.classList.add('danger');
      else if (state.secondsLeft <= 120) timerEl.classList.add('warning');
    }
    state.timerId = setInterval(tick, 1000);

    if (state.isBotGame && !state.botTimerStarted) {
      state.botTimerStarted = true;
      state.botStartTs = Date.now();
      scheduleBotNextWord();
    }
  }

  /* ========================================================================
     Bot opponent (local opponent, timed word finding)
     ======================================================================== */

  // Cache word lists in memory across bot games (same page session).
  var BOT_WIKI_WORDS_CACHE = null; // Array of lowercase words from wiki-100k.txt
  var BOT_INVALID_WORDS_CACHE = null; // Set of lowercase invalid words

  function getBotIntervalSeconds(elapsedSeconds) {
    var base = state.botBaseSeconds;
    if (typeof base !== 'number' || isNaN(base)) base = 4;
    // Base interval increases by +1 each passing minute.
    return base + Math.floor(elapsedSeconds / 60);
  }

  function acceptAndRecordOpponentWord(raw) {
    var word = String(raw || '').toUpperCase();
    if (!word || state.opponentWords.has(word)) return;

    state.opponentWords.add(word);

    var basePoints = pointsForWordLength(word.length);
    var bonus = isPangram(word) ? PANGRAM_BONUS : 0;
    state.opponentScore += basePoints + bonus;
    if (opponentScoreEl) opponentScoreEl.textContent = state.opponentScore;
  }

  function scheduleBotNextWord() {
    if (!state.isBotGame) return;
    if (state.gameOver) return;

    if (state.botFindTimeoutId) {
      clearTimeout(state.botFindTimeoutId);
      state.botFindTimeoutId = null;
    }

    var startTs = state.botStartTs || Date.now();
    state.botStartTs = startTs;
    var elapsedSeconds = (Date.now() - startTs) / 1000;
    var intervalSeconds = getBotIntervalSeconds(elapsedSeconds);

    state.botFindTimeoutId = setTimeout(function () {
      state.botFindTimeoutId = null;
      if (state.gameOver) return;

      // Find a word the bot can take next.
      var candidates = [];
      VALID_WORDS.forEach(function (w) {
        var word = String(w).toUpperCase();
        if (state.opponentWords.has(word)) return;
        // Non-pangrams are exclusive: if the player already has it, bot can't take it.
        if (!isPangram(word) && state.found.has(word)) return;
        candidates.push(word);
      });

      // If the puzzle `VALID_WORDS` are exhausted for the bot, allow it to
      // continue using an "extra pool" of dictionary/common words that fit
      // the letters but are NOT in `VALID_WORDS`.
      if (!candidates.length && state.botExtraWordsReady && Array.isArray(state.botExtraWordsPool)) {
        var extraCandidates = [];
        var extraPool = state.botExtraWordsPool;
        for (var i = 0; i < extraPool.length; i++) {
          var ew = extraPool[i];
          if (state.opponentWords.has(ew)) continue;
          if (!isPangram(ew) && state.found.has(ew)) continue;
          extraCandidates.push(ew);
        }
        candidates = extraCandidates;
      }

      if (!candidates.length) return;

      var pick = candidates[Math.floor(Math.random() * candidates.length)];
      acceptAndRecordOpponentWord(pick);
      scheduleBotNextWord();
    }, Math.max(0, intervalSeconds) * 1000);
  }

  /**
   * Load/build a bot "extra pool" once per puzzle.
   * These are words that:
   * - fit the current 7 letters (center + outer)
   * - are NOT in `VALID_WORDS`
   * - are not proper nouns (shared blocklist)
   * - are not locally profane
   * - optionally exclude anything in `data/invalid-valid-words.txt` (if present)
   * - optionally exclude anything in `DICTIONARY_BLOCKLIST` (if loaded)
   *
   * Notes:
   * - This is only used after the bot exhausts puzzle `VALID_WORDS`.
   * - It runs only for bot games.
   */
  async function buildBotExtraWordsPool() {
    if (!state.isBotGame) return;
    if (state.botExtraWordsReady) return;
    if (!LOCAL_PUZZLES) return;

    try {
      if (typeof fetch === 'undefined') {
        state.botExtraWordsPool = [];
        state.botExtraWordsReady = true;
        return;
      }

      // Load a common 100k word list from wiki-100k.txt (one word per line).
      var wikiText = '';
      if (BOT_WIKI_WORDS_CACHE && BOT_WIKI_WORDS_CACHE.length) {
        wikiText = null;
      } else {
        wikiText = await fetch('data/wiki-100k.txt?v=1').then(function (r) { return r.text(); }).catch(function () { return ''; });
      }
      if (wikiText === '' || wikiText === null) {
        if (!BOT_WIKI_WORDS_CACHE || !BOT_WIKI_WORDS_CACHE.length) {
          state.botExtraWordsPool = [];
          state.botExtraWordsReady = true;
          return;
        }
      } else {
        // Parse + cache lowercase words.
        BOT_WIKI_WORDS_CACHE = wikiText
          .split(/\r?\n/)
          .map(function (l) { return String(l).trim().toLowerCase(); })
          .filter(function (w) { return w && /^[a-z]+$/.test(w); });
      }

      if (!BOT_WIKI_WORDS_CACHE || !BOT_WIKI_WORDS_CACHE.length) {
        state.botExtraWordsPool = [];
        state.botExtraWordsReady = true;
        return;
      }

      // Optional: use invalid-valid-words.txt as a safety filter.
      if (BOT_INVALID_WORDS_CACHE) {
        // already cached
      } else {
        var invalidText = await fetch('data/invalid-valid-words.txt?v=1').then(function (r) { return r.text(); }).catch(function () { return ''; });
        var invalidSet = new Set();
        if (invalidText) {
          invalidSet = new Set(
            invalidText
              .split(/\\r?\\n/)
              .map(function (l) { return String(l).trim().toLowerCase().replace(/#.*$/, '').trim(); })
              .filter(function (w) { return w && /^[a-z]+$/.test(w); })
          );
        }
        BOT_INVALID_WORDS_CACHE = invalidSet;
      }

      var center = String(LETTER_SET && LETTER_SET.center ? LETTER_SET.center : '').toUpperCase();
      if (!center) {
        state.botExtraWordsPool = [];
        state.botExtraWordsReady = true;
        return;
      }

      var allLettersArr = getAllLetters(); // uppercase [center, ...outer]
      var allowedLetters = new Set(allLettersArr.map(function (c) { return String(c).toUpperCase(); }));

      var outPool = [];
      for (var i = 0; i < BOT_WIKI_WORDS_CACHE.length; i++) {
        var rawLower = BOT_WIKI_WORDS_CACHE[i];
        if (!rawLower) continue;
        var wUpper = String(rawLower).toUpperCase();
        if (wUpper.length < MIN_LENGTH) continue;
        if (!wUpper.includes(center)) continue;

        // Use only current 7 letters.
        var ok = true;
        for (var j = 0; j < wUpper.length; j++) {
          var ch = wUpper[j];
          if (!allowedLetters.has(ch)) { ok = false; break; }
        }
        if (!ok) continue;

        // Not part of puzzle valid set.
        if (VALID_WORDS && VALID_WORDS.has(wUpper)) continue;

        // Exclude proper nouns + local profanity.
        if (isProperNoun(wUpper)) continue;
        var lower = wUpper.toLowerCase();
        if (LOCAL_PROFANITY && LOCAL_PROFANITY.has(lower)) continue;
        if (BOT_INVALID_WORDS_CACHE && BOT_INVALID_WORDS_CACHE.size > 0 && BOT_INVALID_WORDS_CACHE.has(lower)) continue;

        // If remote dictionary blocklist was loaded, exclude too.
        if (DICTIONARY_BLOCKLIST && DICTIONARY_BLOCKLIST.has(wUpper)) continue;

        outPool.push(wUpper);
      }

      // Deduplicate just in case.
      state.botExtraWordsPool = Array.from(new Set(outPool)).sort();
      state.botExtraWordsReady = true;
    } catch (e) {
      // Fail open to normal VALID_WORDS behavior.
      state.botExtraWordsPool = [];
      state.botExtraWordsReady = true;
    }
  }

  /* ========================================================================
     Event listeners
     ======================================================================== */

  function getHexFromEvent(e) {
    var target = e.target && e.target.closest ? e.target.closest('.hex') : null;
    return target && target.dataset && target.dataset.letter ? target : null;
  }

  var hexPointerDown = null;
  honeycomb.addEventListener('pointerdown', function (e) {
    hexPointerDown = getHexFromEvent(e);
  }, { passive: true });
  honeycomb.addEventListener('pointerup', function (e) {
    var hex = getHexFromEvent(e);
    if (hex && hex === hexPointerDown && hex.dataset.letter) addLetter(hex.dataset.letter);
    hexPointerDown = null;
  });
  honeycomb.addEventListener('pointercancel', function () {
    hexPointerDown = null;
  });
  honeycomb.addEventListener('click', function (e) {
    if (typeof PointerEvent !== 'undefined') return;
    var btn = getHexFromEvent(e);
    if (btn && btn.dataset.letter) addLetter(btn.dataset.letter);
  });

  wordInput.addEventListener('keydown', (e) => {
    if (!gameId) startTimer();
    if (e.key === 'Enter') {
      e.preventDefault();
      submitWord();
    }
  });

  btnDelete.addEventListener('click', () => {
    if (!gameId) startTimer();
    wordInput.value = wordInput.value.slice(0, -1);
    wordInput.setSelectionRange(wordInput.value.length, wordInput.value.length);
    updateMobileWordDisplay();
  });

  btnShuffle.addEventListener('click', () => {
    if (!gameId) startTimer();
    if (state.gameOver) return;
    renderHoneycomb(true);
  });

  btnEnter.addEventListener('click', () => {
    if (!gameId) startTimer();
    submitWord();
  });

  wordInput.addEventListener('focus', function () {
    if (!gameId) startTimer();
  });
  wordInput.addEventListener('input', function () { updateMobileWordDisplay(); });

  function setMobileInputReadOnly() {
    if (!wordInput) return;
    var mobile = typeof window.matchMedia !== 'undefined' && window.matchMedia('(max-width: 600px)').matches;
    wordInput.readOnly = mobile;
    wordInput.setAttribute('aria-readonly', mobile ? 'true' : 'false');
    wordInput.placeholder = mobile ? '' : 'Type or tap letters';
  }
  setMobileInputReadOnly();
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', setMobileInputReadOnly);
  }

  document.body.addEventListener('keydown', function startOnce() {
    if (!gameId) { startTimer(); document.body.removeEventListener('keydown', startOnce); }
  });
  if (honeycomb) honeycomb.addEventListener('click', function startOnce() {
    if (!gameId) { startTimer(); honeycomb.removeEventListener('click', startOnce); }
  });

  /** Scrabble tile values — sum over 7 unique letters ≈ how “spicy” the board is. */
  var LETTER_SCRABBLE = {
    A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
    N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
  };

  function puzzleLetterRaritySum(p) {
    if (!p) return 0;
    var c = String(p.center_letter || '').toUpperCase();
    var o = String(p.outer_letters || '').toUpperCase();
    var seen = {};
    var sum = 0;
    for (var i = 0; i < c.length; i++) {
      var ch = c[i];
      if (seen[ch]) continue;
      seen[ch] = true;
      sum += LETTER_SCRABBLE[ch] || 0;
    }
    for (var j = 0; j < o.length; j++) {
      var ch2 = o[j];
      if (seen[ch2]) continue;
      seen[ch2] = true;
      sum += LETTER_SCRABBLE[ch2] || 0;
    }
    return sum;
  }

  /** Weight ≥ 1; higher for boards with Q, J, X, Z, K, V, etc. */
  function puzzleRarityPickWeight(p) {
    var s = puzzleLetterRaritySum(p);
    return Math.pow(1.042, s);
  }

  function pickWeightedPuzzleIndex(indices, getWeight) {
    var total = 0;
    var weights = [];
    for (var i = 0; i < indices.length; i++) {
      var w = getWeight(LOCAL_PUZZLES[indices[i]]);
      if (!(w > 0) || !isFinite(w)) w = 1;
      weights.push(w);
      total += w;
    }
    var r = Math.random() * total;
    for (var j = 0; j < indices.length; j++) {
      r -= weights[j];
      if (r <= 0) return indices[j];
    }
    return indices[indices.length - 1];
  }

  /**
   * Pick a puzzle index; avoids recent history when possible.
   * Biased toward boards with rarer letters (Scrabble-style weights).
   * @returns {number} Puzzle index, or -1 if no puzzles.
   */
  function pickSoloPuzzleIndex() {
    if (!LOCAL_PUZZLES || LOCAL_PUZZLES.length === 0) return -1;
    var recent = RB && RB.getRecentBoardIndices ? RB.getRecentBoardIndices() : [];
    var recentSet = new Set(recent);
    var n = LOCAL_PUZZLES.length;

    // If every local board has been played at least once (within our recent history),
    // we signal exhaustion by returning -1 so the caller can fall back to on-the-fly generation.
    if (n > 0 && recentSet.size >= n) {
      return -1;
    }

    var eligible = [];
    for (var i = 0; i < n; i++) {
      if (!recentSet.has(i)) eligible.push(i);
    }
    if (eligible.length === 0) return Math.floor(Math.random() * n);
    return pickWeightedPuzzleIndex(eligible, puzzleRarityPickWeight);
  }

  /** Save the current game's puzzle index to recent boards (called when starting a game). */
  function saveRecentBoardIndex(index) {
    if (RB && RB.saveRecentBoardIndex && typeof index === 'number' && index >= 0) {
      RB.saveRecentBoardIndex(index);
    }
  }

  /* ========================================================================
     Init: versus (gameId + db) or solo
     ======================================================================== */
  function fetchGeneratedPuzzle() {
    if (typeof fetch === 'undefined') return Promise.resolve(null);
    return fetch('/.netlify/functions/generate-puzzle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .catch(function () { return null; });
  }

  async function initSolo() {
    document.body.classList.add('solo-mode');
    if (state.isBotGame) document.body.classList.add('bot-mode');

    // Even in bot/solo mode, show the logged-in username in the Player card.
    // (Versus mode sets this from DB rows; solo/bot needs it too.)
    if (window.db && window.db.getCurrentUserAsync && typeof window.db.getCurrentUserAsync === 'function') {
      window.db.getCurrentUserAsync().then(function (me) {
        if (me && me.username) {
          state.myUsername = me.username;
          if (playerUsernameEl) playerUsernameEl.textContent = me.username;
        }
      }).catch(function () {});
    }

    state.gameOver = false;
    state.roundOver = false;
    state.secondsLeft = TOTAL_SECONDS;
    state.timerId = null;
    if (timerEl) {
      var m = Math.floor(state.secondsLeft / 60);
      var s = state.secondsLeft % 60;
      timerEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
      timerEl.classList.remove('warning', 'danger', 'bitter-end', 'timer-countdown', 'timer-pulse');
    }
    var puzzleSet = false;
    if (LOCAL_PUZZLES && LOCAL_PUZZLES.length > 0) {
      var idx = pickSoloPuzzleIndex();
      if (idx >= 0 && LOCAL_PUZZLES[idx]) {
        setPuzzleFromData(LOCAL_PUZZLES[idx]);
        saveRecentBoardIndex(idx);
        puzzleSet = true;
      }
    }
    // Fallback: all local boards exhausted or none available; ask Netlify function
    // to generate a fresh puzzle on the fly.
    if (!puzzleSet) {
      var generated = await fetchGeneratedPuzzle();
      if (generated) {
        setPuzzleFromData(generated);
        puzzleSet = true;
      }
    }
    renderHoneycomb();
    state.totalBoardPoints = state.totalBoardPoints || computeTotalBoardPoints();
    if (scoreEl) scoreEl.textContent = '0';
    if (opponentScoreEl) opponentScoreEl.textContent = '0';
    // Bot opponent setup: assign name + speed, and start the timer immediately.
    if (state.isBotGame && typeof state.botLevel === 'number' && BOT_LEVELS[state.botLevel]) {
      state.opponentScore = 0;
      state.opponentWords = new Set();
      state.botBaseSeconds = BOT_LEVELS[state.botLevel].baseSeconds;
      state.botName = BOT_LEVELS[state.botLevel].name;
      state.opponentUsername = state.botName;
      if (opponentUsernameEl) opponentUsernameEl.textContent = state.botName || 'Opponent';
      // Load extra bot word pool before starting timer so the bot can
      // keep playing after exhausting VALID_WORDS.
      await buildBotExtraWordsPool();
      // Start the round immediately so the bot schedule begins without waiting for user input.
      startTimer();
    }
    hideGameLoading();
  }

  function initVersus() {
    document.body.classList.remove('solo-mode');
    var db = window.db;
    if (!gameId || !db || !db.getGameWithPuzzle) { initSolo(); return; }
    setLoadingText('Loading game…');
    db.getCurrentUserAsync().then(function (me) {
      state.myUserId = me ? me.id : null;
      if (me && me.username) {
        state.myUsername = me.username;
        if (playerUsernameEl) playerUsernameEl.textContent = me.username;
      }
      return db.getGameWithPuzzle(gameId);
    }).then(function (data) {
      if (!data || !data.game) {
        initSolo();
        return;
      }
      var puzzle = null;
      var puzzleIndex = data.puzzle_index != null ? data.puzzle_index : (data.game && data.game.puzzle_index);
      var usedIndex = null;
      if (puzzleIndex != null && LOCAL_PUZZLES && LOCAL_PUZZLES.length > 0) {
        var n = LOCAL_PUZZLES.length;
        var idx = puzzleIndex >= 0 && puzzleIndex < n
          ? puzzleIndex
          : Math.abs(puzzleIndex % n) % n;
        puzzle = LOCAL_PUZZLES[idx];
        usedIndex = idx;
        if (idx !== puzzleIndex && typeof console !== 'undefined' && console.warn) {
          console.warn('Spellbound: puzzle_index', puzzleIndex, 'mapped to local index', idx, '(local set has', n, 'puzzles)');
        }
      }
      if (!puzzle && data.puzzle) {
        puzzle = data.puzzle;
      }
      if (!puzzle) {
        initSolo();
        return;
      }
      setPuzzleFromData(puzzle);
      if (usedIndex != null) saveRecentBoardIndex(usedIndex);
      else if (puzzleIndex != null) saveRecentBoardIndex(puzzleIndex);
      renderHoneycomb();
      var startedAt = data.game.started_at;
      var duration = data.game.duration_seconds || 300;
      if (startedAt) {
        startTimerFromDB(startedAt, duration);
      } else {
        state.secondsLeft = duration;
        startTimerFromDB(new Date().toISOString(), duration);
      }
      hideGameLoading();
      return db.getGamePlayers(gameId).then(function (players) {
        if (!players || !players.length) return;
        var myRow = players.filter(function (p) { return p.user_id === state.myUserId; })[0];
        if (myRow) {
          state.score = myRow.score || 0;
          state.found = new Set(Array.isArray(myRow.words_found) ? myRow.words_found : []);
          if (scoreEl) scoreEl.textContent = state.score;
          state.found.forEach(function (w) {
            var li = document.createElement('li');
            li.textContent = w;
            if (isPangram(w)) li.classList.add('pangram');
            if (wordsListEl) wordsListEl.appendChild(li);
          });
        }
        applyOpponentPlayers(players, state.myUserId);
        if (db.subscribeToGamePlayers) {
          unsubscribeGamePlayers = db.subscribeToGamePlayers(gameId, function (updated) {
            applyOpponentPlayers(updated, state.myUserId);
          });
        }
        var pollId = setInterval(function () {
          if (state.gameOver) { clearInterval(pollId); return; }
          db.getGamePlayers(gameId).then(function (updated) {
            applyOpponentPlayers(updated, state.myUserId);
          }).catch(function () {});
          if (db.getGameStatus) {
            db.getGameStatus(gameId).then(function (st) {
              if (!st || state.gameOver) return;
              if (st.status === 'finished') {
                clearInterval(pollId);
                if (state.timerId) {
                  clearInterval(state.timerId);
                  state.timerId = null;
                }
                state.gameOver = true;
                state.roundOver = true;
                if (timerEl) {
                  timerEl.textContent = '0:00';
                  timerEl.classList.remove('timer-countdown', 'timer-pulse');
                }
                var endMessage = (st.end_reason === 'all_words_found') ? 'All words found!' : 'Time\'s up!';
                endGame(endMessage);
              }
            }).catch(function () {});
          }
        }, 2500);

        function showInGameChallengePopup(challenge) {
          if (!challenge || !challengeNotifOverlay) return;
          if (challengeNotifMsg) {
            var name = challenge.from_username || 'Someone';
            challengeNotifMsg.textContent = name + ' challenged you to a game. Joining will leave your current game.';
          }
          challengeNotifOverlay.classList.add('open');
          challengeNotifOverlay.setAttribute('aria-hidden', 'false');
          state.pendingChallenge = challenge;
        }
        function closeInGameChallengePopup() {
          state.pendingChallenge = null;
          if (challengeNotifOverlay) {
            challengeNotifOverlay.classList.remove('open');
            challengeNotifOverlay.setAttribute('aria-hidden', 'true');
          }
        }
        if (challengeNotifJoinGame) {
          challengeNotifJoinGame.addEventListener('click', function () {
            if (!state.pendingChallenge || !db.acceptChallenge) return;
            var id = state.pendingChallenge.id;
            closeInGameChallengePopup();
            var accepterRecent = RB && RB.getRecentBoardIndices ? RB.getRecentBoardIndices() : [];
            db.acceptChallenge(id, accepterRecent).then(function (gameId) {
              window.location.href = 'game.html?gameId=' + encodeURIComponent(gameId);
            }).catch(closeInGameChallengePopup);
          });
        }
        if (challengeNotifRejectGame) {
          challengeNotifRejectGame.addEventListener('click', function () {
            if (state.pendingChallenge && db.rejectChallenge) {
              db.rejectChallenge(state.pendingChallenge.id).then(closeInGameChallengePopup);
            } else closeInGameChallengePopup();
          });
        }
        challengeNotifOverlay && challengeNotifOverlay.addEventListener('click', function (e) {
          if (e.target === challengeNotifOverlay) closeInGameChallengePopup();
        });
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape' && challengeNotifOverlay && challengeNotifOverlay.classList.contains('open')) closeInGameChallengePopup();
        });

        db.getMyPendingChallenges().then(function (list) {
          if (list && list.length && list[0]) showInGameChallengePopup(list[0]);
        });
        if (db.subscribeToIncomingChallenges) {
          db.subscribeToIncomingChallenges(function (list) {
            if (list && list.length && list[0]) showInGameChallengePopup(list[0]);
          }).then(function (unsub) { unsubscribeChallenges = unsub; });
        }
      });
    }).catch(function (err) {
      if (typeof console !== 'undefined' && console.warn) console.warn('Spellbound initVersus:', err);
      initSolo();
    });
  }

  /** Load local puzzles then start versus or solo. */
  function start() {
    if (gameId && window.db) {
      initVersus();
    } else {
      initSolo();
    }
  }

  /** Parse word list from text: one word per line or JSON array. Returns Set of uppercase words (4–15 letters). */
  function parseWordListToSet(text) {
    var set = new Set();
    var trimmed = (text || '').trim();
    if (!trimmed) return set;
    if (trimmed.indexOf('[') === 0) {
      try {
        var arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) {
          for (var i = 0; i < arr.length; i++) {
            var w = String(arr[i]).trim().toUpperCase().replace(/[^A-Z]/g, '');
            if (w.length >= 4 && w.length <= 15) set.add(w);
          }
        }
        return set;
      } catch (e) { /* fall through to line-by-line */ }
    }
    var lines = trimmed.split(/\r?\n/);
    for (var j = 0; j < lines.length; j++) {
      var word = lines[j].trim().toUpperCase().replace(/[^A-Z]/g, '');
      if (word.length >= 4 && word.length <= 15) set.add(word);
    }
    return set;
  }

  /** Load URL and parse into word set. */
  function fetchWordSet(url) {
    if (!url) return Promise.resolve(new Set());
    return fetch(url)
      .then(function (r) { return r.text(); })
      .then(parseWordListToSet)
      .catch(function () { return new Set(); });
  }

  function loadBlocklist() {
    var blockUrl = (typeof window.__SPELLBOUND_BLOCKLIST_URL__ !== 'undefined' && window.__SPELLBOUND_BLOCKLIST_URL__) ? window.__SPELLBOUND_BLOCKLIST_URL__ : '';
    if (!blockUrl) return Promise.resolve();
    return fetchWordSet(blockUrl).then(function (set) {
      DICTIONARY_BLOCKLIST = set;
    });
  }

  Promise.all([
    fetch('data/puzzles-2.json?v=2').then(function (r) { return r.json(); }).then(function (arr) {
      LOCAL_PUZZLES = Array.isArray(arr) ? arr : [];
    }).catch(function () { LOCAL_PUZZLES = []; }),
    loadBlocklist(),
  ]).then(function () { start(); });
})();
