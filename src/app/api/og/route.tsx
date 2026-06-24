/* /api/og — the dynamic share card.
 *
 * Renders a player's score, big and loud, per game: /api/og?g=<id>&s=<score>&r=<rank>
 * Satori (next/og) port of public/og/score.html — same frame, lit CRT tile, signature
 * art, glowing score. Fully determined by the query, so it caches forever at the edge.
 * No tech framing: the score and the game's art carry it. */
import type { CSSProperties } from "react";
import { ImageResponse } from "next/og";
import { getCardGame, type CardArt } from "@/lib/arcadeCards";

export const runtime = "edge";

// co-located assets (Next inlines these into the edge bundle)
const jbExtraBold = fetch(new URL("./JetBrainsMono-ExtraBold.ttf", import.meta.url)).then((r) => r.arrayBuffer());
const jbMedium = fetch(new URL("./JetBrainsMono-Medium.ttf", import.meta.url)).then((r) => r.arrayBuffer());
const roobert = fetch(new URL("./RoobertPRO-SemiBold.otf", import.meta.url)).then((r) => r.arrayBuffer());
const wordmark = fetch(new URL("./wordmark.svg", import.meta.url)).then((r) => r.text());

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// the MultiversX X-glyph, tinted to the accent (used in the "ring" art)
const X_GLYPH = (c: string) => (
  <svg width="62" height="48" viewBox="0 0 192 148">
    <path
      fill={c}
      d="M106.4,74L192,28L177.6,0.2L99.2,32.1c-2,0.8-4.3,0.8-6.3,0L14.5,0.2L0.1,28l85.6,46l-85.6,46l14.4,27.8l78.4-31.9c2-0.8,4.3-0.8,6.3,0l78.4,31.9l14.4-27.8L106.4,74z"
    />
  </svg>
);

