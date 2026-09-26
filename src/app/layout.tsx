import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

// Use system fonts only — avoids Google Fonts fetch failures during Vercel build
// (Inter / JetBrains Mono fetching has been intermittently failing on Vercel)

export const metadata: Metadata = {
  title: "Base Airdrop Radar — Top 3 gasless campaigns on Base",
  description:
    "Hand-curated list of the 3 highest-ROI gasless airdrop campaigns on Base right now. Tap to explore, no ETH required.",
  keywords: [
    "Base",
    "Airdrop",
    "Gasless",
    "Farcaster Frame",
    "ERC-4337",
    "CDP Paymaster",
    "Coinbase",
    "Layer 2",
  ],
  authors: [{ name: "Base Airdrop Radar" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="antialiased bg-background text-foreground"
        style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
