# Degen Dash (lane runner) — handoff to the Arcade coordinator

**What:** the *true* Degen Dash — a gasless, fully-onchain **endless lane runner** (Subway Surfers / Temple Run feel). You run a track into the screen as an astronaut (back to camera); the crypto feed rushes toward you down 3 lanes in perspective, growing as it nears. **Swipe between lanes** (or tap a side / arrow keys): a good item that reaches your lane auto-grabs (+score, one real tx), and you dodge the bad by steering out of their lane. It replaces the current `/degen-dash` falling-tapper (whose feel moves to Clawback's Guardian mode, per the coordinator backlog).

**Branch:** `feat/degen-dash-runner` (supernova-arcade repo). Built in an isolated folder, nothing live touched. Not pushed.

**Status:** built + verified offline (practice mode, real play runs end-to-end). Contract still UNDEPLOYED. Not announced. Awaiting your review + deploy.

---

## The one rule it keeps (uncheatable)
Score = the contract's tally of **real onchain grabs**, never distance or time. Every item that reaches your lane auto-fires one real gasless `collect(roundId, itemId)` tx; the contract referees it against the **real block timestamp** (good item in-window = +amount, bad item = −amount penalty), seeds every round from block randomness, and computes the final. Items in other lanes pass by and fire nothing (a good one is a missed win, a bad one is dodged). Bots welcome — a bot just sends more real grabs. The contract is the referee; this is unchanged.

## What's new vs the live cabinet (scope)
**Only the presentation.** `index.html` was rewritten from a vertical falling-tapper into a perspective lane runner:
- a perspective track that converges to a vanishing point, 3 lanes, rushing "sleeper" rungs + speed streaks for the sense of forward motion, over the shared galaxy backdrop,
- an astronaut (SVG, back view, leg-cycle + bob) that runs away down the track and **steers between the 3 lanes** (swipe / tap a side / arrow keys), with a glow pad marking its lane; it hops on a grab, stumbles on a hit,
- items spawn small at the vanishing point and **rush toward the camera growing in scale** down their lane; 15 crisp inline-SVG glyphs (EGLD, green/red candle, airdrop, NFT, staking yield, 100x, blue chip, bridge / rug, hack, gas spike, MEV sandwich, honeypot, exit liquidity), color-coded mint=good, coral=bad, lavender=jackpot, amber=about-to-pass,
- the grab loop (an item reaching your lane auto-fires `collect`, astronaut reacts, score/float/audio/haptics).

**Reused byte-for-byte (do not re-review):** `arcade.js`, `arcade.config.js`, `schedule.js` are verbatim copies of `public/degen-dash/`'s files, and the Rust contract at `marketing/games/degen-dash/contract/` is unchanged. The client mirrors the deployed `getScheduleParams`, so it auto-adapts to whatever you deploy.

---

## Integrate (one file)
The 3 plumbing files here are identical to `public/degen-dash/`, so going live is a single swap:

```bash
cp public/degen-dash-runner/index.html public/degen-dash/index.html
# (then the degen-dash-runner/ folder can be deleted — it was just the isolated dev copy)
```

Everything else about the `degendash` cabinet (hub registration, relayer, OG) stays as-is. Preserve the old `public/degen-dash/index.html` (the falling-tapper) for whoever builds Clawback's Guardian mode.

## Deploy (same flow as the other cabinets)
The cabinet runs in **practice mode** until the contract is deployed and `GAMES.degendash.contract` is flipped off the placeholder.

1. Build + deploy the contract (shard 0), **with runner-friendly density**:
   ```bash
   cd marketing/games/degen-dash/contract && sc-meta all build
   ITEMS=110 PEM=.wallets/deployer.pem ./scripts/deploy-testnet.sh
   ```
   - `ITEMS=110` (≈1.8/sec, ramped) gives a clean, readable lane stream. The contract default is 440 (~7.3/sec) which is far too busy for a single-runner lane view. Round 60s, catch window 8s, good 72% are fine as defaults.
2. Put the printed address in `public/arcade-core.js` (`GAMES.degendash.contract`) **and** `src/lib/onchain/arcade.config.ts` (`NEXT_PUBLIC_DEGENDASH_CONTRACT`). Both must match.
3. (Optional, for `claim`) grant the contract `ESDTRoleLocalMint` on **NOVA-558b9d**, then `configureToken(NOVA-558b9d)`. Game is fully playable without this; only the end-of-round NOVA mint needs it.
4. `vercel --prod` (Lukas).

## Smoke test after deploy
- Badge flips to **Onchain · Supernova**; mode label not "practice".
- A grab fires a real tx (relayer 200s); `getGlobalActions` increments; the hub odometer picks it up.
- End of round records a score (`getFinal` > 0 after `endRound`), board row appears after `setHandle`.
- Reminder: `get_block_timestamp()` is **milliseconds** on Supernova — the contract + schedule already size every window in ms (8000 = 8s). Don't "fix" this.

---

## Verify offline yourself
Static server (practice mode needs no relayer), then open `/degen-dash-runner/`:
```bash
python3 -m http.server 8792 --directory projects/supernova-arcade/public
```
Headless/background browsers throttle `requestAnimationFrame`, so the loop may not advance unless the tab is foreground. For a deterministic frame, append **`?dbg`** to the URL — it exposes a small `window.__dd` hook (inert without the flag). Example to render a faithful mid-game frame (pre-advances lane phase past already-passed items):
```js
const D = window.__dd;
D.beginRound({ seed: 123n, startMs: Date.now(), roundId: 0 });
const E = 15000, slipped = D.G.schedule.filter(o => o.spawnMs <= E - D.G.travelMs).length;
D.G.spawnSeq = slipped; D.G.nextIdx = slipped; D.G.startMs = Date.now() - E; D.tick();
```
The `?dbg` hook is gated behind the query param and ships harmlessly; remove the `if (location.search.includes("dbg"))` block before final if you prefer a pristine file.

## Notes / open calls for you
- **Density** is the main taste call: 110 vs the 440 default (see deploy step 1). `items` is deploy-time; the ramp is tunable live via `configureDifficulty` without redeploy.
- **Controls** are swipe / tap-a-side / arrow keys to switch lanes; the astronaut auto-grabs whatever reaches its lane (good +, bad −), and items in other lanes pass with no tx. This keeps the genre feel while staying one-real-tx-per-grab. The grab window is the front of the track (`GRAB_T`), tunable in `index.html`.
- Item humor lives in the icons + names (name shows on hover/`title`); per-item text labels are dropped because they smear at speed and clutter the perspective.
- Accent is warm amber (`--c:#FFD23F`, shard 0) to match the hub cabinet; good=mint, bad=coral, jackpot=lavender.
