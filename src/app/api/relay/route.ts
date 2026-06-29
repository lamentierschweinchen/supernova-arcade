// src/app/api/relay/route.ts
//
// Gasless relayer for the Supernova Sprint onchain demos (Relayed v3).
//
// The player builds and signs a transaction in the browser with an ephemeral
// keypair (no wallet, no funds). They POST the signed transaction here. This
// route adds the RELAYER signature (Relayed v3) and broadcasts it, so the
// RELAYER pays the testnet gas and the player pays nothing.
//
// Two operations are relayed (additively; each pins its own receiver + caps):
//   - `submitScore` -> the leaderboard contract  (the /supernova-sprint game)
//   - `recordTaps`  -> the tap-counter contract   (the /onchain experiment)
//
// TRUST MODEL: the relayer is a trusted component. It pays gas and can refuse or
// rate-limit. It only signs transactions that (a) call an ALLOWED function on
// the matching known contract, (b) name THIS relayer in the `relayer` field,
// (c) carry no EGLD value, and (d) ask for gas within that operation's cap. It
// does not validate the payload's meaning: v1 scores / tap counts are
// client-computed and spoofable by design (see the contracts + the brief). That
// is acceptable for a fun community demo on a test network.
//
// RELAYED v3 SHARD RULE: the transaction sender (ephemeral key) must be in the
// same shard as the relayer. The client guarantees this by generating the
// ephemeral key in the relayer's shard before signing. This route also rejects
// a sender in a different shard, so a bad client gets a clear error instead of a
// protocol-level failure.
//
// KEY HANDLING: the relayer signing key is read from process.env only. Set
// RELAYER_PEM (full PEM file contents) OR RELAYER_SECRET_KEY (64-hex secret key)
// as a Vercel env var. Never hardcoded, never committed.

import { NextResponse } from "next/server";
import {
  Account,
  AddressComputer,
  Transaction,
  TransactionComputer,
  UserSecretKey,
  UserVerifier,
} from "@multiversx/sdk-core";
import {
  CHAIN_ID,
  LEADERBOARD_CONTRACT,
  ONCHAIN_LEADERBOARD_CONTRACT,
  RELAYER_ADDRESS,
  SUBMIT_FUNCTION,
  SUBMIT_GAS_LIMIT,
  TESTNET_GATEWAY,
  TESTNET_EXPLORER,
} from "@/lib/onchain/leaderboard.config";
import {
  TAP_COUNTER_CONTRACT,
  TAP_COUNTER_CONTRACT_CROSSSHARD,
  RECORD_TAPS_FUNCTION,
  RECORD_TAPS_GAS_LIMIT,
} from "@/lib/onchain/tap-counter.config";
import {
  TUGOFWAR_CONTRACT,
  CANVAS_CONTRACT,
  BUTTON_CONTRACT,
  REACTION_CONTRACT,
  CLAWBACK_CONTRACT,
  DEGENDASH_CONTRACT,
  PULL_FUNCTION,
  PLACE_PIXEL_FUNCTION,
  PRESS_FUNCTION,
  REACT_FUNCTION,
  START_ROUND_FUNCTION,
  CLAW_BACK_FUNCTION,
  END_ROUND_FUNCTION,
  CLAIM_FUNCTION,
  COLLECT_FUNCTION,
  PULL_GAS_LIMIT,
  PLACE_PIXEL_GAS_LIMIT,
  PRESS_GAS_LIMIT,
  REACT_GAS_LIMIT,
  START_ROUND_GAS_LIMIT,
  CLAW_BACK_GAS_LIMIT,
  END_ROUND_GAS_LIMIT,
  CLAIM_GAS_LIMIT,
  COLLECT_GAS_LIMIT,
  WENMOON_CONTRACT,
  STARTRUN_FUNCTION,
  CALL_FUNCTION,
  CASHOUT_FUNCTION,
  STARTRUN_GAS_LIMIT,
  CALL_GAS_LIMIT,
  CASHOUT_GAS_LIMIT,
  SHARD_HYDRA_HUB_CONTRACT,
  SHARD_HYDRA_HEAD_CONTRACTS,
  JOIN_RAID_FUNCTION,
  HIT_FUNCTION,
  RESOLVE_MISS_FUNCTION,
  JOIN_RAID_GAS_LIMIT,
  HIT_GAS_LIMIT,
  RESOLVE_MISS_GAS_LIMIT,
  isPlaceholder,
} from "@/lib/onchain/arcade.config";

