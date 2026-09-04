import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { Badge } from "@/components/Badge";
import { formatNumber, formatVpf, formatDateTime } from "@/lib/format";
import { DraftStatusActions } from "@/components/DraftStatusActions";
import { ChannelVersions, type ChannelVersion } from "@/components/ChannelVersions";
import { CopyBody } from "@/components/CopyBody";

export const dynamic = "force-dynamic";

/**
 * Platform sections. "All posts" keeps the by-idea view -- one card per
 * post with its channels behind tabs -- and each platform tab flips the
 * page to a by-channel view: every post's version for that one platform,
 * grouped by format.
 *
 * Both views exist because they answer different questions. "What should
 * we post about?" is a question about ideas. "Give me everything for
 * LinkedIn this week" is a question about a channel, and answering it from
 * the by-idea view means opening 69 cards and clicking the same tab in
 * each.
 */
const PLATFORMS = [
  { key: "all", label: "All posts" },
  { key: "instagram", label: "Instagram" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "facebook", label: "Facebook" },
  { key: "twitter", label: "X / Twitter" },
] as const;

const FORMAT_LABEL: Record<string, string> = {
  reel: "Reel captions",
  carousel: "Carousels",
  single_image: "Single image",
  story: "Stories",
  post: "Posts",
  carousel_pdf: "Carousels (PDF)",
  facebook_post: "Posts",
  facebook_carousel: "Carousels",
  tweet: "Tweets",
};

// Order within a platform: the format used most often first.
const FORMAT_ORDER = [
  "reel",
  "carousel",
  "single_image",
  "story",
  "post",
  "carousel_pdf",
  "facebook_post",
  "facebook_carousel",
  "tweet",
];

interface FormatRow extends ChannelVersion {
  draft_id: string;
}

export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string }>;
}) {
  const params = await searchParams;
  const active = PLATFORMS.some((p) => p.key === params.platform)
    ? (params.platform as string)
    : "all";

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

  // Channel versions for everything on this page, fetched in one query and
  // grouped in memory rather than one query per card.
  const { data: formatRows } = rows.length
    ? await supabase
        .from("draft_formats")
        .select("draft_id, platform, format, body, char_count, char_limit")
        .in(
          "draft_id",
          rows.map((d) => d.draft_id)
        )
    : { data: [] as FormatRow[] };

  const all = (formatRows ?? []) as FormatRow[];

  const byDraft = new Map<string, ChannelVersion[]>();
  for (const f of all) {
    if (!byDraft.has(f.draft_id)) byDraft.set(f.draft_id, []);
    byDraft.get(f.draft_id)!.push(f);
  }

  const hookByDraft = new Map(rows.map((d) => [d.draft_id, d.hook as string]));
  const countFor = (key: string) =>
    key === "all" ? rows.length : all.filter((f) => f.platform === key).length;

  return (
    <div className="p-4">
      <h1 className="mb-1 text-sm font-semibold text-text">Ready-made posts</h1>
      <p className="mb-4 text-xs text-faint">
        Every draft written out for each channel you publish on. Pick a platform to see just
        that channel&apos;s versions. Nothing here is auto-posted -- review before using.
        {dismissedCount ? ` ${dismissedCount} dismissed draft${dismissedCount === 1 ? "" : "s"} hidden.` : ""}
      </p>

      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {PLATFORMS.map((p) => (
          <Link
            key={p.key}
            href={p.key === "all" ? "/drafts" : `/drafts?platform=${p.key}`}
            className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
              p.key === active
                ? "border-brand text-brand"
                : "border-border text-dim hover:text-text"
            }`}
          >
            {p.label}
            <span className="ml-1.5 text-[10px] tabular-nums opacity-60">{countFor(p.key)}</span>
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="panel p-4 text-xs text-faint">
          No drafts generated yet. Click &quot;Generate Ark draft&quot; on any post in Content ideas
          to create one -- it&apos;ll show up here automatically from now on.
        </div>
      ) : active === "all" ? (
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
                  <Badge tone={d.status === "used" ? "good" : "brand"}>{d.status}</Badge>
                </div>
                <DraftStatusActions
                  draftId={d.draft_id}
                  status={d.status}
                  hook={d.hook}
                  script={d.script}
                  caption={d.caption}
                />
              </div>
              <p className="mb-1.5 text-sm font-medium text-text">{d.hook}</p>
              <p className="mb-1.5 whitespace-pre-wrap text-xs leading-relaxed text-dim">{d.script}</p>
              <p className="text-xs italic text-faint">Caption: {d.caption}</p>
              <ChannelVersions versions={byDraft.get(d.draft_id) ?? []} />
            </div>
          ))}
        </div>
      ) : (
        <PlatformView
          rows={all.filter((f) => f.platform === active)}
          hookByDraft={hookByDraft}
        />
      )}
    </div>
  );
}

function PlatformView({
  rows,
  hookByDraft,
}: {
  rows: FormatRow[];
  hookByDraft: Map<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <div className="panel p-4 text-xs text-faint">
        No versions for this platform yet. They are written by{" "}
        <span className="font-mono">npm run generate-formats</span>, which runs automatically
        after new posts are generated.
      </div>
    );
  }

  const byFormat = new Map<string, FormatRow[]>();
  for (const r of rows) {
    if (!byFormat.has(r.format)) byFormat.set(r.format, []);
    byFormat.get(r.format)!.push(r);
  }
  const groups = Array.from(byFormat.entries()).sort(
    (a, b) => FORMAT_ORDER.indexOf(a[0]) - FORMAT_ORDER.indexOf(b[0])
  );

  return (
    <div className="flex flex-col gap-7">
      {groups.map(([format, items]) => (
        <section key={format}>
          <h2 className="mb-2 text-[11px] font-medium text-faint">
            {FORMAT_LABEL[format] ?? format}
            <span className="ml-1.5 tabular-nums opacity-70">{items.length}</span>
            {items[0]?.char_limit ? (
              <span className="ml-2 opacity-70">limit {items[0].char_limit.toLocaleString()}</span>
            ) : (
              <span className="ml-2 opacity-70">no fixed limit</span>
            )}
          </h2>
          <div className="flex flex-col gap-3">
            {items.map((r) => (
              <div key={`${r.draft_id}-${r.format}`} className="panel p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  {/* The source hook, so a body can be traced back to the
                      idea it came from without leaving this view. */}
                  <Link
                    href={`/drafts#draft-${r.draft_id}`}
                    className="text-[11px] text-faint underline-offset-2 hover:underline"
                  >
                    {(hookByDraft.get(r.draft_id) ?? "").slice(0, 90)}
                  </Link>
                  <CopyBody text={r.body} />
                </div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-bg px-3 py-2.5 font-sans text-xs leading-relaxed text-text">
                  {r.body}
                </pre>
                <p className="mt-1 text-[10px] text-faint tabular-nums">
                  {r.char_count.toLocaleString()} characters
                  {r.char_limit ? ` of ${r.char_limit.toLocaleString()}` : ""}
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
