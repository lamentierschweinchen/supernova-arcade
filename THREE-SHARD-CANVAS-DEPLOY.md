# Three-Shard Canvas (the Triptych) — coordinator deploy note

Built and verified on branch `audio/lite-engine`. **Not deployed, not shipped** — the
two wing contracts and the prod ship are yours. Everything below is wired against
the undeployed placeholder, so the build is safe to ship in stages: the center is
live now, the wings light up the moment you deploy them and fill in two addresses.

## What this is

The single Supernova Canvas evolved into an **opened triptych**: a wide 32×32 center
board flanked by two 16×32 wings, one board per shard, painting in parallel. The
center is the existing canvas (data preserved); the wings are two new deploys.

## IMPORTANT — shard mapping correction

The spec narrative assumed the center was on **shard 1**. Verified against the chain,
the existing canvas (`erd1qqq…g93s3t`) is on **shard 0** (it was deployed from the
shard-0 relayer). To keep one board per shard AND preserve the center's ~24k pixels,
the truthful mapping (confirmed with Lukas) is:

| Panel (left→right) | Shard | Contract | Deploy |
|---|---|---|---|
| Wing | **1** | new 16×32 | `hydra-shard-1.pem` |
| Center | **0** | existing `erd1qqq…g93s3t` (unchanged) | — |
| Wing | **2** | new 16×32 | `hydra-shard-2.pem` |

Labels read `1 · 0 · 2`. Tint follows role, not number: center = teal hero, wings =
blue (s1) / lavender (s2).

## 1. Deploy the two wings (the only step I couldn't do)

The contract is parameterized to WIDTH×HEIGHT and **already built at 16×32**
(`marketing/games/onchain/canvas-contract`, `getDims` view added, 7/7 blackbox tests
green). A reproducible deploy script is in place. From `canvas-contract/`:

```bash
# (artifacts already built; rebuild only if you change src) sc-meta all build
PEM=../.wallets/hydra-shard-1.pem SHARD=1 ./scripts/deploy-wing-testnet.sh
PEM=../.wallets/hydra-shard-2.pem SHARD=2 ./scripts/deploy-wing-testnet.sh
```

Both deployer wallets are funded (~0.96 xEGLD each). Init writes the 512-byte board;
the script uses 100M gas (the 32×32 center needed ~100M; 30M failed). Each run prints
the contract address and writes `scripts/deploy-wing-shard{1,2}.testnet.json`.

**Smoke each** (one placePixel, confirm `getGlobalActions` ticks):
```bash
mxpy contract call <WING_ADDR> --pem ../.wallets/hydra-shard-1.pem \
  --proxy https://testnet-gateway.multiversx.com --chain T --gas-limit 15000000 \
  --function placePixel --arguments 0 2 --send --wait-result
```

## 2. Wire the two addresses (two places, same address each)

**a) Relayer env (Vercel) + server config** — `src/lib/onchain/arcade.config.ts` reads:
```
NEXT_PUBLIC_CANVAS_SHARD1_CONTRACT = <shard-1 wing address>
NEXT_PUBLIC_CANVAS_SHARD2_CONTRACT = <shard-2 wing address>
```
These already feed: the relay `placePixel`/`setHandle` receivers, the leaderboard
aggregation, and the daily board. No code change needed — just set the env.

**b) Client registry (static HTML can't read env)** — `public/arcade-core.js`,
`GAMES.triptych.boards`: replace the two `UNDEPLOYED_PLACEHOLDER` entries
(boards[0] = shard 1, boards[2] = shard 2) with the deployed addresses. This also
lights up the hub odometer (shell COUNTERS + arcade.html sum already reference them).

Until both are set per wing, that wing paints locally ("warming up"); the center is
fully live throughout.

## 3. Ship (yours)

`vercel --prod` then `git push`. Cache-bust when verifying (a fresh deploy can serve
stale edge HTML). Route: `/three-shard-canvas`.

## Optional — sound voice

The cabinet already raises the shared soundtrack bed (shell `COUNTERS`, id `triptych`,
wings only — the center is counted via `canvas`) and fires the fallback coin stinger.
For a bespoke voice, ping the music instance to add `triptych` to `arcade-score.js`
(`GAME_VOICES` etc.). Not required.

## Verification done (local)

- `tsc --noEmit` clean; `npm test` 5/5; contract `cargo test` 7/7; eslint 0 errors.
- Desktop + mobile render clean, no console errors. Center loads the real onchain
  mural; "Pixels placed" = summed `getGlobalActions` (25,948, center-only pre-deploy).
- Mobile layout per Lukas: center on top, two wings below clearly separated, a
  shard-nav strip to switch boards.
- `/api/leaderboard?game=triptych` aggregates `playerPixels` across the three
  contracts (center-only until wings deploy); `?game=canvas` still works (199 painters).
- Hub: bespoke triptych cabinet art + `3 shards` badge, game count now 10.

## Files changed

**supernova-arcade repo:**
- `public/triptych.html` (new — the client)
- `public/arcade-core.js` (`GAMES.triptych`)
- `public/arcade.html` (cabinet entry + `triptych` art case + `.tri3` CSS + `readCounter` sum)
- `public/shell.html` (`GAME_FILE` / `GAME_PRETTY` / `COUNTERS`)
- `public/arcade-bridge.js` (`gameFromPath`)
- `vercel.json` (`/three-shard-canvas` rewrite)
- `src/lib/onchain/arcade.config.ts` (`CANVAS_SHARD1/2_CONTRACT`, `CANVAS_TRIPTYCH_CONTRACTS`)
- `src/app/api/relay/route.ts` (wings as `placePixel`/`setHandle` receivers; placePixel rate 240→600)
- `src/app/api/leaderboard/route.ts` (`triptych` aggregated board + wings in daily)

**marketing/games/onchain/canvas-contract (on disk, not a git repo):**
- `src/lib.rs` (GRID → WIDTH×HEIGHT, set 16×32; `getDims` view)
- `src/canvas_proxy.rs`, `output/*` (regenerated for `getDims`, 16×32)
- `tests/canvas_blackbox_test.rs` (parameterization-aware, `getDims` check)
- `scripts/deploy-wing-testnet.sh` (new)

Front/back (the hidden outer faces) stays parked for v2 (needs a fold mechanism).
