# Supernova Arcade

Eleven one-tap mini-games on MultiversX testnet, live at
**[supernova-arcade.xyz](https://supernova-arcade.xyz)**. No wallet, no funds, no signup.
You press a button, a real transaction settles onchain, and the leaderboard is a contract
tally rather than a number in a database.

## The house rules

Every cabinet follows the same four rules. They are what make this an arcade rather than a
demo.

1. **Uncheatable.** Your score is a contract's own tally of real onchain actions, so there
   is no client-reported number to forge. Contracts pace-gate their endpoints against
   block timestamps, so nobody outruns a human by spamming.
2. **Gasless.** Players never hold funds. The browser mints an ephemeral keypair and
   signs, then a relayer co-signs and pays (Relayed v3).
3. **The chain is invisible by default.** Nothing asks you to connect anything. The
   onchain part is there if you look for it and never in the way if you do not.
4. **One passport.** Set a name once and it follows you across every cabinet and onto your
   profile at `/me`.

Each game also makes a MultiversX property load-bearing to the fun, rather than bolting a
tally onto a generic game.

## The cabinets

| Game | Route | What the chain is doing |
|---|---|---|
| Supernova Sprint | `/sprint` | Speed and finality. Tap as fast as blocks confirm. |
| Novaman | `/novaman` | Pac-Man split across **three real shards**. Tunnels are shard boundaries, and every action settles on whichever shard you are standing on. |
| Snakanova | `/snakanova` | VRF-fair pellet order, enforced in sequence by the contract. |
| Three-Shard Canvas | `/canvas` | One mural across three shard contracts, one pixel per player per cooldown. |
| Shard Hydra | `/shard-hydra` | Cross-shard raid on a boss everyone shares. |
| Clawback | `/clawback` | Guardians and 2FA turned into a game mechanic. |
| Wen Moon | `/wen-moon` | VRF fairness you can verify, over a bankroll you cannot fake. |
| Degen Dash | `/degen-dash` | Endless runner with an uncheatable tally, refereed by catch windows. |
| Tug of War | `/tug-of-war` | A shared round. Everyone pulls the same rope at once. |
| The Button | `/button` | One shared round, one press. |
| Reaction | `/reaction` | Shared-round reaction time, measured onchain. |

Your profile is at `/me`, and `/why` explains the arcade to a first-time visitor.

## How it works

```
browser                        this app                     MultiversX testnet
-------                        --------                     ------------------
shell.html --iframes--> cabinet --signed tx--> /api/relay --co-signs--> contracts
    |                      |                        |                       |
 owns audio,          builds and signs        adds the relayer       the score IS
 passport, nav        with an ephemeral       signature, then        the contract's
                      keypair                 broadcasts             own tally
```

- **`public/shell.html`** is the persistent parent frame. It owns audio, the passport and
  navigation, and iframes each cabinet so sound and identity survive moving between games.
  Every player-facing route rewrites to it (see `vercel.json`).
- **Cabinets** are static HTML/JS/CSS under `public/`. They build and sign transactions in
  the browser with an ephemeral keypair, then POST to `/api/relay`.
- **`/api/relay`** (`src/app/api/relay/route.ts`) adds the relayer signature and
  broadcasts. It signs only allowed functions on known contracts, names itself as relayer,
  permits no EGLD value, and enforces per-function gas caps and rate limits.
- **`/api/leaderboard`** serves the boards from indexed contract state, because reading a
  full `getTop*` view onchain does not scale.
- **Shared client modules** sit beside the cabinets: `arcade-core.js` (transaction client),
  `passport.js` (identity), `arcade-score.js` (audio engine).
- **Onchain config** lives in `src/lib/onchain/*.config.ts`: contract addresses, the
  relayer's public address, gateway and explorer URLs, gas caps. Static cabinets cannot
  read `NEXT_PUBLIC` at runtime, so the matching client constants live in
  `public/arcade-core.js`.

This is a Next.js app rather than a static site purely because the relayer needs to be a
server route that travels with the arcade.

## Repo map

| Path | What is in it |
|---|---|
| `public/` | Every cabinet, the shell, shared client modules, fonts |
| `src/app/api/` | `relay` (gasless co-signing), `leaderboard`, `hydra` |
| `src/lib/onchain/` | Contract addresses, gas caps, network config |
| `scripts/` | Operational tooling: standings, load generation |
| `tests/` | Relay validation and Hydra state tests |
| `concepts/` | Design docs for games, shipped and unshipped |
| `template/` | Starting point for a new cabinet |

## Documentation

| Doc | Read it when |
|---|---|
| [ADDING-A-GAME.md](ADDING-A-GAME.md) | You are building a new cabinet |
| [CABINET-STANDARD.md](CABINET-STANDARD.md) | You want the conventions every cabinet follows |
| [GAMES-SLATE.md](GAMES-SLATE.md) | You want the roadmap and the reasoning behind each pick |
| [HARDENING.md](HARDENING.md) | You are touching the relay, the contracts, or anything security-adjacent |
| [OPERATIONS.md](OPERATIONS.md) | You are running load, reading standings, or minding the relayer |
| [THREE-SHARD-CANVAS-DEPLOY.md](THREE-SHARD-CANVAS-DEPLOY.md) | You are redeploying the canvas trio |
| [concepts/NOVAMAN.md](concepts/NOVAMAN.md) | You want the full cross-shard design |

## Develop

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

Set the relayer key in `.env.local` (see `.env.example`) to enable onchain plays. Without
it, `/api/relay` returns `503 relayer_unavailable` and the games still play locally, which
is usually what you want for UI work.

```bash
npm test
```

```bash
node scripts/arcade-standings.mjs
```

## Deploy (Vercel)

1. Set **`RELAYER_PEM`** (or `RELAYER_SECRET_KEY`) in the Vercel project env, using the
   same relayer wallet as the existing deploy. Reusing it is safe: the player's ephemeral
   key is the transaction sender, so co-signing never collides. The one shared resource is
   the relayer's gas balance, so keep it funded.
2. Point `supernova-arcade.xyz` DNS at Vercel and add the domain to the project.
3. Promote to production.

See `.env.example` for every environment variable.

> **Never commit a key.** The relayer PEM, the load-generation rosters and the bot and
> painter keyfiles are all gitignored. `scripts/*roster*.json` in particular holds one
> secret key per generated player.

## Status

Testnet. The arcade has settled more than 6.7 million onchain actions across the eleven
cabinets, from over 4,000 distinct players (July 2026).
