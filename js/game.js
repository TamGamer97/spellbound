/**
 * Spellbound — Spelling Bee
 *
 * Round 1 rules:
 * - 10-minute timer (from DB started_at in versus, or first interaction in solo)
 * - 4-letter minimum, 1 pt/letter, +5 pangram
 */

(function () {
  'use strict';

  var gameId = (function () {
    var p = typeof window !== 'undefined' && window.location && window.location.search && window.location.search.slice(1);
    var params = p ? new URLSearchParams(p) : null;
    return params && params.get('gameId') ? params.get('gameId') : null;
  })();

  /** Local puzzle set (data/puzzles.json). Loaded before init; used for versus (puzzle_index) and solo (random). */
  var LOCAL_PUZZLES = [];
  /** Blocklist for dictionary fallback: words in this set are never accepted. */
  var DICTIONARY_BLOCKLIST = new Set();
  /** Prevents double-submit while dictionary/profanity/POS check is in flight. */
  var dictionaryCheckInFlight = false;

  /** Returns a Promise<boolean>: true if the word contains profanity (Purgomalum API). */
  function checkProfanity(word) {
    var base = (typeof window.__SPELLBOUND_PROFANITY_API__ !== 'undefined' && window.__SPELLBOUND_PROFANITY_API__)
      ? window.__SPELLBOUND_PROFANITY_API__
      : 'https://www.purgomalum.com/service/containsprofanity';
    var url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'text=' + encodeURIComponent(word);
    return fetch(url)
      .then(function (r) { return r.text(); })
      .then(function (text) { return (String(text).trim().toLowerCase() === 'true'); })
      .catch(function () { return false; });
  }

  /** Returns a Promise<boolean>: true if POS tagger thinks this is a proper noun. */
  function checkProperNoun(originalWord) {
    var base = (typeof window.__SPELLBOUND_POS_API__ !== 'undefined' && window.__SPELLBOUND_POS_API__)
      ? window.__SPELLBOUND_POS_API__
      : '';
    if (!base) return Promise.resolve(false);
    var url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'word=' + encodeURIComponent(originalWord);
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data) return false;
        return !!data.isProperNoun;
      })
      .catch(function () { return false; });
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
  const POINTS_PER_LETTER = 1;
  const PANGRAM_BONUS = 5;
  const TOTAL_SECONDS = 5 * 60;

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
  var unsubscribeGamePlayers = null;
  var unsubscribeChallenges = null;

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
    myUserId: null,
    opponentWords: new Set(),
    roundPhase: 'round_1',
    totalBoardPoints: 0,
    opponentScore: 0,
    myUsername: null,
    opponentUsername: null,
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
      total += w.length * POINTS_PER_LETTER;
      if (isPangram(w)) total += PANGRAM_BONUS;
    });
    return total;
  }

  /** Set puzzle from DB (versus mode). Pangrams derived by definition (word uses all 7 letters). */
  function setPuzzleFromData(puzzle) {
    if (!puzzle) return;
    LETTER_SET = {
      center: puzzle.center_letter,
      outer: typeof puzzle.outer_letters === 'string' ? puzzle.outer_letters.split('') : (puzzle.outer_letters || []),
    };
    VALID_WORDS = new Set(Array.isArray(puzzle.valid_words) ? puzzle.valid_words : []);
    PANGRAMS = new Set(Array.from(VALID_WORDS).filter(isPangram));
    state.totalBoardPoints = (puzzle.total_points != null && puzzle.total_points > 0)
      ? puzzle.total_points
      : computeTotalBoardPoints();
  }

  /** Update opponent panel: score, username, and "opponent left". Opponent words are not shown; we only store them for validation (no reusing except pangrams). */
  function applyOpponentPlayers(players, myUserId) {
    if (!players || !players.length || !myUserId) return;
    var myRow = players.filter(function (p) { return p.user_id === myUserId; })[0];
    var opponent = players.filter(function (p) { return p.user_id !== myUserId; })[0];
    if (myRow && myRow.users && myRow.users.username) {
      state.myUsername = myRow.users.username;
      if (playerUsernameEl) playerUsernameEl.textContent = state.myUsername;
    }
    if (!opponent) return;
    state.opponentScore = opponent.score || 0;
    if (opponentScoreEl) opponentScoreEl.textContent = state.opponentScore;
    if (opponent.users && opponent.users.username) {
      state.opponentUsername = opponent.users.username;
      if (opponentUsernameEl) opponentUsernameEl.textContent = state.opponentUsername;
    }
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
        timerEl.classList.remove('warning', 'danger');
        if (state.secondsLeft <= 60) timerEl.classList.add('danger');
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
      el.textContent = state.letters[i];
      el.dataset.letter = state.letters[i];
    });
  }

  /** Appends a letter to the input (e.g. when clicking a hex). Cursor is moved to end. */
  function addLetter(letter) {
    if (state.gameOver) return;
    const val = wordInput.value.toUpperCase();
    if (val.length < 15) {
      wordInput.value = val + letter;
      wordInput.setSelectionRange(wordInput.value.length, wordInput.value.length);
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
    const original = wordInput.value.trim();
    const raw = original.toUpperCase();
    if (validationClearTimeoutId) {
      clearTimeout(validationClearTimeoutId);
      validationClearTimeoutId = null;
    }
    if (validationEl) {
      validationEl.textContent = '';
      validationEl.className = 'validation-message';
    }

    if (!raw) return;

    if (raw.length < MIN_LENGTH) {
      showValidation('Too short', 'invalid');
      wordInput.value = '';
      return;
    }

    const center = state.letters[CENTER_INDEX];
    const allowed = new Set(getAllLetters());
    for (const c of raw) {
      if (!allowed.has(c)) {
        showValidation('Invalid letters', 'invalid');
        wordInput.value = '';
        return;
      }
    }
    if (!raw.includes(center)) {
      showValidation('Must use center letter', 'invalid');
      wordInput.value = '';
      return;
    }

    if (state.found.has(raw)) {
      showValidation('Taken', 'taken');
      wordInput.value = '';
      return;
    }

    if (gameId && state.opponentWords && state.opponentWords.has(raw) && !isPangram(raw)) {
      showValidation('Already found by opponent', 'invalid');
      wordInput.value = '';
      return;
    }

    if (state.gameOver) return;

    var inPuzzleList = VALID_WORDS.has(raw);
    if (inPuzzleList) {
      if (dictionaryCheckInFlight) return;
      dictionaryCheckInFlight = true;
      checkProperNoun(original || raw)
        .then(function (isProper) {
          if (isProper) {
            showValidation('Proper nouns are not allowed', 'invalid');
            wordInput.value = '';
            return null;
          }
          return checkProfanity(raw);
        })
        .then(function (hasProfanity) {
          if (hasProfanity === null) return;
          if (hasProfanity) {
            showValidation("That word isn't allowed", 'invalid');
            wordInput.value = '';
          } else {
            acceptAndRecordWord(raw);
          }
        })
        .finally(function () { dictionaryCheckInFlight = false; });
      return;
    }

    if (DICTIONARY_BLOCKLIST.has(raw)) {
      showValidation('Not a word', 'invalid');
      wordInput.value = '';
      return;
    }

    var apiBase = typeof window.__SPELLBOUND_DICTIONARY_API__ !== 'undefined' && window.__SPELLBOUND_DICTIONARY_API__
      ? window.__SPELLBOUND_DICTIONARY_API__
      : 'https://api.dictionaryapi.dev/api/v2/entries/en';
    var apiUrl = apiBase.replace(/\/$/, '') + '/' + encodeURIComponent(raw.toLowerCase());

    if (dictionaryCheckInFlight) return;
    dictionaryCheckInFlight = true;
    fetch(apiUrl)
      .then(function (res) {
        if (!res.ok) {
          showValidation('Not a word', 'invalid');
          wordInput.value = '';
          return null;
        }
        return checkProperNoun(original || raw);
      })
      .then(function (isProper) {
        if (isProper === null) return null;
        if (isProper) {
          showValidation('Proper nouns are not allowed', 'invalid');
          wordInput.value = '';
          return null;
        }
        return checkProfanity(raw);
      })
      .then(function (hasProfanity) {
        if (hasProfanity === null) return;
        if (hasProfanity) {
          showValidation("That word isn't allowed", 'invalid');
          wordInput.value = '';
        } else {
          acceptAndRecordWord(raw);
        }
      })
      .catch(function () {
        showValidation('Not a word', 'invalid');
        wordInput.value = '';
      })
      .finally(function () {
        dictionaryCheckInFlight = false;
      });
  }

  function acceptAndRecordWord(raw) {
    state.found.add(raw);
    var basePoints = raw.length * POINTS_PER_LETTER;
    var bonus = isPangram(raw) ? PANGRAM_BONUS : 0;
    state.score += basePoints + bonus;

    wordInput.value = '';
    if (scoreEl) scoreEl.textContent = state.score;
    if (!gameId || !window.db || !window.db.updateMyGamePlayer) {
      if (opponentScoreEl) opponentScoreEl.textContent = state.score;
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

    if (isPangram(raw)) {
      showValidation('Pangram!', 'pangram');
    } else {
      showValidation('Great!', 'great');
    }

    checkWin();
  }

  /** If all valid words found in Round 1 and round not already over, end the game. */
  function checkWin() {
    if (state.found.size === VALID_WORDS.size && !state.gameOver && !state.roundOver && state.roundPhase === 'round_1') {
      endGame('All words found!');
    }
  }

  /** Reveal opponent's words in the opponent panel (at end of round). */
  function revealOpponentWords() {
    if (!opponentWordsListEl || !gameId) return;
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
    state.gameOver = true;
    state.roundOver = true;
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    if (timerEl) timerEl.textContent = '0:00';
    if (gameId && window.db && window.db.setGameFinished) {
      window.db.setGameFinished(gameId).catch(function () {});
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
      var myName = state.myUsername || 'You';
      var oppName = state.opponentUsername || 'Opponent';
      var oppScore = (gameId && state.opponentScore != null) ? state.opponentScore : state.score;
      if (scoresEl) {
        scoresEl.textContent = myName + ': ' + state.score + (gameId ? ' · ' + oppName + ': ' + oppScore : '');
      }
      var winnerText = '';
      if (gameId && state.opponentScore != null) {
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
          winnerText = (myName === 'You' ? 'You win (pangram)!' : myName + ' wins (pangram)!');
        } else if (!myHasPangram && opponentHasPangram) {
          winnerText = oppName + ' wins (pangram)!';
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
      if (gameId) revealOpponentWords();
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
      if (state.secondsLeft <= 60) timerEl.classList.add('danger');
      else if (state.secondsLeft <= 120) timerEl.classList.add('warning');
    }
    if (state.secondsLeft <= 0) endGame('Time\'s up!');
  }

  /** Starts the 10-minute countdown (only once). */
  function startTimer() {
    if (state.timerId) return;
    state.timerId = setInterval(tick, 1000);
  }

  /* ========================================================================
     Event listeners
     ======================================================================== */

  honeycomb.addEventListener('click', (e) => {
    const btn = e.target.closest('.hex');
    if (btn && btn.dataset.letter) addLetter(btn.dataset.letter);
  });

  wordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitWord();
    }
  });

  btnDelete.addEventListener('click', () => {
    wordInput.value = wordInput.value.slice(0, -1);
    wordInput.setSelectionRange(wordInput.value.length, wordInput.value.length);
  });

  btnShuffle.addEventListener('click', () => {
    if (state.gameOver) return;
    renderHoneycomb(true);
  });

  btnEnter.addEventListener('click', () => submitWord());

  wordInput.addEventListener('focus', function () {
    if (!gameId) startTimer();
  });

  document.body.addEventListener('keydown', function startOnce() {
    if (!gameId) { startTimer(); document.body.removeEventListener('keydown', startOnce); }
  });
  if (honeycomb) honeycomb.addEventListener('click', function startOnce() {
    if (!gameId) { startTimer(); honeycomb.removeEventListener('click', startOnce); }
  });

  /* ========================================================================
     Init: versus (gameId + db) or solo
     ======================================================================== */
  function initSolo() {
    if (LOCAL_PUZZLES && LOCAL_PUZZLES.length > 0) {
      var idx = Math.floor(Math.random() * LOCAL_PUZZLES.length);
      setPuzzleFromData(LOCAL_PUZZLES[idx]);
    }
    renderHoneycomb();
    state.totalBoardPoints = state.totalBoardPoints || computeTotalBoardPoints();
    if (scoreEl) scoreEl.textContent = '0';
    if (opponentScoreEl) opponentScoreEl.textContent = '0';
  }

  function initVersus() {
    var db = window.db;
    if (!gameId || !db || !db.getGameWithPuzzle) { initSolo(); return; }
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
      if (data.puzzle_index != null && LOCAL_PUZZLES && LOCAL_PUZZLES[data.puzzle_index]) {
        puzzle = LOCAL_PUZZLES[data.puzzle_index];
      } else if (data.puzzle) {
        puzzle = data.puzzle;
      }
      if (!puzzle) {
        initSolo();
        return;
      }
      setPuzzleFromData(puzzle);
      renderHoneycomb();
      var startedAt = data.game.started_at;
      var duration = data.game.duration_seconds || 300;
      if (startedAt) {
        startTimerFromDB(startedAt, duration);
      } else {
        state.secondsLeft = duration;
        startTimerFromDB(new Date().toISOString(), duration);
      }
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
            db.acceptChallenge(id).then(function (gameId) {
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
    fetch('data/puzzles.json').then(function (r) { return r.json(); }).then(function (arr) {
      LOCAL_PUZZLES = Array.isArray(arr) ? arr : [];
    }).catch(function () { LOCAL_PUZZLES = []; }),
    loadBlocklist(),
  ]).then(function () { start(); });
})();
