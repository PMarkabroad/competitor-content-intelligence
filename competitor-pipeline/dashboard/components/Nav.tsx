"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/review", label: "Review" },
  { href: "/roster", label: "Roster" },
  { href: "/hooks", label: "Hooks" },
  { href: "/outliers", label: "Outliers" },
  { href: "/data", label: "Data" },
  { href: "/status", label: "Status" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex h-full w-44 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-raised)]">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <span className="text-sm font-semibold text-[var(--color-text)]">Ark Competitor Intel</span>
      </div>
      <div className="flex flex-col gap-0.5 p-2">
        {LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(link.href + "/");
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-[var(--color-brand)] text-white"
                  : "text-[var(--color-text-dim)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
      <div className="mt-auto p-2">
        <form action="/api/logout" method="post">
          <button
            type="submit"
            className="w-full rounded px-3 py-1.5 text-left text-xs text-[var(--color-text-faint)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-dim)]"
          >
            Log out
          </button>
        </form>
      </div>
    </nav>
  );
}