// Arcade cabinet receivers that are actually deployed. A cabinet whose address
// is still the undeployed placeholder is dropped here, so the relayer never
// relays to a non-existent contract (those games play locally until deployed).
const ARCADE_RECEIVERS = [
  TUGOFWAR_CONTRACT,
  CANVAS_CONTRACT,
  BUTTON_CONTRACT,
  REACTION_CONTRACT,
  CLAWBACK_CONTRACT,
  DEGENDASH_CONTRACT,
  WENMOON_CONTRACT,
  SHARD_HYDRA_HUB_CONTRACT,
].filter((addr) => !isPlaceholder(addr));

// The plain-object shape accepted by Transaction.newFromPlainObject, derived
// from the function signature so we do not depend on the type's export name.
type PlainTxObject = Parameters<typeof Transaction.newFromPlainObject>[0];

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // sdk-core crypto needs the Node runtime

const addressComputer = new AddressComputer();
const txComputer = new TransactionComputer();

// ---- relayable operations ----
//
// One entry per function the relayer will sign for. Each entry pins the exact
// receiver contract for that function, a gas ceiling (so a malicious client
// cannot drain the relayer), and a per-IP rate budget. Adding an operation here
// is the ONLY change needed to relay a new function — the validation below is
// driven entirely off this table, so the existing submitScore path keeps its own
// receiver, gas cap, and 12/min budget unchanged.
type RelayOp = {
  /** Receiver contracts this function may target. One function can serve more
   *  than one deployed instance: submitScore for both leaderboard boards (the
   *  main game's, shard 1; the onchain sprint's, shard 0), and recordTaps for
   *  both the intra-shard tap-counter (shard 0) and the original cross-shard one
   *  (shard 1, used only by the optional cross-shard demo toggle). */
  receivers: string[];
  /** Hard gas ceiling for this function (data bytes + execution). */
  maxGasLimit: number;
  /** Per-IP rate budget for this function. */
  rateMax: number;
};

const RATE_WINDOW_MS = 60_000;

