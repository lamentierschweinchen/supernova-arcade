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

export async function GET() {
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
