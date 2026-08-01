# Operations

Running the arcade: reading its real state, generating load against it, and keeping the
relayer alive. Everything here was learned by getting it wrong first, so the reasoning is
included rather than just the commands.

## Reading the real state

```bash
node scripts/arcade-standings.mjs
```

```bash
node scripts/arcade-standings.mjs --watch 15
```

This reads the **contracts directly**, not `/api/leaderboard`. That matters more than it
sounds:

> **Gateway acceptance is not contract execution.** A transaction the gateway accepts can
> still fail on chain. Every load wave that has gone wrong went wrong in exactly this gap,
> looking perfectly healthy in the sender's own logs. Judge a run by whether the
> contract's `getGlobalActions` is climbing, never by your success rate.

Every cabinet exposes `getGlobalActions` and `getPlayerCount`. The original tap counter
predates that convention and uses `getGlobalTaps`.

To see whether transactions are executing or merely landing:

```bash
curl -s "https://testnet-api.multiversx.com/transactions?size=100&order=desc&receiver=<contract>" | python3 -c "import sys,json;from collections import Counter;print(Counter(t['status'] for t in json.load(sys.stdin)))"
```

When something fails, ask the contract why instead of guessing. The gateway returns the
actual `signalError` string:

```bash
curl -s "https://testnet-gateway.multiversx.com/transaction/<hash>?withResults=true" | python3 -m json.tool | grep -A3 signalError
```

## Generating load

```bash
node scripts/arcade-million.mjs --target 500000 --players 60 --rate 90 --names 1500
```

| Flag | Meaning |
|---|---|
| `--target` | Transactions to send before stopping |
| `--players` | Concurrent players on the floor |
| `--rate` | Governor cap, transactions per second |
| `--names` | Size of the name pool, which is the ceiling on distinct players |
| `--diverse` | Light, wide visits: flat cabinet weighting, 4 to 6 games each, 30% volume |
| `--maxhours` | Wall-clock ceiling |

`scripts/arcade-underdogs.mjs` is the same idea aimed only at the four least-played
cabinets. `scripts/arcade-night.mjs` is the older per-cohort generator.

### Rules that were expensive to learn

**Submit straight to the gateway, never through the site.** An early wave pushed load
through `/api/relay` and tripped Vercel's automatic DDoS mitigation, which then returned
403 to *every* visitor including real browsers. The generators sign both the player and
relayer signatures locally and POST to the gateway, so the website is never in the path.
Sizing load against the relay's own rate limits is not enough; the CDN in front of it has
its own opinion.

**One job at a time.** Two concurrent waves cost about 26,000 failed sends and a third of
throughput. Serialised, the same infrastructure ran at a 0.04% failure rate. If a wave is
already running, wait for it.

**The gateway limits requests, not transactions.** Burst cabinets batch 25 transactions
into one `send-multiple` call, while pace-gated cabinets must send one transaction per
request. So a run weighted toward gated games makes roughly ten times the requests at the
same transactions per second, and starts getting rejected. `--diverse` is exactly that
shape, which is why it wants a lower player count than a burst-heavy run.

**A rejected send does not consume the nonce.** The client has already incremented it
locally though, so without a resync the first rejection puts every later send from that
player one nonce too high and the whole visit dies behind it. Failures then arrive in
spikes rather than at a steady rate, which is the tell. `Player.resync()` re-reads the
authoritative nonce from the gateway on any failure.

**Pace-gated contracts compare block timestamps.** Sleeping the gate and then batching
puts both actions in the same block and the second is rejected. Gated cabinets must send
one action at a time, sequentially, per player.

**`startRun` is not in effect until it is in a block.** Reading a run straight after
sending `startRun` returns the player's *previous* run. With a roster of returning
regulars that stale read made every Snakanova eat land out of order
(`signalError: eat pellets in order`) and failed 64% of them. Wait for the run id to
change, do not just sleep a second or two.

**Derive schedules from the game's own module.** Degen Dash and Clawback are refereed
against a VRF-seeded schedule. The generators import `public/degen-dash/schedule.js` and
`public/clawback/schedule.js` so they play the stream the contract actually scores,
instead of a reimplementation that drifts.

**Shard Hydra only joins.** The generator sends `joinRaid` and nothing else. A per-head
`hit` needs the live attacking head and a real reaction window, and faking it would put
junk on a boss that real players share. This is why Hydra's `getGlobalActions` does not
move during a wave while its player count does: `join_raid` registers the player, but only
the settlement path increments the action counter. That is correct, not a bug.

**Verify throughput, not success rate.** One run reported a flawless 100% success rate
while a governor deadlock held it to 676 transactions in nine hours. A success rate looks
identical at any volume. Check that the on-chain totals are climbing before you walk away.

### Roster and identity

Generators keep a roster JSON mapping each name to a keypair, so a returning name keeps
its address, its scores and its passport. **These files hold one secret key per player and
are gitignored.** They are throwaway zero-balance testnet accounts, but they do not belong
in the repo. Back them up outside it if you care about name continuity; losing the roster
means every regular comes back as a stranger.

## Minding the relayer

```bash
node -e "
const fs=await import('node:fs');const {UserSecretKey}=await import('@multiversx/sdk-core');
const sk=UserSecretKey.fromPem(fs.readFileSync(process.env.RELAYER_PEM_PATH,'utf8'));
const r=await(await fetch('https://testnet-api.multiversx.com/accounts/'+sk.generatePublicKey().toAddress().toBech32())).json();
console.log((Number(r.balance)/1e18).toFixed(1),'xEGLD');"
```

Budget roughly **170 to 190 xEGLD per million transactions**. Check the balance before a
run rather than during: an empty relayer fails every cabinet at once, for real players as
well as generated ones.

## If the site starts returning 403

That is Vercel's automatic DDoS mitigation, not the app.

```bash
vercel firewall overview
```

Disable **System Mitigations** in the Vercel dashboard, and stop whatever load triggered
it. Then move that load to direct gateway submission so it cannot happen again.
