#![no_std]

//! Supernova Arcade — game contract template.
//!
//! ONE contract that gives an Arcade game everything the integration spec asks
//! for: an UNCHEATABLE score, a readable leaderboard, a global "onchain actions"
//! counter, and a standard event the hub sums across every game. Fork it, set your
//! `game_id`, deploy, and point the web client at it.
//!
//! THE SCORE IS THE COUNT OF REAL TRANSACTIONS. `recordAction()` takes NO
//! arguments: one call = exactly one transaction = +1. You cannot fake a
//! transaction, so the score is honest by construction — there is nothing to
//! bound, rate-limit, or trust from the client. **Bots are welcome:** a bot just
//! does more real onchain work, which is the whole point (more real activity =
//! more proof). This is the proven Supernova Sprint `recordTap` model.
//!
//! HOW A SCORE IS SHAPED. A score is the best SESSION a player lands: the run of
//! actions that fall within `session_window_ms` of the session's first action. A
//! short window (e.g. 30_000 = 30s) makes a timed sprint — your best 30-second run
//! is your score. A very large window makes an all-time cumulative count. Either
//! way the score is a count of real transactions.
//!
//! BLOCK TIMESTAMP IS IN MILLISECONDS. On a Supernova network
//! `get_block_timestamp()` returns MILLISECONDS, not seconds (sub-second blocks).
//! So `session_window_ms` is milliseconds: 30s is `30_000`. Sizing a window in
//! seconds is the classic bug that pinned Sprint's score at 1 (a `30` window is
//! 30ms, so every tap opened a fresh session). Always ×1000.
//!
//! The leaderboard is sorted CLIENT-SIDE. `getLeaderboard()` returns every entry;
//! the reader (game UI or hub) sorts by score. No gas-metered onchain sort to cap
//! how big the board can grow.
//!
//! NETWORK: built for MultiversX TESTNET, the public network on which Supernova is
//! scheduled to activate (600ms rounds), so a submission finalizes on the
//! Supernova clock. Testnet is a test network and can be reset, which would clear
//! the board. Frame it that way in your UI.

use multiversx_sc::{derive_imports::*, imports::*};

pub mod arcade_game_proxy;

/// One leaderboard entry, as returned by the views. The byte layout is stable so
/// a dependency-free browser client can decode it straight from a vm-values read:
/// address(32) + handleLen(4, big-endian) + handle(utf8) + score(u64) + timestamp(u64).
#[type_abi]
#[derive(TopEncode, TopDecode, NestedEncode, NestedDecode, ManagedVecItem, Clone, PartialEq, Eq, Debug)]
pub struct ScoreEntry<M: ManagedTypeApi> {
    pub address: ManagedAddress<M>,
    pub handle: ManagedBuffer<M>,
    pub score: u64,
    pub timestamp: u64,
}

/// Max handle length in bytes. Keeps storage bounded and event logs sane.
const MAX_HANDLE_LEN: usize = 32;

/// Default session window in MILLISECONDS (see the module docs on ms timestamps).
/// 30_000 ms = 30s. Used when a deploy passes 0 for the window.
const DEFAULT_SESSION_WINDOW_MS: u64 = 30_000;

#[multiversx_sc::contract]
pub trait ArcadeGame {
    /// Deploy-time config.
    /// - `game_id`: a short id for this game (e.g. "nova-taps"), emitted (indexed)
    ///   on every `arcadeAction` event so the hub can group actions by game.
    /// - `session_window_ms`: the rolling window for scoring, in MILLISECONDS. Pass
    ///   0 for the 30s default. A short window = a timed sprint; a very large window
    ///   = an all-time cumulative count.
    #[init]
    fn init(&self, game_id: ManagedBuffer, session_window_ms: u64) {
        require!(!game_id.is_empty(), "game_id must not be empty");
        require!(game_id.len() <= MAX_HANDLE_LEN, "game_id too long");
        self.game_id().set(&game_id);

        let window = if session_window_ms == 0 {
            DEFAULT_SESSION_WINDOW_MS
        } else {
            session_window_ms
        };
        self.session_window_ms().set(window);
    }

