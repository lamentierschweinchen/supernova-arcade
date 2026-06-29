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
  SHARD_HYDRA_HUB_CONTRACT,
  SHARD_HYDRA_HEAD_CONTRACTS,
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
    ...SHARD_HYDRA_HEAD_CONTRACTS,
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
type GameCfg = { contract: string; scoreMapper?: string; view?: string; pointsView?: string };
// How each game's board is read off-chain (no onchain getTop* gas ceiling):
//  - scoreMapper: parse raw storage (<mapper>+addr). For the ARCADE-CORE games, whose
//    getTop* views OOM past ~120 players and whose /keys scales with players only (cheap).
//  - view: call the contract's getLeaderboard + decode ScoreEntry. For the SCORE games
//    (degen/wen-moon/clawback): getLeaderboard scales with players (works at our sizes),
//    while their raw /keys is dominated by action-scaling mappers (would grow unbounded).
//  - pointsView: the cabinet board is best-single-run (scoreMapper/view); the HUB board
//    is CUMULATIVE points (getTopPoints). ?metric=points reads this instead.
const GAME_BOARDS: Record<string, GameCfg> = {
  tugofwar: { contract: TUGOFWAR_CONTRACT, scoreMapper: "playerPulls" },
  canvas: { contract: CANVAS_CONTRACT, scoreMapper: "playerPixels" },
  button: { contract: BUTTON_CONTRACT, scoreMapper: "playerPoints" },
  reaction: { contract: REACTION_CONTRACT, scoreMapper: "reactions" },
  degendash: { contract: DEGENDASH_CONTRACT, view: "getLeaderboard", pointsView: "getTopPoints" },
  wenmoon: { contract: WENMOON_CONTRACT, view: "getLeaderboard", pointsView: "getTopPoints" },
  clawback: { contract: CLAWBACK_CONTRACT, view: "getLeaderboard", pointsView: "getTopPoints" },
  // The hub stores playerHits per address, but its /keys is dominated by
  // action-scaling attempt records (123 of 271 after 14 raids). Storage-parse
  // would fetch the whole growing keyspace each time, so read the player-scaling
  // getLeaderboard view instead — same pattern as the other score games.
  shardhydra: { contract: SHARD_HYDRA_HUB_CONTRACT, view: "getLeaderboard" },
};

type GameRow = { address: string; handle: string; score: number };
type RawRow = { addrHex: string; handle: string; score: number };
const boardCache = new Map<string, { at: number; rows: GameRow[] }>();
const rawCache = new Map<string, { at: number; rows: RawRow[] }>();

function toBech32(addrHex: string): string {
  try {
    return new Address(Buffer.from(addrHex, "hex")).toBech32();
  } catch {
    return "";
  }
}

// one base64 ScoreEntry: address(32) + handleLen(4 BE) + handle + score(8 BE),
// then an OPTIONAL trailing ts(8 BE). The score games (degen/wen-moon/clawback)
// carry the timestamp; the Shard Hydra hub omits it. We never read ts, so accept
// either length — validate only through the score field at 36 + handle + 8.
function decodeScoreEntry(b64: string): RawRow | null {
  try {
    const b = Buffer.from(b64, "base64");
    if (b.length < 36) return null;
    const addrHex = b.subarray(0, 32).toString("hex");
    const hlen = b.readUInt32BE(32);
    if (b.length < 36 + hlen + 8) return null;
    const handle = b.subarray(36, 36 + hlen).toString("utf8");
    const score = Number(b.readBigUInt64BE(36 + hlen));
    return { addrHex, handle, score };
  } catch {
    return null;
  }
}

