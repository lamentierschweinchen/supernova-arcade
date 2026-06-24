// verify-signing.mjs — proves the two halves of the gasless flow agree.
//
// The browser (web/arcade.js) signs a transaction with @noble/ed25519 over a
// canonical signing string. The relayer (relayer/relay.js) verifies that
// signature with @multiversx/sdk-core's UserVerifier over
// TransactionComputer.computeBytesForVerifying. If those two serializations ever
// disagree, every gasless submission would be rejected. This script reproduces
// the browser signing path with the SAME libraries the browser uses, then checks
// it against sdk-core exactly as the relayer does — no network, no deploy.
//
// Run: npm run verify:signing   (after npm install)

import * as ed from "@noble/ed25519";
import { bech32 } from "@scure/base";
import sdkCore from "@multiversx/sdk-core";

const { Transaction, TransactionComputer, UserVerifier, Address } = sdkCore;

const NUM_SHARDS = 3;
const RELAYER_SHARD = 0;
const RELAYER = "erd1ru08dt4u5e0psfrwth38u0dfed0hw8289xqdd9yghl3ec24uppuq6hgphm";
const CONTRACT = "erd1qqqqqqqqqqqqqpgqlwv6l2zpx9v0uv6869tn90exv3vdplejppuq97k7r4";

const enc = new TextEncoder();
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

// --- replicate web/arcade.js exactly ---
function shardOfPubkey(pub) {
  const last = pub[31];
  let shard = last & 3;
  if (shard > NUM_SHARDS - 1) shard = last & 1;
  return shard;
}
function addressFromPubkey(pub) {
  return bech32.encode("erd", bech32.toWords(pub), 256);
}
function signingString(tx) {
  return JSON.stringify({
    nonce: tx.nonce,
    value: tx.value,
    receiver: tx.receiver,
    sender: tx.sender,
    gasPrice: tx.gasPrice,
    gasLimit: tx.gasLimit,
    data: tx.dataB64,
    chainID: tx.chainID,
    version: tx.version,
    relayer: tx.relayer,
  });
}
async function generateEphemeral() {
  for (let i = 0; i < 500; i++) {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    if (shardOfPubkey(pub) === RELAYER_SHARD) return { priv, pub, address: addressFromPubkey(pub) };
  }
  throw new Error("could not grind a key into the relayer shard");
}

let failures = 0;
function check(name, cond) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
}

async function run() {
  console.log("\nVerifying browser-signing ⇄ relayer-verification contract\n");

  const key = await generateEphemeral();

  // 1. address derivation: @scure/base must agree with sdk-core
  const sdkAddr = new Address(key.pub).toBech32();
  check("ephemeral address: @scure/base == sdk-core", sdkAddr === key.address);
  check("ephemeral key landed in the relayer shard", shardOfPubkey(key.pub) === RELAYER_SHARD);

  // 2. build + sign each relayable payload the way the browser does, then verify
  //    it with sdk-core the way the relayer does.
  const cases = [
    { name: "recordAction", data: "recordAction" },
    { name: "setHandle", data: "setHandle@6e6f7661" },
  ];

  const txComputer = new TransactionComputer();

  for (const c of cases) {
    const dataB64 = b64(c.data);
    const txForSign = {
      nonce: 0,
      value: "0",
      receiver: CONTRACT,
      sender: key.address,
      gasPrice: 1_000_000_000,
      gasLimit: 6_000_000,
      dataB64,
      chainID: "T",
      version: 2,
      relayer: RELAYER,
    };
    const sig = await ed.signAsync(enc.encode(signingString(txForSign)), key.priv);

    const plainTx = {
      nonce: 0,
      value: "0",
      receiver: CONTRACT,
      sender: key.address,
      gasPrice: 1_000_000_000,
      gasLimit: 6_000_000,
      data: dataB64,
      chainID: "T",
      version: 2,
      relayer: RELAYER,
      signature: bytesToHex(sig),
    };

    // relayer path: reconstruct + verify
    const tx = Transaction.newFromPlainObject(plainTx);
    const verifyBytes = txComputer.computeBytesForVerifying(tx);
    const verifier = UserVerifier.fromAddress(tx.sender);
    const valid = await verifier.verify(verifyBytes, Buffer.from(tx.signature));

    check(`${c.name}: browser signature verifies under sdk-core`, valid === true);

    // the browser's signing bytes must equal sdk-core's verifying bytes
    const sameBytes = Buffer.from(enc.encode(signingString(txForSign))).equals(Buffer.from(verifyBytes));
    check(`${c.name}: signing string == sdk-core computeBytesForVerifying`, sameBytes);
  }

  console.log("");
  if (failures === 0) {
    console.log("ALL CHECKS PASSED — the browser and relayer agree.\n");
    process.exit(0);
  } else {
    console.log(`${failures} CHECK(S) FAILED.\n`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
