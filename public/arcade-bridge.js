// arcade-bridge.js — the per-game shim that REPLACES the /arcade-sound.js include.
//
// Two modes, decided by whether the page is framed:
//
//  STANDALONE (window.parent === window): someone opened /canvas.html directly,
//  or a pretty route is not yet served by the shell. Delegate to today's
//  behavior — dynamically import /arcade-sound.js so a direct load still gets
//  the sound toggle + the per-game score. Nothing else changes.
//
//  EMBEDDED (window.parent !== window): the page is inside shell.html, which OWNS
//  the AudioContext, the single sound toggle, and the score. So this shim must
//  NOT create a score or inject a toggle. It only:
//    1. samples this game's play rate and postMessages it up as `arcade:activity`
//       (the shell feeds the one persistent score), so the music breathes with
//       how hard you're playing — exactly like arcade-sound.js did locally;
//    2. intercepts back / cabinet / cross-game links and postMessages
//       `arcade:navigate {to}` so the SHELL swaps the iframe (audio rides through)
//       instead of the iframe navigating (which would kill the context);
//    3. forwards the FIRST in-iframe pointerdown/keydown as `arcade:gesture`, the
//       user gesture the shell needs to unlock/resume audio (in-iframe pointer
//       events do not bubble to the parent).
//
// Same-origin throughout, so /api/relay, passport.js, and localStorage work
// unchanged inside the iframe — this shim touches none of that.
//
// Self-contained, dependency-free. US English, on-canon.
(function () {
  "use strict";

  // ---------------------------------------------------------------- STANDALONE
  // Not in a frame -> behave exactly like before: load the full sound module.
  if (window.parent === window) {
    import("/arcade-sound.js").catch(function (e) {
      console.warn("[arcade-bridge] standalone sound import failed", e);
    });
    return;
  }

  // ------------------------------------------------------------------ EMBEDDED
  var ORIGIN = location.origin;
  function post(msg) {
    try { window.parent.postMessage(msg, ORIGIN); } catch (e) {}
  }

  // ---- which game is this? (mirrors arcade-sound.js / arcade-info.js) ----
  function gameFromPath(p) {
    p = (p || "").toLowerCase();
    if (/degen[-_]?dash/.test(p)) return "degendash";
    if (/wen[-_]?moon/.test(p)) return "wenmoon";
    if (/clawback/.test(p)) return "clawback";
    if (/reaction/.test(p)) return "reaction";
    if (/shard[-_]?hydra|shardhydra/.test(p)) return "shardhydra";
    if (/button/.test(p)) return "button";
    if (/canvas/.test(p)) return "canvas";
    if (/tug[-_]?of[-_]?war|tugofwar/.test(p)) return "tugofwar";
    if (/supernova[-_]?sprint/.test(p)) return "supernova-sprint";
    if (/sprint|onchain/.test(p)) return "sprint";
    if (/(^|\/)why(\.html)?$/.test(p) || /\/why\b/.test(p)) return "why";
    if (/(^|\/)me(\.html)?$/.test(p) || /\/me\b/.test(p)) return "me";
    if (/arcade/.test(p)) return "arcade";
    return null;
  }

  var GAME_ID = gameFromPath(location.pathname);

  /* ===================================================================
     LINK INTERCEPTION. Any anchor that points at the hub, a cabinet, or
     another arcade surface must become a SHELL navigation (postMessage),
     not an in-iframe navigation. We map the anchor's path to a game id;
     if it maps, we preventDefault and message the shell. Anything that
     does not map (external links, in-page #anchors, /api, downloads) is
     left completely alone.
     =================================================================== */
  // The hub uses pretty paths in cabinet hrefs (/canvas, /tug-of-war, /clawback,
  // /degen-dash, /sprint ...). gameFromPath already resolves both pretty and raw.
  function navTargetFromHref(a) {
    // resolve relative + ignore cross-origin / non-http links outright
    var url;
    try { url = new URL(a.getAttribute("href"), location.href); } catch (e) { return null; }
    if (url.origin !== ORIGIN) return null;
    // a pure in-page hash on the same path is NOT navigation
    var samePath = url.pathname === location.pathname;
    if (samePath && url.hash) return null;
    var g = gameFromPath(url.pathname);
    return g; // game id, or null if it is not an arcade surface
  }

  function onClick(e) {
    // respect new-tab / modified clicks and non-primary buttons
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    if (a.target && a.target !== "" && a.target !== "_self") return; // _blank etc.
    if (a.hasAttribute("download")) return;
    var g = navTargetFromHref(a);
    if (!g) return; // not an arcade surface -> let it behave normally
    e.preventDefault();
    post({ type: "arcade:navigate", to: g });
  }
  // capture phase so we win even if the game stops propagation on its own anchors
  document.addEventListener("click", onClick, true);

  /* ===================================================================
     FIRST-GESTURE FORWARD. In-iframe pointer/key events do not reach the
     parent, so forward the first one as `arcade:gesture`; the shell uses
     it as the user gesture to unlock/resume audio. Once only.
     =================================================================== */
  var gestureSent = false;
  function onFirstGesture() {
    if (gestureSent) return;
    gestureSent = true;
    document.removeEventListener("pointerdown", onFirstGesture, true);
    document.removeEventListener("keydown", onFirstGesture, true);
    post({ type: "arcade:gesture" });
  }
  document.addEventListener("pointerdown", onFirstGesture, true);
  document.addEventListener("keydown", onFirstGesture, true);

  /* ===================================================================
     ACTIVITY SAMPLER (kept from arcade-sound.js ~186-207). A capturing
     pointerdown on the play surface bumps a counter; every ~1.5s we post
     the running total up under this game's id. The shell feeds the score.
     why / me have no play surface, so they simply never post activity.
     =================================================================== */
  if (GAME_ID && GAME_ID !== "why" && GAME_ID !== "me") {
    var PLAY_SELECTOR =
      "#arena,#board,#stage,#pad,#tapBtn,.tap-btn,#pullBtn,#sideA,#sideB,.pull-btn,.side-btn,.press-btn,.pad,[data-play]";
    var activity = 0;
    document.addEventListener("pointerdown", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest(PLAY_SELECTOR)) activity += 1;
    }, true);
    setInterval(function () {
      // post every tick (cheap); the shell only audibly reacts once its score is
      // running, and it diffs the running total to a delta internally.
      post({ type: "arcade:activity", game: GAME_ID, total: activity });
    }, 1500);
  }
})();
