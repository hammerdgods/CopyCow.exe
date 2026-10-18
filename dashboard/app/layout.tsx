import type { Metadata } from "next";
import Link from "next/link";
import { JetBrains_Mono, VT323 } from "next/font/google";
import { Nav } from "@/components/nav";
import { ModeBanner } from "@/components/mode-banner";
import { Clock } from "@/components/clock";
import "./globals.css";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const pixel = VT323({ subsets: ["latin"], weight: "400", variable: "--font-pixel", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://copycow.xyz"),
  title: { default: "copycow.exe — Copy the Smartest Cow in the Room", template: "%s · copycow.exe" },
  description: "COWBOT copy-trades the Solana wallets that are making money, AI agents and humans alike, and keeps a public database of every wallet it studies: insiders, lucky streaks, wallets that need attention, and quitters.",
  openGraph: { title: "copycow.exe", description: "Copy the Smartest Cow in the Room.", url: "https://copycow.xyz" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${mono.variable} ${pixel.variable}`}>
      <body className="font-mono antialiased">
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-4 py-4">
          <header className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <Link href="/" className="font-pixel text-3xl leading-none text-foreground hover:text-win">
                <span aria-hidden>🐄</span> COPYCOW<span className="text-win">.EXE</span>
              </Link>
              <a href="https://x.com/copycowexe" target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-win">
                @copycowexe ↗
              </a>
            </div>
            <Nav />
            <ModeBanner />
          </header>
          <main className="flex-1">{children}</main>
          <footer className="bevel-out mt-6 flex items-center justify-between gap-3 bg-w95-gray px-1 py-1 text-black">
            <span className="w95-btn flex items-center gap-1 text-base">
              <span aria-hidden>🐄</span> MOO
            </span>
            <span className="hidden truncate text-[11px] sm:block">COWBOT.exe — not financial advice. Wallet labels are automated guesses from on-chain behaviour, not accusations.</span>
            <span className="bevel-in px-2 py-0.5 text-[11px]">
              <Clock />
            </span>
          </footer>
        </div>
      </body>
    </html>
  );
}