const RELAY_OPS: Record<string, RelayOp> = {
  // The leaderboard path — the main game's board (shard 1) AND the onchain
  // sprint's board (shard 0). Same function + gas profile; budget unchanged.
  [SUBMIT_FUNCTION]: {
    receivers: [LEADERBOARD_CONTRACT, ONCHAIN_LEADERBOARD_CONTRACT],
    maxGasLimit: SUBMIT_GAS_LIMIT + 100_000,
    rateMax: 12, // submissions per IP per window
  },
  // The /onchain tap path — the primary intra-shard tap-counter (shard 0) AND
  // the original cross-shard one (shard 1, only via the cross-shard toggle).
  // Per-tap mode fires one tx per tap, so a human mashing (~8-12 taps/s) far
  // exceeds 12/min. Supernova's fast finality keeps per-sender pending low at
  // human rates; this budget gives a single player ample room for a full session
  // while still capping a single IP. The client also offers a bundled mode that
  // collapses many taps into one tx if a player hits this.
  [RECORD_TAPS_FUNCTION]: {
    receivers: [TAP_COUNTER_CONTRACT, TAP_COUNTER_CONTRACT_CROSSSHARD],
    maxGasLimit: RECORD_TAPS_GAS_LIMIT + 100_000,
    rateMax: 1200, // taps (or bundles) per IP per window
  },
  // The uncheatable sprint-score path: one recordTap = one real tx (no claimable
  // count argument). Shard-0 tap-counter only (the scored board); the cross-shard
  // demo stays on recordTaps. Same high per-IP budget as recordTaps.
  recordTap: {
    receivers: [TAP_COUNTER_CONTRACT],
    maxGasLimit: RECORD_TAPS_GAS_LIMIT + 100_000,
    rateMax: 1200,
  },
  // Username for the caller's address, set once at the end of a run. The client
  // reuses the leaderboard gas budget (lbGasLimit = SUBMIT_GAS_LIMIT), so cap it
  // to match. setHandle is light and consumes far less; the relayer only pays the
  // gas actually consumed. Low rate budget. Shared by the Sprint tap-counter AND
  // the Arcade cabinets (tug-of-war, canvas), all of which expose setHandle.
  setHandle: {
    receivers: [TAP_COUNTER_CONTRACT, ...ARCADE_RECEIVERS],
    maxGasLimit: SUBMIT_GAS_LIMIT + 100_000,
    rateMax: 30,
  },
  // --- Supernova Arcade cabinets (additive; each pins its own receiver + caps) ---
  // Tug-of-war: one `pull` = one tx = +1 to a side (uncheatable, no claimable
  // count). Tappy game, so it gets the same high per-IP budget as the taps path;
  // Supernova's fast finality keeps per-sender pending low at human rates.
  [PULL_FUNCTION]: {
    receivers: isPlaceholder(TUGOFWAR_CONTRACT) ? [] : [TUGOFWAR_CONTRACT],
    maxGasLimit: PULL_GAS_LIMIT + 100_000,
    rateMax: 5000, // flagship: 4 players may share one event-WiFi IP and pool this budget; 1200 throttled them mid-game
  },
  // Canvas: one `placePixel` = one tx = one pixel. The contract enforces a
  // per-address cooldown and the client mirrors it, so a single key paces itself;
  // this per-IP budget caps a single source painting from many keys at once.
  [PLACE_PIXEL_FUNCTION]: {
    receivers: isPlaceholder(CANVAS_CONTRACT) ? [] : [CANVAS_CONTRACT],
    maxGasLimit: PLACE_PIXEL_GAS_LIMIT + 100_000,
    rateMax: 240,
  },
  // The Button: one `press` = one tx = one press (resets the shared timer). A
  // human presses a handful of times per round, but allow headroom for a hot
  // button; same shape as the other cabinets.
  [PRESS_FUNCTION]: {
    receivers: isPlaceholder(BUTTON_CONTRACT) ? [] : [BUTTON_CONTRACT],
    maxGasLimit: PRESS_GAS_LIMIT + 100_000,
    rateMax: 600,
  },
  // Reaction Arcade: one `react` = one tx = +1 landed reaction (uncheatable, no
  // arguments). A human lands roughly one reaction per 1-3s; allow ample headroom
  // for a fast run, same shape as the other tappy cabinets.
  [REACT_FUNCTION]: {
    receivers: isPlaceholder(REACTION_CONTRACT) ? [] : [REACTION_CONTRACT],
    maxGasLimit: REACT_GAS_LIMIT + 100_000,
    rateMax: 1200,
  },
  // --- Clawback + Degen Dash (self-contained forks; small round lifecycles) ---
  // Both expose startRound/endRound/claim (shared NAMES), so each of those ops
  // lists BOTH deployed contracts as allowed receivers (placeholders filtered out);
  // the receiver check still pins each tx to a real contract. Their per-tap paths
  // are DISTINCT functions: Clawback's `clawBack`, Degen Dash's `collect`. Both get
  // the tap-sized budget; the lifecycle fns fire about once per round.
  [START_ROUND_FUNCTION]: {
    receivers: [CLAWBACK_CONTRACT, DEGENDASH_CONTRACT].filter((a) => !isPlaceholder(a)),
    maxGasLimit: START_ROUND_GAS_LIMIT + 100_000,
    rateMax: 60,
  },
  [CLAW_BACK_FUNCTION]: {
    receivers: isPlaceholder(CLAWBACK_CONTRACT) ? [] : [CLAWBACK_CONTRACT],
    maxGasLimit: CLAW_BACK_GAS_LIMIT + 100_000,
    rateMax: 1200,
  },
  [COLLECT_FUNCTION]: {
    receivers: isPlaceholder(DEGENDASH_CONTRACT) ? [] : [DEGENDASH_CONTRACT],
    maxGasLimit: COLLECT_GAS_LIMIT + 100_000,
    rateMax: 1200,
  },
  [END_ROUND_FUNCTION]: {
    receivers: [CLAWBACK_CONTRACT, DEGENDASH_CONTRACT].filter((a) => !isPlaceholder(a)),
    maxGasLimit: END_ROUND_GAS_LIMIT + 100_000,
    rateMax: 60,
  },
  [CLAIM_FUNCTION]: {
    receivers: [CLAWBACK_CONTRACT, DEGENDASH_CONTRACT, WENMOON_CONTRACT].filter((a) => !isPlaceholder(a)),
    maxGasLimit: CLAIM_GAS_LIMIT + 100_000,
    rateMax: 60,
  },
  // --- Wen Moon (provably-fair press-your-luck; its own contract + ops) ---
  // startRun mints the bankroll + seeds the run; `call` is the per-call VRF draw
  // (high-frequency, tap-sized budget); cashOut banks. claim (above) + setHandle
  // (ARCADE_RECEIVERS) already include this contract.
  [STARTRUN_FUNCTION]: {
    receivers: isPlaceholder(WENMOON_CONTRACT) ? [] : [WENMOON_CONTRACT],
    maxGasLimit: STARTRUN_GAS_LIMIT + 100_000,
    rateMax: 60,
  },
  [CALL_FUNCTION]: {
    receivers: isPlaceholder(WENMOON_CONTRACT) ? [] : [WENMOON_CONTRACT],
    maxGasLimit: CALL_GAS_LIMIT + 100_000,
    rateMax: 1200,
  },
  [CASHOUT_FUNCTION]: {
    receivers: isPlaceholder(WENMOON_CONTRACT) ? [] : [WENMOON_CONTRACT],
    maxGasLimit: CASHOUT_GAS_LIMIT + 100_000,
    rateMax: 60,
  },
  // Shard Hydra: join the shared fight at the hub, hit the visibly attacking
  // shard head, then resolve that attack through its expected head after the
  // cross-shard grace period. All three writes are signed Relayed-v3 txs.
  [JOIN_RAID_FUNCTION]: {
    receivers: isPlaceholder(SHARD_HYDRA_HUB_CONTRACT) ? [] : [SHARD_HYDRA_HUB_CONTRACT],
    maxGasLimit: JOIN_RAID_GAS_LIMIT + 100_000,
    rateMax: 60,
  },
  [HIT_FUNCTION]: {
    receivers: SHARD_HYDRA_HEAD_CONTRACTS.filter((address) => !isPlaceholder(address)),
    maxGasLimit: HIT_GAS_LIMIT + 100_000,
    rateMax: 1200,
  },
  [RESOLVE_MISS_FUNCTION]: {
    receivers: SHARD_HYDRA_HEAD_CONTRACTS.filter((address) => !isPlaceholder(address)),
    maxGasLimit: RESOLVE_MISS_GAS_LIMIT + 100_000,
    rateMax: 1200,
  },
};

