// arcade-lock.js — keep a touch player INSIDE the game on a phone.
//
// The big reason a one-tap web game lets you "swipe out" by accident: pull-to-refresh,
// overscroll-nav, pinch/double-tap zoom, and swipes on the play surface scrolling the
// page. This kills all of them, while leaving the leaderboard below free to scroll.
// One include per game, after the game's own script:
//   <script src="/arcade-lock.js"></script>
(function () {
  var de = document.documentElement;

  // 1) no pull-to-refresh / overscroll chaining — the most common accidental exit
  de.style.overscrollBehavior = "none";
  if (document.body) document.body.style.overscrollBehavior = "none";

  // 2) no pinch / double-tap zoom (reinforces the viewport meta on iOS)
  var vp = document.querySelector('meta[name="viewport"]');
  if (vp) vp.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); }, { passive: false });

  // 3) lock the play surface: a swipe/drag there must drive the game, never scroll the
  //    page. touch-action:none stops the browser claiming the gesture; the non-passive
  //    touchmove guard stops the scroll while STILL letting the game's own listeners read
  //    the move (preventDefault stops the default scroll, not the event).
  function lock(el) {
    if (!el || el.__arcadeLocked) return;
    el.__arcadeLocked = true;
    el.style.touchAction = "none";
    el.addEventListener("touchmove", function (e) { e.preventDefault(); }, { passive: false });
  }
  function lockAll() {
    document.querySelectorAll("#arena, #board, .pad, .tap-btn, .press-btn, .pull-btn, .side-btn, [data-lock]").forEach(lock);
  }
  if (document.readyState !== "loading") lockAll();
  else document.addEventListener("DOMContentLoaded", lockAll);
  // expose for surfaces created after load
  window.arcadeLock = lock;
})();
