# Supernova Arcade — hardening backlog

A pre-new-games audit (Jul 3 2026) covered the whole arcade: shared modules, hub +
cabinets, the two Sprint monoliths, the per-game dirs, and the API/config layer.
This file is the reconciled worklist. The zero-risk tier is already applied (see
"Done this pass"); everything below the line is scoped but not yet done, ordered by
value, so the next session (or the next game) starts from a known state.

## Done this pass (shipped)

- **Relay gasPrice cap** (security, was the one real drain vector): the relayer paid
  `gasLimit x gasPrice` and only `gasLimit` was capped, so a within-cap gasLimit at a
  huge gasPrice could drain it in one tx. Now pinned to the network minimum (every
  client already sends exactly that). `src/app/api/relay/route.ts`.
- **Relay prototype-key guard**: `data="__proto__"` resolved to an Object.prototype
  member and 500'd instead of a clean 400. Own-property lookup now. Same file.
- **/sprint leaderboard regression** (user-visible since Jun 29 `3379fec`): the board
  + submit were repointed to the legacy `submitScore` contract, which (a) has no
  `setHandle` and isn't relay-allowlisted, so every submit returned `wrong_receiver`,
  and (b) shows spoofable client-claimed rows (live top was "Bubu 1,234,567,890").
  Repointed both to the tap-counter's `bestScore` — the uncheatable board with 1,151
  real players. `onchain.html` + `leaderboard/route.ts`.
- **Share-card drift**: triptych / wen-moon / shard-hydra had live share buttons but
  no registry entry, so all three shared a *Sprint*-branded card. Added to
  `arcade-share.js` + `arcadeCards.ts`.
- **Broken OG images**: wen-moon pointed at a nonexistent `/og/wen-moon-og.png`;
  shard-hydra had no `og:image`. Both now use the site card. Also fixed wen-moon's
  footer repo link (was `multiversx/…`, a 404).
- **Declutter** (~660 lines): deleted dead `public/arcade.css` (zero `<link>` refs) and
  `public/arcade-concept.html` (comment-only refs); removed dead exports
  (`wireShare`, `PASSPORT_SLOTS`), the dead `PB_SOURCES`/`pbRead`/`hexToBech`/`bechToHex`
  cluster in `arcade.html`, and a duplicate `gameFromPath` line in `arcade-sound.js`.

---

## Security backlog (do before any new relayed game)

1. **`RELAYER_PEM` loading is broken and can log the private key.** `relay/route.ts`
   passes PEM *contents* to `Account.newFromPem(path)`, which does `fs.readFile(path)`
   — it tries to open a file named the key text, throws, and the error (embedding the
   key material) is `console.error`'d into Vercel logs. The documented "recommended"
   option has never worked; prod must be on `RELAYER_SECRET_KEY`. Fix: parse via
   `UserSigner.fromPem(text)`, never log the raw key-load error, correct README +
   `.env.example`. **Confirm which env var prod actually uses before touching this.**
2. **`hydra/settle` fails open + weak dedupe.** On any testnet-api failure the keeper
   assumes `nextSettlement:-1` and relays up to 4 `settlePlayer` txs (30M gas each)
   unverified; `raidId` is unbounded so the dedupe key is bypassable. Fix: fail-closed
   (skip relay when the authoritative read fails), clamp `raidId` to the hub's
   `current_raid_id`, and authenticate the keeper (the `x-hydra-keeper` header it
   already sends is read by nothing — wire it to a shared secret).
3. **Rate limits are per-instance in-memory** (real budget = limit x live instances,
   resets on cold start). Move to KV/Upstash + a relayer-balance alarm.
4. **No security headers** anywhere (`vercel.json` has no `headers`): add
   `frame-ancestors 'self'`/`X-Frame-Options`, HSTS, and sane cache headers for
   `public/*.js`. Add `AbortSignal` timeouts to all upstream fetches.

## Correctness backlog (cross-cabinet, user-visible)

