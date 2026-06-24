// Gasless relayer core (Relayed v3) — framework-agnostic.
//
// The player builds and signs a transaction in the browser with an ephemeral
// keypair (no wallet, no funds) and POSTs it here. This module adds the RELAYER
// signature and broadcasts it, so the relayer pays the testnet gas and the player
// pays nothing.
//
// TRUST MODEL: the relayer is a trusted component. It pays gas and can refuse. It
// only signs transactions that
//   (a) call an ALLOWED function (see config.RELAY_OPS) on the matching contract,
//   (b) name THIS relayer in the `relayer` field,
//   (c) carry no EGLD value,
//   (d) ask for gas within that function's cap (gas hygiene, not a score cap),
//   (e) come from a sender in the relayer's shard, and
//   (f) carry a valid sender signature.
// There is deliberately NO rate limiting and NO score bound: the Arcade score IS
// the count of real transactions, so it can't be faked without actually
// transacting, and a bot just generates more real onchain activity — which is the
// point. The only cost is the gas the relayer pays, so keep its wallet funded.
//
// KEY HANDLING: the relayer signing key is read from process.env ONLY. Set
// RELAYER_PEM (full PEM contents) OR RELAYER_SECRET_KEY (64-hex secret key).
// Never hardcode, never commit.
//
// This file has no framework dependency. Wire it to any HTTP layer:
//   - server.js     (zero-dependency node:http dev server + static hosting)
//   - api/relay.js  (Vercel / Next.js serverless function)

const {
  Account,
  AddressComputer,
  Transaction,
  TransactionComputer,
  UserSecretKey,
  UserVerifier,
} = require("@multiversx/sdk-core");

const cfg = require("./config");

const addressComputer = new AddressComputer();
const txComputer = new TransactionComputer();

/** Load the relayer account from env. Returns null if no key is configured. */
function loadRelayer() {
  const pem = process.env.RELAYER_PEM;
  const secretHex = process.env.RELAYER_SECRET_KEY;
  if (pem && pem.trim().length > 0) {
    return Account.newFromPem(pem);
  }
  if (secretHex && secretHex.trim().length > 0) {
    return new Account(UserSecretKey.fromString(secretHex.trim()));
  }
  return null;
}

/**
 * Validate, co-sign, and broadcast one relayed transaction.
 * @param {object} args
 * @param {object} args.body  parsed request body — `{ transaction }` or the tx itself
 * @param {string} args.ip    client IP (accepted for logging / a future shared guard; not rate-limited)
 * @returns {Promise<{status:number, json:object}>}
 */
