# Degen Dash (endless lane runner) — handoff to the Arcade coordinator

**What:** the *true* Degen Dash — a gasless, fully-onchain **endless lane runner** (Subway Surfers / Temple Run feel). You run a track into the screen as an astronaut; the crypto feed rushes toward you down 3 perspective lanes. **Swipe** L/R to switch lanes, **up** to jump, **down** to duck (tap = jump; arrow keys / WASD too). Mint **coins** that reach your lane auto-grab (+score, one real onchain tx). Red **hazards** must be dodged — switch out of a wall's lane, jump the low ones (gas spike, red candle), duck the high ones (MEV sandwich, honeypot). Hit one and **the run ends; your score saves onchain; you restart.** It speeds up the longer you last. Replaces the current `/degen-dash` falling-tapper (whose feel moves to Clawback's Guardian mode).

**Branch:** `feat/degen-dash-runner` (supernova-arcade repo). Isolated folder, nothing live touched. Not pushed.

**Status:** built + verified offline. **Contract has ONE small change** (see below) — rebuilt, 17/17 blackbox tests pass — and is still UNDEPLOYED. Not announced. Awaiting review + deploy.

---

## The cornerstone (unchanged): score = real onchain grabs
Score is the contract's tally of **real onchain grabs**, never distance or time. Each coin that reaches your lane auto-fires one real gasless `collect(roundId, itemId)` tx; the contract referees it by the real block timestamp. Coins in other lanes fire nothing. The **survival layer (obstacles, jump, duck, death) is client-side and does NOT score** — the chain can't referee dodging and needn't; death only gates *how long you keep grabbing*. Crash early → you stop grabbing → score frozen at your real grabs. Nothing to fake; bots welcome.

## The contract change (small + tested)
To make "die → save → restart" work, `end_round` no longer requires the round timer to fully elapse — it now finalizes **the moment the run ends (on death)**. That's the whole change (one removed `require!`). It's safe: ending only *stops collecting*, so it can only lower your own potential score, never inflate it (no early-exit exploit; the per-item collect window is unchanged). Source: `marketing/games/degen-dash/contract/src/lib.rs`. Rebuilt (`output/degen-dash.wasm`), and the blackbox suite passes including a new `early_end_banks_what_you_collected` (die mid-run → score recorded + banked). **This means the contract must be re-deployed** (it was never deployed, so it's a first deploy).

Everything else is reused **byte-for-byte**: `arcade.js`, `arcade.config.js`, `schedule.js` (verbatim copies of `public/degen-dash/`). The client mirrors the deployed `getScheduleParams`.

## Two modes
- **PRACTICE** (no contract configured — current state): truly **endless**, die-to-end, no time cap, coins generated locally, ramping. This is what you play pre-deploy.
- **ONCHAIN** (deployed contract + relayer): coins are the contract's seeded schedule; grabs are real gasless txs; on death the run finalizes immediately (a one-confirm "saving your run onchain" beat, like any tx). Set the round long so a long survivor never runs out of coins.

---

## Integrate (one file)
The 3 web plumbing files here are identical to `public/degen-dash/`, so the web side is a single swap:
```bash
cp public/degen-dash-runner/index.html public/degen-dash/index.html
# preserve the OLD public/degen-dash/index.html first (the falling-tapper, for Clawback Guardian mode)
# then the degen-dash-runner/ dev folder can be removed.
```

## Deploy
1. Build + deploy the contract (shard 0), long round + mostly-good coins:
   ```bash
   cd marketing/games/degen-dash/contract && sc-meta all build
   ROUND_LENGTH_MS=180000 ITEMS=340 GOOD_PERMIL=990 PEM=.wallets/deployer.pem ./scripts/deploy-testnet.sh
   ```
   - `GOOD_PERMIL=990` ≈ all coins are wins (hazards are the client challenge, not bad coins). `ITEMS=340` over 180s ≈ ~1.9 coins/sec so even a 2–3 min survivor keeps grabbing. Long round is fine now that death finalizes instantly.
2. Put the printed address in `public/arcade-core.js` (`GAMES.degendash.contract`) **and** `src/lib/onchain/arcade.config.ts` (`NEXT_PUBLIC_DEGENDASH_CONTRACT`). Both must match.
3. (Optional, for `claim`) grant the contract `ESDTRoleLocalMint` on **NOVA-558b9d**, then `configureToken(NOVA-558b9d)`.
4. `vercel --prod` (Lukas).

## Smoke test after deploy
- Badge flips to **Onchain · Supernova**.
- Steering a coin into your lane fires a real tx → `getGlobalActions` increments → hub odometer moves.
- Dying records `getFinal` > 0 promptly (no wait); `setHandle` lands a board row; a second run starts clean.
- `get_block_timestamp()` is **milliseconds** on Supernova — the contract/schedule already use ms. Don't change.

## Verify offline yourself
```bash
python3 -m http.server 8792 --directory projects/supernova-arcade/public   # web (practice = endless)
cd marketing/games/degen-dash/contract && sc-meta all build && cargo test    # contract (17 tests)
```
Open `/degen-dash-runner/`. Headless/background browsers throttle `requestAnimationFrame`; for deterministic frames append **`?dbg`** (exposes `window.__dd`: `beginRound`, `tick`, `jump`, `duck`, `moveLane`, `spawnObstacle`, …; inert without the flag). Step the sim with a 60ms-frame loop. Remove the `if (location.search.includes("dbg"))` block before final if you want a pristine file.

## Notes / knobs
- **Controls:** swipe L/R = lanes, up = jump, down = duck, tap = jump; ArrowKeys / WASD too. Tunables in `index.html`: `JUMP_MS`/`JUMP_H`/`DUCK_MS`, `RAMP_FULL_MS` (how fast it gets hard), `GRAB_T`/`HIT_T` (resolve depth), spawn gaps in `rampUpdate`.
- **Hazards are themed bad-crypto** (rug/hack = wall, gas/red-candle = jump, MEV/honeypot = duck); coins are good-crypto (EGLD, candle, airdrop, NFT, yield, 100x, blue chip, bridge). Names on hover/`title`.
- Accent warm amber (`--c:#FFD23F`, shard 0); coins mint, jackpots lavender, hazards coral.
- Truly-infinite onchain (unbounded coins past the round span) is still possible as a later change, but isn't needed: a long round + die-to-end already plays endless. Flag it if you want it.
