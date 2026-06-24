# Supernova Arcade — open game template

Ship a simple, **real-onchain** game on MultiversX in a day. No wallet, no install
for your players — they just tap, and every action is a real transaction that
finalizes on the Supernova clock.

This template packages the live **Supernova Sprint** stack as a forkable starter:

1. **Ephemeral-key gasless play** — a keypair is generated in the browser and
   transactions are relayed for free. No wallet, no funds, one tap to play.
2. **An uncheatable leaderboard + shared-state contract** — scores and a global
   counter live onchain, readable by anyone.
3. **The score IS the count of real transactions** — one action = one tx. You can't
   fake a transaction, so the score is honest by construction. No rate-limiting, no
   score-bounding, no fighting bots: a bot just does more real onchain work, which
   is the point (more real activity = more proof).
4. **The standard Arcade action event** — every game emits the same `arcadeAction`
   event so the hub can sum a single global "N onchain actions" counter across all
   games.
5. **A minimal example game** — *Nova Taps*, a 15-second tap sprint, wired end to
   end. Swap the gameplay, keep the plumbing.

> Supernova is **scheduled to activate** on MultiversX. This template targets the
> public **testnet**, where Supernova runs today (≈600ms rounds), so a submission
> really does finalize on the Supernova clock. Testnet EGLD is free, so the relayer
> pays nothing; testnet can be reset, which would clear the board.

---

## The contract every Arcade game must meet

See [`ARCADE-SPEC.md`](ARCADE-SPEC.md) for the full spec. In short, a game must:
one-tap gasless play · an onchain score or shared state · onchain anti-cheat · the
standard global-counter event · a readable per-game leaderboard. This template
implements all five. You can fork it, or roll your own as long as you meet the spec.

One design rule runs through everything: **onchain reads are legible at ~2s** (API
/ indexer latency, even with 600ms blocks — measured in Sprint). So counters and
leaderboards tick on a **~2s** cadence. Never put a contract read in your per-frame
loop, and never fake real-time. Gameplay is local; the chain is the score.

---

## Quickstart

```bash
# 0. prerequisites: Node >= 20.6, Rust + sc-meta (https://docs.multiversx.com), mxpy
npm install

# 1. build, test, and verify the stack offline (no network, no deploy)
npm run build:contract     # compile the contract to wasm + ABI
npm run test:contract      # 10 blackbox tests
npm run verify:signing     # browser signing  ⇄  relayer verification agree
npm run verify:relayer     # every relayer guard behaves (broadcast stubbed)

# 2. deploy the contract to testnet from a SHARD-0 wallet (see below)
GAME_ID="nova-taps" PEM=contract/.wallets/deployer.pem npm run deploy:contract

# 3. point the template at your deployed contract + your relayer wallet
#    - web/arcade.config.js : CONTRACT + relayer (public address)
#    - relayer/config.js     : CONTRACT + RELAYER_ADDRESS
#    - .env                  : the relayer's signing key (cp .env.example .env)

# 4. run it: one command serves the game AND the relayer on one origin
npm run dev                 # http://localhost:8787
```

That's the whole loop. Replace *Nova Taps* with your game and you're done.

---

## How it works

```
  Browser (web/)                         Relayer (relayer/)            Chain (testnet)
  ┌───────────────────────┐    POST      ┌────────────────────┐        ┌──────────────┐
  │ arcade.js             │  /api/relay  │ relay.js           │        │ arcade-game  │
  │  • ephemeral ed25519  │ ───────────► │  • validates       │  send  │  contract    │
  │    key, ground into   │  signed tx   │  • co-signs (gas)  │ ─────► │  • score      │
  │    the relayer shard  │              │  • broadcasts      │        │  • leaderboard│
  │  • local nonce        │ ◄─────────── │                    │        │  • global ctr │
  │  • build + sign tx    │  txHash      └────────────────────┘        │  • arcadeAction
  │  • read board (~2s)   │ ◄──────────────── vm-values/query ──────── │    event     │
  └───────────────────────┘                                            └──────────────┘
```

**The gasless flow (Relayed v3), all client-side:**
1. The browser generates an ephemeral ed25519 keypair — no wallet, no funds —
   ground into the relayer's shard (Relayed v3 needs sender and relayer in the same
   shard). The nonce is fetched once, then incremented **locally**, so rapid taps
   never wait on the network.
2. The browser builds and signs a transaction (sender = ephemeral key,
   relayer = the hosted relayer) and POSTs it to `/api/relay`.
3. The relayer **validates** it, adds its own signature, and broadcasts it — so the
   relayer pays the gas and the player pays nothing.
