// arcade-share.js — one viral share path for every game.
//
// Native share sheet on mobile (the friction-free path), X web-intent everywhere
// else. Dependency-free; any cabinet just adds ONE button and imports this:
//
//   <button class="share-btn" data-share="I placed {score} pixels on the Supernova
//     Canvas, each a real onchain transaction." data-score="yourPixels">Share</button>
//   <script type="module" src="/arcade-share.js"></script>
//
// {score} is replaced by the live text of the element with id=data-score (read at
// click time, so it reflects the current play), and the game's URL is appended.
export function shareArcade(text) {
  try {
    if (navigator.share) {
      navigator.share({ text }).catch(() => openX(text));
      return;
    }
  } catch (_e) {}
  openX(text);
}

function openX(text) {
  window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(text), "_blank", "noopener");
}

function cleanUrl() {
  return location.origin.replace(/^http:\/\/localhost.*/, "https://supernova-arcade.xyz") + location.pathname.replace(/\.html$/, "").replace(/\/index$/, "");
}

function wire() {
  document.querySelectorAll("[data-share]").forEach((el) => {
    if (el.dataset.shareWired) return;
    el.dataset.shareWired = "1";
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const scoreId = el.getAttribute("data-score");
      const score = scoreId ? (document.getElementById(scoreId)?.textContent || "").trim() : "";
      const brag = el.getAttribute("data-share").replace("{score}", score);
      shareArcade(brag + "\n\n👉 " + cleanUrl());
    });
  });
}

if (document.readyState !== "loading") wire();
else document.addEventListener("DOMContentLoaded", wire);
// re-wire for buttons injected later (e.g. /me renders its card after a fetch)
export const wireShare = wire;
