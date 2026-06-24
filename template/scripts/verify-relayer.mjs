// verify-relayer.mjs — exercises the relayer's validation logic offline.
//
// Sets up a throwaway relayer key, STUBS the gateway broadcast (so nothing is
// ever sent to a network), then fires crafted requests at handleRelay() to prove
// each guard rejects what it should and the happy path co-signs + "broadcasts".
// No deploy, no real transactions.
//
// Run: npm run verify:relayer   (after npm install)

import * as ed from "@noble/ed25519";
import { bech32 } from "@scure/base";
import sdkCore from "@multiversx/sdk-core";

const { Address, AddressComputer, UserSecretKey } = sdkCore;

// A throwaway relayer secret (test-only; never funded, never used anywhere else).
const RELAYER_SECRET = "1a1b1c1d1e1f20212223242526272829" + "2a2b2c2d2e2f30313233343536373839";
const relayerAddr = UserSecretKey.fromString(RELAYER_SECRET).generatePublicKey().toAddress().toBech32();

const CONTRACT = "erd1qqqqqqqqqqqqqpgqlwv6l2zpx9v0uv6869tn90exv3vdplejppuq97k7r4";

// Configure the relayer BEFORE importing it (config.js reads env at load time).
process.env.RELAYER_SECRET_KEY = RELAYER_SECRET;
process.env.RELAYER_ADDRESS = relayerAddr;
process.env.CONTRACT = CONTRACT;
process.env.CHAIN_ID = "T";

// Stub the gateway broadcast so the happy path never touches a network.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (typeof url === "string" && url.includes("/transaction/send")) {
    return { ok: true, json: async () => ({ data: { txHash: "stubbedhash000000000000000000000000000000000000000000000000000000" } }) };
  }
  return realFetch(url, opts);
};

const { handleRelay } = await import("../relayer/relay.js").then((m) => m.default ?? m);

const addrComputer = new AddressComputer();
const relayerShard = addrComputer.getShardOfAddress(new Address(relayerAddr));

const enc = new TextEncoder();
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

function shardOfPubkey(pub) {
  const last = pub[31];
  let shard = last & 3;
  if (shard > 2) shard = last & 1;
  return shard;
}
function signingString(tx) {
  return JSON.stringify({
    nonce: tx.nonce, value: tx.value, receiver: tx.receiver, sender: tx.sender,
    gasPrice: tx.gasPrice, gasLimit: tx.gasLimit, data: tx.dataB64,
    chainID: tx.chainID, version: tx.version, relayer: tx.relayer,
  });
}
async function ephemeralInShard(shard) {
  for (let i = 0; i < 800; i++) {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    if (shardOfPubkey(pub) === shard) return { priv, pub, address: bech32.encode("erd", bech32.toWords(pub), 256) };
  }
  throw new Error("grind failed");
}

// Build a signed plain tx, applying overrides AFTER signing where we want the
// signature to stay valid (e.g. tampering the relayer field tests that guard).
async function buildSignedTx(key, { data = "recordAction", receiver = CONTRACT, value = "0", gasLimit = 6_000_000, chainID = "T", relayer = relayerAddr } = {}) {
  const dataB64 = b64(data);
  const txForSign = { nonce: 0, value, receiver, sender: key.address, gasPrice: 1_000_000_000, gasLimit, dataB64, chainID, version: 2, relayer };
  const sig = await ed.signAsync(enc.encode(signingString(txForSign)), key.priv);
  return {
    nonce: 0, value, receiver, sender: key.address, gasPrice: 1_000_000_000, gasLimit,
    data: dataB64, chainID, version: 2, relayer, signature: bytesToHex(sig),
  };
}

let failures = 0;
function check(name, cond) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
}

async function run() {
  console.log("\nVerifying relayer validation (gateway broadcast stubbed)\n");
  const key = await ephemeralInShard(relayerShard);

  // happy path: a valid recordAction co-signs + broadcasts (stub) => 200
  let r = await handleRelay({ body: { transaction: await buildSignedTx(key) }, ip: "test-happy" });
  check("valid recordAction → 200 + txHash", r.status === 200 && !!r.json.txHash);

  // wrong chain
  r = await handleRelay({ body: { transaction: await buildSignedTx(key, { chainID: "D" }) }, ip: "test-2" });
  check("wrong chainID → wrong_chain", r.json.error === "wrong_chain");

  // function not on the allowlist
  r = await handleRelay({ body: { transaction: await buildSignedTx(key, { data: "drainTreasury" }) }, ip: "test-3" });
  check("unlisted function → wrong_function", r.json.error === "wrong_function");

  // wrong receiver for an allowed function
  const otherContract = "erd1qqqqqqqqqqqqqpgq9tmxfe7dm4ndgzt4cx9z83mrj750kgnuenwscvaddk";
  r = await handleRelay({ body: { transaction: await buildSignedTx(key, { receiver: otherContract }) }, ip: "test-4" });
  check("wrong receiver → wrong_receiver", r.json.error === "wrong_receiver");

  // non-zero value
  r = await handleRelay({ body: { transaction: await buildSignedTx(key, { value: "1000000000000000000" }) }, ip: "test-5" });
  check("non-zero value → value_not_allowed", r.json.error === "value_not_allowed");

  // relayer field names someone else (tamper after signing; guard fires before sig check)
  const tamperedRelayer = await buildSignedTx(key);
  tamperedRelayer.relayer = otherContract;
  r = await handleRelay({ body: { transaction: tamperedRelayer }, ip: "test-6" });
  check("foreign relayer field → wrong_relayer", r.json.error === "wrong_relayer");

  // gas above the cap
  r = await handleRelay({ body: { transaction: await buildSignedTx(key, { gasLimit: 999_000_000 }) }, ip: "test-7" });
  check("gas over cap → gas_too_high", r.json.error === "gas_too_high");

  // missing signature
  const unsigned = await buildSignedTx(key);
  unsigned.signature = "";
  r = await handleRelay({ body: { transaction: unsigned }, ip: "test-8" });
  check("missing signature → unsigned", r.json.error === "unsigned");

  // tampered payload under a real-looking signature (verify must fail). Keep the
  // function allowlisted (setHandle) so it reaches the signature check.
  const tampered = await buildSignedTx(key, { data: "setHandle@6e6f7661" });
  tampered.data = b64("setHandle@6e6f7666"); // changed after signing
  r = await handleRelay({ body: { transaction: tampered }, ip: "test-9" });
  check("tampered data → bad_signature", r.json.error === "bad_signature");

  // NOTE: there is intentionally NO rate-limit guard to test — the score is the
  // count of real transactions, so bots/fast play are welcome by design.

  console.log("");
  if (failures === 0) {
    console.log("ALL CHECKS PASSED — every relayer guard behaves.\n");
    process.exit(0);
  } else {
    console.log(`${failures} CHECK(S) FAILED.\n`);
    process.exit(1);
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