async function handleRelay({ body, ip }) {
  // ---- load + sanity-check the relayer key ----
  let relayer;
  try {
    relayer = loadRelayer();
  } catch (err) {
    console.error("[relay] failed to load relayer key:", err);
    return { status: 500, json: { error: "relayer_misconfigured" } };
  }
  if (!relayer) {
    return {
      status: 503,
      json: {
        error: "relayer_unavailable",
        message: "The gasless relayer is not configured. Set RELAYER_PEM or RELAYER_SECRET_KEY.",
      },
    };
  }
  if (relayer.address.toBech32() !== cfg.RELAYER_ADDRESS) {
    console.error(
      "[relay] relayer key/address mismatch. key:",
      relayer.address.toBech32(),
      "expected:",
      cfg.RELAYER_ADDRESS,
    );
    return { status: 500, json: { error: "relayer_misconfigured" } };
  }

  // ---- parse the signed transaction ----
  const plain = body?.transaction ?? body;
  let tx;
  try {
    tx = Transaction.newFromPlainObject(plain);
  } catch (err) {
    console.error("[relay] bad transaction object:", err);
    return { status: 400, json: { error: "invalid_transaction" } };
  }

  // ---- validation: only relay what we intend to pay for ----

  // chain
  if (tx.chainID !== cfg.CHAIN_ID) {
    return { status: 400, json: { error: "wrong_chain", message: `expected chainID ${cfg.CHAIN_ID}` } };
  }

  // function must be one we relay. Data is `fn@arg...` for functions with
  // arguments and just `fn` for a no-arg function (recordAction). Take the name
  // before the first `@`, or the whole data when there is no `@`.
  const data = Buffer.from(tx.data ?? new Uint8Array()).toString("utf8");
  const atIndex = data.indexOf("@");
  const fnName = atIndex === -1 ? data : data.slice(0, atIndex);
  const op = fnName ? cfg.RELAY_OPS[fnName] : undefined;
  if (!op) {
    return {
      status: 400,
      json: { error: "wrong_function", message: `only ${Object.keys(cfg.RELAY_OPS).join(", ")} are relayed` },
    };
  }

  // NOTE: no rate limit. The score is the count of real transactions, so a player
  // (or a bot) can only raise it by doing more real onchain work — which is the
  // point. The relayer's only cost is gas; keep its wallet funded.

  // receiver must be one allowed for this function
  const receiver = tx.receiver.toBech32();
  if (!op.receivers.includes(receiver)) {
    return { status: 400, json: { error: "wrong_receiver", message: `wrong contract for ${fnName}` } };
  }

  // no value transfer
  if (tx.value !== BigInt(0)) {
    return { status: 400, json: { error: "value_not_allowed", message: "value must be 0" } };
  }

  // the relayer field must name THIS relayer
  const relayerField = tx.relayer?.toBech32?.() ?? "";
  if (relayerField !== cfg.RELAYER_ADDRESS) {
    return { status: 400, json: { error: "wrong_relayer", message: "relayer field must be this relayer" } };
  }

  // sender must be signed
  if (!tx.signature || tx.signature.length === 0) {
    return { status: 400, json: { error: "unsigned", message: "sender signature missing" } };
  }

  // gas cap (this function's ceiling)
  if (tx.gasLimit > BigInt(op.maxGasLimit)) {
    return { status: 400, json: { error: "gas_too_high", message: "gas limit exceeds relayer cap" } };
  }

  // Relayed v3 shard rule: sender must be in the relayer's shard
  try {
    const senderShard = addressComputer.getShardOfAddress(tx.sender);
    const relayerShard = addressComputer.getShardOfAddress(relayer.address);
    if (senderShard !== relayerShard) {
      return { status: 400, json: { error: "wrong_shard", message: `sender must be in shard ${relayerShard}` } };
    }
  } catch (err) {
    console.error("[relay] shard check failed:", err);
    return { status: 400, json: { error: "invalid_transaction" } };
  }

  // verify the sender's signature over the canonical signing bytes, so the relayer
  // never pays for a transaction the player did not actually sign
  try {
    const verifyBytes = txComputer.computeBytesForVerifying(tx);
    const verifier = UserVerifier.fromAddress(tx.sender);
    // verify() is async in sdk-core v15; awaiting is essential, else the returned
    // Promise is always truthy and the check is a no-op.
    const valid = await verifier.verify(verifyBytes, Buffer.from(tx.signature));
    if (!valid) {
      return { status: 400, json: { error: "bad_signature", message: "sender signature invalid" } };
    }
  } catch (err) {
    console.error("[relay] signature verification error:", err);
    return { status: 400, json: { error: "bad_signature", message: "could not verify sender signature" } };
  }

  // ---- sign as relayer and broadcast ----
  try {
    tx.relayerSignature = await relayer.signTransaction(tx);
    const hash = await broadcast(tx);
    return {
      status: 200,
      json: {
        txHash: hash,
        sender: tx.sender.toBech32(),
        explorerUrl: `${cfg.EXPLORER}/transactions/${hash}`,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "broadcast failed";
    console.error("[relay] broadcast failed:", message);
    return { status: 502, json: { error: "broadcast_failed", message } };
  }
}

/** Broadcast a fully-signed transaction to the gateway; return the tx hash. */
async function broadcast(tx) {
  const payload = tx.toPlainObject();
  const res = await fetch(`${cfg.GATEWAY}/transaction/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok || json?.error) {
    throw new Error(json?.error || `gateway ${res.status}`);
  }
  const hash = json?.data?.txHash;
  if (!hash) {
    throw new Error("gateway returned no txHash");
  }
  return hash;
}

module.exports = { handleRelay, loadRelayer };
