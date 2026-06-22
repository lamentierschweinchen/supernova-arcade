# Degen Dash (runner) — handoff to the Arcade coordinator

**What:** the *true* Degen Dash — a one-tap, gasless, fully-onchain **side-scrolling auto-runner**. The world scrolls toward a running cosmonaut and the crypto feed flies past in 3 lanes; tap a good item to grab it (+score), leave the bad (mis-tap = penalty). It replaces the current `/degen-dash` **falling-tapper** (whose feel moves to Clawback's Guardian mode, per the coordinator backlog).

**Branch:** `feat/degen-dash-runner` (supernova-arcade repo). Built in an isolated folder, nothing live touched. Not pushed.

**Status:** built + verified offline (practice mode, all frames). Contract still UNDEPLOYED. Not announced. Awaiting your review + deploy.

---

## The one rule it keeps (uncheatable)
Score = the contract's tally of **real onchain grabs**, never distance or time. Each grab is one real gasless `collect(roundId, itemId)` tx; the contract referees it against the **real block timestamp** (good item in-window = +amount, bad item = −amount penalty), seeds every round from block randomness, and computes the final. Bots welcome — a bot just sends more real grabs. This is unchanged: the contract is the referee.

## What's new vs the live cabinet (scope)
**Only the presentation.** `index.html` was rewritten from a vertical falling-tapper into a side-scroller:
- side-scroll motion + parallax (far/mid block-skyline = "the chain", scrolling track, drifting motes) over the shared galaxy backdrop,
- a running cosmonaut (SVG, leg-cycle + bob; hops on a good grab, stumbles on a bad one),
- 15 crisp inline-SVG item glyphs (EGLD, green/red candle, airdrop, NFT, staking yield, 100x, blue chip, bridge / rug, hack, gas spike, MEV sandwich, honeypot, exit liquidity) — color-coded mint=good, coral=bad, lavender=jackpot, amber=about-to-slip,
- the grab loop (tap an item → `collect`, runner reacts, score/float/audio/haptics).

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
   ITEMS=180 PEM=.wallets/deployer.pem ./scripts/deploy-testnet.sh
   ```
   - `ITEMS=180` (≈3/sec, ramped) reads cleanly as a single-runner stream. The contract default is 440 (~7.3/sec) which still works but plays *busy* for a runner — 180 is the intended feel. Round 60s, catch window 8s, good 72% are fine as defaults.
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
Headless/background browsers pause `requestAnimationFrame`, so the loop won't advance unless the tab is foreground. For a deterministic frame, append **`?dbg`** to the URL — it exposes a small `window.__dd` hook (inert without the flag). Example to render a mid-game frame:
```js
const D = window.__dd;
D.beginRound({ seed: 123n, startMs: Date.now(), roundId: 0 });
const E = 15000, slipped = D.G.schedule.filter(o => o.spawnMs <= E - D.G.travelMs).length;
D.G.spawnSeq = slipped; D.G.nextIdx = slipped; D.G.startMs = Date.now() - E; D.tick();
```
The `?dbg` hook is gated behind the query param and ships harmlessly; remove the `if (location.search.includes("dbg"))` block before final if you prefer a pristine file.

## Notes / open calls for you
- **Density** is the one taste call: 180 vs the 440 default (see deploy step 1). Easy to tune live later via `configureDifficulty` (ramp) without redeploy, but `items` is deploy-time.
- Item humor lives in the icons + names (name shows on hover/`title`); per-item text labels were dropped because they smear at speed. Say the word if you want the labels back on big jackpots.
- Accent is warm amber (`--c:#FFD23F`, shard 0) to match the hub cabinet; good=mint, bad=coral, jackpot=lavender.
