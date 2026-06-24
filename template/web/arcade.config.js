// arcade.config.js — the ONE file you edit on the web side.
//
// Fill in your deployed contract and your relayer's PUBLIC address. Everything
// here is safe to expose (addresses + public endpoints). The relayer's SIGNING
// KEY never lives in the browser — it stays in the relayer's server env.
//
// Keep these values in sync with relayer/config.js (CONTRACT + RELAYER_ADDRESS).

export const ARCADE_CONFIG = {
  // Your deployed arcade-game contract (from contract/scripts/deploy-testnet.sh).
  contract: "erd1qqqqqqqqqqqqqpgq0000000000000000000000000000000000000000000000", // <-- replace

  // The relayer's PUBLIC address (the gas payer). The client builds every tx with
  // this in the `relayer` field. It should be in shard 0 (relayerShard below).
  relayer: "erd1000000000000000000000000000000000000000000000000000000000000000", // <-- replace
  relayerShard: 0,

  // Where the browser POSTs signed transactions. Same-origin in this template
  // (the dev server and the Vercel function both expose /api/relay).
  relayUrl: "/api/relay",

  // MultiversX testnet — the public network on which Supernova is scheduled to
  // activate (600ms rounds), so a submission finalizes on the Supernova clock.
  api: "https://testnet-api.multiversx.com",
  explorer: "https://testnet-explorer.multiversx.com",
  chainID: "T",
  numShards: 3,

  // Gas limits per function (the relayer caps these server-side too).
  gasPrice: 1_000_000_000,
  gas: {
    recordAction: 6_000_000,
    setHandle: 10_000_000,
  },
};
