import { redirect } from "next/navigation";

// The Supernova Arcade hub is the static `public/arcade.html`, served at `/`
// by the rewrite in vercel.json (and at `/arcade`). This Next route only exists
// so the App Router has a valid root; on Vercel the static hub is served for `/`
// directly. This redirect is a safety net for any context where the static
// rewrite is not in effect (e.g. `next start` without vercel.json rewrites).
export default function RootPage() {
  redirect("/arcade");
}
