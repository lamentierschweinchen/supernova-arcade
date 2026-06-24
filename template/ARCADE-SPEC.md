# Supernova Arcade — integration spec

The contract any game must meet to join the Supernova Arcade, whether built from
this template or from scratch. Goal: lots of fun, real-onchain games, not one clever
engine. This document restates the spec and shows exactly how this template
satisfies each clause, so you can fork it and pass review, or roll your own against
the same bar.

## Core model

- **Gameplay is local; the onchain layer is the score / shared state.** Play runs in
  the browser; the chain holds the leaderboard or the shared tally.
- **Onchain legibility is ~2s** (API / indexer read latency, even with 600ms blocks —
  measured in Sprint). So onchain state (score, tally, board) updates on a ~2s tick.
  Never put the chain in the critical path of twitch gameplay.
- **Out of scope:** real-time twitch PvP needing per-frame sync between players (e.g.
  onchain Pong). Not feasible at ~2s. Build collective / accumulation games, or
  local-play-with-onchain-score, instead.

## What every Arcade game must implement

| # | Requirement | How this template meets it |
|---|---|---|
| 1 | **One-tap gasless play** — ephemeral key generated in-browser, transactions relayed gaslessly. No wallet, no install. | `web/arcade.js` generates an ephemeral ed25519 key ground into the relayer's shard, signs locally, and POSTs to the relayer (`relayer/relay.js`, Relayed v3). |
| 2 | **Onchain score or shared state** — player actions/scores land onchain via a leaderboard or shared-state contract the hub can read. | `contract/src/lib.rs` stores each player's best score + a global counter; readable via `getLeaderboard`, `getGlobalActions`, `getPlayerEntry`. |
| 3 | **Uncheatable score = real onchain txs (don't fight bots).** The score IS the count of real transactions: one action = one tx (the Sprint `recordTap` pattern), leaderboard sorted client-side. You can't fake a tx, so the score is honest by construction; a bot just does more real onchain work — the point. No rate-limiting or score-bounding. | `recordAction()` takes no args → one tx = +1, scored as the best in-window session. The relayer adds **no rate limit and no score bound** — only gas/receiver/value/shard/signature safety. The leaderboard is sorted client-side. |
| 4 | **Global-counter event** — emit each onchain action in a standard format so the hub's global "onchain actions" counter aggregates across all games. | Every accepted action emits `arcadeAction(game, player, actions, new_total)` — identical across all Arcade games (incl. the Tug-of-War + Canvas seed games). The hub sums `actions` across all games (or sums each `getGlobalActions()` view). |
| 5 | **Per-game leaderboard** — readable onchain, for the hub to render. | `getLeaderboard()` returns every entry (unsorted; the reader sorts client-side) with a stable byte layout a dependency-free client can decode. |

## The standard global-counter event

Keep this event so your game feeds the hub's odometer without custom indexer work:

```
arcadeAction(
  #[indexed] game:      ManagedBuffer   // the game id set at deploy
  #[indexed] player:    ManagedAddress  // the ephemeral caller
  #[indexed] actions:   u32             // onchain actions this tx represents (usually 1)
             new_total: u64             // this contract's running total after the call
)
```

The hub aggregates the global "N onchain actions" counter by summing `actions`
across every featured contract's `arcadeAction` events, grouping by `game`.
Equivalently (no indexer), it reads each game's `getGlobalActions()` view on the ~2s
tick and sums. Both give the same number.

## The open template (this repo)

Packages the Sprint stack — ephemeral-key gasless onboarding + leaderboard/shared-
state contract + the uncheatable-score model + the global-counter event — as a
starter so a dev ships a simple game in a day. Optional: creative / advanced builders
can roll their own, as long as they meet the contract above.

## Submission

- Repo + hosted URL + contract address + a one-line description + the action-event
  format used (this template's `arcadeAction`, unless you changed it).
- Safety + quality review before featuring (no malicious contracts, no scams, works
  on mobile).
- Featured games get a permanent cabinet in the hub; their activity feeds the global
  counter.

## Design constraints

- Counters / leaderboards tick ~2s; no fake real-time.
- Supernova = "scheduled to activate," never "live," never a date, in any copy.
- Mobile-first (taps). US English.

## Gotchas + infra

- **Block timestamp is in MILLISECONDS.** On Supernova (sub-second blocks)
  `get_block_timestamp()` returns ms, not seconds — size any time-window constant
  ×1000. (A 30s window written as `30` is actually 30ms; Sprint's score got stuck at
  1 from exactly this.) This template's `session_window_ms` is milliseconds and a
  blackbox test (`window_is_milliseconds`) guards it.
- **Relayer at scale.** The gasless relayer is gas-only — there is no rate limit by
  design (the score is real-tx count, so bots are welcome). Keep the relayer's
  testnet wallet funded; at real volume, watch the host's request limits and move the
  function to a higher-throughput host if needed.