- **Nonce-resync missing in clawback + degen-dash** (the two highest-tx games). A single
  relay rejection permanently desyncs the shared passport nonce for the session. Port
  the proven 2-attempt `resyncNonce` block from `wen-moon/arcade.js` (or move onto
  arcade-core, which has it).
- **`pollTx` runaway guard exists only in tug-of-war.** canvas/triptych/button/reaction
  spawn an unbounded status-poll per action off the feed; backport tug's one-line
  "still in the feed" guard.
- **Transient-send retry (CABINET-STANDARD §"every action lands onchain") is implemented
  only in triptych.** tug/canvas/button/reaction drop the action on `rate_limited`/
  `network`. Bake the retry into the shared cabinet kit so the standard is enforced by
  construction.
- **`me.html` reads the OOM-dead `getTop*` views** (tug + canvas points read 0 on every
  profile) and omits reaction/wenmoon/triptych. Migrate to `fetchGameBoard` /
  `?metric=points`; also fix its Sprint points source (still the legacy board = 0).
- **Corrupt-passport bricking (clawback)**: restore + fresh-key generation share one
  try/catch, so a corrupt saved key drops to practice forever. Split them (match
  degen-dash / arcade-core).
- **Shard badges drifted from chain**: most cabinet "shard N" labels are cosmetic-wrong
  (the contracts are all shard 0). Either soften the copy or re-derive from the address.
- **Triptych escapes `arcade-lock` + the activity sampler** (dynamically-built canvases
  match neither selector): mobile swipes can scroll the mural. Add `data-lock` +
  `[data-play]` when building panels.
- **wen-moon share posts 0** after cash-out (`data-score` reads the zeroed bankroll);
  wire `shareScore` at cash-out with the banked amount, like clawback.

## Beauty / dedup backlog (the big refactors — checkpoint before starting)

These are high-value but behavior-sensitive; each wants its own branch + verify pass.

