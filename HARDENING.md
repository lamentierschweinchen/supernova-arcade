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

1. **`RELAYER_PEM` loading + key-logging — DONE.** `relay/route.ts` passed PEM
   *contents* to `Account.newFromPem(path)` (which `fs.readFile`s a path), so the
   documented "recommended" option always threw, and the catch `console.error`'d the
   error object — which for a key-parse failure can carry the key material — into
   Vercel logs. Now parses the text via `UserSecretKey.fromPem(pem)` + `new Account(...)`,
   and the catch logs a static message only (never the error). Prod is unaffected (it
   runs on `RELAYER_SECRET_KEY`; the PEM path was dead), so this is a safe correctness
   fix that makes the documented option actually work. REMAINING (docs): note in
   README + `.env.example` that `RELAYER_PEM` now works.
2. **`hydra/settle` fail-open + weak dedupe — DONE.** On any testnet-api failure the
   keeper assumed `nextSettlement:-1` and relayed up to 4 unverified `settlePlayer` txs
   (30M gas each); `raidId` was unbounded so the dedupe key was bypassable. Now
   fail-closed: `authoritativeSettlement` returns `{ ok:false }` on fetch throw / non-ok
   / bad body, and `settleInBackground` relays only on an authoritative not-settled read
   (an unreadable state skips the attempt; the in-page pump is the client backstop).
   `raidId` is clamped to `MAX_RAID_ID` (1e6, ~years of raids) — a static bound rather
   than a per-request `current_raid_id` fetch (avoids adding a network dependency to
   every settle; fail-closed already removes the unverified-relay risk the tighter bound
   guarded). DEFERRED: keeper auth (wire the unused `x-hydra-keeper` header to a shared
   secret) — lower priority now that `settlePlayer` is fail-closed + idempotent on-chain.
3. **Rate limits are per-instance in-memory** (real budget = limit x live instances,
   resets on cold start). Move to KV/Upstash + a relayer-balance alarm. DEFERRED (infra).
4. **Security headers — DONE.** `vercel.json` now sets, on `/(.*)`: `X-Frame-Options:
   SAMEORIGIN` + CSP `frame-ancestors 'self'` (clickjacking; SAMEORIGIN keeps the
   shell's same-origin cabinet iframes working), `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: strict-origin-when-cross-origin`, and HSTS (2y + subdomains). No
   `script-src`/`connect-src` CSP (would break the esm.sh crypto imports) and no cache
   headers (aggressive JS caching reintroduces the stale-ES-module bug). DEFERRED:
   `AbortSignal` timeouts on upstream fetches (minor robustness).

## Correctness backlog (cross-cabinet, user-visible)

- **Nonce-resync — DONE for clawback + degen-dash.** Ported wen-moon's proven 2-attempt
  send loop + `resyncNonce` into both (the happy path is byte-identical; only a relay
  rejection now re-syncs the nonce and retries once instead of desyncing the rest of the
  session). Both boot clean. Verified static + boot; the retry only fires on rejection.
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
  adapters. Keeps each app.html untouched. DEFERRED (not the fixes — those are done
  above): the full rewrite touches the entire onchain layer of 3 live games and can't be
  fully verified without real playtesting (rAF + relay), so it's high-risk for a
  line-count win. Do it in a worktree with the smoke scripts under
  `marketing/games/*/scripts/` + a two-tab nonce-race test. The correctness bug it would
  have fixed (nonce-resync) is already backported.
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

## Tests

- **DONE — Relay validation suite** (`tests/relay-validation.test.mts`, `npm run test:relay`).
  Drives the POST handler with a stub env key; asserts the 400s for wrong
  function/receiver/value/relayer/gas + a control that a valid-shaped tx clears every
  field guard. Includes the two security red-tests: **gasPrice above min → 400** and
  **`data:"__proto__"` → 400 not 500**. Runs via tsx (the one test devDep added).
- **DONE — Registry consistency check** (`scripts/check-registry.mjs`, `npm run check:registry`),
  in `npm run verify` with the tests. Also covers the share-key ↔ CARD_GAMES invariant
  (would have caught the three wrong cards).
- **TODO — `decodeScoreEntry` + storage-parse units** — with/without trailing ts,
  truncated buffers, huge handle-len, mapper prefix/length disambiguation, hex→bech32
  failure. Needs the decode extracted from `leaderboard/route.ts` into a testable unit.

`npm run verify` = check:registry + all tests (the pre-ship gate).

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
