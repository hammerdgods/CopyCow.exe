"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const NAV = [
  { href: "/", label: "Home" },
  { href: "/wallets", label: "Wallet Database" },
  { href: "/groups", label: "Fresh Wallets" },
  { href: "/leaders", label: "Who COWBOT Copies" },
  { href: "/copies", label: "Live Copies" },
  { href: "/performance", label: "Performance" },
  { href: "/proof", label: "Proof Ledger" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Main">
      <ul className="flex min-w-max gap-1">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                className={cn(
                  "block px-3 py-1.5 text-[12px] uppercase tracking-widest transition-colors",
                  active ? "bevel-in bg-black text-win" : "bevel-out bg-w95-gray text-black hover:bg-white",
                )}
                aria-current={active ? "page" : undefined}
              >
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