// Lightweight in-memory rate limit per client IP, scoped PER FUNCTION. The
// relayer pays gas, so this caps spam from a single source. Best-effort only: it
// resets on cold start and is per-instance, not a substitute for a real shared
// limiter, but it raises the cost of trivially draining the relayer. Scoping by
// function means the high tap budget cannot weaken the leaderboard's budget.
const rateHits = new Map<string, number[]>();

function rateLimited(ip: string, fn: string, max: number): boolean {
  const now = Date.now();
  const key = `${fn}:${ip}`;
  const hits = (rateHits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateHits.set(key, hits);
  // opportunistic cleanup so the map does not grow unbounded
  if (rateHits.size > 5000) {
    for (const [k, v] of rateHits) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) rateHits.delete(k);
    }
  }
  return hits.length > max;
}

/** Load the relayer account from env. Returns null if no key is configured. */
async function loadRelayer(): Promise<Account | null> {
  const pem = process.env.RELAYER_PEM;
  const secretHex = process.env.RELAYER_SECRET_KEY;

  if (pem && pem.trim().length > 0) {
    return Account.newFromPem(pem);
  }
  if (secretHex && secretHex.trim().length > 0) {
    const secretKey = UserSecretKey.fromString(secretHex.trim());
    return new Account(secretKey);
  }
  return null;
}

