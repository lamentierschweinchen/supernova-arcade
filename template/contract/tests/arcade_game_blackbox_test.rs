// Blackbox tests for the Supernova Arcade game contract template.
// Exercises the contract through the VM exactly as the blockchain would:
// the uncheatable session score (recordAction — one tx = one point), the
// MILLISECOND session window, handles, the leaderboard data (unsorted; the client
// sorts), the global counter, and the standard event path.
//
// Run: `sc-meta all build` first (these reference output/arcade-game.mxsc.json),
// then `cargo test`.
//
// Note on timestamps: the session sentinel treats stored start == 0 as "no
// session yet". Real networks never produce a 0 timestamp, so these tests set a
// non-zero block timestamp (in MILLISECONDS) before exercising session logic.

use arcade_game::*;
use multiversx_sc_scenario::imports::*;

const OWNER: TestAddress = TestAddress::new("owner");
const ALICE: TestAddress = TestAddress::new("alice");
const BOB: TestAddress = TestAddress::new("bob");
const CAROL: TestAddress = TestAddress::new("carol");
const CONTRACT: TestSCAddress = TestSCAddress::new("arcade");
const CODE_PATH: MxscPath = MxscPath::new("output/arcade-game.mxsc.json");

const GAME_ID: &str = "nova-taps";
const WINDOW_MS: u64 = 30_000; // 30s in MILLISECONDS

fn world() -> ScenarioWorld {
    let mut blockchain = ScenarioWorld::new();
    blockchain.register_contract(CODE_PATH, arcade_game::ContractBuilder);
    blockchain
}

fn deploy_with_window(world: &mut ScenarioWorld, window_ms: u64) {
    world.account(OWNER).nonce(1);
    world.account(ALICE).nonce(1);
    world.account(BOB).nonce(1);
    world.account(CAROL).nonce(1);

    world
        .tx()
        .from(OWNER)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .init(ManagedBuffer::from(GAME_ID), window_ms)
        .code(CODE_PATH)
        .new_address(CONTRACT)
        .run();
}

fn deploy(world: &mut ScenarioWorld) {
    deploy_with_window(world, 0);
}

fn set_time(world: &mut ScenarioWorld, t: u64) {
    world.current_block().block_timestamp(t);
}

fn record_action(world: &mut ScenarioWorld, from: TestAddress) {
    world
        .tx()
        .from(from)
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .record_action()
        .run();
}

/// Record `n` actions for `from`, all inside the same window (so they accumulate
/// into one session of size `n`).
fn record_n(world: &mut ScenarioWorld, from: TestAddress, n: u64, base_ms: u64) {
    for i in 0..n {
        set_time(world, base_ms + i); // +i ms apart, all within the window
        record_action(world, from);
    }
}

fn global_actions(world: &mut ScenarioWorld) -> u64 {
    world
        .query()
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .get_global_actions()
        .returns(ReturnsResult)
        .run()
}

fn score_of(world: &mut ScenarioWorld, who: TestAddress) -> u64 {
    world
        .query()
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .get_player_entry(who.to_address())
        .returns(ReturnsResult)
        .run()
        .score
}

// ---------------------------------------------------------------------------
// deploy + config
// ---------------------------------------------------------------------------

#[test]
fn deploys_empty_with_config() {
    let mut world = world();
    deploy(&mut world);

    world
        .query()
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .get_player_count()
        .returns(ExpectValue(0usize))
        .run();

    world
        .query()
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .get_game_id()
        .returns(ExpectValue(ManagedBuffer::from(GAME_ID)))
        .run();

    // window 0 at deploy resolves to the 30s (30_000 ms) default
    world
        .query()
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .get_session_window_ms()
        .returns(ExpectValue(WINDOW_MS))
        .run();

    assert_eq!(global_actions(&mut world), 0);
}

#[test]
fn rejects_empty_game_id() {
    let mut world = world();
    world.account(OWNER).nonce(1);
    world
        .tx()
        .from(OWNER)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .init(ManagedBuffer::new(), 0u64)
        .code(CODE_PATH)
        .new_address(CONTRACT)
        .with_result(ExpectError(4, "game_id must not be empty"))
        .run();
}

// ---------------------------------------------------------------------------
// recordAction — the uncheatable session score (one tx = one point)
// ---------------------------------------------------------------------------

#[test]
fn single_action_scores_one() {
    let mut world = world();
    deploy(&mut world);
    set_time(&mut world, 1_000);

    record_action(&mut world, ALICE);

    assert_eq!(score_of(&mut world, ALICE), 1);
    assert_eq!(global_actions(&mut world), 1);
    world
        .query()
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .get_player_count()
        .returns(ExpectValue(1usize))
        .run();
}

