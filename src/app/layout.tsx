import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Supernova Arcade",
  description:
    "One-tap, gasless, fully-onchain mini-games on MultiversX testnet.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
