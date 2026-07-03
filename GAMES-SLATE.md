# Supernova Arcade — next games slate

The arcade's rule: every game is **uncheatable** (score = a contract tally of real
gasless onchain actions), the chain is **invisible by default**, one **passport** is
your identity everywhere, and the best games make an MvX feature *load-bearing to the
fun* — not a bolted-on tally.

What's already showcased: speed/finality (Sprint), shards (Canvas/Triptych), cross-shard
(Shard Hydra), guardians/2FA (Clawback), VRF fairness (Wen Moon), uncheatable endless
tally (Degen Dash), shared rounds (Tug-of-War, Button, Reaction).

Gaps worth filling: **commit-reveal fairness** (the chain proving it didn't cheat you),
**ESDT rewards** (earn a real token), **NFT minting** (a trophy of your run), and
**cross-shard as a felt mechanic** rather than a label.

---

## Tier A — the onchain part makes the game genuinely BETTER

These are the "makes sense on MvX" picks: the blockchain solves a real problem the genre
has always had, so it's not a gimmick.

### 1. Fair Sweeper (Minesweeper) — the strongest onchain-native pick
Classic minesweeper's whole anxiety is "did the mine move after I clicked?" Onchain
**commit-reveal** kills it dead: the contract commits to a hashed mine layout (VRF-seeded)
*before* you touch the board, and reveals the seed at the end so anyone can verify the
mines never moved. Provably fair, both ways — you can't peek, it can't cheat.
- **MvX feature:** commit-reveal + VRF. A genuine trust win, not a tally.
- **Uncheatable:** each reveal is a relayed tx; the board is contract-authoritative.
- **Hook line:** "The only minesweeper that can prove it didn't cheat."
- **Build:** medium. New mechanic (commit-reveal), but small board, low tx rate.

### 2. Fair Stack (Tetris) — provably-fair randomizer
Competitive Tetris players obsess over "bag" fairness (is the piece sequence rigged?).
VRF makes the sequence **provably fair and verifiable** — the seed is onchain, the whole
piece order is reproducible. Lines cleared = the uncheatable tally.
- **MvX feature:** VRF fairness that players *actually care about*.
- **Uncheatable:** lines-cleared tally onchain; sequence derived from the onchain seed.
- **Build:** medium-high (real-time Tetris client), but the contract side is light.

### 3. Shard Chomp (Pac-Man) — cross-shard as a mechanic *(you asked for this)*
The maze is split into three **shard-colored zones**. Ghosts are deterministic from a VRF
maze seed. The twist: after a power pellet, chasing a fleeing ghost across a **shard
border** is a real **cross-shard transaction** — you watch it resolve in ~6s, the same
settlement Shard Hydra uses. You *feel* the shards instead of reading a label. Optional
shared-maze multiplayer (multiple pac-men, ghosts hunt everyone) like Hydra.
- **MvX feature:** 3 shards + cross-shard latency turned into a chase mechanic + VRF ghosts.
- **Uncheatable:** power-pellet chomps + ghost-eats are the onchain tally (pace-gated, so
  no spamming — same anti-cheat as Degen Dash's grabs).
- **Why it "makes sense on MvX":** most chains have no shards to cross. This is a game only
  MvX can host honestly.
- **Build:** high (maze + ghost AI + cross-shard flow), but reuses Hydra's cross-shard rig.

---

## Tier B — great classics with a clean, honest hook

### 4. Finality Flippers (Pinball) — VRF playfield + a real reward *(you asked for this)*
Every ball drops onto a **VRF-generated playfield** (bumpers/targets/jackpot laid out
fresh each game — provably not rigged, no two games alike). Bumper hits are the
uncheatable tally. The standout: hitting the **multiball jackpot mints a NOVA ESDT (or an
NFT trophy) straight to your passport** — a real, keepable reward for a skill shot.
- **MvX feature:** VRF (fair layout) + **ESDT/NFT minting** (a feature no arcade game shows
  yet — you walk away *owning* something).
- **Distinct from Wen Moon:** there the payout is pure chance; here the score is skill and
  VRF only guarantees the table is fair.
- **Build:** high (pinball physics is the hard part), contract side is light.

### 5. Shard Snake — wrap across the shards
Classic snake, but the board **wraps across shards**: slither off shard 0's right edge and
you enter shard 1's left edge. The pellets are **real ESDT tokens** you collect (length =
tokens eaten, onchain). Simple, instantly readable, shows shards + ESDT with almost no
new UI.
- **MvX feature:** shards (as a wrap-around board) + ESDT pellets.
- **Uncheatable:** length = onchain-confirmed eats.
- **Build:** low-medium. Good "fast win" to ship between the big ones.

### 6. Fair Break (Breakout) — co-op shared wall
VRF brick layout, gasless power-ups that feel free (relayed, instant), and a **co-op mode
where several players share one wall** (shared state, like Canvas/Hydra) — you clear it
together, the tally is per-player bricks broken.
- **MvX feature:** shared state + speed (gasless power-ups) + VRF layout.
- **Build:** medium.

---

## Backburner
- **Slither (team snake).** A slither.io-style shared board where many snakes play at
  once. This is the natural home for making "shards" REAL: split the shared board
  across the three execution shards (players genuinely on different shards, one board
  per shard aggregated like Shard Hydra / Three-Shard Canvas), so crossing a zone is a
  felt cross-shard move and the team fills the whole network. Merges the "real shards"
  fix for Shard Snake with a team game. Bigger lift (shared-state + 3 contracts).
- **Shard Snake, earning its name.** v1 shards are cosmetic (3 colored zones + wrap).
  Options to make them load-bearing: a seed-derived cross-shard combo (eat one pellet
  of each shard color in a row for a bonus, one contract), or the full tri-shard board
  above. Otherwise rename (Nova Snake / Onchain Snake).

## Also considered (parked)
- **Frogger** (each lane a shard, crossing = shard hops) — fun but overlaps Shard Chomp's
  cross-shard hook.
- **Simon / memory** (VRF sequence) — overlaps Fair Stack's VRF angle, thinner.
- **Asteroids / Space shooter** (VRF field) — high tx frequency, weaker onchain hook.
- **Whack-a-mole** (moles on shards) — too close to Reaction Arcade.

## Recommended build order
1. **Shard Snake** first — low effort, ships fast, proves the ESDT-pellet + shard-wrap
   pattern that Chomp will reuse.
2. **Fair Sweeper** — the cleanest "onchain makes it better" story; great for a "why
   blockchain" narrative beat.
3. **Shard Chomp (Pac-Man)** — the flagship; reuses Hydra's cross-shard rig + Snake's ESDT.
4. **Finality Flippers (Pinball)** — headline the first ESDT/NFT-reward game.
5. Fair Stack + Fair Break as the fun-classics fill.

Each follows the existing cabinet standard (Rust contract + relayed txs + `arcade-core.js`
client + the shared cabinet UI). Worth doing the `createCabinetKit` extraction from
HARDENING.md *before* #3-#6 so new cabinets are ~100 lines, not ~500.
