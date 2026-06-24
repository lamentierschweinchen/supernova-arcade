// Relayer config — the one file you edit to point the relayer at YOUR contract.
//
// Safe to expose (addresses + public endpoints only). The relayer SIGNING KEY is
// NEVER here — it is read from the environment in relay.js (RELAYER_PEM or
// RELAYER_SECRET_KEY). Never commit a key.
//
// Everything overridable via env so you can change addresses without a code edit.

// ---- network (MultiversX testnet, where Supernova is scheduled to activate) ----
const CHAIN_ID = process.env.CHAIN_ID || "T";
const GATEWAY = process.env.GATEWAY || "https://testnet-gateway.multiversx.com";
const EXPLORER = process.env.EXPLORER || "https://testnet-explorer.multiversx.com";
const NUM_SHARDS = Number(process.env.NUM_SHARDS || 3);

// ---- your deployed contract + your relayer wallet ----
// CONTRACT: the arcade-game contract you deployed (see contract/scripts/deploy-testnet.sh).
// RELAYER_ADDRESS: the PUBLIC address of the relayer wallet. It MUST match the key
// set as RELAYER_PEM / RELAYER_SECRET_KEY in the environment, and SHOULD be in
// shard 0 so player keys (ground into its shard) stay intra-shard and fast.
const CONTRACT =
  process.env.CONTRACT ||
  "erd1qqqqqqqqqqqqqpgq0000000000000000000000000000000000000000000000"; // <-- replace after deploy
const RELAYER_ADDRESS =
  process.env.RELAYER_ADDRESS ||
  "erd1000000000000000000000000000000000000000000000000000000000000000"; // <-- replace with your relayer wallet

// ---- relayable operations ----------------------------------------------------
// One entry per function the relayer will sign for. THIS TABLE IS THE ALLOWLIST:
// a function not listed here is refused. Each entry pins
//   - receivers:   the exact contract(s) this function may target (anti-misuse),
//   - maxGasLimit: a hard gas ceiling so a single malformed call can't make the
//                  relayer overpay for gas. (This is gas hygiene, NOT a score cap
//                  or a rate limit — the score model is uncheatable by design, so
//                  there is deliberately no per-key rate limit or score bound.)
// Adding a function = adding one row.
//
// NOTE ON BOTS / RATE LIMITS: the Arcade score IS the count of real transactions,
// so a bot just generates more real onchain activity — which is the point. There
// is intentionally no rate limiting here. The only operational cost is the gas the
// relayer pays, so keep its testnet wallet funded (free from the faucet).
const RELAY_OPS = {
  // the uncheatable score path: one tx = one point.
  recordAction: { receivers: [CONTRACT], maxGasLimit: 6_000_000 + 100_000 },
  // set a handle once after scoring. Light call.
  setHandle: { receivers: [CONTRACT], maxGasLimit: 10_000_000 + 100_000 },
};

module.exports = {
  CHAIN_ID,
  GATEWAY,
  EXPLORER,
  NUM_SHARDS,
  CONTRACT,
  RELAYER_ADDRESS,
  RELAY_OPS,
};
