// arcade-sound.js — the live arcade score, on EVERY game (not just the hub).
//
// The hub (/arcade) sonifies the GLOBAL onchain activity via /arcade-score.js and a
// speaker toggle. This brings that same toggle + score to each cabinet, makes the
// on/off choice STICK as the player moves between pages, and drives the score from
// the game the player is actually playing. One include per game, after the game's
// own script:
//   <script type="module" src="/arcade-sound.js"></script>
//
// It USES the score engine's API only (never edits arcade-score.js):
//   createArcadeScore() -> { toggle(), setOn(b), isOn(), isStarted(), feed({perCabinet,total}), getState() }
//
// PERSISTENCE — a shared localStorage key `arcade_sound_on`. On load the toggle is
// painted to the saved preference. Browsers block audio without a user gesture, so a
// saved "on" cannot auto-play on navigation: instead the toggle shows "on" from load
// and the score RESUMES on the first pointerdown/keydown (which a player makes to
// play). So sound stays on everywhere; it resumes the instant they touch the page.
//
// PER-GAME REACTION — the score is fed THIS game's own play rate. A capturing
// pointerdown on the play surface bumps a counter; every ~1.5s we feed the running
// total under this game's id, so the music breathes with how hard you're playing.
//
// Self-contained + dependency-free (besides the score engine it imports). Reuses the
// hub's `.sound-toggle` markup + CSS so it looks identical; themes to the game's --c
// accent. US English, on-canon (Roobert PRO + JetBrains Mono).
import { createArcadeScore } from "/arcade-score.js";