    /// Storage persists across upgrades. `game_id` and the window keep their stored
    /// values unless you explicitly re-set them here.
    #[upgrade]
    fn upgrade(&self) {}

    // ====================================================================
    // SCORING — one call = one transaction = +1. Uncheatable by construction.
    // ====================================================================

    /// Record one real action. Takes NO arguments, so the score cannot be
    /// self-reported: it is +1 to the caller's current session, and the best
    /// session a caller ever lands is their leaderboard score. Opens a fresh
    /// session if the last action was more than `session_window_ms` ago. Always
    /// bumps the global counter and emits `arcadeAction`.
    ///
    /// There is nothing to rate-limit or bound here. A player (or a bot) can only
    /// raise their score by sending more real transactions, which is exactly the
    /// onchain activity the Arcade is proving.
    #[endpoint(recordAction)]
    fn record_action(&self) {
        let caller = self.blockchain().get_caller();
        let now = self.blockchain().get_block_timestamp(); // MILLISECONDS on Supernova
        let window = self.session_window_ms().get();

        let start = self.session_start(&caller).get();
        let session = if start == 0 || now > start + window {
            self.session_start(&caller).set(now);
            1u64
        } else {
            self.session(&caller).get() + 1
        };
        self.session(&caller).set(session);

        // A new personal best joins (or updates) the leaderboard.
        if session > self.best_score(&caller).get() {
            self.register_player(&caller);
            self.best_score(&caller).set(session);
            self.timestamp(&caller).set(now);
        }

        self.bump_and_emit(&caller, 1);
    }

    /// Attach a username to the caller's address, shown next to their score. A real
    /// score is required first, so a handle can't be claimed without playing.
    #[endpoint(setHandle)]
    fn set_handle(&self, handle: ManagedBuffer) {
        require!(!handle.is_empty(), "handle must not be empty");
        require!(handle.len() <= MAX_HANDLE_LEN, "handle too long");
        let caller = self.blockchain().get_caller();
        require!(self.best_score(&caller).get() > 0, "play first");
        self.handle(&caller).set(&handle);
        self.handle_set_event(&caller, &handle);
    }

    // ====================================================================
    // VIEWS (read-only; the hub and the game UI poll these on a ~2s tick)
    // ====================================================================

    /// Every entry on the board, UNSORTED. The reader sorts client-side (by score
    /// descending, ties broken by earlier timestamp). Returning the raw set keeps
    /// reads cheap and lets the board grow without an onchain sort cap. Cost scales
    /// with the player count; for a very large board, page with the player set.
    #[view(getLeaderboard)]
    fn get_leaderboard(&self) -> MultiValueEncoded<ScoreEntry<Self::Api>> {
        let mut out = MultiValueEncoded::new();
        for addr in self.players().iter() {
            out.push(ScoreEntry {
                score: self.best_score(&addr).get(),
                handle: self.handle(&addr).get(),
                timestamp: self.timestamp(&addr).get(),
                address: addr,
            });
        }
        out
    }

    /// Number of distinct players with a score on the board.
    #[view(getPlayerCount)]
    fn get_player_count(&self) -> usize {
        self.players().len()
    }

    /// A single player's entry, or an empty entry (score 0) if they've never
    /// scored. Lets the UI show "your rank/score" cheaply.
    #[view(getPlayerEntry)]
    fn get_player_entry(&self, address: ManagedAddress) -> ScoreEntry<Self::Api> {
        ScoreEntry {
            score: self.best_score(&address).get(),
            handle: if self.handle(&address).is_empty() {
                ManagedBuffer::new()
            } else {
                self.handle(&address).get()
            },
            timestamp: self.timestamp(&address).get(),
            address,
        }
    }

    /// This game's global running total of onchain actions. The hub reads this from
    /// every featured game and sums to a single cross-game odometer (no indexer
    /// needed). For an event-driven hub, sum the `arcadeAction` events instead —
    /// both give the same total.
    #[view(getGlobalActions)]
    fn get_global_actions(&self) -> u64 {
        self.global_actions().get()
    }