// signature art for the CRT tile, one per game family
function Art(art: CardArt, c: string) {
  const center: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    width: 300,
    height: 300,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  if (art === "ring") {
    return (
      <div style={center}>
        <div
          style={{
            width: 124,
            height: 124,
            borderRadius: 62,
            border: `3px solid ${c}`,
            boxShadow: `0 0 26px ${rgba(c, 0.55)}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {X_GLYPH(c)}
        </div>
        {[
          [114, 222],
          [180, 240],
          [150, 198],
        ].map(([x, y], i) => (
          <div
            key={i}
            style={{ position: "absolute", left: x, top: y, width: 7, height: 7, borderRadius: 4, background: c, boxShadow: `0 0 9px ${c}` }}
          />
        ))}
      </div>
    );
  }
  if (art === "rope") {
    return (
      <div style={center}>
        <div style={{ position: "relative", width: 222, height: 6, borderRadius: 3, background: rgba(c, 0.32), display: "flex" }}>
          <div style={{ position: "absolute", left: 118, top: -8, width: 22, height: 22, borderRadius: 11, background: c, boxShadow: `0 0 16px ${c}` }} />
        </div>
      </div>
    );
  }
  if (art === "pix") {
    const lit = [2, 3, 8, 9, 10, 14, 15, 20];
    return (
      <div style={center}>
        <div style={{ display: "flex", flexWrap: "wrap", width: 150, gap: 5 }}>
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 20,
                height: 20,
                borderRadius: 3,
                background: lit.includes(i) ? c : rgba(c, 0.18),
                boxShadow: lit.includes(i) ? `0 0 10px ${c}` : "none",
              }}
            />
          ))}
        </div>
      </div>
    );
  }
  if (art === "btn") {
    return (
      <div style={center}>
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            background: `radial-gradient(circle at 45% 35%, #ffffff, ${c} 66%)`,
            boxShadow: `0 0 30px ${rgba(c, 0.6)}, 0 0 0 16px ${rgba(c, 0.0)}, 0 0 0 19px ${rgba(c, 0.45)}`,
            display: "flex",
          }}
        />
      </div>
    );
  }
  if (art === "card") {
    return (
      <div style={center}>
        <div style={{ position: "absolute", left: 72, top: 78, padding: "7px 13px", borderRadius: 8, fontFamily: "JetBrains Mono", fontWeight: 800, fontSize: 24, color: "#FF6B9D", background: "rgba(255,107,157,.16)", display: "flex" }}>
          -12
        </div>
        <div style={{ position: "absolute", left: 168, top: 162, padding: "7px 13px", borderRadius: 8, fontFamily: "JetBrains Mono", fontWeight: 800, fontSize: 24, color: "#4ADE80", background: "rgba(74,222,128,.16)", display: "flex" }}>
          +6
        </div>
      </div>
    );
  }
  if (art === "dash") {
    return (
      <div style={center}>
        <div style={{ position: "absolute", left: 66, top: 84, padding: "7px 13px", borderRadius: 8, fontFamily: "JetBrains Mono", fontWeight: 800, fontSize: 24, color: "#23F7DD", background: "rgba(35,247,221,.16)", display: "flex" }}>
          +18
        </div>
        <div style={{ position: "absolute", left: 168, top: 168, padding: "7px 13px", borderRadius: 8, fontWeight: 800, fontSize: 26, color: "#FF6B9D", background: "rgba(255,107,157,.16)", display: "flex" }}>
          ☠
        </div>
      </div>
    );
  }
  // rx — a flashing reflex target
  return (
    <div style={center}>
      <div style={{ width: 118, height: 118, borderRadius: 59, border: `3px solid ${rgba(c, 0.45)}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 42, height: 42, borderRadius: 21, background: c, boxShadow: `0 0 28px ${c}` }} />
      </div>
    </div>
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const g = getCardGame(searchParams.get("g"));
  const score = (searchParams.get("s") ?? "0").slice(0, 14);
  const rank = searchParams.get("r");
  const c = g.accent;

  const [jb8, jb5, ro6, markSvg] = await Promise.all([jbExtraBold, jbMedium, roobert, wordmark]);
  const markUri = "data:image/svg+xml;utf8," + encodeURIComponent(markSvg);

  // long scores shrink so they never clip the card
  const len = score.length;
  const scoreSize = len > 6 ? Math.max(64, 158 - (len - 6) * 17) : 158;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          position: "relative",
          background: "#040506",
          fontFamily: "JetBrains Mono",
          color: "#F4F6FA",
          overflow: "hidden",
        }}
      >
        {/* galaxy backdrop (static approximation of the live network field) */}
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(46% 62% at 58% 15%, ${rgba("#F5B544", 0.2)}, transparent 60%)`, display: "flex" }} />
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(40% 56% at 71% 56%, ${rgba("#23F7DD", 0.18)}, transparent 62%)`, display: "flex" }} />
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(50% 66% at 26% 48%, ${rgba("#5B8DEF", 0.09)}, transparent 60%)`, display: "flex" }} />
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(135% 125% at 62% 50%, transparent 45%, rgba(2,3,4,.74) 100%)", display: "flex" }} />
        {/* a sparse star field for life (deterministic) */}
        <div style={{ position: "absolute", inset: 0, display: "flex" }}>
          {[
            [86, 96, 2, 0.5], [188, 58, 1.5, 0.32], [310, 128, 2, 0.55], [524, 78, 1.5, 0.4],
            [772, 150, 2.5, 0.5], [992, 66, 1.5, 0.3], [1086, 196, 2, 0.46], [648, 44, 1.5, 0.42],
            [916, 308, 2, 0.36], [1128, 430, 1.5, 0.3], [206, 372, 2, 0.3], [430, 536, 1.5, 0.38],
            [1052, 548, 2, 0.42], [726, 566, 1.5, 0.28], [868, 476, 2.5, 0.46], [566, 312, 1.5, 0.3],
          ].map(([x, y, s, o], i) => (
            <div key={i} style={{ position: "absolute", left: x, top: y, width: s, height: s, borderRadius: s, background: "#ffffff", opacity: o }} />
          ))}
        </div>

        {/* frame */}
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: "46px 60px 42px" }}>
          {/* top */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <img src={markUri} height={23} alt="" />
              <div style={{ width: 1, height: 22, background: "#2a3140", margin: "0 14px" }} />
              <div style={{ fontSize: 14, letterSpacing: 3, textTransform: "uppercase", color: "#6B7385" }}>Supernova Arcade</div>
            </div>
            <div
              style={{
                fontSize: 14,
                letterSpacing: 1.4,
                textTransform: "uppercase",
                color: c,
                border: `1px solid ${rgba(c, 0.35)}`,
                background: rgba(c, 0.1),
                padding: "8px 16px",
                borderRadius: 999,
                display: "flex",
              }}
            >
              shard {g.shard}
            </div>
          </div>

          {/* mid */}
          <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
            {/* the lit CRT tile */}
            <div
              style={{
                width: 300,
                height: 300,
                borderRadius: 14,
                position: "relative",
                display: "flex",
                background: `radial-gradient(120% 130% at 50% 0%, ${rgba(c, 0.16)}, #040506)`,
                border: "2px solid #04060a",
                boxShadow: `inset 0 0 34px rgba(0,0,0,.85), 0 0 0 1px ${rgba(c, 0.32)}, 0 0 40px ${rgba(c, 0.22)}`,
                marginRight: 56,
                flex: "0 0 auto",
              }}
            >
              {Art(g.art, c)}
            </div>

            {/* the loud score block */}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontFamily: "Roobert", fontWeight: 600, fontSize: 30, color: "#F4F6FA", opacity: 0.92 }}>{g.name}</div>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: scoreSize,
                  lineHeight: 0.92,
                  letterSpacing: -5,
                  color: c,
                  marginTop: 4,
                  textShadow: `0 0 40px ${rgba(c, 0.62)}, 0 0 92px ${rgba(c, 0.34)}`,
                  display: "flex",
                }}
              >
                {score}
              </div>
              <div style={{ fontSize: 23, fontWeight: 500, letterSpacing: 3, textTransform: "uppercase", color: "#9BA3B4", marginTop: 16 }}>{g.unit}</div>
              {g.isMe && rank ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginTop: 20,
                    fontSize: 21,
                    fontWeight: 700,
                    color: c,
                    border: `1px solid ${rgba(c, 0.38)}`,
                    background: rgba(c, 0.12),
                    padding: "9px 17px",
                    borderRadius: 999,
                    alignSelf: "flex-start",
                  }}
                >
                  <div style={{ width: 13, height: 13, borderRadius: 7, background: "linear-gradient(145deg,#FFE680,#F2B23A)", boxShadow: "0 0 8px rgba(245,181,68,.6)", marginRight: 9 }} />
                  Ranked #{rank}
                </div>
              ) : null}
            </div>
          </div>

          {/* bottom */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 16, letterSpacing: 0.5, color: "#F4F6FA", display: "flex" }}>
              supernova-arcade.xyz<span style={{ color: c }}>{g.route}</span>
            </div>
            <div style={{ fontSize: 15, letterSpacing: 1.2, textTransform: "uppercase", color: c }}>Your turn →</div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "JetBrains Mono", data: jb8, weight: 800, style: "normal" },
        { name: "JetBrains Mono", data: jb5, weight: 500, style: "normal" },
        { name: "Roobert", data: ro6, weight: 600, style: "normal" },
      ],
      headers: { "Cache-Control": "public, immutable, no-transform, max-age=31536000" },
    },
  );
}