// fetch one game's raw rows (addrHex, handle, score), cached. Storage-parse or view.
async function fetchRows(game: string, cfg: GameCfg): Promise<RawRow[]> {
  const hit = rawCache.get(game);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  let rows: RawRow[] = [];
  try {
    if (cfg.view) {
      const r = await fetch(`${API}/vm-values/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scAddress: cfg.contract, funcName: cfg.view, args: [] }),
        cache: "no-store",
      });
      if (!r.ok) return hit ? hit.rows : [];
      const parts = (((await r.json()) as { data?: { data?: { returnData?: string[] } } })?.data?.data?.returnData) || [];
      rows = parts.map(decodeScoreEntry).filter((e): e is RawRow => e !== null);
    } else {
      const r = await fetch(`${API}/address/${cfg.contract}/keys`, { cache: "no-store" });
      if (!r.ok) return hit ? hit.rows : [];
      const pairs = (((await r.json()) as { data?: { pairs?: Record<string, string> } })?.data?.pairs) || {};
      const sm = cfg.scoreMapper as string;
      const sp = Buffer.from(sm, "utf8").toString("hex");
      const hp = Buffer.from("handle", "utf8").toString("hex");
      const sl = (sm.length + 32) * 2;
      const hl = (6 + 32) * 2;
      const by = new Map<string, { handle: string; score: number }>();
      const slot = (a: string) => by.get(a) || { handle: "", score: 0 };
      for (const [k, v] of Object.entries(pairs)) {
        if (k.length === sl && k.startsWith(sp)) {
          const a = k.slice(sp.length);
          const e = slot(a);
          e.score = v ? Number(BigInt("0x" + v)) : 0;
          by.set(a, e);
        } else if (k.length === hl && k.startsWith(hp)) {
          const a = k.slice(hp.length);
          const e = slot(a);
          e.handle = v ? Buffer.from(v, "hex").toString("utf8") : "";
          by.set(a, e);
        }
      }
      rows = [...by.entries()].map(([addrHex, e]) => ({ addrHex, handle: e.handle, score: e.score }));
    }
  } catch {
    return hit ? hit.rows : [];
  }
  rawCache.set(game, { at: Date.now(), rows });
  return rows;
}

// global handle map — a player's chosen name from ANY game, so a name set in one
// game shows on EVERY board (name persistence). Cached.
let handleCache: { at: number; map: Map<string, string> } | null = null;
async function globalHandles(): Promise<Map<string, string>> {
  if (handleCache && Date.now() - handleCache.at < CACHE_MS) return handleCache.map;
  const map = new Map<string, string>();
  await Promise.all(
    Object.entries(GAME_BOARDS).map(async ([game, cfg]) => {
      if (isPlaceholder(cfg.contract)) return;
      const rows = await fetchRows(game, cfg);
      for (const r of rows) if (r.handle && !map.has(r.addrHex)) map.set(r.addrHex, r.handle);
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

  const raw = await fetchRows(game, cfg);
  const gh = await globalHandles(); // a name set on ANY game shows on this board too
  const rows = raw
    .filter((e) => e.score > 0)
    .map((e) => ({ address: toBech32(e.addrHex), handle: e.handle || gh.get(e.addrHex) || "", score: e.score }))
    .filter((e) => e.address)
    .sort((a, b) => b.score - a.score);
  boardCache.set(game, { at: Date.now(), rows });
  return rows;
}

// the HUB "points board" metric: cumulative points (getTopPoints) per player, decoded
// + global-handle overlaid + sorted, cached. Distinct from the cabinet's best-run board.
async function pointsBoard(game: string): Promise<GameRow[] | null> {
  const cfg = GAME_BOARDS[game];
  if (!cfg || !cfg.pointsView || isPlaceholder(cfg.contract)) return null;
  const key = `${game}:points`;
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const raw = await fetchRows(key, { contract: cfg.contract, view: cfg.pointsView });
  const gh = await globalHandles();
  const rows = raw
    .filter((e) => e.score > 0)
    .map((e) => ({ address: toBech32(e.addrHex), handle: e.handle || gh.get(e.addrHex) || "", score: e.score }))
    .filter((e) => e.address)
    .sort((a, b) => b.score - a.score);
  boardCache.set(key, { at: Date.now(), rows });
  return rows;
}

export async function GET(request: Request) {
  // ?game=X -> that game's cabinet board (best run); &metric=points -> the hub's
  // cumulative-points board for that game. No game -> the daily board.
  const params = new URL(request.url).searchParams;
  const game = params.get("game");
  if (game) {
    const metric = params.get("metric");
    const rows = metric === "points" ? await pointsBoard(game) : await gameBoard(game);
    if (rows === null) return NextResponse.json({ error: "unknown_game" }, { status: 404 });
    return NextResponse.json({ game, metric: metric === "points" ? "points" : "best", count: rows.length, rows });
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
