const TONES = {
  neutral: "border-[var(--color-border)] text-[var(--color-text-dim)]",
  good: "border-[var(--color-good)]/40 text-[var(--color-good)]",
  warn: "border-[var(--color-warn)]/40 text-[var(--color-warn)]",
  bad: "border-[var(--color-bad)]/40 text-[var(--color-bad)]",
  brand: "border-[var(--color-brand)]/40 text-[var(--color-brand)]",
} as const;

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: keyof typeof TONES }) {
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] leading-none whitespace-nowrap ${TONES[tone]}`}>
      {children}
    </span>
  );
}
