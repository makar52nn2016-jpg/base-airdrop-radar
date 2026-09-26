import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

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
        className={`${inter.variable} ${jetbrains.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
