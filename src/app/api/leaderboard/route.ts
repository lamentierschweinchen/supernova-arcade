// GET /api/leaderboard?window=daily
//
// The DAILY arcade leaderboard. The onchain boards are all-time only, so "today"
// is computed here: count each game contract's successful transactions since
// 00:00 UTC, tallied per SENDER. Every player signs with their persistent passport
// key (the gasless relayer only co-signs as `relayer`, never as `sender`), so the
// sender IS the player and one tx is one real onchain action. Result is cached in
// memory ~2 min and the contracts are fetched in parallel, so a warm hit is instant.
//
// Scope note: capped at MAX_PAGES per contract (a generous bound for testnet
// volume). If a single game ever sustains more than that in a day, its daily
// tally becomes a lower bound — the upgrade path is a cron + KV snapshot.
import { NextResponse } from "next/server";
import {
  TUGOFWAR_CONTRACT,
  CANVAS_CONTRACT,
  BUTTON_CONTRACT,
  REACTION_CONTRACT,
  CLAWBACK_CONTRACT,
  DEGENDASH_CONTRACT,
  WENMOON_CONTRACT,
  isPlaceholder,
} from "@/lib/onchain/arcade.config";
import { TAP_COUNTER_CONTRACT } from "@/lib/onchain/tap-counter.config";
import { Address } from "@multiversx/sdk-core";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API = "https://testnet-api.multiversx.com";
const CACHE_MS = 120_000;
const PAGE = 50;
const MAX_PAGES = 12; // up to 600 txs/contract/day; a lower bound above that

function gameContracts(): string[] {
  return [
    TUGOFWAR_CONTRACT,
    CANVAS_CONTRACT,
    BUTTON_CONTRACT,
    REACTION_CONTRACT,
    CLAWBACK_CONTRACT,
    DEGENDASH_CONTRACT,
    WENMOON_CONTRACT,
    TAP_COUNTER_CONTRACT,
  ].filter((a) => a && !isPlaceholder(a));
}

function utcMidnight(): number {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
}

async function countContract(contract: string, after: number, tally: Map<string, number>) {
  for (let page = 0; page < MAX_PAGES; page++) {
    let txs: Array<{ sender?: string }> = [];
    try {
      const r = await fetch(
        `${API}/accounts/${contract}/transactions?after=${after}&status=success&size=${PAGE}&from=${page * PAGE}&fields=sender`,
        { cache: "no-store" },
      );
      if (!r.ok) break;
      txs = await r.json();
    } catch {
      break;
    }
    if (!Array.isArray(txs) || txs.length === 0) break;
    for (const tx of txs) {
      if (tx.sender) tally.set(tx.sender, (tally.get(tx.sender) || 0) + 1);
    }
    if (txs.length < PAGE) break; // last page
  }
}

type Cache = { at: number; day: number; rows: Array<{ address: string; actions: number }> };
let cache: Cache | null = null;

// ---- all-time per-game board (storage-parsed, no gas limit) ----
// Every arcade-core game stores <scoreMapper>+address -> u64 score and
// handle+address -> name. The onchain getTop* views SORT all players and run out
// of query gas past ~120 players (tug-of-war + canvas are already broken), so we
// read the raw storage via /keys and sort off-chain. Scales to any player count.
const GAME_BOARDS: Record<string, { contract: string; scoreMapper: string }> = {
  tugofwar: { contract: TUGOFWAR_CONTRACT, scoreMapper: "playerPulls" },
  canvas: { contract: CANVAS_CONTRACT, scoreMapper: "playerPixels" },
  button: { contract: BUTTON_CONTRACT, scoreMapper: "playerPoints" },
  reaction: { contract: REACTION_CONTRACT, scoreMapper: "reactions" },
};

type GameRow = { address: string; handle: string; score: number };
const boardCache = new Map<string, { at: number; rows: GameRow[] }>();

function toBech32(addrHex: string): string {
  try {
    return new Address(Buffer.from(addrHex, "hex")).toBech32();
  } catch {
    return "";
  }
}

