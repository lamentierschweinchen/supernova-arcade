// arcadeCards.ts — one source of truth for the share surface (card + landing).
// Mirrors public/og/score.html's GAMES map; both /api/og (the card image) and
// /s/[game] (the share landing that unfurls it) read from here.
//
// Copy is plain and confident, fun-first — no tech framing (the proof lives on
// /why, not on a share card). US English, no em dashes.

export type CardArt = "ring" | "rope" | "pix" | "btn" | "card" | "dash" | "rx";

export interface CardGame {
  name: string;
  accent: string; // hex
  shard: number; // 0 | 1 | 2
  art: CardArt;
  route: string; // where a human who taps the shared link lands
  unit: string; // the noun under the big number
  copy: string; // the share text; {score} (and {rank} for /me) get filled in
  isMe?: boolean;
}

export const CARD_GAMES: Record<string, CardGame> = {
  sprint: {
    name: "Supernova Sprint",
    accent: "#23F7DD",
    shard: 1,
    art: "ring",
    route: "/sprint",
    unit: "taps in 30 seconds",
    copy: "I got {score} taps in 30 seconds on the Supernova Sprint.",
  },
  tugofwar: {
    name: "Tug of War",
    accent: "#23F7DD",
    shard: 1,
    art: "rope",
    route: "/tug-of-war",
    unit: "pulls",
    copy: "I've made {score} pulls in Tug of War.",
  },
  canvas: {
    name: "Supernova Canvas",
    accent: "#A78BFA",
    shard: 1,
    art: "pix",
    route: "/canvas",
    unit: "pixels placed",
    copy: "I've placed {score} pixels on the Supernova Canvas.",
  },
  button: {
    name: "The Button",
    accent: "#5B8DEF",
    shard: 2,
    art: "btn",
    route: "/button",
    unit: "best wait",
    copy: "My best on The Button: {score}.",
  },
  clawback: {
    name: "Clawback",
    accent: "#FF6B9D",
    shard: 2,
    art: "card",
    route: "/clawback",
    unit: "NOVA kept",
    copy: "I kept {score} in Clawback.",
  },
  degendash: {
    name: "Degen Dash",
    accent: "#FFD23F",
    shard: 0,
    art: "dash",
    route: "/degen-dash",
    unit: "final score",
    copy: "I scored {score} in Degen Dash.",
  },
  reaction: {
    name: "Reaction Arcade",
    accent: "#F5B544",
    shard: 0,
    art: "rx",
    route: "/reaction",
    unit: "reactions landed",
    copy: "I landed {score} reactions in Reaction Arcade.",
  },
  me: {
    name: "Supernova Arcade",
    accent: "#23F7DD",
    shard: 1,
    art: "ring",
    route: "/me",
    unit: "arcade points",
    copy: "{score} points, ranked #{rank} on the Supernova Arcade.",
    isMe: true,
  },
};

export function getCardGame(id: string | null | undefined): CardGame {
  return (id && CARD_GAMES[id]) || CARD_GAMES.sprint;
}

export const SITE_URL = "https://supernova-arcade.xyz";