export async function POST(request: Request) {
  let relayer: Account | null;
  try {
    relayer = await loadRelayer();
  } catch (err) {
    console.error("[/api/relay] Failed to load relayer key:", err);
    return NextResponse.json(
      { error: "relayer_misconfigured" },
      { status: 500 },
    );
  }

  // No key configured: tell the client cleanly so it can fail soft (the game
  // still plays and reveals; the onchain card just shows an unavailable state).
  if (!relayer) {
    return NextResponse.json(
      {
        error: "relayer_unavailable",
        message:
          "The gasless relayer is not configured. Set RELAYER_PEM or RELAYER_SECRET_KEY.",
      },
      { status: 503 },
    );
  }

  // Client IP for rate limiting (the relayer pays gas; cap single-source spam).
  // The actual limit is applied below, once we know which function this is, so
  // each operation is metered against its own budget.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  // Sanity: the configured key must match the advertised relayer address.
  if (relayer.address.toBech32() !== RELAYER_ADDRESS) {
    console.error(
      "[/api/relay] Relayer key/address mismatch. key:",
      relayer.address.toBech32(),
      "expected:",
      RELAYER_ADDRESS,
    );
    return NextResponse.json(
      { error: "relayer_misconfigured" },
      { status: 500 },
    );
  }

  // Parse the signed transaction sent by the client.
  let plain: Record<string, unknown>;
  try {
    const body = await request.json();
    plain = body?.transaction ?? body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  let tx: Transaction;
  try {
    tx = Transaction.newFromPlainObject(plain as unknown as PlainTxObject);
  } catch (err) {
    console.error("[/api/relay] Bad transaction object:", err);
    return NextResponse.json({ error: "invalid_transaction" }, { status: 400 });
  }

  // ---- validation: only relay what we intend to pay for ----

  // chain
  if (tx.chainID !== CHAIN_ID) {
    return NextResponse.json(
      { error: "wrong_chain", message: `expected chainID ${CHAIN_ID}` },
      { status: 400 },
    );
  }

  // function must be one we relay. The data field is `fn@arg...` for functions
  // with arguments (submitScore, recordTaps, setHandle) and just `fn` for a no-arg
  // function (recordTap). Take the name before the first `@`, or the whole data
  // when there is no `@`. Empty data yields an empty name and is rejected below.
  const data = Buffer.from(tx.data ?? new Uint8Array()).toString("utf8");
  const atIndex = data.indexOf("@");
  const fnName = atIndex === -1 ? data : data.slice(0, atIndex);
  const op = fnName ? RELAY_OPS[fnName] : undefined;
  if (!op) {
    return NextResponse.json(
      {
        error: "wrong_function",
        message: `only ${Object.keys(RELAY_OPS).join(", ")} are relayed`,
      },
      { status: 400 },
    );
  }

  // Rate limit per client IP, against THIS function's budget. Scoping by
  // function keeps the high tap budget from weakening the leaderboard's budget.
  if (rateLimited(ip, fnName, op.rateMax)) {
    return NextResponse.json(
      { error: "rate_limited", message: "too many requests, slow down" },
      { status: 429 },
    );
  }

  // receiver must be one of the contracts allowed for this function
  const receiver = tx.receiver.toBech32();
  if (!op.receivers.includes(receiver)) {
    return NextResponse.json(
      { error: "wrong_receiver", message: `wrong contract for ${fnName}` },
      { status: 400 },
    );
  }

  // no value transfer
  if (tx.value !== BigInt(0)) {
    return NextResponse.json(
      { error: "value_not_allowed", message: "value must be 0" },
      { status: 400 },
    );
  }

  // the relayer field must name THIS relayer
  const relayerField = tx.relayer?.toBech32?.() ?? "";
  if (relayerField !== RELAYER_ADDRESS) {
    return NextResponse.json(
      { error: "wrong_relayer", message: "relayer field must be this relayer" },
      { status: 400 },
    );
  }

  // sender must be signed and present
  if (!tx.signature || tx.signature.length === 0) {
    return NextResponse.json(
      { error: "unsigned", message: "sender signature missing" },
      { status: 400 },
    );
  }

  // gas cap (this function's ceiling)
  if (tx.gasLimit > BigInt(op.maxGasLimit)) {
    return NextResponse.json(
      { error: "gas_too_high", message: "gas limit exceeds relayer cap" },
      { status: 400 },
    );
  }

  // Relayed v3 shard rule: sender must be in the relayer's shard.
  try {
    const senderShard = addressComputer.getShardOfAddress(tx.sender);
    const relayerShard = addressComputer.getShardOfAddress(relayer.address);
    if (senderShard !== relayerShard) {
      return NextResponse.json(
        {
          error: "wrong_shard",
          message: `sender must be in shard ${relayerShard}`,
        },
        { status: 400 },
      );
    }
  } catch (err) {
    console.error("[/api/relay] Shard check failed:", err);
    return NextResponse.json({ error: "invalid_transaction" }, { status: 400 });
  }

  // verify the sender's signature over the canonical signing bytes, so the
  // relayer never pays for a transaction the player did not actually sign
  try {
    const verifyBytes = txComputer.computeBytesForVerifying(tx);
    const verifier = UserVerifier.fromAddress(tx.sender);
    // verify() is async in sdk-core v15; awaiting is essential, otherwise the
    // returned Promise is always truthy and the check is a no-op.
    const valid = await verifier.verify(verifyBytes, Buffer.from(tx.signature));
    if (!valid) {
      return NextResponse.json(
        { error: "bad_signature", message: "sender signature invalid" },
        { status: 400 },
      );
    }
  } catch (err) {
    console.error("[/api/relay] Signature verification error:", err);
    return NextResponse.json(
      { error: "bad_signature", message: "could not verify sender signature" },
      { status: 400 },
    );
  }

  // ---- sign as relayer and broadcast ----
  try {
    const relayerSignature = await relayer.signTransaction(tx);
    tx.relayerSignature = relayerSignature;

    const hash = await broadcast(tx);
    return NextResponse.json({
      txHash: hash,
      sender: tx.sender.toBech32(),
      explorerUrl: `${TESTNET_EXPLORER}/transactions/${hash}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "broadcast failed";
    console.error("[/api/relay] Broadcast failed:", message);
    return NextResponse.json(
      { error: "broadcast_failed", message },
      { status: 502 },
    );
  }
}

/**
 * Broadcast a fully-signed transaction to the testnet gateway and return the
 * transaction hash. Uses the gateway's /transaction/send endpoint directly to
 * keep the dependency surface small.
 */
async function broadcast(tx: Transaction): Promise<string> {
  const payload = tx.toPlainObject();
  const res = await fetch(`${TESTNET_GATEWAY}/transaction/send`, {
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
