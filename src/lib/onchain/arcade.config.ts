// Onchain config for the Supernova ARCADE seed games (tug-of-war + canvas).
//
// These two cabinets reuse the SAME network, the SAME gasless relayer, and the
// SAME Relayed-v3 shard rule as the Sprint stack. This file is the server-side
// source of truth for their contract addresses and relay limits; the relayer
// route imports it to authorize `pull` / `placePixel` additively (see
// app/api/relay/route.ts). The matching client constants live in
// public/arcade-core.js (static cabinets can't read NEXT_PUBLIC at runtime).
//
// NOT DEPLOYED YET. The defaults below are an explicit "undeployed" placeholder
// (the all-zero system address). Until the real addresses are set, the relayer
// will NOT relay to a placeholder receiver and each game plays locally with its
// onchain layer shown as "scheduled". After deploying the contracts (shard 0,
// from the relayer wallet — see marketing/games/onchain/*/scripts), set:
//   - NEXT_PUBLIC_TUGOFWAR_CONTRACT  (server relayer, here)
//   - NEXT_PUBLIC_CANVAS_CONTRACT    (server relayer, here)
//   - the matching addresses in public/arcade-core.js (the client cabinets)
//
// Safe to expose (addresses + public endpoints). The relayer SIGNING KEY is NOT
// here; it is read from process.env in the API route only.

// Re-export the shared network + relayer values so there is a single source of
// truth for chain id, gateway, explorer, gas price, the relayer address, etc.
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
 * Explicit "not deployed yet" sentinel: the all-zero system SC address. It is a
 * valid bech32 address (so client/SDK parsing never throws), but the relayer
 * treats it as unconfigured and refuses to relay to it. Replace via the env vars
 * below once the contracts are live.
 */
export const UNDEPLOYED_PLACEHOLDER =
  "erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu";

/**
 * The TUG-OF-WAR contract (shard 0). Set NEXT_PUBLIC_TUGOFWAR_CONTRACT after
 * deploy. See marketing/games/onchain/tug-of-war-contract.
 */
export const TUGOFWAR_CONTRACT =
  process.env.NEXT_PUBLIC_TUGOFWAR_CONTRACT ||
  "erd1qqqqqqqqqqqqqpgqrxm0hn9tgwm3waey3ynx08uutur58y0kppuqgpd2xl"; // testnet, shard 0

/**
 * The SUPERNOVA CANVAS contract (shard 0). Set NEXT_PUBLIC_CANVAS_CONTRACT after
 * deploy. See marketing/games/onchain/canvas-contract.
 */
export const CANVAS_CONTRACT =
  process.env.NEXT_PUBLIC_CANVAS_CONTRACT ||
  "erd1qqqqqqqqqqqqqpgqxex6j5ucqqmgurwpxunf428jnrck53a9ppuqg93s3t"; // testnet, shard 0

/**
 * THE BUTTON contract (shard 0). Set NEXT_PUBLIC_BUTTON_CONTRACT after deploy.
 * See marketing/games/onchain/button-contract.
 */
export const BUTTON_CONTRACT =
  process.env.NEXT_PUBLIC_BUTTON_CONTRACT ||
  "erd1qqqqqqqqqqqqqpgqm4z4vf7h2y0dmcadrj66ucxkda7950mqppuqz09pgl"; // testnet, shard 0

/**
 * THE REACTION ARCADE contract (shard 0). Set NEXT_PUBLIC_REACTION_CONTRACT after
 * deploy. See marketing/games/onchain/reaction-contract.
 */
export const REACTION_CONTRACT =
  process.env.NEXT_PUBLIC_REACTION_CONTRACT ||
  "erd1qqqqqqqqqqqqqpgqfhn8axyds26pz6lue7akns6de9f0qaakppuqjxjact"; // testnet, shard 0

