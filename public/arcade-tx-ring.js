// arcade-tx-ring.js — the live transaction ring. Shell-level chrome.
//
// A tiny ring of dots in the corner, one per recent onchain transaction, colored
// by its REAL status (polled from the chain). It pulses as txs fire and settle —
// the VISUAL twin of the arcade's sound (both are driven by the same real
// transactions). Invisible-by-default stays the rule: the ring is small and
// ambient, never the main event. Tap it to expand: the recent txs with explorer
// links — glanceable PROOF that every tap is a real MultiversX transaction, for
// the curious (and the skeptics) without a technical dashboard.
//
// Mounted ONCE by the shell, which feeds it each game's tx hashes (the games
// postMessage `arcade:tx` up; the shell tags the current game and calls addTx).
// Self-contained, dependency-free, US English, on-canon.

const API = "https://testnet-api.multiversx.com";
const EXPLORER = "https://testnet-explorer.multiversx.com";
const MAX_DOTS = 18; // recent txs shown around the ring
const POLL_MS = 1500;
const POLL_TRIES = 16; // ~24s; Supernova finalizes in ~1-2s, this just bounds the unknown case
const CONFIRMING_MS = 700; // brief blue->purple->green flourish on settle

const STATUS = {
  pending: { color: "#3b82f6", fill: false, label: "Pending" },
  confirming: { color: "#a855f7", fill: false, label: "Confirming" },
  confirmed: { color: "#22c55e", fill: true, label: "Confirmed" },
  cancelled: { color: "#f59e0b", fill: true, label: "Cancelled" },
  failed: { color: "#ef4444", fill: true, label: "Failed" },
  unknown: { color: "#6b7280", fill: false, label: "Unknown" },
};

const CSS = `
.atr-wrap{position:fixed;z-index:2147482000;bottom:calc(14px + env(safe-area-inset-bottom));right:calc(14px + env(safe-area-inset-right));font-family:'JetBrains Mono',ui-monospace,monospace;}
.atr-ring{width:38px;height:38px;padding:3px;border:0;background:rgba(10,13,18,.55);border-radius:999px;cursor:pointer;display:block;
  -webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);transition:transform .25s, box-shadow .35s;outline:none;}
.atr-ring:hover{box-shadow:0 0 14px rgba(35,247,221,.22);}
.atr-ring svg{width:100%;height:100%;display:block;overflow:visible;}
.atr-wrap.pulse .atr-ring{transform:scale(1.12);box-shadow:0 0 18px rgba(35,247,221,.4);}
.atr-dot-new{filter:drop-shadow(0 0 3px currentColor);}
.atr-panel{position:absolute;bottom:48px;right:0;width:280px;max-width:84vw;background:rgba(10,13,18,.96);
  border:1px solid #1e2330;border-radius:14px;padding:13px 14px;box-shadow:0 16px 40px rgba(0,0,0,.5);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);display:none;color:#9ba3b4;}
.atr-wrap.open .atr-panel{display:block;}
.atr-head{font-family:'Roobert PRO',system-ui,sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7385;margin:0 0 9px;}
.atr-list{list-style:none;margin:0 0 10px;padding:0;max-height:188px;overflow:auto;}
.atr-list li{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11px;}
.atr-list .d{width:8px;height:8px;border-radius:999px;flex:0 0 auto;}
.atr-list a{color:#cfd4de;text-decoration:none;font-size:11px;}
.atr-list a:hover{color:#23f7dd;text-decoration:underline;}
.atr-list .g{color:#6b7385;flex:1;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.atr-empty{font-size:11px;color:#6b7385;padding:6px 0 10px;line-height:1.5;}
.atr-legend{display:flex;flex-wrap:wrap;gap:6px 12px;border-top:1px solid #181c27;padding-top:9px;font-size:9.5px;color:#6b7385;}
.atr-legend span{display:inline-flex;align-items:center;gap:5px;}
.atr-legend i{width:7px;height:7px;border-radius:999px;}
.atr-foot{margin-top:9px;font-size:10px;color:#5b6373;line-height:1.5;}
.atr-foot a{color:#23f7dd;text-decoration:none;}
.atr-foot a:hover{text-decoration:underline;}
@media (prefers-reduced-motion: reduce){.atr-wrap.pulse .atr-ring{transform:none;}}
`;

