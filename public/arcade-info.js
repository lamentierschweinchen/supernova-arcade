// arcade-info.js — one "how to play" overlay for every game.
//
// Every cabinet gets a small "i" button in the header (next to the back-link /
// shard pill, clear of the play controls). Tapping it opens an OPAQUE card with
// that game's OBJECTIVE (a line or two) and CONTROLS (a short list). An X button
// and a tap on the backdrop close it. One include per game, after the game's own
// script:
//   <script src="/arcade-info.js"></script>
//
// Self-contained: infers the game from location.pathname, injects its own scoped
// styles (all class names prefixed `ah-` so nothing collides with a page that
// already ships .info-btn / .info-modal, e.g. onchain.html). Themes to the game's
// --c accent. Plain copy, a little fun, no tech-preaching (the deep "why onchain"
// proof lives on /why). Dependency-free, on-canon (Roobert PRO + JetBrains Mono).
(function () {
  "use strict";

  // Per-game copy — derived from each cabinet's real mechanic + intro copy.
  // objective: 1-2 short lines. controls: a few imperative steps.
  var GAMES = {
    canvas: {
      title: "Supernova Canvas",
      objective: "A shared pixel board that lives onchain. Place pixels to leave your mark on a canvas everyone can see.",
      controls: ["Pick a color from the palette", "Tap a pixel to place it", "Each placement is one real transaction"],
    },
    button: {
      title: "The Button",
      objective: "One shared 60-second timer. Every press resets it to full, so the clock never quite runs out. Wait as long as you dare.",
      controls: ["Tap Press to fire and reset the timer", "Each press is one real transaction", "Hold your nerve, the longer you wait the bolder the play"],
    },
    reaction: {
      title: "Reaction Arcade",
      objective: "Land as many on-time reactions as you can. The board ranks by reactions landed, not by speed.",
      controls: ["Wait for the X to flash", "Tap the moment it lights up", "Tap too soon and the run resets", "Every on-time tap is one real transaction"],
    },
    clawback: {
      title: "Clawback",
      objective: "Attacks rain down to drain your wallet. Claw each one back before it settles and keep as much as you can.",
      controls: ["Tap a red attack to claw it back", "Leave the green credits, they pay you", "Beat the settle line or the drain lands", "Every clawback is one real transaction"],
    },
    degendash: {
      title: "Degen Dash",
      objective: "An endless onchain runner. Grab the wins in your lane, dodge the rugs, and run as far as you can.",
      controls: ["Swipe left or right to switch lanes", "Swipe up to jump, down to duck", "Wins in your lane auto-grab, one real transaction each", "Hit a hazard and the run ends"],
    },
    sprint: {
      title: "Supernova Sprint",
      objective: "Tap as fast as you can for 30 seconds. Every tap is a real transaction, and your score is the count that confirm onchain.",
      controls: ["Tap the big button as fast as you can", "Each tap fires one real transaction", "30 seconds on the clock, go"],
    },
    tugofwar: {
      title: "Tug-of-War",
      objective: "Pick a team and pull the rope your way. Whoever has the most pulls when the 45-second round ends wins.",
      controls: ["Pick Supa or Nova to join a team", "Tap PULL to pull the rope your way", "Each pull is one real transaction", "Most pulls when the round ends takes it"],
    },
  };

  // Map a pathname to a game key. Handles /canvas, /canvas.html, /clawback/,
  // /degen-dash, /onchain, /sprint, /supernova-sprint, etc.
  function gameFromPath() {
    var p = (location.pathname || "").toLowerCase();
    if (/degen[-_]?dash/.test(p)) return "degendash";
    if (/clawback/.test(p)) return "clawback";
    if (/reaction/.test(p)) return "reaction";
    if (/button/.test(p)) return "button";
    if (/canvas/.test(p)) return "canvas";
    if (/tug[-_]?of[-_]?war|tugofwar/.test(p)) return "tugofwar";
    if (/sprint|onchain/.test(p)) return "sprint";
    return null;
  }

  var KEY = gameFromPath();
  if (!KEY || !GAMES[KEY]) return; // unknown page — do nothing
  var GAME = GAMES[KEY];

  // ---- scoped styles (ah- prefix, themed to --c via the body) ----
  function injectStyles() {
    if (document.getElementById("ah-style")) return;
    var css =
      ".ah-btn{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;" +
      "width:30px;height:30px;flex:0 0 auto;border-radius:50%;cursor:pointer;padding:0;margin:0;line-height:1;" +
      "font-family:var(--mono,'JetBrains Mono',ui-monospace,monospace);font-style:italic;font-weight:700;font-size:14px;" +
      "color:var(--text-dim,#9BA3B4);background:rgba(14,17,23,.6);border:1px solid var(--border,#1E2330);" +
      "-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);-webkit-user-select:none;user-select:none;" +
      "transition:color .15s,border-color .15s,transform .07s;}" +
      ".ah-btn:hover{color:var(--c,#23F7DD);border-color:color-mix(in srgb,var(--c,#23F7DD) 45%,transparent);}" +
      ".ah-btn:active{transform:scale(.94);}" +
      // overlay: OPAQUE dark scrim, centered card
      ".ah-overlay{position:fixed;inset:0;z-index:9000;display:none;align-items:center;justify-content:center;" +
      "padding:20px;background:rgba(4,5,6,.92);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);" +
      "opacity:0;transition:opacity .18s ease;}" +
      ".ah-overlay.ah-open{display:flex;opacity:1;}" +
      ".ah-card{position:relative;width:100%;max-width:380px;max-height:88vh;overflow-y:auto;-webkit-overflow-scrolling:touch;" +
      "background:linear-gradient(180deg,#10141c,#0a0d12);color:var(--text,#F4F6FA);" +
      "border:1px solid color-mix(in srgb,var(--c,#23F7DD) 32%,#222835);border-radius:18px;" +
      "padding:22px 20px 24px;box-shadow:0 0 34px color-mix(in srgb,var(--c,#23F7DD) 18%,transparent),0 24px 60px rgba(0,0,0,.6);" +
      "transform:translateY(8px) scale(.98);transition:transform .2s cubic-bezier(.16,1,.3,1);font-family:'Roobert PRO',system-ui,-apple-system,sans-serif;}" +
      ".ah-overlay.ah-open .ah-card{transform:translateY(0) scale(1);}" +
      ".ah-x{position:absolute;top:12px;right:12px;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;" +
      "border-radius:9px;cursor:pointer;border:1px solid var(--border,#1E2330);background:rgba(255,255,255,.03);" +
      "color:var(--text-dim,#9BA3B4);font-size:18px;line-height:1;padding:0;transition:color .15s,border-color .15s;-webkit-user-select:none;user-select:none;}" +
      ".ah-x:hover{color:var(--text,#F4F6FA);border-color:color-mix(in srgb,var(--c,#23F7DD) 40%,transparent);}" +
      ".ah-k{font-family:var(--mono,'JetBrains Mono',ui-monospace,monospace);font-size:9.5px;letter-spacing:.16em;" +
      "text-transform:uppercase;color:var(--c,#23F7DD);margin:0 0 6px;}" +
      ".ah-title{font-size:21px;font-weight:900;letter-spacing:-.01em;line-height:1.05;margin:0 0 14px;padding-right:34px;color:var(--text,#F4F6FA);}" +
      ".ah-h{font-family:var(--mono,'JetBrains Mono',ui-monospace,monospace);font-size:10px;letter-spacing:.14em;" +
      "text-transform:uppercase;color:var(--text-faint,#6B7385);margin:0 0 7px;}" +
      ".ah-obj{font-size:14px;line-height:1.55;color:var(--text-dim,#9BA3B4);margin:0 0 18px;}" +
      ".ah-list{list-style:none;margin:0;padding:0;}" +
      ".ah-list li{position:relative;display:flex;align-items:flex-start;gap:10px;padding:7px 0;font-size:13.5px;" +
      "line-height:1.45;color:var(--text-dim,#9BA3B4);border-bottom:1px solid var(--border-soft,#161B25);}" +
      ".ah-list li:last-child{border-bottom:none;}" +
      ".ah-list li .ah-dot{flex:0 0 auto;width:6px;height:6px;margin-top:7px;border-radius:50%;" +
      "background:var(--c,#23F7DD);box-shadow:0 0 7px color-mix(in srgb,var(--c,#23F7DD) 60%,transparent);}" +
      "@media (prefers-reduced-motion:reduce){.ah-overlay,.ah-card{transition:none;}}";
    var s = document.createElement("style");
    s.id = "ah-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ---- the overlay (built once, lazily) ----
  var overlay = null;

  function esc(str) {
    return String(str).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function buildOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "ah-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "How to play " + GAME.title);

    var steps = GAME.controls
      .map(function (c) {
        return '<li><span class="ah-dot" aria-hidden="true"></span><span>' + esc(c) + "</span></li>";
      })
      .join("");

    overlay.innerHTML =
      '<div class="ah-card">' +
      '<button class="ah-x" type="button" aria-label="Close">&times;</button>' +
      '<p class="ah-k">How to play</p>' +
      '<h2 class="ah-title">' + esc(GAME.title) + "</h2>" +
      '<p class="ah-h">Objective</p>' +
      '<p class="ah-obj">' + esc(GAME.objective) + "</p>" +
      '<p class="ah-h">Controls</p>' +
      '<ul class="ah-list">' + steps + "</ul>" +
      "</div>";

    // backdrop tap closes (but not a tap inside the card)
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".ah-x").addEventListener("click", close);
    document.body.appendChild(overlay);
    return overlay;
  }

  function open() {
    buildOverlay();
    // force reflow so the opacity/transform transition runs from the start
    overlay.offsetWidth; // eslint-disable-line no-unused-expressions
    overlay.classList.add("ah-open");
    document.addEventListener("keydown", onKey);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove("ah-open");
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape" || e.key === "Esc") close();
  }

  // ---- the "i" button, placed in the header clear of play controls ----
  function makeButton() {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ah-btn";
    b.textContent = "i";
    b.setAttribute("aria-label", "How to play " + GAME.title);
    b.setAttribute("title", "How to play");
    b.addEventListener("click", function (e) {
      e.preventDefault();
      open();
    });
    return b;
  }

  function placeButton() {
    if (document.getElementById("ah-info-btn")) return;
    var btn = makeButton();
    btn.id = "ah-info-btn";

    // Prefer the header bar so the button sits by the back-link / shard pill,
    // away from the play surface. .abar (shell games) or .topbar (sprint).
    var header = document.querySelector(".abar") || document.querySelector(".topbar");
    if (header) {
      // tuck it next to the brand lockup at the right edge of the header
      var lockup = header.querySelector(".lockup");
      if (lockup && lockup.parentNode === header) {
        header.insertBefore(btn, lockup.nextSibling);
      } else {
        header.appendChild(btn);
      }
      // the headers are flex space-between; a small gap keeps it tidy
      btn.style.marginLeft = "8px";
      return;
    }

    // Fallback: a fixed, unobtrusive button top-right, below the corner bracket.
    btn.style.position = "fixed";
    btn.style.top = "calc(14px + env(safe-area-inset-top))";
    btn.style.right = "46px"; // clear of the .brk.tr corner bracket
    btn.style.zIndex = "20";
    (document.body || document.documentElement).appendChild(btn);
  }

  function init() {
    injectStyles();
    placeButton();
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);

  // expose a manual opener in case a game wants to trigger it from its own UI
  window.arcadeHowTo = { open: open, close: close };
})();
