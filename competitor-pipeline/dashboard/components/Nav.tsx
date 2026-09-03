"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Five day-to-day links, ordered the way the work actually runs: see the
// state of things, see who we track, see what the data says, get ideas,
// get something ready to post.
//
// The previous version put only 5 links up top too, but four of the five
// questions this tool exists to answer -- which patterns work, which
// formats, where the gaps are, what to make -- were all buried under
// "More", along with the competitor roster. Those six analysis screens are
// now one /insights page, so they're a click from anywhere instead of a
// click plus a hunt.
//
// Nothing was deleted. Every old route still exists and still works; the
// ones below just aren't the daily path.
const PRIMARY_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/competitors", label: "Competitors" },
  { href: "/insights", label: "Insights" },
  { href: "/content-ideas", label: "Content ideas" },
  { href: "/hooks", label: "Hook library" },
  { href: "/formats", label: "Formats they use" },
  { href: "/drafts", label: "Ready-made posts" },
];

const MORE_LINKS: { href: string; label: string }[] = [
  { href: "/review", label: "Review new accounts" },
  { href: "/outliers", label: "Transcription queue" },
  { href: "/transcripts", label: "Transcripts" },
  { href: "/reports", label: "Monthly reports" },
  { href: "/status", label: "Status" },
  { href: "/data", label: "Raw tables" },
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
