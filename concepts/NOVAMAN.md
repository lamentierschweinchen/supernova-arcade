# Novaman — concept

*Pac-Man across the MultiversX network. One maze, split into three shards. Every dot you
eat, every powerup you grab, every bite you take settles on whichever shard you are
standing on. Light all three and you ignite the Supernova.*

> Status: **solo-first**, co-op is backburner. Held as a concept, not in build.

---

## The honest-shards test (read this first)

Snakanova taught us the rule: do not paint shards on for flavor. We renamed that game and
tore out the fake shard coloring because the shards were cosmetic and everyone could tell.
Novaman only earns the name if the shards are **real**. They are, and in the strongest way:
your actual onchain activity gets distributed across three shards as you play. Most chains
have no shards to spread across. This is a game only MvX can host honestly.

## How the shards actually work (the heart of it)

- **One maze, three regions: shard 0, shard 1, shard 2.** Both you and the ghosts roam the
  whole board.
- **Tunnels are the shard boundaries.** Port through one and you are now on a different
  shard. So are the ghosts that chase you through it.
- **Every onchain action settles on the shard you are on when it happens.** Grab an item in
  shard 0, it settles on shard 0's contract. Take a bite in shard 2, that bite lands on
  shard 2. Eat a ghost just after a port, it settles wherever you came out.
- So a single run is **genuinely smeared across three shard contracts by geography.** Pull
  up the explorer afterward and your account has real activity on all three shards from one
  game. That is not a diagram of sharding. It is you, sharded.
- (This is the Triptych move done as a game: three shard boards, one aggregate, except here
  the board is a maze and the aggregate is your run.)

## The cross-shard flex

- Porting is instant to play, but it is a real shard change underneath. On Supernova's
  sub-second finality, settling on the shard you just ported into is near-instant, the game
  clocks it, and your **fastest port** becomes a number you can chase and show off.
- Reuses Shard Hydra's cross-shard settlement rig, so this plumbing already exists.

## Core loop

- You are Novaman, dropped into the maze. Eat sparks, grab items and Nova Cores, dodge four
  ghosts.
- Everything meaningful you do settles on your **current** shard. Clear a region's sparks to
  **light** that shard.
- Tunnels port you (and the ghosts) between the three shards. A port is your escape hatch,
  but you cannot camp one safe region, because you have to light all three.
- Light all three shards to ignite the **Supernova** finale.

## Why the shards matter to play (not just lore)

- A tunnel is an **escape hatch**: hop shards to shake a ghost and buy a beat. But the ghosts
  port too, so it only buys a beat.
- You **must spread across all three** shards to win, so you cannot hide in one. There is a
  real read on which shard to push and when.
- Each shard can carry its own **temperament** (ghost speed, a hazard, spawn rate) so the
  three regions feel distinct, not reskinned.

## Uncheatable, and a fistful of stats *(you wanted multiple stats — good, they are sexier)*

Score is not one number. Several ranked stats, each an onchain tally, each pace-gated (same
anti-cheat as Degen Dash's grabs, so no spamming):

- **Sparks cleared** — the grind.
- **Ghosts eaten** — the aggression.
- **Shards lit** and **full clears** (all three) — the completion.
- **Ports** — how many times you crossed shards. The stat only a sharded chain has.
- **Fastest port** — your best cross-shard finality time. The throughput flex, made personal.
- **Shard fingerprint** — the split of your run across shard 0 / 1 / 2. Unique per player,
  screenshot bait on the score card.

Because every meaningful action settles on the shard you are on, the leaderboards can rank
you **overall and per shard.** Ambient sparks stay local for feel; the settled events drive
the stats and the truth. (The board API already supports multiple metrics, so these are
leaderboards we can already scale.)

## Provably fair board — the Snakanova through-line

- Every run's maze and the ghost patrol paths are derived from a **VRF seed**,
  deterministically. Unlearnable, un-riggable, reproducible.
- Nobody, us included, knows the layout before the seed drops. The seed is onchain, so
  anyone can replay the exact run and confirm the walls and ghosts were never moved.

## The Supernova finale

- Light all three shards and the network **goes supernova**: the three shard tallies
  reconcile into one Supernova run, it seals onchain, and you get a score card carrying your
  fistful of stats and your shard fingerprint (the existing `/api/og` card pipeline).
- Clearing the network **is** igniting the Supernova. Lands the Sep 10 story with zero
  marketing copy inside the game.

## Ghosts and power mode

- Four ghosts, a straight Pac-Man homage, but **VRF-deterministic** (no rubber-band RNG).
  They roam every region and port between shards to chase you. A ghost is on whatever shard
  it is standing on, same as you.
- A **Nova Core** flips them edible for a few seconds. Eating a fleeing ghost settles on your
  current shard, and chasing one through a tunnel is the high-stakes play: commit to the
  port, or let it go.

## Multiplayer — backburner (solo ships first)

Solo is v1. Later, the obvious co-op: three players, and the network only goes supernova when
all three shards are lit. A literal "we cleared the network together." Out of v1 scope, noted
so we design v1 without painting it out.

## Build notes

- **Reuses:** Shard Hydra's cross-shard rig, the cabinet kit, arcade-core `sendAction`
  (signed Relayed-v3), the passport, the multi-metric board API, the VRF-seed pattern from
  Snakanova / Wen Moon, the OG score-card pipeline.
- **New work:** maze generation from the seed, deterministic ghost AI, three shard contracts
  plus routing each action to the current shard, the port / context-switch flow, the
  multi-stat tally, the finale reconciliation.
- **Size:** high, the biggest lift on the slate. But the two hardest pieces, cross-shard and
  provable fairness, are already live and proven in shipped games.

## Settlement model — DECIDED: A (independent tallies, reconcile at the finale)

All design calls are now locked:

- **One maze in three shard-parts**, all accessible to player and ghosts.
- **Actions settle on the current shard** (the run is smeared across three shard contracts by
  geography).
- **Multiple stats**, rankable overall and per shard.
- **Solo first**, co-op backburner.
- **Settlement: model A.** Each shard contract independently records what happened on its
  turf; the global run is the **aggregate, reconciled at the Supernova finale** (the Triptych
  pattern, already proven, no per-port latency). A port is a **local context switch** that
  just changes which shard your next actions route to. The cross-shard finality flex lives in
  the finale reconciliation, plus an optional light checkpoint tx on each port if we want the
  clock visible in-run.

Rejected: **model B** (hand run-state off cross-shard on every port). Maximally purist for
cross-shard, but a finality round trip on every tunnel fights Pac-Man's twitch. A keeps the
game genuinely tri-shard without paying latency in the twitch loop.

**This concept is build-ready.** Remaining before a build starts is scoping and Lukas's
greenlight, not design.
