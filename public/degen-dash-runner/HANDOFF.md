# Degen Dash (endless lane runner) — handoff to the Arcade coordinator

**What:** the *true* Degen Dash — a gasless, fully-onchain **endless lane runner** (Subway Surfers / Temple Run feel). You run a track into the screen as an astronaut; the crypto feed rushes toward you down 3 perspective lanes. **Swipe** L/R to switch lanes, **up** to jump, **down** to duck (tap = jump; arrow keys too). Mint **coins** that reach your lane auto-grab (+score, one real onchain tx). Red **hazards** must be dodged — switch out of a wall's lane, jump the low ones (gas spike, red candle), duck the high ones (MEV sandwich, honeypot). Hit one and the run ends. It speeds up and thickens the longer you last. Replaces the current `/degen-dash` falling-tapper (whose feel moves to Clawback's Guardian mode).

**Branch:** `feat/degen-dash-runner` (supernova-arcade repo). Isolated folder, nothing live touched. Not pushed.

**Status:** built + verified offline (perspective frames, coin auto-grab, all dodge/death rules, the wrecked screen). Contract still UNDEPLOYED. Not announced. Awaiting your review + deploy.

---

## The cornerstone (unchanged): score = real onchain grabs
Score is the contract's tally of **real onchain grabs**, never distance or time. Each coin that reaches your lane auto-fires one real gasless `collect(roundId, itemId)` tx; the contract referees it by the real block timestamp and computes the final. Coins in other lanes fire nothing.

The **survival layer (obstacles, jump, duck, death) is client-side and does NOT score.** The chain can't referee dodging (not crashing isn't a transaction), and it doesn't need to: death only gates *how long you keep grabbing*. Crash early → you stop grabbing → your onchain score freezes at the real grabs you made. There's nothing to fake (to score you must send real grab txs), and bots are still welcome (a bot ignores obstacles and grabs). This is the only honest way to add obstacles/death without weakening the uncheatable score — and it's consistent with the "score = grabs, not distance" rule.

## Two modes
- **PRACTICE** (no contract configured — current state): truly **endless**, die-to-end, no time cap. Coins generated locally, ramping. This is what you see/play pre-deploy.
- **ONCHAIN** (deployed contract + relayer): coins are the contract's seeded schedule **within the deployed round**; grabs are real gasless txs; obstacles + death ride on top. Capped at the round length (see the one caveat below).

## What's new vs the live cabinet (scope)
**Only the presentation + the client survival layer.** `index.html`: perspective track (vanishing point, 3 lanes, rushing rungs + speed streaks), an astronaut (back view) that steers lanes + jumps + ducks + dies, coins that rush+grow and auto-grab, client-side hazards (wall/jump/duck) with on-barrier hints, a difficulty ramp, and the WRECKED/run-again flow. **Reused byte-for-byte:** `arcade.js`, `arcade.config.js`, `schedule.js` (verbatim copies of `public/degen-dash/`) and the Rust contract at `marketing/games/degen-dash/contract/` — unchanged. The client mirrors the deployed `getScheduleParams`.

---

## Integrate (one file)
The 3 plumbing files here are identical to `public/degen-dash/`, so going live is a single swap:
```bash
cp public/degen-dash-runner/index.html public/degen-dash/index.html
# preserve the OLD public/degen-dash/index.html first (the falling-tapper, for Clawback Guardian mode)
# then the degen-dash-runner/ dev folder can be removed.
```

## Deploy
The cabinet runs in **practice mode** (endless) until the contract is deployed and `GAMES.degendash.contract` is flipped off the placeholder.
1. Build + deploy (shard 0). Coins are wins, so deploy almost-all-good with a runner-friendly density:
   ```bash
   cd marketing/games/degen-dash/contract && sc-meta all build
   ROUND_LENGTH_MS=60000 ITEMS=115 GOOD_PERMIL=990 PEM=.wallets/deployer.pem ./scripts/deploy-testnet.sh
   ```
   - `GOOD_PERMIL=990` ≈ all coins are wins (hazards are the client-side challenge, not bad coins). `ITEMS=115` over 60s ≈ ~1.9 coins/sec. Keep `ROUND_LENGTH_MS=60000` short — see the caveat.
2. Put the printed address in `public/arcade-core.js` (`GAMES.degendash.contract`) **and** `src/lib/onchain/arcade.config.ts` (`NEXT_PUBLIC_DEGENDASH_CONTRACT`). Both must match.
3. (Optional, for `claim`) grant the contract `ESDTRoleLocalMint` on **NOVA-558b9d**, then `configureToken(NOVA-558b9d)`.
4. `vercel --prod` (Lukas).

## The one caveat (onchain death finalize)
The contract finalizes a round (`endRound`) **only after the round's length elapses** — it can't finalize early. So in ONCHAIN mode, when you die, the score shows instantly but the *onchain record* (leaderboard + claimable) locks at the round's natural end: the death screen shows a short "locking your score onchain…" wait, bounded by the remaining round time. That's why the recommended onchain round is short (60s) — it keeps that wait small (and the ramp clusters most deaths late, so it's usually a few seconds). **Practice mode has no such wait** (instant restart). The clean fix (finalize-on-death instantly + truly-infinite onchain) is the small contract change we deferred; flag it if you want me to do it.

## Smoke test after deploy
- Badge flips to **Onchain · Supernova**.
- Steering a coin into your lane fires a real tx → `getGlobalActions` increments → hub odometer moves.
- A run that ends (death or round end) records `getFinal` > 0; `setHandle` lands a board row.
- `get_block_timestamp()` is **milliseconds** on Supernova — the contract/schedule already use ms. Don't change.

## Verify offline yourself
```bash
python3 -m http.server 8792 --directory projects/supernova-arcade/public
```
Open `/degen-dash-runner/`. Headless/background browsers throttle `requestAnimationFrame`; for deterministic frames append **`?dbg`** (exposes `window.__dd` — `beginRound`, `tick`, `jump`, `duck`, `moveLane`, `spawnObstacle`, etc.; inert without the flag). Step the sim with a 60ms-frame loop (`for i: G.startMs = base - i*60; tick()`). Remove the `if (location.search.includes("dbg"))` block before final if you want a pristine file.

## Notes / open calls
- **Controls:** swipe L/R = lanes, up = jump, down = duck, tap = jump; ArrowKeys / WASD too. Tunable knobs in `index.html`: `JUMP_MS`/`JUMP_H`/`DUCK_MS` (move feel), `RAMP_FULL_MS` (how fast it gets hard), `GRAB_T`/`HIT_T` (how close coins/hazards resolve), the spawn gaps in `rampUpdate`.
- **Hazards are themed bad-crypto** (rug/hack = wall, gas-spike/red-candle = jump, MEV/honeypot = duck). Coins are good-crypto (EGLD, candle, airdrop, NFT, yield, 100x, blue chip, bridge). Names show on hover/`title`.
- Accent warm amber (`--c:#FFD23F`, shard 0); coins mint, jackpots lavender, hazards coral.
