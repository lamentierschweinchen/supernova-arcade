# Supernova Arcade

A hub of one-tap, gasless, fully-onchain mini-games on MultiversX testnet, served
at **supernova-arcade.xyz**. The hub (`public/arcade.html`) is the hero at `/`.

This is a Next.js app rather than a pure static site because the gasless relayer
is a Next API route (`/api/relay`) that travels with the arcade.

## How it works

- **Games** are static HTML/JS/CSS in `public/` (hub, cabinets, shared modules,
  fonts). They build and sign player transactions in the browser with an
  ephemeral keypair (no wallet, no funds), then POST the signed tx to `/api/relay`.
- **`/api/relay`** (`src/app/api/relay/route.ts`) adds the relayer signature
  (Relayed v3) and broadcasts it, so the relayer pays testnet gas and the player
  pays nothing. It only signs allowed functions on known contracts, naming itself
  as relayer, with no EGLD value and gas within caps.
- **Onchain config** (`src/lib/onchain/*.config.ts`) holds contract addresses,
  the relayer's public address, gateway/explorer URLs, and gas caps. The matching
  client constants live in `public/arcade-core.js` (static cabinets can't read
  `NEXT_PUBLIC` at runtime).

## Routes (see `vercel.json`)

| Path | Serves |
|---|---|
| `/` and `/arcade` | `public/arcade.html` (the hub) |
| `/tug-of-war` | `public/tug-of-war.html` |
| `/canvas` | `public/canvas.html` |
| `/button` | `public/button.html` |
| `/reaction` | `public/reaction.html` |
| `/clawback` | `public/clawback/index.html` |
| `/degen-dash` | `public/degen-dash/index.html` |
| `/onchain` | `public/onchain.html` (the in-arcade "Supernova Sprint") |
| `/api/relay` | the gasless relayer (POST) |

`/supernova-sprint` redirects to the original standalone Sprint on
`supernova-sprint.xyz` (it lives there, not here).

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
```

Set the relayer key locally in `.env.local` (see `.env.example`) to enable
onchain plays. Without it, `/api/relay` returns `503 relayer_unavailable` and
games still play locally.

## Deploy (Vercel)

1. Set **`RELAYER_PEM`** (or `RELAYER_SECRET_KEY`) in the Vercel project env —
   the SAME relayer wallet as the existing deploy. Reusing it is safe (the player
   ephemeral key is the tx sender, so co-signing never collides; the one shared
   resource is the relayer gas balance — keep it funded).
2. Point `supernova-arcade.xyz` DNS at Vercel and add the domain to the project.
3. Promote to production.

See `.env.example` for all environment variables.
