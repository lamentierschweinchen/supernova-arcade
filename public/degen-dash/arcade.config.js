// arcade.config.js — the ONE file you edit on the web side for DEGEN DASH.
//
// Fill in your deployed contract and your relayer's PUBLIC address. Everything
// here is safe to expose (addresses + public endpoints). The relayer's SIGNING
// KEY never lives in the browser — it stays in the relayer's server env.
//
// Keep these values in sync with the server relayer config
// (src/lib/onchain/arcade.config.ts: DEGENDASH_CONTRACT + RELAYER_ADDRESS).

export const ARCADE_CONFIG = {
  // The deployed Degen Dash contract (from contract/scripts/deploy-testnet.sh).
  // Until deployed this is the all-zero "undeployed" placeholder, so the game runs
  // locally in PRACTICE mode and the relayer refuses to relay to it.
  contract: "erd1qqqqqqqqqqqqqpgqt4560zpw4yhdm0tmzj2thxkh9snerm58ppuqp7kyxt", // testnet, shard 0

  // The relayer's PUBLIC address (the gas payer). The client builds every tx with
  // this in the `relayer` field. It is in shard 0 (the shared arcade relayer).
  relayer: "erd1ru08dt4u5e0psfrwth38u0dfed0hw8289xqdd9yghl3ec24uppuq6hgphm", // shard 0 (shared hub relayer)
  relayerShard: 0,

  // Where the browser POSTs signed transactions. Same-origin (the dev server and
  // the Vercel function both expose /api/relay).
  relayUrl: "/api/relay",

  // MultiversX testnet — the public network on which Supernova is scheduled to
  // activate (600ms rounds), so a submission finalizes on the Supernova clock.
  api: "https://testnet-api.multiversx.com",
  explorer: "https://testnet-explorer.multiversx.com",
  chainID: "T",
  numShards: 3,

  // Gas limits per function (the relayer caps these server-side too). Mirrors the
  // server caps in src/lib/onchain/arcade.config.ts.
  gasPrice: 1_000_000_000,
  gas: {
    startRound: 30_000_000,
    collect: 8_000_000,
    endRound: 12_000_000,
    claim: 10_000_000,
    setHandle: 10_000_000,
  },
};
