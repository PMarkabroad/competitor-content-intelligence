import { getSupabaseServerClient } from "@/lib/supabase";
import { Badge } from "@/components/Badge";
import { formatNumber, formatVpf, formatDateTime } from "@/lib/format";
import { DraftStatusActions } from "@/components/DraftStatusActions";

export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const supabase = getSupabaseServerClient();
  // Dismissed drafts are excluded, not badged. They were shown with a
  // "dismissed" tag before, which meant an off-business draft still sat in
  // the middle of the queue you scroll to pick tonight's post from -- the
  // relevance audit dismissed 38 at once and every one of them stayed
  // visible. A dismissed draft is a decision already made; it does not
  // belong in the list of things to choose between.
  const { data: drafts } = await supabase
    .from("generated_drafts")
    .select("*")
    .neq("status", "dismissed")
    .order("created_at", { ascending: false })
    .limit(100);

  const { count: dismissedCount } = await supabase
    .from("generated_drafts")
    .select("*", { count: "exact", head: true })
    .eq("status", "dismissed");

  const rows = drafts ?? [];

  return (
    <div className="p-4">
      <h1 className="mb-1 text-sm font-semibold text-text">Ready-made posts</h1>
      <p className="mb-4 text-xs text-faint">
        Every draft generated from a competitor post, newest first. Nothing here is auto-posted -- review before using.
        {dismissedCount ? ` ${dismissedCount} dismissed draft${dismissedCount === 1 ? "" : "s"} hidden.` : ""}
      </p>

      {rows.length === 0 ? (
        <div className="panel p-4 text-xs text-faint">
          No drafts generated yet. Click "Generate Ark draft" on any post in Content ideas to create one --
          it'll show up here automatically from now on.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((d) => (
            <div key={d.draft_id} id={`draft-${d.draft_id}`} className="panel p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] text-faint">
                  <span className="font-medium text-dim">{d.competitor_name}</span>
                  <Badge tone="neutral">{d.market}</Badge>
                  <span>{formatDateTime(d.created_at)}</span>
                  {d.source_views != null && <span>{formatNumber(d.source_views)} views</span>}
                  {d.source_vpf != null && <span>vpf {formatVpf(d.source_vpf)}</span>}
                  <Badge tone={d.status === "used" ? "good" : d.status === "dismissed" ? "neutral" : "brand"}>
                    {d.status}
                  </Badge>
                </div>
                <DraftStatusActions draftId={d.draft_id} status={d.status} hook={d.hook} script={d.script} caption={d.caption} />
              </div>
              <p className="mb-1.5 text-sm font-medium text-text">{d.hook}</p>
              <p className="mb-1.5 whitespace-pre-wrap text-xs leading-relaxed text-dim">{d.script}</p>
              <p className="text-xs italic text-faint">Caption: {d.caption}</p>
              {d.source_caption && (
                <p className="mt-2 border-t border-border pt-2 text-[11px] text-faint">
                  Source post caption: "{d.source_caption}"
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
