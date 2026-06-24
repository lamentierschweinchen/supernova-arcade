"use client";
import { useEffect } from "react";

// A human who taps a shared link gets bounced into the game. Crawlers (X,
// Telegram, Discord) don't run JS, so they just read the OG meta and unfurl
// the score card — which is the whole point.
export default function Redirect({ to }: { to: string }) {
  useEffect(() => {
    const t = setTimeout(() => window.location.replace(to), 850);
    return () => clearTimeout(t);
  }, [to]);
  return null;
}