#[test]
fn actions_within_window_accumulate() {
    let mut world = world();
    deploy(&mut world);

    // five actions inside the 30s window => session of 5 => score 5
    record_n(&mut world, ALICE, 5, 1_000);

    assert_eq!(score_of(&mut world, ALICE), 5);
    assert_eq!(global_actions(&mut world), 5);
}

#[test]
fn new_window_opens_fresh_session_but_keeps_best() {
    let mut world = world();
    deploy(&mut world);

    // session A: 4 actions => best 4
    record_n(&mut world, ALICE, 4, 1_000);
    assert_eq!(score_of(&mut world, ALICE), 4);

    // a single action far past the window opens a fresh session of 1.
    // best stays 4 (we keep the best session ever, not the latest).
    set_time(&mut world, 1_000_000);
    record_action(&mut world, ALICE);
    assert_eq!(score_of(&mut world, ALICE), 4);

    // the global counter counts every real action: 4 + 1 = 5
    assert_eq!(global_actions(&mut world), 5);
}

#[test]
fn window_is_milliseconds() {
    let mut world = world();
    deploy(&mut world); // 30_000 ms window

    // two actions 29s apart (29_000 ms) are in the SAME 30s window => session 2
    set_time(&mut world, 10_000);
    record_action(&mut world, ALICE);
    set_time(&mut world, 39_000); // 29_000 ms later, still within 30_000
    record_action(&mut world, ALICE);
    assert_eq!(score_of(&mut world, ALICE), 2);

    // an action 31s after the session start (41_000 > 10_000 + 30_000) opens a
    // fresh session of 1. If the window were mistakenly treated as seconds (30),
    // even a 1ms gap would reset — this asserts the ms sizing.
    set_time(&mut world, 41_001);
    record_action(&mut world, ALICE);
    assert_eq!(score_of(&mut world, ALICE), 2); // best still 2 (fresh session is 1)
}

// ---------------------------------------------------------------------------
// setHandle — requires a real score first
// ---------------------------------------------------------------------------

#[test]
fn set_handle_requires_a_score() {
    let mut world = world();
    deploy(&mut world);

    // no score yet => rejected
    world
        .tx()
        .from(ALICE)
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .set_handle(ManagedBuffer::from("alice"))
        .with_result(ExpectError(4, "play first"))
        .run();

    // score via recordAction, then a handle sticks
    set_time(&mut world, 1_000);
    record_action(&mut world, ALICE);
    world
        .tx()
        .from(ALICE)
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .set_handle(ManagedBuffer::from("alice"))
        .run();

    let entry = world
        .query()
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .get_player_entry(ALICE.to_address())
        .returns(ReturnsResult)
        .run();
    assert_eq!(entry.handle, ManagedBuffer::from("alice"));
}

#[test]
fn set_handle_rejects_empty_and_long() {
    let mut world = world();
    deploy(&mut world);
    set_time(&mut world, 1_000);
    record_action(&mut world, ALICE);

    world
        .tx()
        .from(ALICE)
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .set_handle(ManagedBuffer::new())
        .with_result(ExpectError(4, "handle must not be empty"))
        .run();

    let long_handle = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 33 bytes
    assert_eq!(long_handle.len(), 33);
    world
        .tx()
        .from(ALICE)
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .set_handle(ManagedBuffer::from(long_handle))
        .with_result(ExpectError(4, "handle too long"))
        .run();
}

// ---------------------------------------------------------------------------
// leaderboard data + global counter
// ---------------------------------------------------------------------------

#[test]
fn leaderboard_returns_all_entries_unsorted() {
    let mut world = world();
    deploy(&mut world);

    // alice 3, bob 5, carol 2 — each in their own window
    record_n(&mut world, ALICE, 3, 1_000);
    record_n(&mut world, BOB, 5, 1_000);
    record_n(&mut world, CAROL, 2, 1_000);

    // every player is present with the right score (order is the client's job)
    world
        .query()
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .get_player_count()
        .returns(ExpectValue(3usize))
        .run();

    let board = world
        .query()
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .get_leaderboard()
        .returns(ReturnsResult)
        .run();

    let entries = board.to_vec();
    assert_eq!(entries.len(), 3);

    // each individual score is correct
    assert_eq!(score_of(&mut world, ALICE), 3);
    assert_eq!(score_of(&mut world, BOB), 5);
    assert_eq!(score_of(&mut world, CAROL), 2);

    // global counter = sum of all real actions
    assert_eq!(global_actions(&mut world), 10);
}

#[test]
fn player_entry_empty_for_unknown() {
    let mut world = world();
    deploy(&mut world);

    let entry = world
        .query()
        .to(CONTRACT)
        .typed(arcade_game_proxy::ArcadeGameProxy)
        .get_player_entry(CAROL.to_address())
        .returns(ReturnsResult)
        .run();

    assert_eq!(entry.score, 0);
    assert!(entry.handle.is_empty());
}
