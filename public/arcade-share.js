// arcade-share.js — one viral share path for every game.
//
// Sharing a score posts a link to /s/<game>?s=<score>, which unfurls the dynamic
// score card (from /api/og) on X / Telegram / Discord, then drops a human who taps
// it straight into the game. Plain, confident copy — no tech pitch (the proof lives
// on /why, not on a share). Dependency-free.
//
// Two ways to use it:
//
//  1. Declarative (ambient games) — one button, no JS:
//       <button class="share-btn" data-game="canvas" data-score="yourPixels">Share</button>
//       <script type="module" src="/arcade-share.js"></script>
//     {score} is read live from the element id in data-score at click time.
//
//  2. Programmatic (games that build an end screen in JS):
//       window.shareScore({ game: "clawback", score: final });
//
// COPY + ROUTE mirror src/lib/arcadeCards.ts (the card's source of truth). Keep in sync.
const SITE = "https://supernova-arcade.xyz";
const GAMES = {
  sprint: { route: "/sprint", copy: "I got {score} taps in 30 seconds on the Supernova Sprint." },
  tugofwar: { route: "/tug-of-war", copy: "I've made {score} pulls in Tug of War." },
  canvas: { route: "/canvas", copy: "I've placed {score} pixels on the Supernova Canvas." },
  button: { route: "/button", copy: "My best on The Button: {score}." },
  clawback: { route: "/clawback", copy: "I kept {score} in Clawback." },
  degendash: { route: "/degen-dash", copy: "I scored {score} in Degen Dash." },
  reaction: { route: "/reaction", copy: "I landed {score} reactions in Reaction Arcade." },
  me: { route: "/me", copy: "{score} points, ranked #{rank} on the Supernova Arcade." },
};

export function shareArcade(text) {
  try {
    if (navigator.share) {
      navigator.share({ text }).catch(() => openX(text));
      return;
    }
  } catch (_e) {}
  openX(text);
}

// share a score: builds the brag copy + the unfurling landing link, then shares.
export function shareScore({ game, score, rank }) {
  const g = GAMES[game] || GAMES.sprint;
  const raw = String(score == null ? "" : score).trim();
  const num = raw.replace(/[^\d.,]/g, "") || "0"; // the value the card renders
  let url = SITE + "/s/" + game + "?s=" + encodeURIComponent(num);
  if (rank != null && rank !== "") url += "&r=" + encodeURIComponent(rank);
  const brag = g.copy.replace("{score}", raw || num).replace("{rank}", rank == null ? "" : String(rank));
  shareArcade(brag + "\n\n👉 " + url);
}

function openX(text) {
  window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(text), "_blank", "noopener");
}

function wire() {
  document.querySelectorAll("[data-game][data-score]").forEach((el) => {
    if (el.dataset.shareWired) return;
    el.dataset.shareWired = "1";
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const id = el.getAttribute("data-score");
      const score = id ? (document.getElementById(id)?.textContent || "").trim() : "";
      const rank = el.getAttribute("data-rank") || undefined;
      shareScore({ game: el.getAttribute("data-game"), score, rank });
    });
  });
}

if (typeof window !== "undefined") {
  window.shareArcade = shareArcade;
  window.shareScore = shareScore;
}
if (document.readyState !== "loading") wire();
else document.addEventListener("DOMContentLoaded", wire);
// re-wire for buttons injected later (e.g. /me renders its card after a fetch)
export const wireShare = wire;