/**
 * THE CLAWBACK contract (shard 0). Set NEXT_PUBLIC_CLAWBACK_CONTRACT after deploy.
 * See marketing/games/clawback (a self-contained fork; its client lives at
 * public/clawback/). Unlike the other cabinets it has a small round lifecycle —
 * startRound / clawBack / endRound / claim — so it gets four relay ops below.
 */
export const CLAWBACK_CONTRACT =
  process.env.NEXT_PUBLIC_CLAWBACK_CONTRACT ||
  "erd1qqqqqqqqqqqqqpgq5prt7nz84my2926d4xs9sw9dyz9j2s4uppuqkvnrrs"; // testnet, shard 0

/**
 * THE DEGEN DASH contract (shard 0). Set NEXT_PUBLIC_DEGENDASH_CONTRACT after deploy.
 * See marketing/games/degen-dash (a self-contained fork; its client lives at
 * public/degen-dash/). Like Clawback it has a small round lifecycle —
 * startRound / collect / endRound / claim. The high-frequency path is `collect`.
 * Undeployed by default (placeholder), so the relayer refuses it and the cabinet
 * plays locally in practice mode until the real address is set.
 */
export const DEGENDASH_CONTRACT =
  process.env.NEXT_PUBLIC_DEGENDASH_CONTRACT ||
  "erd1qqqqqqqqqqqqqpgqs7wzfzuc0wju7kdna4528ntz4hcywdrlppuqtn4h8w"; // testnet, shard 0

/**
 * THE WEN MOON contract (shard 0). Deployed; owner = the relayer. NOVA-558b9d is
 * configured and the contract holds ESDTLocalMint, so startRun mints the bankroll
 * and claim mints kept NOVA. See marketing/games/onchain/wen-moon-contract.
 */
export const WENMOON_CONTRACT =
  process.env.NEXT_PUBLIC_WENMOON_CONTRACT ||
  "erd1qqqqqqqqqqqqqpgq83errjg5avj4d8tmpwpc33ckl9ywp0erppuqna027f"; // testnet, shard 0

/**
 * SHARD HYDRA uses one score hub plus three identical head contracts deployed
 * across execution shards 0, 1, and 2. All players see the same attacking head.
 * The first source-shard tap is settled by the hub into damage or a lost life.
 */
export const SHARD_HYDRA_HUB_CONTRACT =
  process.env.NEXT_PUBLIC_SHARD_HYDRA_HUB_CONTRACT ||
  "erd1qqqqqqqqqqqqqpgqa3dyjwv8r74md5wq0n3cfuvh98w24zmdppuqjufe9x"; // bite-back testnet hub, shard 0
export const SHARD_HYDRA_HEAD_0_CONTRACT =
  process.env.NEXT_PUBLIC_SHARD_HYDRA_HEAD_0_CONTRACT ||
  "erd1qqqqqqqqqqqqqpgqdra35g6vnytdh8lnuuhpth4xs46xvjvqppuqgh7u5r"; // bite-back testnet head, shard 0
export const SHARD_HYDRA_HEAD_1_CONTRACT =
  process.env.NEXT_PUBLIC_SHARD_HYDRA_HEAD_1_CONTRACT ||
  "erd1qqqqqqqqqqqqqpgq6w5as8ku03k4ag2wzygdyzcux0c98lmrx63sf3ctpx"; // bite-back testnet head, shard 1
export const SHARD_HYDRA_HEAD_2_CONTRACT =
  process.env.NEXT_PUBLIC_SHARD_HYDRA_HEAD_2_CONTRACT ||
  "erd1qqqqqqqqqqqqqpgqgam85mljt0jz4tfj2uvky0n2mrefm6da5cdqlr79w9"; // bite-back testnet head, shard 2
export const SHARD_HYDRA_HEAD_CONTRACTS = [
  SHARD_HYDRA_HEAD_0_CONTRACT,
  SHARD_HYDRA_HEAD_1_CONTRACT,
  SHARD_HYDRA_HEAD_2_CONTRACT,
];

