/**
 * Spellbound — Supabase API (auth, users, challenges, matchmaking).
 * Requires window.__SPELLBOUND_SUPABASE__ (url, anonKey) and Supabase client script loaded first.
 */

(function (global) {
  'use strict';

  var config = typeof window !== 'undefined' && window.__SPELLBOUND_SUPABASE__;
  var hasConfig = config && config.url && config.anonKey;
  if (!hasConfig && typeof window !== 'undefined') {
    console.warn('Spellbound: Set window.__SPELLBOUND_SUPABASE__.url and .anonKey (e.g. in js/config.js)');
  }
  var supabase = (typeof window !== 'undefined' && window.supabase && hasConfig)
    ? window.supabase.createClient(config.url, config.anonKey)
    : null;
  var cachedUser = null;

  function noClient() {
    return Promise.reject(new Error('Supabase client not loaded'));
  }

  /**
   * Login with email and password. Returns { id, username } or null.
   */
  function login(email, password) {
    if (!supabase) return noClient();
    var em = (email || '').trim();
    if (!em || !password) return Promise.resolve(null);
    return supabase.auth.signInWithPassword({ email: em, password: password })
      .then(function (res) {
        if (res.data && res.data.user) {
          return fetchProfile(res.data.user.id).then(function (profile) {
            var u = profile || { id: res.data.user.id, username: res.data.user.email || 'Player' };
            cachedUser = u;
            return u;
          });
        }
        return null;
      })
      .catch(function () { return null; });
  }

  /**
   * Sign up with email, password, and username. Stores username in public.users via trigger.
   */
  function signup(email, password, username) {
    if (!supabase) return noClient();
    var em = (email || '').trim();
    var name = (username || '').trim();
    if (!em || !password) return Promise.resolve(null);
    return supabase.auth.signUp({
      email: em,
      password: password,
      options: { data: { username: name || em.split('@')[0] } }
    })
      .then(function (res) {
        if (res.data && res.data.user) {
          return fetchProfile(res.data.user.id).then(function (profile) {
            var u = profile || { id: res.data.user.id, username: name || res.data.user.email };
            cachedUser = u;
            return u;
          });
        }
        if (res.error && res.error.message) return Promise.reject(res.error);
        return null;
      });
  }

  function fetchProfile(userId) {
    if (!supabase) return Promise.resolve(null);
    return supabase.from('users').select('id, username').eq('id', userId).maybeSingle()
      .then(function (r) {
        if (r.data) return { id: r.data.id, username: r.data.username };
        return null;
      });
  }

  /**
   * Get currently logged-in user { id, username } or null (sync; uses cache from getCurrentUserAsync/login/signup).
   */
  function getCurrentUser() {
    return cachedUser;
  }

  /**
   * Resolve current user from Supabase auth + public.users. Caches result for getCurrentUser().
   */
  function getCurrentUserAsync() {
    if (!supabase) return Promise.resolve(null);
    return supabase.auth.getUser()
      .then(function (r) {
        if (!r.data || !r.data.user) {
          cachedUser = null;
          return null;
        }
        return fetchProfile(r.data.user.id);
      })
      .then(function (profile) {
        cachedUser = profile;
        return profile;
      });
  }

  /**
   * Change password for the current user. Requires new password (min 6 chars for Supabase).
   */
  function changePassword(newPassword) {
    if (!supabase) return noClient();
    if (!newPassword || String(newPassword).length < 6) {
      return Promise.reject(new Error('Password must be at least 6 characters'));
    }
    return supabase.auth.updateUser({ password: String(newPassword) }).then(function (r) {
      if (r.error) return Promise.reject(r.error);
      return true;
    });
  }

  /**
   * Log out.
   */
  function logout() {
    cachedUser = null;
    if (!supabase) return Promise.resolve();
    return supabase.auth.signOut();
  }

  /**
   * Search users by username (excludes current user). Returns [{ id, username }].
   */
  function searchUsers(query) {
    if (!supabase) return Promise.resolve([]);
    var q = (query || '').trim();
    if (!q) return Promise.resolve([]);
    return getCurrentUserAsync().then(function (me) {
      if (!me) return [];
      return supabase.from('users')
        .select('id, username')
        .neq('id', me.id)
        .ilike('username', '%' + q + '%')
        .limit(20)
        .then(function (r) {
          if (r.data) return r.data;
          return [];
        });
    });
  }

  /**
   * Send a challenge to a user. Returns challenge or throws.
   */
  function sendChallenge(toUserId, toUsername) {
    if (!supabase) return noClient();
    return getCurrentUserAsync().then(function (me) {
      if (!me) return Promise.reject(new Error('Not logged in'));
      return supabase.from('challenges').insert({
        from_user_id: me.id,
        to_user_id: toUserId,
        status: 'pending'
      }).select('id, created_at').single().then(function (r) {
        if (r.error) return Promise.reject(r.error);
        return { toUserId: toUserId, toUsername: toUsername, status: 'pending', sentAt: Date.now() };
      });
    });
  }

  /**
   * Get current user's pending sent challenge, or null.
   */
  function getChallengeStatus() {
    if (!supabase) return Promise.resolve(null);
    return getCurrentUserAsync().then(function (me) {
      if (!me) return null;
      return supabase.from('challenges')
        .select('id, to_user_id, status, created_at')
        .eq('from_user_id', me.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(function (r) {
          if (!r.data) return null;
          var toUserId = r.data.to_user_id;
          return supabase.from('users').select('username').eq('id', toUserId).maybeSingle()
            .then(function (u) {
              var toUsername = (u && u.data && u.data.username) ? u.data.username : 'Player';
              return {
                toUserId: toUserId,
                toUsername: toUsername,
                status: r.data.status,
                sentAt: new Date(r.data.created_at).getTime()
              };
            });
        });
    });
  }

  /**
   * Get sender's most recent sent challenge (any status) so we can detect accept/reject.
   * Returns { id, status, game_id, toUsername } or null.
   */
  function getSentChallengeStatus() {
    if (!supabase) return Promise.resolve(null);
    return getCurrentUserAsync().then(function (me) {
      if (!me) return null;
      return supabase.from('challenges')
        .select('id, to_user_id, status, game_id, created_at')
        .eq('from_user_id', me.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(function (r) {
          if (!r.data) return null;
          var toUserId = r.data.to_user_id;
          return supabase.from('users').select('username').eq('id', toUserId).maybeSingle()
            .then(function (u) {
              var toUsername = (u && u.data && u.data.username) ? u.data.username : 'Player';
              return {
                id: r.data.id,
                status: r.data.status,
                game_id: r.data.game_id || null,
                toUsername: toUsername
              };
            });
        });
    });
  }

  /**
   * Get pending challenges sent TO the current user. Returns [{ id, from_user_id, from_username, created_at }].
   */
  function getMyPendingChallenges() {
    if (!supabase) return Promise.resolve([]);
    return supabase.rpc('get_my_pending_challenges').then(function (r) {
      if (r.error || !r.data) return [];
      return r.data;
    });
  }

  /**
   * Accept a challenge (as recipient). Creates game and returns gameId; redirect to game.html?gameId=...
   */
  function acceptChallenge(challengeId) {
    if (!supabase) return noClient();
    return supabase.rpc('accept_challenge', { p_challenge_id: challengeId }).then(function (r) {
      if (r.error || r.data == null) return Promise.reject(r.error || new Error('Accept failed'));
      return r.data;
    });
  }

  /**
   * Reject a challenge (as recipient). Sets status to declined.
   */
  function rejectChallenge(challengeId) {
    if (!supabase) return noClient();
    return getCurrentUserAsync().then(function (me) {
      if (!me) return Promise.resolve();
      return supabase.from('challenges')
        .update({ status: 'declined', responded_at: new Date().toISOString() })
        .eq('id', challengeId)
        .eq('to_user_id', me.id);
    });
  }

  /**
   * Subscribe to new challenges where to_user_id = me (so we can show popup when challenged).
   * Returns unsubscribe function.
   */
  function subscribeToIncomingChallenges(callback) {
    if (!supabase) return function () {};
    return getCurrentUserAsync().then(function (me) {
      if (!me) return function () {};
      var channel = supabase
        .channel('incoming_challenges_' + me.id)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'challenges', filter: 'to_user_id=eq.' + me.id },
          function () {
            getMyPendingChallenges().then(function (list) {
              if (callback) callback(list);
            });
          }
        )
        .subscribe();
      return function () { supabase.removeChannel(channel); };
    });
  }

  /**
   * Cancel the current user's pending sent challenge.
   */
  function cancelChallenge() {
    if (!supabase) return noClient();
    return getCurrentUserAsync().then(function (me) {
      if (!me) return Promise.resolve(true);
      return supabase.from('challenges')
        .update({ status: 'expired' })
        .eq('from_user_id', me.id)
        .eq('status', 'pending')
        .then(function () { return true; });
    });
  }

  /**
   * Join matchmaking queue and try to match. Returns promise.
   */
  function findMatch() {
    if (!supabase) return noClient();
    return getCurrentUserAsync().then(function (me) {
      if (!me) return Promise.reject(new Error('Not logged in'));
      return supabase.from('matchmaking_queue').upsert(
        { user_id: me.id, joined_at: new Date().toISOString(), matched_game_id: null },
        { onConflict: 'user_id' }
      ).then(function () {
        return supabase.rpc('try_match');
      }).then(function (r) {
        return (r.data && r.data) || true;
      });
    });
  }

  /**
   * Get matchmaking status: { status: 'searching' } or { status: 'matched', gameId: '...' }.
   */
  function getMatchStatus() {
    if (!supabase) return Promise.resolve(null);
    return getCurrentUserAsync().then(function (me) {
      if (!me) return null;
      return supabase.from('matchmaking_queue')
        .select('matched_game_id')
        .eq('user_id', me.id)
        .maybeSingle()
        .then(function (r) {
          if (!r.data) return { status: 'searching' };
          if (r.data.matched_game_id) {
            return { status: 'matched', gameId: r.data.matched_game_id };
          }
          return { status: 'searching' };
        });
    });
  }

  /**
   * Leave matchmaking queue.
   */
  function cancelMatch() {
    if (!supabase) return noClient();
    return getCurrentUserAsync().then(function (me) {
      if (!me) return Promise.resolve(true);
      return supabase.from('matchmaking_queue').delete().eq('user_id', me.id).then(function () { return true; });
    });
  }

  /**
   * Get game and its puzzle (for versus: timer from started_at, board from puzzle).
   * Uses RPC get_game_for_player to avoid RLS 500 on direct games select.
   */
  function getGameWithPuzzle(gameId) {
    if (!supabase) return noClient();
    return supabase.rpc('get_game_for_player', { p_game_id: gameId })
      .then(function (r) {
        if (r.error) {
          if (typeof console !== 'undefined' && console.warn) console.warn('Spellbound getGameWithPuzzle:', r.error.message || r.error);
          return null;
        }
        var data = r.data;
        if (!data || !data.game) return null;
        return {
          game: data.game,
          puzzle: data.puzzle || null,
          puzzle_index: data.puzzle_index != null ? data.puzzle_index : null
        };
      });
  }

  /**
   * Get both game_players for a game (score, words_found, left_at, bitter_end_choice, username via users).
   */
  function getGamePlayers(gameId) {
    if (!supabase) return noClient();
    return supabase.from('game_players')
      .select('id, user_id, role, score, words_found, left_at, bitter_end_choice, users!user_id(username)')
      .eq('game_id', gameId)
      .then(function (r) {
        if (r.data) return r.data;
        return [];
      });
  }

  /**
   * Update current user's game_players row (score and words_found).
   */
  function updateMyGamePlayer(gameId, payload) {
    if (!supabase) return noClient();
    return getCurrentUserAsync().then(function (me) {
      if (!me) return Promise.reject(new Error('Not logged in'));
      var row = { score: payload.score, words_found: payload.words_found || [] };
      return supabase.from('game_players')
        .update(row)
        .eq('game_id', gameId)
        .eq('user_id', me.id)
        .select()
        .then(function (r) { return r.error ? Promise.reject(r.error) : r.data; });
    });
  }

  /**
   * Start Bitter End (one player clicks Continue). Sets game.bitter_end_mode so the other player sees it and proceeds.
   * Returns 'coop' or 'competitive' on success, null if not both agreed.
   */
  function startBitterEnd(gameId) {
    if (!supabase) return Promise.resolve(null);
    return supabase.rpc('start_bitter_end', { p_game_id: gameId }).then(function (r) {
      if (r.error) return null;
      return r.data;
    });
  }

  /**
   * Set current user's Bitter End choice (coop or competitive). Both players must agree to continue.
   */
  function updateBitterEndChoice(gameId, choice) {
    if (!supabase) return noClient();
    return getCurrentUserAsync().then(function (me) {
      if (!me) return Promise.reject(new Error('Not logged in'));
      return supabase.from('game_players')
        .update({ bitter_end_choice: choice })
        .eq('game_id', gameId)
        .eq('user_id', me.id)
        .select()
        .then(function (r) { return r.error ? Promise.reject(r.error) : r.data; });
    });
  }

  /**
   * Mark game as finished (status, ended_at). Call when Round 1 ends (time up or all words found).
   */
  function setGameFinished(gameId) {
    if (!supabase) return Promise.resolve(false);
    return supabase.rpc('set_game_finished', { p_game_id: gameId }).then(function (r) {
      if (r.error) return false;
      return r.data === true;
    });
  }

  /**
   * Mark that the current user left the game (opponent will see via Realtime).
   */
  function leaveGame(gameId) {
    if (!supabase) return noClient();
    return getCurrentUserAsync().then(function (me) {
      if (!me) return Promise.resolve();
      return supabase.from('game_players')
        .update({ left_at: new Date().toISOString() })
        .eq('game_id', gameId)
        .eq('user_id', me.id);
    });
  }

  /**
   * Subscribe to game_players changes for this game. Callback(players) with full rows.
   * Returns unsubscribe function.
   */
  function subscribeToGamePlayers(gameId, callback) {
    if (!supabase) return function () {};
    var channel = supabase
      .channel('game_players_' + gameId)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_players', filter: 'game_id=eq.' + gameId },
        function () {
          getGamePlayers(gameId).then(function (players) {
            if (callback) callback(players);
          });
        }
      )
      .subscribe();
    return function () {
      supabase.removeChannel(channel);
    };
  }

  global.db = {
    login: login,
    signup: signup,
    getCurrentUser: getCurrentUser,
    getCurrentUserAsync: getCurrentUserAsync,
    changePassword: changePassword,
    logout: logout,
    searchUsers: searchUsers,
    sendChallenge: sendChallenge,
    getChallengeStatus: getChallengeStatus,
    cancelChallenge: cancelChallenge,
    getSentChallengeStatus: getSentChallengeStatus,
    getMyPendingChallenges: getMyPendingChallenges,
    acceptChallenge: acceptChallenge,
    rejectChallenge: rejectChallenge,
    subscribeToIncomingChallenges: subscribeToIncomingChallenges,
    findMatch: findMatch,
    getMatchStatus: getMatchStatus,
    cancelMatch: cancelMatch,
    getGameWithPuzzle: getGameWithPuzzle,
    getGamePlayers: getGamePlayers,
    updateMyGamePlayer: updateMyGamePlayer,
    updateBitterEndChoice: updateBitterEndChoice,
    startBitterEnd: startBitterEnd,
    setGameFinished: setGameFinished,
    leaveGame: leaveGame,
    subscribeToGamePlayers: subscribeToGamePlayers,
  };
})(typeof window !== 'undefined' ? window : this);
