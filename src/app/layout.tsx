import type { Metadata, Viewport } from "next";
import { DM_Serif_Display, JetBrains_Mono, Sora } from "next/font/google";
import "./globals.css";
import { headers } from "next/headers";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next"
import { AppToaster } from "@/components/AppToaster";

const dmSerif = DM_Serif_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const sora = Sora({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Vantage — Personal Wealth Terminal",
  description: "Track stocks, ETFs, crypto, gold and property across 30 global exchanges. Live prices, FX-aware P&L and AI analysis. Your data stays in your own database.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  /* Follows the OS, not the stored override — browser-chrome cosmetic only */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F0E8" },
    { media: "(prefers-color-scheme: dark)", color: "#0E0C0A" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${dmSerif.variable} ${jetbrainsMono.variable} ${sora.variable}`}
    >
      <head>
        <script src="/theme-init.js" nonce={nonce} />
      </head>
      <body>
        {children}
        <AppToaster />
      </body>
      <SpeedInsights />
      <Analytics />
    </html>
  );
}
