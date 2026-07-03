// Live onchain smoke test for Novaman against the PROD relay.
// Signs a Relayed-v3 startRun + collectSparks(5) on the shard-0 instance and
// confirms getPlayerStats reflects them. Proves the uncheatable path end to end:
// client signs -> /api/relay co-signs + broadcasts -> contract executes.
//
// Run from the arcade repo root (uses its @multiversx/sdk-core):
//   node /path/to/novaman-smoke.mjs
import {
  Address,
  AddressComputer,
  Transaction,
  TransactionComputer,
  UserSecretKey,
} from "@multiversx/sdk-core";

const RELAY = "https://supernova-arcade.xyz/api/relay";
const API = "https://testnet-api.multiversx.com";
const CHAIN = "T";
const GAS_PRICE = 1_000_000_000;
const RELAYER = "erd1ru08dt4u5e0psfrwth38u0dfed0hw8289xqdd9yghl3ec24uppuq6hgphm"; // shard 0
// SHARD=0|1|2 picks which instance to settle on (1/2 are real cross-shard from the
// shard-0 relayer/sender). Default 0.
const NOVAMAN = [
  "erd1qqqqqqqqqqqqqpgq8shkqnta5x6aj7gt5lapsmk7aw5kjrzrppuqvfm605",
  "erd1qqqqqqqqqqqqqpgqk6gs82sw7urmxky08cxsvpfz9vkrs7nqx63s34pjrl",
  "erd1qqqqqqqqqqqqqpgqdp7qwkajzvg0pn3annpgkmhjhw89tlwf5cdqs7jc4q",
];
const SH = Number(process.env.SHARD || 0);
const SHARD0 = NOVAMAN[SH];

const ac = new AddressComputer();
const tc = new TransactionComputer();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// grind an ephemeral key into shard 0 (Relayed-v3: sender shard == relayer shard)
function shard0Key() {
  for (let i = 0; i < 5000; i++) {
    const sk = UserSecretKey.generate();
    const addr = sk.generatePublicKey().toAddress();
    if (ac.getShardOfAddress(addr) === 0) return { sk, addr };
  }
  throw new Error("could not grind a shard-0 key");
}

async function nonceOf(bech32) {
  const r = await fetch(`${API}/accounts/${bech32}`);
  if (!r.ok) return 0;
  const j = await r.json();
  return j.nonce || 0;
}

async function relay(sk, addr, nonce, dataStr) {
  const tx = new Transaction({
    nonce: BigInt(nonce),
    value: 0n,
    sender: addr,
    receiver: Address.newFromBech32(SHARD0),
    gasPrice: BigInt(GAS_PRICE),
    gasLimit: 8_100_000n,
    data: new TextEncoder().encode(dataStr),
    chainID: CHAIN,
    version: 2,
    relayer: Address.newFromBech32(RELAYER),
  });
  tx.signature = sk.sign(tc.computeBytesForSigning(tx));
  const res = await fetch(RELAY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: tx.toPlainObject() }),
  });
  const out = await res.json().catch(() => ({}));
  return { ok: res.ok && !out.error, status: res.status, out };
}

async function waitTx(hash, label) {
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const r = await fetch(`${API}/transactions/${hash}?fields=status`);
    if (r.ok) {
      const j = await r.json();
      if (j.status && j.status !== "pending") {
        console.log(`  ${label}: ${j.status}  ${hash}`);
        return j.status;
      }
    }
  }
  console.log(`  ${label}: still pending  ${hash}`);
  return "pending";
}

function decodeU64(part) {
  const b = Buffer.from(part || "", "base64");
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return Number(v);
}

async function stats(addrHex) {
  const r = await fetch(`${API}/vm-values/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scAddress: SHARD0, funcName: "getPlayerStats", args: [addrHex] }),
  });
  const j = await r.json();
  const rd = j?.data?.data?.returnData || [];
  return { sparks: decodeU64(rd[0]), ghosts: decodeU64(rd[1]), ports: decodeU64(rd[2]), bites: decodeU64(rd[3]) };
}

const { sk, addr } = shard0Key();
const addrHex = addr.toHex();
console.log("ephemeral (shard 0):", addr.toBech32());

let nonce = await nonceOf(addr.toBech32());

console.log("\n1) startRun ->");
const r1 = await relay(sk, addr, nonce++, "startRun");
console.log("   relay:", r1.status, r1.ok ? "accepted" : JSON.stringify(r1.out));
if (!r1.ok) process.exit(1);
await waitTx(r1.out.txHash, "startRun");

await sleep(1500); // let enough block-time pass for the munch pacing (5*80ms)

console.log("\n2) collectSparks(5) ->");
const r2 = await relay(sk, addr, nonce++, "collectSparks@05");
console.log("   relay:", r2.status, r2.ok ? "accepted" : JSON.stringify(r2.out));
if (!r2.ok) process.exit(1);
await waitTx(r2.out.txHash, "collectSparks");

await sleep(2000);
console.log("\n3) getPlayerStats ->");
const s = await stats(addrHex);
console.log("   ", JSON.stringify(s));
const pass = s.sparks === 5 && s.ports === 1;
console.log("\n" + (pass ? `✅ PASS — 5 sparks + 1 port settled on shard ${SH} (uncheatable path works)` : "❌ unexpected stats"));
process.exit(pass ? 0 : 1);
