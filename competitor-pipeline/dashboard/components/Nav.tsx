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
      aria-current={active ? "page" : undefined}
      className={`rounded-lg px-3 py-2 text-[13px] transition-colors ${
        active
          ? "bg-brand font-medium text-white"
          : "text-dim hover:bg-surface-hover hover:text-text"
      }`}
    >
      {label}
    </Link>
  );
}

export function Nav() {
  const pathname = usePathname();
  const moreHasActive = MORE_LINKS.some((link) => isActive(pathname, link.href));
  const [moreOpen, setMoreOpen] = useState(moreHasActive);

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface">
      <Link
        href="/"
        className="flex items-baseline gap-2 border-b border-border px-4 py-5 transition-colors hover:bg-surface-hover"
      >
        <span className="text-[15px] font-semibold tracking-tight text-text">Ark</span>
        <span className="text-[13px] text-faint">competitor intel</span>
      </Link>
      <div className="flex flex-col gap-1 p-3">
        {PRIMARY_LINKS.map((link) => (
          <NavLink key={link.href} href={link.href} label={link.label} active={isActive(pathname, link.href)} />
        ))}

        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="mt-3 flex items-center justify-between rounded-lg px-3 py-2 text-[13px] text-faint transition-colors hover:bg-surface-hover hover:text-dim"
        >
          More
          <span aria-hidden>{moreOpen ? "\u2212" : "+"}</span>
        </button>
        {moreOpen && (
          <div className="flex flex-col gap-1">
            {MORE_LINKS.map((link) => (
              <NavLink key={link.href} href={link.href} label={link.label} active={isActive(pathname, link.href)} />
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
