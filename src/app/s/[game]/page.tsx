/* /s/[game]?s=<score>&r=<rank> — the share landing.
 *
 * Returns 200 HTML carrying the per-score Open Graph meta (so X / Telegram /
 * Discord unfurl the dynamic card from /api/og), then bounces a human visitor
 * straight into the game. The card and the score do the talking — no tech pitch. */
import type { Metadata } from "next";
import { CARD_GAMES, SITE_URL } from "@/lib/arcadeCards";
import Redirect from "./Redirect";

// resolve to a canonical game id (unknown -> sprint), so the card and links agree
function resolveId(game: string): string {
  return CARD_GAMES[game] ? game : "sprint";
}

type Props = {
  params: Promise<{ game: string }>;
  searchParams: Promise<{ s?: string; r?: string }>;
};

function cardImage(gameId: string, s: string, r?: string): string {
  const q = new URLSearchParams({ g: gameId, s });
  if (r) q.set("r", r);
  return `${SITE_URL}/api/og?${q.toString()}`;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { game } = await params;
  const { s = "0", r } = await searchParams;
  const id = resolveId(game);
  const g = CARD_GAMES[id];
  const title = g.copy.replace("{score}", s).replace("{rank}", r ?? "");
  const image = cardImage(id, s, r);
  const url = `${SITE_URL}/s/${id}?s=${encodeURIComponent(s)}${r ? `&r=${encodeURIComponent(r)}` : ""}`;

  return {
    title,
    description: "One-tap, gasless, fully-onchain mini-games on MultiversX. Your turn.",
    openGraph: {
      title,
      description: "Tap to beat it. No wallet, no install.",
      url,
      siteName: "Supernova Arcade",
      images: [{ url: image, width: 1200, height: 630 }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: "Tap to beat it. No wallet, no install.",
      images: [image],
    },
  };
}

export default async function SharePage({ params, searchParams }: Props) {
  const { game } = await params;
  const { s = "0", r } = await searchParams;
  const g = CARD_GAMES[resolveId(game)];
  const c = g.accent;
  const headline = g.copy.replace("{score}", s).replace("{rank}", r ?? "");

  return (
    <main
      style={{
        minHeight: "100vh",
        margin: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        background: "#040506",
        color: "#F4F6FA",
        fontFamily:
          "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
        textAlign: "center",
        padding: 24,
      }}
    >
      <div style={{ fontSize: 13, letterSpacing: 3, textTransform: "uppercase", color: "#6B7385" }}>
        Supernova Arcade
      </div>
      <div style={{ fontSize: 88, fontWeight: 800, lineHeight: 1, color: c, textShadow: `0 0 44px ${c}66` }}>
        {s}
      </div>
      <div style={{ fontSize: 18, color: "#9BA3B4", maxWidth: 440 }}>{headline}</div>
      <a
        href={g.route}
        style={{
          marginTop: 8,
          fontSize: 15,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "#040506",
          background: c,
          padding: "13px 26px",
          borderRadius: 999,
          textDecoration: "none",
          fontWeight: 700,
        }}
      >
        Play {g.name} →
      </a>
      <Redirect to={g.route} />
    </main>
  );
}
