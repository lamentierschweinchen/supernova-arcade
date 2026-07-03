# Novaman — concept

*Pac-Man, but the maze is the MultiversX network. Three shards, three connected
mazes, and the tunnels between them are real cross-shard transactions. Light all
three and you ignite the Supernova.*

---

## The honest-shards test (read this first)

Snakanova taught us the rule: do not paint shards on for flavor. We renamed it and
tore out the fake shard coloring because the shards were cosmetic and everyone could
tell. Novaman only earns the name if the shards are **real**.

They are. Each of the three mazes is its own shard contract, and crossing between them
is a genuine cross-shard message, not a colored line on one board. This is the whole
reason the game exists on MvX and nowhere else: most chains have no shards to cross.
If we cannot make the crossing real, we do not call them shards and we do not build it.

## Core loop

- You are Novaman, loose in shard 0's maze. Eat the sparks, dodge the ghosts.
- Clear a shard's sparks to **light** it. Lit shards fill the Supernova meter.
- **Bridges** (the classic Pac-Man side-tunnels) connect the three shard-mazes. Take
  one and you hop shards for real.
- Grab a **Nova Core** (the power pellet) to turn the ghosts edible for a few seconds.
- Light all three shards to trigger the **Supernova** finale.

## The shard mechanic — the star of the show

- **Three mazes, one per execution shard, each its own contract.** Not one maze in
  three colors. Three boards on three shards.
- **The bridges are real cross-shard txs.** Take a bridge and a relayed cross-shard
  message fires; you surface in the next shard's maze when it lands. On the transit,
  Novaman streaks along a bridge of light while the finality clock ticks, then drops
  into the next board. The pause is not a fake spinner. It is the network actually
  moving you.
- **The hop is a live throughput flex.** On Supernova's sub-second finality that
  crossing is near-instant, and the game clocks it: *"crossed shards in 420ms."* Every
  warp is a benchmark you can feel, not a number on a slide. (Same cross-shard rig
  Shard Hydra already runs, so the plumbing exists.)
- **Within a shard, play is smooth and client-side.** Pac-Man twitch stays twitchy.
  The chain shows up at the crossings and in the score, and nowhere it would hurt the
  fun. Chain invisible by default.

## Why the shards matter to play (not just to lore)

- A bridge is your **escape hatch**: flee a ghost by hopping shards and the hop buys
  you a beat. But you have to come back, because you must light all three to win, so
  you cannot just camp one safe maze.
- Each shard can carry its **own hazard or ghost temperament**, so the three boards
  feel distinct instead of reskinned.
- The Supernova meter rewards keeping all three in play. Clearing one too early strands
  you. There is a rhythm to which shard you push and when.

## Uncheatable scoring

- Score is an **onchain tally of the events that matter**: ghosts eaten, shards lit,
  bridges crossed. Not a client-claimed number.
- Each is **pace-gated by the contract**, the same anti-cheat as Degen Dash's grabs and
  Snakanova's travel-time eats. You cannot be on shard 2 without the bridge tx that put
  you there, and you cannot clear a maze faster than it is physically walkable.
- Eating individual sparks stays **local** (far too fast to relay). The sparks are the
  feel; the tallied events are the truth. This is the arcade's standard split: the game
  is smooth, the score is chain-true.

## Provably fair board — the Snakanova through-line

- Every run's three mazes and the ghost patrol paths are derived from a **VRF seed**,
  deterministically. Unlearnable, un-riggable, reproducible. Same fairness story as
  Snakanova's obstacles, now across three boards.
- Nobody, us included, knows the layout before the seed drops. The seed is onchain, so
  anyone can replay the exact run and confirm the ghosts and walls were never moved.

## The Supernova finale

- Light all three shards and the network **goes supernova**: the three cleared mazes
  converge into one burst, the run seals onchain, and you get a Supernova score card to
  share (the existing `/api/og` card pipeline).
- This is the campaign tie-in. Clearing the network *is* igniting the Supernova, and the
  finish lands on the Sep 10 story without a word of marketing copy inside the game.

## Ghosts and power mode

- Four ghosts, a straight Pac-Man homage, but **VRF-deterministic** (no rubber-band RNG).
  They patrol shard territory and pursue across bridges when provoked.
- A **Nova Core** flips them edible for a few seconds. Eating a fleeing ghost is a
  tallied onchain event, and chasing one across a bridge is the high-stakes play: commit
  to the hop, or let it go.

## Multiplayer (backburner — matches your slither note)

- **Co-op:** three players, one per shard, race to light your own board. The network goes
  supernova only when all three are lit. A literal "we cleared the network together"
  finish.
- Or **shared-maze competitive**: multiple Novamen in one maze, ghosts hunt everyone, like
  Hydra's shared rounds.

## Build notes

- **Reuses:** Shard Hydra's cross-shard settlement rig, the cabinet kit, arcade-core
  `sendAction` (signed Relayed-v3), the passport identity, the share-card pipeline, the
  VRF-seed pattern from Snakanova/Wen Moon.
- **New work:** maze generation from the seed, deterministic ghost AI, the three-shard
  contract layout, the bridge/warp flow, the Supernova finale sequence.
- **Size:** high — the biggest lift on the slate (real-time maze + ghost AI + genuine
  cross-shard flow). But the two hardest pieces, cross-shard and provable fairness, are
  already built and proven in live games.

## Where I want your steer

1. **Bridges are cross-shard for real. Should within-shard play stay purely local until a
   bridge (my lean: yes, cleanest and most playable), or do you want more of the maze to
   touch chain state?**
2. **Headline score: ghosts, shards lit, or bridges crossed as the number that ranks you,
   or a single blended nova-score?**
3. **Solo-first, or design the co-op "light the network together" mode in from day one?**