/** Relayed endpoints for the cabinets. */
export const PULL_FUNCTION = "pull";
export const PLACE_PIXEL_FUNCTION = "placePixel";
export const PRESS_FUNCTION = "press";
export const REACT_FUNCTION = "react";
// Clawback round lifecycle (the player's recalls are the high-frequency txs).
export const START_ROUND_FUNCTION = "startRound";
export const CLAW_BACK_FUNCTION = "clawBack";
export const END_ROUND_FUNCTION = "endRound";
export const CLAIM_FUNCTION = "claim";
// Degen Dash round lifecycle. startRound / endRound / claim are shared function
// NAMES with Clawback, but pin DIFFERENT receivers — each op below lists only its
// own contract, so a startRound/endRound/claim for Degen Dash is authorized only
// against the Degen Dash contract (and vice versa). `collect` is its per-tap path.
export const COLLECT_FUNCTION = "collect";
// Wen Moon: provably-fair press-your-luck. startRun mints the bankroll; `call` is the
// per-call VRF draw (high-frequency path); cashOut banks; claim mints kept NOVA.
export const STARTRUN_FUNCTION = "startRun";
export const CALL_FUNCTION = "call";
export const CASHOUT_FUNCTION = "cashOut";
export const JOIN_RAID_FUNCTION = "joinRaid";
export const HIT_FUNCTION = "hit";
export const RESOLVE_MISS_FUNCTION = "resolveMiss";

/**
 * Gas ceilings. `pull` does a handful of small storage writes (plus, on a round
 * roll, a few more). `placePixel` rewrites the whole board buffer (~1 KB) plus
 * small counters. Generous but capped; the relayer only pays gas actually
 * consumed and rejects anything asking for more than this.
 */
export const PULL_GAS_LIMIT = 8_000_000;
export const PLACE_PIXEL_GAS_LIMIT = 15_000_000;
export const PRESS_GAS_LIMIT = 8_000_000;
// `react` does a couple of small storage writes + the event; same shape as pull.
export const REACT_GAS_LIMIT = 8_000_000;
// Clawback: `startRound` sums the round's totals up front (heaviest); `clawBack`
// is the per-tap recall; `endRound` tallies; `claim` mints the kept NOVA.
export const START_ROUND_GAS_LIMIT = 30_000_000;
export const CLAW_BACK_GAS_LIMIT = 8_000_000;
export const END_ROUND_GAS_LIMIT = 12_000_000;
export const CLAIM_GAS_LIMIT = 10_000_000;
// Degen Dash: same lifecycle profile as Clawback. `startRound` sums the good total
// up front (heaviest); `collect` is the per-tap grab; `endRound` tallies; `claim`
// mints the collected NOVA. Same caps; the relayer only pays gas actually consumed.
export const COLLECT_GAS_LIMIT = 8_000_000;
// Wen Moon: startRun mints the bankroll (ESDT localMint) + seeds the run; `call`
// draws the VRF outcome + settles; cashOut banks. Generous caps; the relayer only
// pays gas actually consumed.
export const STARTRUN_GAS_LIMIT = 20_000_000;
export const CALL_GAS_LIMIT = 12_000_000;
export const CASHOUT_GAS_LIMIT = 12_000_000;
// Joining seeds or joins the shared raid. A hit sends one async attempt report.
// Resolution can settle several missed attacks chronologically before reporting
// the player's authoritative lives and score.
export const JOIN_RAID_GAS_LIMIT = 10_000_000;
export const HIT_GAS_LIMIT = 14_000_000;
export const RESOLVE_MISS_GAS_LIMIT = 30_000_000;

/**
 * True when an address is still the undeployed placeholder. The relayer uses
 * this to drop placeholder receivers from its allow-list so it never relays to
 * a non-existent contract.
 */
export function isPlaceholder(address: string): boolean {
  return address === UNDEPLOYED_PLACEHOLDER;
}
