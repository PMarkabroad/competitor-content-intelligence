"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Simplified nav: the 5 links a founder actually uses live up top with no
// section label. Everything else (deeper analysis screens, still fully
// functional, just not day-to-day) is one click away under "More" instead
// of being flattened into 15 always-visible links across 4 sections.
// Nothing was deleted -- every route below still exists and works.
const PRIMARY_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/content-ideas", label: "Content ideas" },
  { href: "/drafts", label: "Ready-made posts" },
  { href: "/transcripts", label: "Transcripts" },
  { href: "/status", label: "Status" },
];

const MORE_LINKS: { href: string; label: string }[] = [
  { href: "/review", label: "Review" },
  { href: "/competitors", label: "Competitors" },
  { href: "/outliers", label: "Outliers" },
  { href: "/reports", label: "Reports" },
  { href: "/hooks", label: "Hooks" },
  { href: "/hooks/analysis", label: "Hook patterns" },
  { href: "/formats", label: "Formats" },
  { href: "/topics", label: "Topics" },
  { href: "/markets", label: "Markets" },
  { href: "/gaps", label: "Gaps" },
  { href: "/recommendations", label: "Recommendations" },
  { href: "/data", label: "Data" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`relative rounded-md px-3 py-1.5 text-[13px] transition-colors ${
        active ? "bg-brand-soft font-medium text-brand" : "text-dim hover:bg-surface-hover hover:text-text"
      }`}
    >
      {active && <span className="absolute -left-2.5 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brand" />}
      {label}
    </Link>
  );
}

export function Nav() {
  const pathname = usePathname();
  const moreHasActive = MORE_LINKS.some((link) => isActive(pathname, link.href));
  const [moreOpen, setMoreOpen] = useState(moreHasActive);

  return (
    <nav className="flex h-full w-48 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface/60 backdrop-blur-sm">
      <Link
        href="/"
        className="flex items-center gap-2 border-b border-border px-4 py-4 transition-colors hover:bg-surface-hover"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
        <span className="text-[13px] font-semibold tracking-tight text-text">Ark Competitor Intel</span>
      </Link>
      <div className="flex flex-col gap-0.5 p-2.5">
        {PRIMARY_LINKS.map((link) => (
          <NavLink key={link.href} href={link.href} label={link.label} active={isActive(pathname, link.href)} />
        ))}

        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="mt-2 flex items-center justify-between rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint hover:text-dim"
        >
          More
          <span className="text-[11px]">{moreOpen ? "\u2212" : "+"}</span>
        </button>
        {moreOpen && (
          <div className="flex flex-col gap-0.5">
            {MORE_LINKS.map((link) => (
              <NavLink key={link.href} href={link.href} label={link.label} active={isActive(pathname, link.href)} />
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
