# Adding a Supernova Arcade game — playbook

The repeatable path, and the traps that already cost us. Follow the steps; heed the gotchas.

## The stack every game needs

1. **Contract** (Rust, testnet). Storage: a `players` set, `<scoreMapper>`+address → u64 score, `handle`+address → name. Emit the standard `arcadeAction(game, player, actions, new_total)` event. Expose `getGlobalActions` (hub odometer), `getPlayerEntry`, and a `setHandle` endpoint. You do **not** need a gas-heavy `getTop*` view for the UI — the off-chain board reads storage directly (step 3). Deploy via the relayer (owner = relayer).

2. **Relay** (`src/app/api/relay/route.ts` + `src/lib/onchain/arcade.config.ts`). Add the game's action functions + `setHandle` to `RELAY_OPS` (allowed receivers + a per-op gas cap), and the contract to `ARCADE_RECEIVERS`.

3. **Off-chain leaderboard** (`src/app/api/leaderboard/route.ts`). Add one line to `GAME_BOARDS`: `{ contract, scoreMapper }`. Done — `/api/leaderboard?game=<id>` now serves the full sorted board (score + handle) parsed from storage, cached, with no gas limit. Scales to any player count.

4. **Client** (sign for real). Use `arcade-core.js` `createArcadeClient(id)` (simple cabinets: tug/canvas/button/reaction) or a per-game `arcade.js` `createArcade(config)` (richer games: degen-dash/wen-moon/clawback). Both do byte-correct Relayed-v3 signing with the shared passport key and POST `{ transaction }`. **Never** roll an inline `fetch` that posts `{game, endpoint, args}` — the relay only accepts a *signed* transaction.

5. **Leaderboard UI** (`arcade-board.js`). `import { fetchGameBoard, topPlusSelf, BOARD_GAP } from "/arcade-board.js"`. Render `topPlusSelf(await fetchGameBoard(id), client.address, 10)` → top-10 + a pinned "you" row when the player is below the cut. Identical behavior in every game.

6. **Handle** (passport). Pre-fill the name input from `getHandle()` (`/passport.js`) on load, so a returning player just hits submit (and registers once on the new game's contract). One identity across all cabinets — don't invent a per-game handle key.

7. **Hub** (`public/arcade.html`). Add the game's entry to `CABINETS`. The living odometer reads `getGlobalActions`.

8. **Routing**. `vercel.json` rewrite (`/<pretty>` → `/shell.html`) + `shell.html` `GAME_FILE`/`GAME_PRETTY` maps + `arcade-bridge.js` `gameFromPath`.

9. **Sound**. Ping the music instance to add a game sound to the arcade live-score engine (it can't be driven from a build session).

10. **Ship + verify**. `vercel --prod` then `git push`. Verify: `/api/leaderboard?game=<id>` returns the board; a smoke test signs → fires an action → the score lands (on `getPlayerEntry` / the board); the page loads with no console errors.

## Gotchas (already paid for)

- **The relay rejects anything unsigned.** It reads `body.transaction` and requires `tx.signature`. Posting intent never signs → the game silently falls to "practice" → no onchain scores. (Wen Moon shipped broken this exact way.)
- **The onchain `getTop*` views OOM past ~120 players.** They sort every player on each read and run out of query gas (tug-of-war at 242 and canvas at 145 both went dead). Always read the board off-chain via the service — never call the onchain top-N view from the UI.
- **Supernova block timestamps are MILLISECONDS, not seconds.** Size time-window constants ×1000.
- **Address form differs by page.** `decodeLeaderboard` returns bech32 on a game page (crypto libs loaded) but hex on the hub (no libs). The off-chain service always returns bech32 — match the player accordingly.
- **A handle only appears after the player claims one** (post-score). Unclaimed players show as their address; that's expected.
- **A new deploy can briefly serve a stale edge-cached HTML.** Cache-bust when verifying immediately after deploy.