(function () {
  "use strict";

  var STORAGE_KEY = "arcade_sound_on";

  // ---- which game is this? (mirrors arcade-info.js's path map) ----
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

  var GAME_ID = gameFromPath();
  if (!GAME_ID) return; // unknown page — do nothing

  // Inside the persistent audio shell? The shell owns the AudioContext + the one
  // toggle, so do NOT create a second score/toggle here (that doubles the music).
  // Hand off to the bridge: it postMessages this game's activity up + routes nav.
  if (window.parent !== window) {
    import("/arcade-bridge.js").catch(function (e) { console.warn("[arcade-sound] bridge load failed", e); });
    return;
  }

  // ---- persistence helpers (fail-safe: private mode / disabled storage) ----
  function readPref() {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch (e) { return false; }
  }
  function writePref(on) {
    try { localStorage.setItem(STORAGE_KEY, on ? "1" : "0"); } catch (e) {}
  }

  // ---- the score engine (lazy-boots Tone.js inside the first gesture) ----
  // lite: the lighter during-gameplay profile (trimmed poly, no convolution reverb),
  // so the synth doesn't fight the game's own render loop. The hub keeps the full mix.
  var score = createArcadeScore({ momentStep: 25000, lite: true });
  // console mixer parity with the hub: arcadeScore.getState() etc.
  try { window.arcadeScore = window.arcadeScore || score; } catch (e) {}

  // ---- scoped CSS: a self-contained copy of the hub's .sound-toggle rules.
  // Themed to the game accent (--c) with the hub's mint as the fallback, so it
  // matches each cabinet instead of being a fixed teal. ----
  function injectStyles() {
    if (document.getElementById("as-style")) return;
    var ACC = "var(--c, var(--mint, #23F7DD))";
    var css =
      ".sound-toggle{display:inline-flex;align-items:center;gap:8px;font-family:inherit;font-size:11.5px;font-weight:500;" +
      "padding:6px 12px;border-radius:999px;border:1px solid var(--border,#1E2330);background:rgba(14,17,23,.6);color:var(--text-dim,#9BA3B4);" +
      "cursor:pointer;white-space:nowrap;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);" +
      "-webkit-user-select:none;user-select:none;transition:border-color .2s,color .2s,background .2s,box-shadow .35s;}" +
      ".sound-toggle:hover{border-color:color-mix(in srgb," + ACC + " 40%,transparent);color:var(--text,#F4F6FA);}" +
      ".sound-toggle .st-ic{width:14px;height:14px;display:block;flex:0 0 auto;}" +
      ".sound-toggle.on{border-color:color-mix(in srgb," + ACC + " 50%,transparent);color:" + ACC + ";" +
      "background:color-mix(in srgb," + ACC + " 6%,transparent);box-shadow:0 0 16px color-mix(in srgb," + ACC + " 16%,transparent);}" +
      ".sound-toggle.on .st-ic{color:" + ACC + ";}" +
      ".sound-toggle.loading{opacity:.6;cursor:progress;}" +
      ".sound-toggle .eq{display:none;align-items:flex-end;gap:2px;height:11px;}" +
      ".sound-toggle.on .eq{display:inline-flex;}" +
      ".sound-toggle .eq i{width:2px;height:100%;background:" + ACC + ";border-radius:1px;transform-origin:bottom;animation:as-eqb .9s ease-in-out infinite;}" +
      ".sound-toggle .eq i:nth-child(1){animation-delay:0s;}" +
      ".sound-toggle .eq i:nth-child(2){animation-delay:.18s;}" +
      ".sound-toggle .eq i:nth-child(3){animation-delay:.34s;}" +
      "@keyframes as-eqb{0%,100%{transform:scaleY(.32);}50%{transform:scaleY(1);}}" +
      // tidy spacing when it sits in the header next to the lockup
      ".sound-toggle.as-toggle{margin-left:8px;}" +
      "@media (prefers-reduced-motion:reduce){.sound-toggle .eq i{animation:none;}}";
    var s = document.createElement("style");
    s.id = "as-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ---- the toggle button (the hub's exact SVG markup) ----
  function makeToggle() {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "sound-toggle as-toggle";
    b.id = "as-sound-toggle";
    b.setAttribute("aria-pressed", "false");
    b.setAttribute("title", "Play the live arcade score — the arcade sonifies its own onchain activity (off by default)");
    b.innerHTML =
      '<svg class="st-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M11 5 6 9H3v6h3l5 4V5Z"/>' +
      '<path class="st-wave" d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12" style="display:none"/>' +
      '<path class="st-mute" d="M22 9.5l-5 5M17 9.5l5 5"/>' +
      "</svg>" +
      '<span class="st-label">Sound</span>' +
      '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>';
    return b;
  }

  var toggleEl = null, labelEl = null, waveEl = null, muteEl = null;

  function paint(on) {
    if (!toggleEl) return;
    toggleEl.classList.toggle("on", !!on);
    toggleEl.setAttribute("aria-pressed", String(!!on));
    if (labelEl) labelEl.textContent = on ? "Sound on" : "Sound";
    if (waveEl) waveEl.style.display = on ? "" : "none";
    if (muteEl) muteEl.style.display = on ? "none" : "";
  }

  // place the toggle in the header, next to the lockup (clear of play controls) —
  // same placement strategy as arcade-info.js (.abar shell games / .topbar sprint).
  function placeToggle() {
    if (document.getElementById("as-sound-toggle")) return true;
    toggleEl = makeToggle();
    labelEl = toggleEl.querySelector(".st-label");
    waveEl = toggleEl.querySelector(".st-wave");
    muteEl = toggleEl.querySelector(".st-mute");

    var header = document.querySelector(".abar") || document.querySelector(".topbar");
    if (header) {
      var lockup = header.querySelector(".lockup");
      if (lockup && lockup.parentNode === header) header.insertBefore(toggleEl, lockup.nextSibling);
      else header.appendChild(toggleEl);
    } else {
      // fallback: a fixed, unobtrusive button top-right (clear of any corner bracket).
      toggleEl.classList.remove("as-toggle");
      toggleEl.style.position = "fixed";
      toggleEl.style.top = "calc(14px + env(safe-area-inset-top))";
      toggleEl.style.right = "calc(14px + env(safe-area-inset-right))";
      toggleEl.style.zIndex = "30";
      (document.body || document.documentElement).appendChild(toggleEl);
    }

    // the toggle click: flip the score, persist the result, repaint.
    toggleEl.addEventListener("click", function () {
      toggleEl.classList.add("loading");
      Promise.resolve()
        .then(function () { return score.toggle(); })
        .then(function (nowOn) { writePref(nowOn); paint(nowOn); })
        .catch(function (e) { console.warn("[arcade-sound] toggle failed", e); })
        .then(function () { toggleEl.classList.remove("loading"); });
    });
    return true;
  }

  // ---- resume-on-first-gesture: if the saved pref is ON, paint "on" from load and
  // boot/resume the score the instant the player first touches the page. ----
  var resumeArmed = false;
  function armResume() {
    if (resumeArmed) return;
    resumeArmed = true;
    var fire = function () {
      cleanup();
      if (!readPref() || score.isStarted()) return; // pref flipped off, or already running
      Promise.resolve()
        .then(function () { return score.setOn(true); })
        .then(function (nowOn) { paint(nowOn); })
        .catch(function (e) { console.warn("[arcade-sound] resume failed", e); });
    };
    function cleanup() {
      document.removeEventListener("pointerdown", fire, true);
      document.removeEventListener("keydown", fire, true);
    }
    // capture phase so we run even if a game stops propagation on its play surface
    document.addEventListener("pointerdown", fire, true);
    document.addEventListener("keydown", fire, true);
  }

  // ---- per-game activity feed: bump on each play interaction, feed on a 1.5s tick.
  // A capturing pointerdown on the play surface is robust across every cabinet
  // (canvas board, button stage, reaction pad, tug controls, sprint tap, the arena)
  // and never touches game logic. ----
  var PLAY_SELECTOR =
    "#arena,#board,#stage,#pad,#tapBtn,.tap-btn,#pullBtn,#sideA,#sideB,.pull-btn,.side-btn,.press-btn,.pad,[data-play]";
  var activity = 0;
  function onPlay(e) {
    var t = e.target;
    if (t && t.closest && t.closest(PLAY_SELECTOR)) activity += 1;
  }
  function startActivityFeed() {
    document.addEventListener("pointerdown", onPlay, true);
    setInterval(function () {
      // only feed once the score is actually running (feed is cheap, but no point
      // accumulating energy the player can't hear).
      if (score.isStarted && score.isStarted()) {
        var per = {}; per[GAME_ID] = activity;
        try { score.feed({ perCabinet: per, total: activity }); } catch (e) {}
      }
    }, 1500);
  }

  // ---- boot ----
  function init() {
    injectStyles();
    placeToggle();
    paint(readPref());   // reflect the saved choice immediately
    armResume();         // resume audio on first gesture if the choice was "on"
    startActivityFeed(); // drive the score from this game's play rate
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