4. The board and the global counter are read straight from the contract on a ~2s
   tick.

Everything **fails soft**: if the crypto libs or the relayer are unavailable, reads
resolve empty and actions surface a friendly message — play is never blocked.

---

## Why scores are honest (and bots are welcome)

The score IS the count of real transactions. You can't fake a transaction, so a
score can't be inflated without actually doing the onchain work — there is nothing
to bound, rate-limit, or trust from the client. A bot is not a threat here: it just
generates more real onchain activity, which is exactly what the Arcade is proving.

**In the contract ([`contract/src/lib.rs`](contract/src/lib.rs)):**
- **`recordAction()` is the whole score model.** It takes **no arguments**, so the
  score can't be self-reported. One call = one transaction = +1 to the caller's
  current session; the best session a caller ever lands is their score (the proven
  Sprint `recordTap` model). The only way up the board is to send more real
  transactions.
- **The score window is in MILLISECONDS.** `get_block_timestamp()` returns ms on
  Supernova, so `session_window_ms` is ms — 30s is `30_000`. (Sizing it in seconds
  is the bug that pinned Sprint's score at 1: a `30` window is 30ms, so every tap
  opened a fresh session.) A short window = a timed sprint; a very large window = an
  all-time cumulative count.
- **The leaderboard is sorted CLIENT-SIDE.** `getLeaderboard()` returns every entry
  unsorted; the reader sorts. No gas-metered onchain sort to cap how big the board
  can grow.

**In the relayer ([`relayer/relay.js`](relayer/relay.js)):** the relayer is a trusted
component (it pays gas; it can refuse). It signs only a transaction that calls an
**allowlisted** function on the **pinned** contract, names itself as relayer, carries
**no value**, asks for gas within a **cap** (gas hygiene, not a score cap), comes from
a sender **in its shard**, and carries a **valid signature**. There is deliberately
**no rate limit** — the only cost is the gas the relayer pays, so keep its testnet
wallet funded (free from the faucet). The allowlist + caps live in one table in
[`relayer/config.js`](relayer/config.js); add a function by adding a row.

---

## The standard `arcadeAction` event (for the hub)

Every accepted action emits one event, so the Arcade hub can sum a single global
"N onchain actions" odometer across **all** games:

```
arcadeAction(
  game:      ManagedBuffer  // indexed — the game id set at deploy, so the hub groups by game
  player:    ManagedAddress // indexed — the ephemeral caller
  actions:   u32            // indexed — actions this tx represents (usually 1)
  new_total: u64            // this contract's running total after the call
)
```

The hub can aggregate two equivalent ways:
- **Event sum (for an indexer):** sum `actions` across every featured contract's
  `arcadeAction` events. The `game` field groups by game.
- **View sum (no indexer):** read each game's `getGlobalActions()` view on the ~2s
  tick and add them up. Same total.

Keep the event as-is so your game drops straight into the hub's counter.

---

## Make it your own game

The example is a tap sprint, but the plumbing is generic. To build your game, edit
**[`web/game.html`](web/game.html)** and keep the three `[ARCADE]` hooks:

```js
const arcade = createArcade(ARCADE_CONFIG);   // [ARCADE] 1 — create the client
await arcade.recordAction();                  // [ARCADE] 2 — one real onchain action (+1)
await arcade.setHandle(handle);               // [ARCADE] 3 — claim a name for your score
```

Reads (poll these on a ~2s `setInterval`, never per frame):

```js
await arcade.getLeaderboard(10);   // [{ address, handle, score, timestamp }], sorted client-side
await arcade.getGlobalActions();   // number
await arcade.getPlayerEntry();     // this player's { score, handle, ... }
await arcade.getTxStatus(hash);    // 'success' | 'fail' | 'invalid' | 'pending'
```

**Model your score as a count of onchain actions.** The Arcade model is "the score
IS your real onchain activity," so a meaningful action in your game = one
`recordAction()` call = one transaction = +1. Most scores fit: taps, jumps, shots
that land, pixels placed, tug pulls. (A "client computes a number" score is exactly
the spoofable shape this model avoids — if your game seems to need one, rethink the
action so each point is a real transaction.)

Two contract knobs (set at deploy, see the deploy script):
- `game_id` — your game's short id, emitted on every event.
- `session_window_ms` — the rolling window in MILLISECONDS (0 = 30s). Short = a timed
  sprint; very large = an all-time cumulative count.

---

## Deploy the contract (shard 0)

**Deploy from a shard-0 wallet.** Relayed v3 needs the sender (the player's
ephemeral key) in the relayer's shard, and the client grinds keys into shard 0. A
shard-0 contract keeps every call intra-shard and fast.