    /// The game id set at deploy.
    #[view(getGameId)]
    fn get_game_id(&self) -> ManagedBuffer {
        self.game_id().get()
    }

    /// The configured session window in milliseconds.
    #[view(getSessionWindowMs)]
    fn get_session_window_ms(&self) -> u64 {
        self.session_window_ms().get()
    }

    // ====================================================================
    // INTERNAL
    // ====================================================================

    /// Add the caller to the leaderboard set if not already present.
    fn register_player(&self, caller: &ManagedAddress) {
        if !self.players().contains(caller) {
            self.players().insert(caller.clone());
        }
    }

    /// Bump the global counter and emit the standard event. `actions` is how many
    /// onchain actions this transaction represents. In this template every call is
    /// exactly one action (one tx = one point), so it is always 1 — but the
    /// parameter keeps the standard event identical to games that legitimately bound
    /// several sub-actions into one tx (e.g. a canvas placing N pixels per tx).
    fn bump_and_emit(&self, caller: &ManagedAddress, actions: u32) {
        let new_total = self.global_actions().update(|g| {
            *g += actions as u64;
            *g
        });
        self.arcade_action_event(&self.game_id().get(), caller, actions, new_total);
    }

    // ====================================================================
    // STORAGE
    // ====================================================================

    /// Short id for this game, emitted on every action event.
    #[storage_mapper("gameId")]
    fn game_id(&self) -> SingleValueMapper<ManagedBuffer>;

    /// Rolling session window for scoring, in MILLISECONDS.
    #[storage_mapper("sessionWindowMs")]
    fn session_window_ms(&self) -> SingleValueMapper<u64>;

    /// Set of every address with a score on the board. O(1) membership + cheap
    /// insert; the views iterate it to build the leaderboard.
    #[storage_mapper("players")]
    fn players(&self) -> UnorderedSetMapper<ManagedAddress>;

    /// A player's best score (their leaderboard score).
    #[storage_mapper("bestScore")]
    fn best_score(&self, address: &ManagedAddress) -> SingleValueMapper<u64>;

    /// A player's handle (set via setHandle). May be empty until set.
    #[storage_mapper("handle")]
    fn handle(&self, address: &ManagedAddress) -> SingleValueMapper<ManagedBuffer>;

    /// Block timestamp (ms) at which a player reached their best score.
    #[storage_mapper("timestamp")]
    fn timestamp(&self, address: &ManagedAddress) -> SingleValueMapper<u64>;

    /// Block timestamp (ms) of the first action in the caller's current session.
    #[storage_mapper("sessionStart")]
    fn session_start(&self, address: &ManagedAddress) -> SingleValueMapper<u64>;

    /// Action count of the caller's current (in-window) session.
    #[storage_mapper("session")]
    fn session(&self, address: &ManagedAddress) -> SingleValueMapper<u64>;

    /// Global running total of all recorded onchain actions.
    #[storage_mapper("globalActions")]
    fn global_actions(&self) -> SingleValueMapper<u64>;

    // ====================================================================
    // EVENTS
    // ====================================================================

    /// THE STANDARD ARCADE EVENT — identical across every Arcade game so the hub
    /// can sum a single global "N onchain actions" odometer. Sum `actions` across
    /// every featured game's `arcadeAction` events (grouped by `game`).
    /// - `game`: the game id (indexed) so the hub can group by game.
    /// - `player`: the (ephemeral) caller (indexed).
    /// - `actions`: onchain actions this tx represents (indexed). 1 here (one tx =
    ///   one point); games that bound several sub-actions per tx emit that count.
    /// - `new_total`: this contract's global total AFTER the call, so a single-game
    ///   listener can follow the counter climb live.
    #[event("arcadeAction")]
    fn arcade_action_event(
        &self,
        #[indexed] game: &ManagedBuffer,
        #[indexed] player: &ManagedAddress,
        #[indexed] actions: u32,
        new_total: u64,
    );

    /// Emitted when a player sets or updates their handle.
    #[event("handleSet")]
    fn handle_set_event(&self, #[indexed] player: &ManagedAddress, handle: &ManagedBuffer);
}
