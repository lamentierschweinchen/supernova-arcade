// Onchain leaderboard config for the Supernova Sprint game.
//
// NETWORK: MultiversX TESTNET. Testnet is the public network currently running
// Supernova (600ms rounds), so a player's real score submission finalizes on
// the Supernova clock. Testnet EGLD is free (faucet), so the relayer pays no
// real cost. Testnet is a test network and can be reset, which would clear the
// leaderboard; the UI frames it accordingly.
//
// These values are safe to expose to the client (addresses + public endpoints).
// The relayer SIGNING KEY is NOT here; it is read from process.env in the API
// route only (see app/api/relay/route.ts).

/** Testnet chain id. */
export const CHAIN_ID = "T";

/** Testnet API (Elastic-backed). Used for reads (account, query, tx status). */
export const TESTNET_API = "https://testnet-api.multiversx.com";

/** Testnet gateway (observing-squad proxy). Used by the relayer to broadcast. */
export const TESTNET_GATEWAY = "https://testnet-gateway.multiversx.com";

/** Testnet explorer base. */
export const TESTNET_EXPLORER = "https://testnet-explorer.multiversx.com";

/**
 * The deployed leaderboard contract address on testnet.
 *
 * Default below is the address predicted for a deploy from the project's
 * generated deployer wallet at nonce 0 (deterministic from deployer + nonce).
 * It becomes live once the contract is actually deployed from that wallet.
 *
 * If the contract is deployed from a different wallet or nonce, set
 * NEXT_PUBLIC_LEADERBOARD_CONTRACT in the environment to override without a
 * code change. Always confirm the real address against the deploy output.
 */
export const LEADERBOARD_CONTRACT =
  process.env.NEXT_PUBLIC_LEADERBOARD_CONTRACT ||
  "erd1qqqqqqqqqqqqqpgqpy7j8ha5pkudun8qleh7l0zjdxnnjnulenwsynzhhf";

/**
 * The ONCHAIN-SPRINT leaderboard: a SECOND instance of this same contract,
 * deployed in SHARD 0 (the relayer's shard) so the sprint's submitScore is an
 * intra-shard, fast-finality transaction. The /onchain 30s sprint submits its
 * score — the count of transactions that actually FINALIZED in the run — here,
 * on its own board, kept separate from the main game's tap-score board above.
 *
 * Override with NEXT_PUBLIC_ONCHAIN_LEADERBOARD_CONTRACT if redeployed.
 */
export const ONCHAIN_LEADERBOARD_CONTRACT =
  process.env.NEXT_PUBLIC_ONCHAIN_LEADERBOARD_CONTRACT ||
  "erd1qqqqqqqqqqqqqpgqh9wpfl0mt337h68z8cuv6w6mkfucqv5tppuqsxz6sp";

/** The contract endpoint the relayer is allowed to relay. */
export const SUBMIT_FUNCTION = "submitScore";

/**
 * Gas limit for a submitScore call. Storage writes + the event; generous but
 * capped. The relayer rejects transactions asking for more than this.
 */
export const SUBMIT_GAS_LIMIT = 10_000_000;

/** Gas price (testnet min). */
export const GAS_PRICE = 1_000_000_000;

/**
 * The relayer's public address (the gas payer). The client must build the
 * transaction with this exact address in the `relayer` field, and the relayer
 * route verifies it signs only transactions naming itself as relayer.
 *
 * RELAYED v3 CONSTRAINT: the transaction SENDER (the ephemeral player key) must
 * be in the SAME SHARD as this relayer. This relayer is in shard 0, so the
 * client generates the ephemeral keypair until its address lands in shard 0.
 *
 * Overridable via NEXT_PUBLIC_RELAYER_ADDRESS so the public address can be
 * swapped if Lukas uses a different relayer wallet. It must match the wallet
 * whose key is set as RELAYER_PEM/RELAYER_SECRET_KEY in the relayer route env.
 */
export const RELAYER_ADDRESS =
  process.env.NEXT_PUBLIC_RELAYER_ADDRESS ||
  "erd1ru08dt4u5e0psfrwth38u0dfed0hw8289xqdd9yghl3ec24uppuq6hgphm";

/** Number of shards (without metachain) on MultiversX. */
export const NUM_SHARDS = 3;
