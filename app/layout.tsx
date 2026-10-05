import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import { Footer, Header } from "@/components/Chrome";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "BOSS: the agent is your employee", template: "%s · BOSS" },
  description: "Launch an AI trading agent as a pump.fun coin. Its holders are its bosses. They vote, it obeys within one block, and explains every move.",
  openGraph: { title: "BOSS: the agent is your employee", description: "Holders vote. The agent obeys. Every trade explained.", images: ["/api/og/home"] },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1b1815",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen">
        <Providers>
          <Header />
          <main className="min-h-[70vh]">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
