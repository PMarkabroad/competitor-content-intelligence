"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS: { label: string; links: { href: string; label: string }[] }[] = [
  {
    label: "Overview",
    links: [{ href: "/", label: "Dashboard" }],
  },
  {
    label: "Pipeline",
    links: [
      { href: "/review", label: "Review" },
      { href: "/competitors", label: "Competitors" },
      { href: "/hooks", label: "Hooks" },
      { href: "/outliers", label: "Outliers" },
      { href: "/reports", label: "Reports" },
    ],
  },
  {
    label: "Analysis",
    links: [
      { href: "/hooks/analysis", label: "Hook patterns" },
      { href: "/formats", label: "Formats" },
      { href: "/topics", label: "Topics" },
      { href: "/transcripts", label: "Transcripts" },
      { href: "/markets", label: "Markets" },
      { href: "/gaps", label: "Gaps" },
      { href: "/recommendations", label: "Recommendations" },
    ],
  },
  {
    label: "System",
    links: [
      { href: "/data", label: "Data" },
      { href: "/status", label: "Status" },
    ],
  },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex h-full w-48 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface/60 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
        <span className="text-[13px] font-semibold tracking-tight text-text">Ark Competitor Intel</span>
      </div>
      <div className="flex flex-col gap-3 p-2.5">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="mb-0.5 px-3 text-[10px] font-semibold uppercase tracking-wide text-faint">{section.label}</p>
            <div className="flex flex-col gap-0.5">
              {section.links.map((link) => {
                const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href + "/"));
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`relative rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                      active ? "bg-brand-soft font-medium text-brand" : "text-dim hover:bg-surface-hover hover:text-text"
                    }`}
                  >
                    {active && <span className="absolute -left-2.5 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brand" />}
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}
