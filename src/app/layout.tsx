import type { Metadata, Viewport } from "next";
import { DM_Serif_Display, JetBrains_Mono, Sora } from "next/font/google";
import "./globals.css";
import { headers } from "next/headers";

import { Analytics } from "@vercel/analytics/next";
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
  title: "Portfolio — Personal Wealth Terminal",
  description: "Personal finance dashboard and portfolio tracker",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  /* Follows the OS, not the stored override — browser-chrome cosmetic only */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eceaf4" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0912" },
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
      <Analytics />
    </html>
  );
}
