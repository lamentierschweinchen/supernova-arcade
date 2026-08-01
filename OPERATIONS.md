# Operations

Running the arcade: reading its real state, and keeping the relayer alive.

## Reading the real state

```bash
node scripts/arcade-standings.mjs
```

```bash
node scripts/arcade-standings.mjs --watch 15
```

This reads the **contracts directly** rather than `/api/leaderboard`, which matters more
than it sounds:

> **Gateway acceptance is not contract execution.** A transaction the gateway accepts can
> still fail on chain. That gap is where problems hide, because everything looks healthy
> in the sender's own logs. Judge the arcade by whether the contracts'
> `getGlobalActions` is climbing.

Every cabinet exposes `getGlobalActions` and `getPlayerCount`. The original tap counter
predates that convention and uses `getGlobalTaps`. Multi-shard cabinets (Novaman,
Three-Shard Canvas) span several contracts under one name, so their totals are a sum.

To see whether transactions are executing or merely landing:

```bash
curl -s "https://testnet-api.multiversx.com/transactions?size=100&order=desc&receiver=<contract>" | python3 -c "import sys,json;from collections import Counter;print(Counter(t['status'] for t in json.load(sys.stdin)))"
```

When something fails, ask the contract why instead of guessing. The gateway returns the
actual `signalError`:

```bash
curl -s "https://testnet-gateway.multiversx.com/transaction/<hash>?withResults=true" | python3 -m json.tool | grep -A3 signalError
```

## Smoke tests after a deploy

```bash
node scripts/novaman-live-smoke.mjs
```

```bash
node scripts/hydra-live-smoke.mjs
```

These sign a real action against production and confirm it settles, which catches a broken
relay allowlist or a stale contract address that a page load will not.

```bash
node scripts/check-registry.mjs
```

Fails the build when the game registries drift apart. A cabinet has to be listed in
`arcade-core.js`, the hub's `CABINETS`, the shell's route maps and `vercel.json`, and
forgetting one is the most common way to ship a half-wired game.

## Minding the relayer

The relayer pays gas for every player, so its balance is the arcade's single shared
resource. If it empties, every cabinet fails at once for everyone.

```bash
node -e "
const fs=await import('node:fs');const {UserSecretKey}=await import('@multiversx/sdk-core');
const sk=UserSecretKey.fromPem(fs.readFileSync(process.env.RELAYER_PEM_PATH,'utf8'));
const r=await(await fetch('https://testnet-api.multiversx.com/accounts/'+sk.generatePublicKey().toAddress().toBech32())).json();
console.log((Number(r.balance)/1e18).toFixed(1),'xEGLD');"
```

Check it before a busy period rather than during one.

## If the site starts returning 403

That is Vercel's automatic DDoS mitigation, not the app. It triggers on traffic shape, and
while it is on it blocks real visitors too.

```bash
vercel firewall overview
```

Disable **System Mitigations** in the Vercel dashboard, then work out what traffic pattern
set it off.

## Deploying

Production is promoted manually, never from a git push:

```bash
vercel --prod
```

Then confirm the change is actually live on the production domain, not just built. A new
deploy can briefly serve stale edge-cached HTML, so cache-bust when verifying immediately
afterwards.
