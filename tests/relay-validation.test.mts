// relay-validation.test.ts — the money path's guardrails, locked in.
//
// The relayer co-signs and pays gas, so its input validation is security-critical.
// This drives the POST handler directly with crafted transactions and asserts the
// rejections — including the two fixes that had no coverage: the gasPrice cap (a
// within-cap gasLimit at an inflated gasPrice was the one real drain vector) and the
// prototype-key guard (data="__proto__" used to 500 instead of a clean 400).
//
// Run: node --import tsx --test tests/relay-validation.test.ts  (npm run test:relay)
//
// The security-critical checks all fire BEFORE the shard + signature-verify steps, so
// a stub relayer key + a present-but-dummy sender signature is enough. We override the
// advertised relayer address to match the stub key and stub the network so nothing
// broadcasts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Account, UserSecretKey } from "@multiversx/sdk-core";

const SK_HEX = "0000000000000000000000000000000000000000000000000000000000000001";
const relayerAddr = new Account(UserSecretKey.fromString(SK_HEX)).address.toBech32();
process.env.RELAYER_SECRET_KEY = SK_HEX;
process.env.NEXT_PUBLIC_RELAYER_ADDRESS = relayerAddr;
// Insurance: no test below should reach a broadcast, but never touch the network.
(globalThis as unknown as { fetch: unknown }).fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({}),
});

const { POST } = await import("@/app/api/relay/route");

const TAP_COUNTER = "erd1qqqqqqqqqqqqqpgqlwv6l2zpx9v0uv6869tn90exv3vdplejppuq97k7r4";
const OTHER_CONTRACT = "erd1qqqqqqqqqqqqqpgqrxm0hn9tgwm3waey3ynx08uutur58y0kppuqgpd2xl"; // tug-of-war
const b64 = (s: string) => Buffer.from(s).toString("base64");
const DUMMY_SIG = "aa".repeat(64); // present but not verified on the early-400 paths

// A plainTx that is valid up to the check under test: recordTap -> tap-counter, no
// value, network-min gasPrice, in-cap gas, relayer = the stub address.
function tx(overrides: Record<string, unknown> = {}) {
  return {
    nonce: 0,
    value: "0",
    receiver: TAP_COUNTER,
    sender: relayerAddr,
    gasPrice: 1000000000,
    gasLimit: 6000000,
    data: b64("recordTap"),
    chainID: "T",
    version: 2,
    relayer: relayerAddr,
    signature: DUMMY_SIG,
    ...overrides,
  };
}
async function post(overrides?: Record<string, unknown>) {
  const req = new Request("http://localhost/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transaction: tx(overrides) }),
  });
  const res = await POST(req);
  return { status: res.status, body: (await res.json()) as { error?: string } };
}

test("a well-formed recordTap passes validation (control)", async () => {
  // Reaches the shard check (stub sender is in the relayer shard here) or later; the
  // point is it is NOT rejected by any of the field guards below.
  const { status, body } = await post();
  assert.notEqual(body.error, "bad_gas_price");
  assert.notEqual(body.error, "wrong_function");
  assert.notEqual(body.error, "wrong_receiver");
  assert.notEqual(body.error, "value_not_allowed");
  assert.ok(status < 500, `unexpected server error: ${JSON.stringify(body)}`);
});

test("gasPrice above the network minimum is rejected (drain vector)", async () => {
  const { status, body } = await post({ gasPrice: 1000000000 * 1000 });
  assert.equal(status, 400);
  assert.equal(body.error, "bad_gas_price");
});

test('data="__proto__" is a clean 400, not a 500', async () => {
  const { status, body } = await post({ data: b64("__proto__") });
  assert.equal(status, 400);
  assert.equal(body.error, "wrong_function");
});

test("an unrelayed function is rejected", async () => {
  const { status, body } = await post({ data: b64("frobnicate") });
  assert.equal(status, 400);
  assert.equal(body.error, "wrong_function");
});

test("the wrong receiver for a function is rejected", async () => {
  const { status, body } = await post({ receiver: OTHER_CONTRACT });
  assert.equal(status, 400);
  assert.equal(body.error, "wrong_receiver");
});

test("a non-zero value is rejected", async () => {
  const { status, body } = await post({ value: "1000000000000000000" });
  assert.equal(status, 400);
  assert.equal(body.error, "value_not_allowed");
});

test("a foreign relayer field is rejected", async () => {
  const { status, body } = await post({ relayer: TAP_COUNTER });
  assert.equal(status, 400);
  assert.equal(body.error, "wrong_relayer");
});

test("a missing sender signature is rejected", async () => {
  const { status, body } = await post({ signature: "" });
  assert.equal(status, 400);
  assert.equal(body.error, "unsigned");
});

test("gas above the function cap is rejected", async () => {
  const { status, body } = await post({ gasLimit: 999_000_000 });
  assert.equal(status, 400);
  assert.equal(body.error, "gas_too_high");
});
