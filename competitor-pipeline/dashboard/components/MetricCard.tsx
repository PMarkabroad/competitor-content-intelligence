export function MetricCard({
  label,
  value,
  note,
  insufficientData,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
  insufficientData?: boolean;
}) {
  return (
    <div className="panel p-4">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className={`text-2xl font-semibold tracking-tight ${insufficientData ? "text-faint" : "text-text"}`}>{value}</p>
      {note && <p className="mt-1 text-[11px] text-faint">{note}</p>}
    </div>
  );
}
