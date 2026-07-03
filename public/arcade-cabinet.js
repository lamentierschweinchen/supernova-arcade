// arcade-cabinet.js — the shared cabinet UI kit.
//
// Every simple cabinet (tug-of-war, canvas, triptych, button, reaction) carried its
// own byte-identical (or noun-swapped) copy of these helpers: the status toast, the
// onchain feed card, the top-10 + self-row leaderboard, the tx status poller, and the
// send-error toast. This module is the ONE copy. A cabinet does:
//
//   import { $, fmt, makeCabinetKit } from "/arcade-cabinet.js";
//   const client = createArcadeClient("tugofwar");
//   const { setStatus, renderFeed, renderLeaderboard, pollTx, handleSendError } =
//     makeCabinetKit(client, { noun: "pulls", emptyText: "No pulls yet. Be the first.", getFeed: () => S.feed });
//
// It assumes the standard cabinet markup ids (status, statusText, feed, feedCard,
// leaderboard) — all five cabinets already use them. Dependency-light, US English.

import { topPlusSelf, BOARD_GAP } from "/arcade-board.js";

export const $ = (id) => document.getElementById(id);
export const fmt = (n) => (n == null ? "···" : Number(n).toLocaleString("en-US"));
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * @param client  the arcade-core client (needs .explorer, .address, .txStatus)
 * @param opts
 *   noun       plural noun for the send-error toast ("pulls", "pixels", "presses"...)
 *   emptyText  the leaderboard empty state
 *   getFeed    () => the cabinet's feed array (newest-first, capped)
 *   scoreText  (entry) => the board's score cell text; default fmt(entry.score)
 *   feedLabel  (entry) => extra feed-row HTML (triptych's shard tag); default none
 *   onResolve  (entry, outcome) => side effect on a tx settling; outcome is
 *              "final" | "failed" | "timeout" | "dropped". Button uses it to clear
 *              its "saving…" counter. Default none.
 */
export function makeCabinetKit(client, opts = {}) {
  const {
    noun = "actions",
    emptyText = "No scores yet. Be the first.",
    getFeed = () => [],
    scoreText = (e) => fmt(e.score),
    feedLabel = null,
    onResolve = null,
  } = opts;

  function setStatus(kind, html) {
    $("status").className = "status " + (kind || "");
    $("statusText").innerHTML = html;
  }

  function renderFeed() {
    const feed = getFeed();
    if (!feed || !feed.length) return;
    $("feedCard").classList.remove("hidden");
    $("feed").innerHTML = feed
      .map(
        (e) =>
          `<li><span class="tag ${e.state}">${e.state}</span>` +
          (e.hash
            ? `<a href="${client.explorer}/transactions/${e.hash}" target="_blank" rel="noopener">${e.hash.slice(0, 10)}…</a>`
            : `<span>${esc(e.note || "")}</span>`) +
          (feedLabel ? feedLabel(e) : "") +
          `</li>`,
      )
      .join("");
  }

  function renderLeaderboard(entries) {
    const ul = $("leaderboard");
    if (!entries || !entries.length) {
      ul.innerHTML = `<li><span class="empty">${esc(emptyText)}</span></li>`;
      return;
    }
    const me = String(client.address || "").toLowerCase();
    const row = (e) => {
      const you = String(e.address).toLowerCase() === me;
      const name = e.handle && e.handle.length ? e.handle : e.address.slice(0, 6) + "…" + e.address.slice(-4);
      return `<li><span class="rank">${e.rank}</span><span class="who ${you ? "you" : ""}">${esc(name)}${you ? " (you)" : ""}</span><span class="sc">${scoreText(e)}</span></li>`;
    };
    const { visible, self } = topPlusSelf(entries, client.address, 10); // top 10 + your own row if below
    ul.innerHTML = visible.map(row).join("") + (self ? BOARD_GAP + row(self) : "");
  }

  // Poll a feed entry to a terminal tx status. The guard stops polling an entry that
  // has been pushed off the capped feed by faster actions — without it a fast tapper
  // spawns a status loop per action (previously only tug-of-war had this guard).
  async function pollTx(entry) {
    for (let i = 0; i < 26; i++) {
      await new Promise((r) => setTimeout(r, 600));
      if (!getFeed().includes(entry)) {
        if (onResolve) onResolve(entry, "dropped");
        return;
      }
      const st = await client.txStatus(entry.hash);
      if (st === "success") {
        entry.state = "final";
        if (onResolve) onResolve(entry, "final");
        renderFeed();
        return;
      }
      if (st === "fail" || st === "invalid") {
        entry.state = "failed";
        if (onResolve) onResolve(entry, "failed");
        renderFeed();
        return;
      }
    }
    if (onResolve) onResolve(entry, "timeout");
  }

  function handleSendError(err) {
    const code = err && err.code;
    if (code === "rate_limited") {
      setStatus("warn", `Going fast. You hit the relayer's per-minute limit. Your ${noun} still count here; onchain resumes in a moment.`);
    } else if (code === "relayer_unavailable" || code === "not_deployed") {
      setStatus("warn", `The onchain layer is <b>warming up</b>. Your ${noun} count here for now and go onchain shortly.`);
    } else if (code === "network") {
      setStatus("err", `Network hiccup reaching the relayer. Your ${noun} still count here.`);
    } else {
      setStatus("warn", `Onchain submission is unavailable this moment. Your ${noun} still count here.`);
    }
  }

  return { setStatus, renderFeed, renderLeaderboard, pollTx, handleSendError };
}