export function mountTxRing() {
  if (typeof document === "undefined") return { addTx() {} };
  if (document.getElementById("atrStyle")) return window.__arcadeTxRing || { addTx() {} };

  const style = document.createElement("style");
  style.id = "atrStyle";
  style.textContent = CSS;
  document.head.appendChild(style);

  const wrap = document.createElement("div");
  wrap.className = "atr-wrap";
  wrap.innerHTML =
    `<button class="atr-ring" id="atrRing" type="button" aria-label="Live onchain transactions" title="Live onchain activity — every tap is a real MultiversX transaction"><svg viewBox="0 0 44 44" aria-hidden="true"></svg></button>` +
    `<div class="atr-panel" id="atrPanel"><div class="atr-head">Live onchain activity</div><ul class="atr-list" id="atrList"></ul><div class="atr-empty" id="atrEmpty">No transactions yet. Play a game — every tap fires one onchain.</div>` +
    `<div class="atr-legend">` +
    Object.values(STATUS).map((s) => `<span><i style="background:${s.color};${s.fill ? "" : "background:transparent;box-shadow:inset 0 0 0 1.4px " + s.color}"></i>${s.label}</span>`).join("") +
    `</div><div class="atr-foot">Every tap is a real, gasless MultiversX transaction.<br><a href="/why" id="atrWhy">Why &rarr;</a> &nbsp;&middot;&nbsp; <a href="https://galaxy-of-nodes.vercel.app/?data=live" target="_blank" rel="noopener">See the live network &rarr;</a></div></div>`;
  document.body.appendChild(wrap);

  const ring = wrap.querySelector("#atrRing");
  const svg = ring.querySelector("svg");
  const panel = wrap.querySelector("#atrPanel");
  const listEl = wrap.querySelector("#atrList");
  const emptyEl = wrap.querySelector("#atrEmpty");
  const whyLink = wrap.querySelector("#atrWhy");

  // /why is a shell route — navigate via the shell so audio rides through
  whyLink.addEventListener("click", (e) => {
    e.preventDefault();
    try { window.history.pushState({ g: "why" }, "", "/why"); } catch (_e) {}
    try { document.getElementById("stage") && (document.getElementById("stage").src = "/why.html"); } catch (_e) {}
    wrap.classList.remove("open");
  });

  ring.addEventListener("click", (e) => { e.stopPropagation(); wrap.classList.toggle("open"); if (wrap.classList.contains("open")) renderPanel(); });
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) wrap.classList.remove("open"); });

  const txs = []; // newest first: { hash, game, status, t }

  function dotXY(i) {
    const a = (-90 + (i * 360) / MAX_DOTS) * (Math.PI / 180);
    return [22 + 16 * Math.cos(a), 22 + 16 * Math.sin(a)];
  }

  function renderRing() {
    // a faint TRACK ring IS the empty state (clearly "no activity"); real txs
    // appear as dots ON the track, so a dot only ever means a real transaction
    // (no more placeholder dots that read as activity when the ring is empty).
    let out = `<circle cx="22" cy="22" r="16" fill="none" stroke="#222836" stroke-width="1"/>`;
    const n = Math.min(txs.length, MAX_DOTS);
    for (let i = 0; i < n; i++) {
      const [x, y] = dotXY(i);
      const tx = txs[i];
      const s = STATUS[tx.status] || STATUS.unknown;
      const cls = i === 0 ? "atr-dot-new" : "";
      const r = i === 0 ? 2.6 : 2.2;
      if (s.fill) out += `<circle class="${cls}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="${s.color}" color="${s.color}"/>`;
      else out += `<circle class="${cls}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="none" stroke="${s.color}" stroke-width="1.5" color="${s.color}"/>`;
    }
    svg.innerHTML = out;
  }

  function ago(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + "s";
    const m = Math.round(s / 60);
    return m < 60 ? m + "m" : Math.round(m / 60) + "h";
  }

  function renderPanel() {
    if (!wrap.classList.contains("open")) return;
    emptyEl.style.display = txs.length ? "none" : "block";
    listEl.innerHTML = txs.slice(0, 24).map((tx) => {
      const s = STATUS[tx.status] || STATUS.unknown;
      const dot = `<span class="d" style="${s.fill ? "background:" + s.color : "background:transparent;box-shadow:inset 0 0 0 1.4px " + s.color}"></span>`;
      const short = tx.hash.slice(0, 6) + "…" + tx.hash.slice(-4);
      return `<li>${dot}<a href="${EXPLORER}/transactions/${tx.hash}" target="_blank" rel="noopener">${short}</a><span class="g">${tx.game ? tx.game + " · " : ""}${s.label} · ${ago(tx.t)}</span></li>`;
    }).join("");
  }

  // coalesce rapid updates (canvas can fire ~7 tx/s) into one render per frame
  let renderQueued = false;
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; renderRing(); renderPanel(); });
  }

  // pulse is throttled so a burst of txs doesn't strobe the corner
  let lastPulse = 0;
  function pulse() {
    const now = Date.now();
    if (now - lastPulse < 450) return;
    lastPulse = now;
    wrap.classList.add("pulse");
    setTimeout(() => wrap.classList.remove("pulse"), 420);
  }

  async function poll(tx) {
    for (let i = 0; i < POLL_TRIES; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      let st = "";
      try {
        const r = await fetch(`${API}/transactions/${tx.hash}?fields=status`);
        if (r.ok) st = (await r.json()).status || "";
      } catch (_e) { /* keep trying */ }
      if (st === "success" || st === "executed") {
        tx.status = "confirming"; render();
        setTimeout(() => { tx.status = "confirmed"; render(); }, CONFIRMING_MS);
        return;
      }
      if (st === "fail") { tx.status = "failed"; render(); return; }
      if (st === "invalid") { tx.status = "cancelled"; render(); return; }
    }
    tx.status = "unknown"; render();
  }

  function addTx(hash, game) {
    if (!hash || typeof hash !== "string") return;
    if (txs.some((t) => t.hash === hash)) return; // de-dupe
    const tx = { hash, game: game || "", status: "pending", t: Date.now() };
    txs.unshift(tx);
    if (txs.length > 60) txs.length = 60; // cap memory; ring shows MAX_DOTS, panel shows 24
    render();
    pulse();
    poll(tx);
  }

  renderRing();
  const api = { addTx };
  try { window.__arcadeTxRing = api; } catch (_e) {}
  return api;
}
