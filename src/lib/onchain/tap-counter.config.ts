// Onchain TAP-COUNTER config for the Supernova Sprint "/onchain" experiment.
//
// This is a SEPARATE contract from the leaderboard. The "/onchain" page fires a
// real `recordTaps` transaction per tap (or per buffered window) and counts the
// ones that actually finalize on testnet. It reuses the same network, the same
// gasless relayer, and the same Relayed-v3 shard rule as the leaderboard path.
//
// NETWORK: MultiversX TESTNET, the public network currently running Supernova
// (600ms rounds), so each recordTaps finalizes on the Supernova clock. Testnet
// EGLD is free (faucet), so the relayer pays no real cost. Testnet can be reset,
// which would clear the counters; the UI frames it accordingly.
//
// These values are safe to expose to the client (addresses + public endpoints).
// The relayer SIGNING KEY is NOT here; it is read from process.env in the API
// route only (see app/api/relay/route.ts).

// Re-export the shared network + relayer values from the leaderboard config so
// there is a single source of truth for chain id, gateway, explorer, gas price,
// the relayer address, and the shard count.
export {
  CHAIN_ID,
  TESTNET_API,
  TESTNET_GATEWAY,
  TESTNET_EXPLORER,
  GAS_PRICE,
  RELAYER_ADDRESS,
  NUM_SHARDS,
} from "./leaderboard.config";

/**
 * The PRIMARY tap-counter — deployed in SHARD 0, the same shard as the relayer
 * and the ephemeral player keys. That makes every recordTaps an INTRA-SHARD
 * transaction (no cross-shard routing), so it finalizes on the Supernova clock
 * in ~sub-2s. This is the default for the /onchain experience.
 *
 * (The original tap-counter was in shard 1; from a shard-0 sender every tap was
 * a CROSS-shard tx, which is why finality trailed by several seconds. We keep
 * that shard-1 contract below for an optional "cross-shard" demo toggle.)
 *
 * Override with NEXT_PUBLIC_TAP_COUNTER_CONTRACT if redeployed (a redeploy uses
 * the next nonce and yields a different address). Confirm against DEPLOYED.md.
 */
export const TAP_COUNTER_CONTRACT =
  process.env.NEXT_PUBLIC_TAP_COUNTER_CONTRACT ||
  "erd1qqqqqqqqqqqqqpgqlwv6l2zpx9v0uv6869tn90exv3vdplejppuq97k7r4";

/**
 * The original tap-counter, in SHARD 1. From a shard-0 sender, a recordTaps to
 * this contract is CROSS-SHARD and finalizes a few seconds slower. Used only by
 * the optional secondary "cross-shard" toggle so players can feel the
 * difference; the primary experience uses the intra-shard contract above.
 */
export const TAP_COUNTER_CONTRACT_CROSSSHARD =
  process.env.NEXT_PUBLIC_TAP_COUNTER_CONTRACT_CROSSSHARD ||
  "erd1qqqqqqqqqqqqqpgq9tmxfe7dm4ndgzt4cx9z83mrj750kgnuenwscvaddk";

/** The contract endpoint the relayer is allowed to relay for taps. */
export const RECORD_TAPS_FUNCTION = "recordTaps";

/**
 * Gas limit for a recordTaps call. Two small storage writes + one event;
 * generous but capped. The relayer rejects transactions asking for more than
 * this. (Measured deploy/query left ~1.49e9 gas remaining out of 1.5e9 for a
 * read; a write of two u64 counters is comfortably under this.)
 */
export const RECORD_TAPS_GAS_LIMIT = 6_000_000;

/**
 * Per-call cap on `count`, mirrored from the contract's MAX_TAPS_PER_CALL.
 * The client clamps bundled windows to this; the contract also enforces it.
 */
export const MAX_TAPS_PER_CALL = 1_000;