// global handle map — a player's chosen name from ANY arcade-core game, so a name
// set in one game shows on EVERY board (name persistence). Cached like the boards.
let handleCache: { at: number; map: Map<string, string> } | null = null;
async function globalHandles(): Promise<Map<string, string>> {
  if (handleCache && Date.now() - handleCache.at < CACHE_MS) return handleCache.map;
  const map = new Map<string, string>();
  const handlePrefix = Buffer.from("handle", "utf8").toString("hex");
  const handleKeyLen = (6 + 32) * 2;
  await Promise.all(
    Object.values(GAME_BOARDS).map(async (cfg) => {
      if (isPlaceholder(cfg.contract)) return;
      try {
        const r = await fetch(`${API}/address/${cfg.contract}/keys`, { cache: "no-store" });
        if (!r.ok) return;
        const pairs = (((await r.json()) as { data?: { pairs?: Record<string, string> } })?.data?.pairs) || {};
        for (const [k, v] of Object.entries(pairs)) {
          if (k.length === handleKeyLen && k.startsWith(handlePrefix) && v) {
            const a = k.slice(handlePrefix.length);
            const h = Buffer.from(v, "hex").toString("utf8");
            if (h && !map.has(a)) map.set(a, h); // first non-empty name wins
          }
        }
      } catch {
        /* skip this game */
      }
    }),
  );
  handleCache = { at: Date.now(), map };
  return map;
}

async function gameBoard(game: string): Promise<GameRow[] | null> {
  const cfg = GAME_BOARDS[game];
  if (!cfg || isPlaceholder(cfg.contract)) return null;
  const hit = boardCache.get(game);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;

  let pairs: Record<string, string> = {};
  try {
    const r = await fetch(`${API}/address/${cfg.contract}/keys`, { cache: "no-store" });
    if (!r.ok) return hit ? hit.rows : [];
    pairs = (((await r.json()) as { data?: { pairs?: Record<string, string> } })?.data?.pairs) || {};
  } catch {
    return hit ? hit.rows : [];
  }

  // storage keys are hex(mapperName) + hex(address-32-bytes). Match by exact length + prefix.
  const scorePrefix = Buffer.from(cfg.scoreMapper, "utf8").toString("hex");
  const handlePrefix = Buffer.from("handle", "utf8").toString("hex");
  const scoreKeyLen = (cfg.scoreMapper.length + 32) * 2;
  const handleKeyLen = (6 + 32) * 2;

  const byAddr = new Map<string, { handle: string; score: number }>();
  const slot = (a: string) => byAddr.get(a) || { handle: "", score: 0 };
  for (const [k, v] of Object.entries(pairs)) {
    if (k.length === scoreKeyLen && k.startsWith(scorePrefix)) {
      const a = k.slice(scorePrefix.length);
      const e = slot(a);
      e.score = v ? Number(BigInt("0x" + v)) : 0;
      byAddr.set(a, e);
    } else if (k.length === handleKeyLen && k.startsWith(handlePrefix)) {
      const a = k.slice(handlePrefix.length);
      const e = slot(a);
      e.handle = v ? Buffer.from(v, "hex").toString("utf8") : "";
      byAddr.set(a, e);
    }
  }

  // overlay the global handle so a name set on ANY game shows on this board too
  const gh = await globalHandles();
  for (const [a, e] of byAddr) {
    if (!e.handle && gh.has(a)) e.handle = gh.get(a) as string;
  }

  const rows = [...byAddr.entries()]
    .filter(([, e]) => e.score > 0)
    .map(([a, e]) => ({ address: toBech32(a), handle: e.handle, score: e.score }))
    .filter((e) => e.address)
    .sort((a, b) => b.score - a.score);
  boardCache.set(game, { at: Date.now(), rows });
  return rows;
}

export async function GET(request: Request) {
  // ?game=canvas -> that game's all-time board (storage-parsed). No game -> daily.
  const game = new URL(request.url).searchParams.get("game");
  if (game) {
    const rows = await gameBoard(game);
    if (rows === null) return NextResponse.json({ error: "unknown_game" }, { status: 404 });
    return NextResponse.json({ game, count: rows.length, rows });
  }
  const after = utcMidnight();
  if (cache && cache.day === after && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({ window: "daily", day: after, rows: cache.rows, cached: true });
  }
  const tally = new Map<string, number>();
  await Promise.all(gameContracts().map((c) => countContract(c, after, tally)));
  const rows = [...tally.entries()]
    .map(([address, actions]) => ({ address, actions }))
    .sort((a, b) => b.actions - a.actions);
  cache = { at: Date.now(), day: after, rows };
  return NextResponse.json({ window: "daily", day: after, rows, cached: false });
}
