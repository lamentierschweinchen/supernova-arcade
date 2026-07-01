# Supernova Arcade — Cabinet Standard

The one template every cabinet follows. Use it to build a new cabinet, and as the
checklist for reviewing community submissions. Reference implementations:
**`tug-of-war.html`** and **`button.html`** (the cleanest full shell cabinets).

## Section order (top → bottom)

1. **Header** (`.abar`) — back-to-arcade link · MultiversX wordmark (`.lockup`) · shard badge (`.shard`). The ⓘ how-to button auto-inserts here.
2. **Title + one-line pitch** — `<h1>` + `.sub`
3. **"No wallet, just play" flash** — `.onetap`
4. **The board** — `.cabinet` / `.screen`
5. **Explanations — BOTH layers, always:**
   - *How to play* → the shared ⓘ overlay (`arcade-info.js`)
   - *Why it works* → a `.why` card linking to a **real** `/why#anchor`
6. **Stats trio** — `.stats`: your score · the global-onchain count (marked `.on`) · players
7. **Status line** — `.status`
8. **Leaderboard** — `.card` + `.lb` (via `arcade-board.js`, top-10 + sticky self) · name input · **"Share my score"** (`.share-btn`)
9. **Footer** — `.afoot`: `Supernova · live on testnet · <rounds/mechanic> · gasless, no wallet · <the score, read from the chain>`

## The shared toolkit (use these — don't reinvent)

- **`arcade-shell.css`** — the design system (every class above). Set `<body style="--c:#accent" data-shard="…">` once and it themes.
- **`arcade-info.js`** — the ⓘ "how to play" overlay. Add a `GAMES.<key>` entry (`title` / `objective` / `controls`) **and** a path regex in `gameFromPath()`, then include `<script src="/arcade-info.js">`. (Both are required — a missing regex = a silently dead overlay.)
- **`arcade-board.js`** — the leaderboard: `fetchGameBoard(key)` + `topPlusSelf(rows, me, 10)` (top-10 + sticky "you").
- **`arcade-share.js`** — one share path. Add `<button class="btn ghost share-btn" data-game="<key>" data-score="<scoreElementId>">Share my score</button>` + `<script type="module" src="/arcade-share.js">`. It auto-wires on load (`data-score` is the id of the element whose text is the score).
- **`arcade-core.js`** — `createArcadeClient("<key>")`, then `sendAction` / `sendActionTo` (signed Relayed-v3 → `/api/relay`, gasless). Using it **automatically feeds the live tx ring** (posts `arcade:tx`).
- **`/why`** — one chapter per network edge. Every cabinet's `.why` card must point at a **real** anchor: `#speed` `#parallel` `#fees` `#gasless` `#mev` `#crossshard` `#randomness`. New edge → add a chapter first.

## "Clears the bar" checklist (new cabinets AND submissions)

- [ ] One-tap, gasless, no wallet (an ephemeral browser key, transactions relayed for free)
- [ ] Score = the player's **real onchain transaction count** — recorded onchain, uncheatable, anyone can verify
- [ ] Emits the canonical **`arcadeAction(game, player, actions, new_total)`** event
- [ ] **Every action lands onchain** — retry transient relay failures (rate-limit / network); never leave a local-only "ghost" that reverts
- [ ] Works on mobile
- [ ] Both explanation layers present: ⓘ how-to **and** a `.why` card → a real `/why` chapter
- [ ] On the shared leaderboard, and has a share button
- [ ] Follows the section order + uses the shell classes (no bespoke stats/leaderboard markup)

## Notes / known deviations

- **Forks** (`clawback/`, `degen-dash/`, `wen-moon/`) and **`onchain.html`** (Sprint) render to the standard but keep some **bespoke internal markup** (their own `.lb`/stats). They use the same shared services, so this is a maintainability nit, not a user-facing gap — left as-is deliberately (rewriting working, popular games for internal purity isn't worth the breakage risk).
- **Sprint** gates its leaderboard/share inside a post-run results panel rather than always-visible — a deliberate "timed run → see your result" design.

## Deploy

Static cabinets live in `public/`. Pretty paths rewrite to `shell.html` (`vercel.json` + the shell's `GAME_FILE` / `GAME_PRETTY` maps). To add a game end-to-end, see **`ADDING-A-GAME.md`**.