```bash
# generate + fund a testnet wallet (fund at the Web Wallet faucet)
mxpy wallet new --format pem --outfile contract/.wallets/deployer.pem

# build, then deploy with your game id
npm run build:contract
GAME_ID="nova-taps" SESSION_WINDOW_MS=0 PEM=contract/.wallets/deployer.pem npm run deploy:contract
```

The script prints the contract address and writes `contract/scripts/deploy-info.testnet.json`.
Put that address in `web/arcade.config.js` and `relayer/config.js`.

---

## The relayer wallet

```bash
# a shard-0 testnet wallet, funded from the faucet, dedicated to paying gas
mxpy wallet new --format pem --outfile contract/.wallets/relayer.pem
```

Set its key for the server via the environment (never commit it):

```bash
cp .env.example .env
# put the PEM contents in RELAYER_PEM, or the 64-hex secret in RELAYER_SECRET_KEY,
# and the wallet's public address in RELAYER_ADDRESS
```

Then set the same public address as `relayer` in `web/arcade.config.js` and
`RELAYER_ADDRESS` in `relayer/config.js`.

---

## Going to production

The dev server (`relayer/server.js`) is for local use. For hosting, the two parts
split cleanly:

- **Static front end:** host `web/` on any static host (Vercel, Netlify, GitHub
  Pages, S3…).
- **Relayer function:** deploy [`relayer/api/relay.js`](relayer/api/relay.js) as a
  serverless function so the browser POSTs to `/api/relay` on the same origin. On
  Vercel, the file at `api/relay.js` is exposed at `/api/relay` automatically. Set
  `RELAYER_PEM` / `RELAYER_SECRET_KEY` as an environment variable in the host's
  dashboard. (sdk-core's crypto needs the Node runtime, not edge.)

Both the dev server and the serverless function share the same `relay.js` core, so
behavior is identical.

**Production note:** there's no rate limit by design (the score is real-tx count, so
bots just add real activity). Your only running cost is the gas the relayer pays —
watch its testnet balance and top it up from the faucet. If you ever want to cap
spend, do it in the relayer as a gas-budget guard, not as a per-player score limit.

---

## Project layout

```
arcade-template/
├── README.md                 ← this file (the integration guide)
├── ARCADE-SPEC.md            ← the contract every Arcade game must meet
├── package.json              ← scripts: build/test/verify/deploy + dev server
├── .env.example              ← relayer key + overrides (copy to .env)
│
├── contract/                 ← the uncheatable leaderboard + shared-state contract
│   ├── src/lib.rs            ← ArcadeGame: recordAction, setHandle, leaderboard, global counter, event
│   ├── src/arcade_game_proxy.rs   ← generated (sc-meta all proxy)
│   ├── tests/                ← 10 blackbox tests
│   ├── scripts/deploy-testnet.sh
│   ├── meta/  wasm/  sc-config.toml  multiversx.json  Cargo.toml
│
├── relayer/                  ← the gasless relayer (Relayed v3)
│   ├── relay.js              ← validate → co-sign → broadcast (framework-agnostic core)
│   ├── config.js             ← network + the allowlist/gas-cap table (edit this)
│   ├── server.js             ← zero-dependency dev server (static + /api/relay)
│   └── api/relay.js          ← Vercel / Next serverless adapter
│
├── web/                      ← the static front end (no build step)
│   ├── arcade.js             ← the reusable browser client (ephemeral key, sign, relay, reads)
│   ├── arcade.config.js      ← addresses + endpoints (edit this)
│   └── game.html             ← Nova Taps — the example game
│
└── scripts/
    ├── verify-signing.mjs    ← proves browser signing ⇄ sdk-core verification agree
    └── verify-relayer.mjs    ← proves every relayer guard (offline, broadcast stubbed)
```

---

## Submitting your game to the Arcade

When your game is live, submit: **repo + hosted URL + contract address + a one-line
description + the action-event format you used** (this template's standard
`arcadeAction` if you didn't change it). Games pass a safety + quality review (no
malicious contracts, no scams, works on mobile) before they're featured. Featured
games get a permanent cabinet in the hub, and their activity feeds the global counter.

---

## Honest caveats

- **Testnet only.** This is a community experiment on a test network where Supernova
  is scheduled to activate. No real value; the board can reset with testnet.
- **Bots are welcome.** The score is the count of real transactions, so there's
  nothing to fake — a bot just does more real onchain work. That's the point, not a
  problem.
- **The relayer is trusted.** It pays gas and can refuse. That's by design for a
  free, no-wallet experience — keep its testnet wallet funded.

MIT licensed. Fork it, ship something fun.