- **Registry drift guard — DONE (`scripts/check-registry.mjs`, `npm run check:registry`).**
  The game list is copied ~14 times (shell maps, arcade-core `GAMES`, hub `CABINETS`,
  three `gameFromPath`s, share, info, score voices, vercel, `CARD_GAMES`, server config).
  A full "everyone imports one module" rewire is partly BLOCKED: arcade-info.js and
  arcade-bridge.js are included as classic `<script>` in ~10 cabinets (IIFEs, can't
  cleanly `import`), and moving arcade-core `GAMES` risks the critical path for modest
  gain (contracts stay dual client/server regardless). So the high-value/low-risk move
  shipped instead: a script that parses every mirror and fails the build on drift
  (missing route/counter/card/share/info, unknown contract, or a `gameFromPath` that
  mis-resolves a pretty path). It immediately caught + fixed real drift (info/sound
  resolved `/canvas` to the classic board, not the triptych; bridge had been fixed but
  they hadn't). REMAINING (optional, deferred): the actual import-consolidation for the
  module-safe consumers (arcade-core re-export + shell deriving its maps) — lower value
  now that drift is a red build.
- **`createCabinetKit()` — DONE for 4 of 5 cabinets** (`public/arcade-cabinet.js`;
  tug/canvas/button/reaction ported + verified on prod; the pollTx runaway-guard + feed
  escaping baked in; send-error copy standardized). REMAINING: port **triptych** (the
  multi-board / per-shard-label outlier — needs the `feedLabel` hook + its multi-board
  `saveName`), and optionally fold `saveName`/`maybeShowNameRow` into the kit (left
  per-cabinet this pass). Also not yet done: the transient-send RETRY (only triptych has
  it) — bake it into the kit so the standard is enforced by construction.
- **Consolidate the 3 private game clients** (clawback/degen-dash/wen-moon `arcade.js`,
  ~1,000 duplicated lines of signing/relay/read) onto `arcade-core.js` via ~60-line
  adapters. Keeps each app.html untouched. The nonce-resync + passport-recovery fixes
  then land everywhere by construction. Verify each: practice + onchain round + board +
  tx-ring + two-tab nonce race, plus the existing smoke scripts under
  `marketing/games/*/scripts/`.
- **Sprint monoliths.** `/sprint` (onchain.html, canonical, 1,151 players) still carries
  a private pre-passport copy of the signing/relay guts + fresh-key-per-load (so scores
  never reach the passport / `/me`). Port it onto `createArcadeClient("sprint")` (needs
  a `GAMES.sprint` entry). Then **retire `/supernova-sprint`** (Finality Frenzy, the
  older annex reachable from one CTA; its board is legacy/spoofable, read by nothing):
  301 `/supernova-sprint` → `/sprint`, drop the map entries, delete the 106KB file. Its
  cross-chain simulation already lives inside the `/sprint` results panel.
- **Nested-shell hole.** An embedded page's `href="/"` (me.html, why.html back-links)
  isn't intercepted by `arcade-bridge.js` `gameFromPath("/")` → the iframe navigates to
  `/` → a shell nests inside the shell (doubled chrome + audio). Fix: map `""`/`"/"` →
  `"arcade"` in bridge, and add a frame guard to `shell.html` (if framed, postMessage
  navigate + bail).
- **Sound/bridge include unification**: 7 pages include `arcade-sound.js`, 4 include
  `arcade-bridge.js`; they mutually import each other. Pick bridge as the single
  include; normalize shard-hydra to `type="module"`.
- **tx-ring hardening**: route its `/why` link through the shell router (it currently
  writes `history`/`stage.src` directly and desyncs `current`); batch the per-tx status
  poller into one tick; validate `/^[0-9a-f]{64}$/i` on hashes + escape `game` in
  `renderPanel`.
- **Shared `esc()` / `gameFromPath` / bech32 helpers** (each copied 3-4x) into
  `arcade-games.js` or a tiny `arcade-util.js`.
- **CSS**: migrate reaction.html's 5 uses of the legacy alias vars, then delete the
  alias block in `arcade-shell.css` (the other 9 aliases have zero consumers).

## Tests to add (highest value first)

1. **Relay validation suite** — wrong function/receiver/value/shard/signature → 400;
   **gasPrice above min → 400** (the red test for the fix just shipped); `data:"__proto__"`
   → 400 not 500. Invoke the route handler with a stub env key + mocked `fetch`.
2. **Share-key ↔ CARD_GAMES contract test** — grep `data-game=`/`shareScore({game:`
   keys across `public/`, assert each exists in `CARD_GAMES`. Would have caught the
   three wrong cards before they shipped.
3. **`decodeScoreEntry` + storage-parse units** — with/without trailing ts, truncated
   buffers, huge handle-len, mapper prefix/length disambiguation, hex→bech32 failure.
4. **Registry consistency test** — `GAME_FILE`/`GAME_PRETTY` ↔ vercel rewrites ↔
   arcade-core `GAMES` ↔ `GAME_BOARDS`+`VOLUME_SOURCES`. Freezes the whole drift class.

## Docs to fix

- **README** routes table is stale on 5 rows (canvas→triptych, app.html not index.html,
  /onchain redirect, the false `/supernova-sprint`→offsite claim) and omits
  /wen-moon, /shard-hydra, /me, /why, the API routes.
- **ADDING-A-GAME.md** misses three registries a new game must touch: `CARD_GAMES`
  (+ og mirror), `VOLUME_SOURCES`, and the daily `gameContracts()` list — the exact
  omission that shipped three wrong share cards.
- **CABINET-STANDARD.md** toolkit list omits `mountGalaxy`, `arcade-lock.js`, and the
  sound include; its "retry transient failures" bullet is aspirational for 4/5 cabinets.
- **THREE-SHARD-CANVAS-DEPLOY.md** headline ("Not deployed") is now false — mark DONE.
