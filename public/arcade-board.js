// arcade-board.js — shared leaderboard helpers for every Supernova Arcade game.
//
// The onchain getTop* views SORT all players and run out of query gas past ~120
// players (tug-of-war + canvas already broke), so arcade-core games read the
// all-time board from /api/leaderboard?game=<id> (storage-parsed server-side, no
// gas limit, cached). Games with their own arcade.js (degen-dash, wen-moon,
// clawback) pass their getLeaderboard() rows instead. Either way every board
// renders the SAME way: top-N + a pinned "you" row when you're below the cut, so
// a player always sees their own position. One identity (the passport) everywhere.

/** Fetch a game's full all-time board (sorted desc) from the off-chain service.
 *  rows: [{ address (bech32), handle, score }]. Returns [] on any failure. */
export async function fetchGameBoard(game) {
  try {
    const r = await fetch(`/api/leaderboard?game=${encodeURIComponent(game)}`);
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.rows) ? d.rows : [];
  } catch (_e) {
    return [];
  }
}

/** From a full sorted board, take the top-N (each with .rank) and, when the
 *  player is ranked below N, their own row (with its real .rank) to pin.
 *  me = the player's bech32 address, or "" when not signed in. */
export function topPlusSelf(rows, me, topN = 10) {
  const mine = String(me || "").toLowerCase();
  const visible = rows.slice(0, topN).map((e, i) => ({ ...e, rank: i + 1 }));
  let self = null;
  if (mine) {
    const idx = rows.findIndex((e) => String(e.address || "").toLowerCase() === mine);
    if (idx >= topN) self = { ...rows[idx], rank: idx + 1 };
  }
  return { visible, self };
}

/** Is this entry the current player? (case-insensitive bech32 match.) */
export function isMe(addr, me) {
  return !!me && String(addr || "").toLowerCase() === String(me).toLowerCase();
}

/** The "···" gap row between the top-N and the pinned self row. Inline-styled so
 *  it needs no per-game CSS; works inside a <ul>/<ol> board. */
export const BOARD_GAP =
  '<li class="alb-gap" aria-hidden="true" style="list-style:none;text-align:center;letter-spacing:.3em;opacity:.35;font-size:10px;padding:2px 0;">&middot;&middot;&middot;</li>';
