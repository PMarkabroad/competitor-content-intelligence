import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { Badge } from "@/components/Badge";
import { formatNumber, formatVpf, formatScore, formatDate, deriveThumbnailUrl } from "@/lib/format";
import { tagHook } from "./actions";

export const dynamic = "force-dynamic";

const HOOK_PATTERNS = [
  "contrarian_inversion", "cost_accounting", "empathy_pivot", "subdivision_teaching",
  "receipt", "direct_question", "cold_open_story", "curiosity", "warning", "list", "problem", "bold_statement",
];
const FORMATS = ["talking_head", "screen_walkthrough", "text_on_screen_broll", "greenscreen_react", "carousel_as_reel", "pov"];
// visa-time-pressure / visa-pr-blocker are excluded from this form on
// purpose -- migration advice is regulated activity, see migration 012's
// header comment. They remain valid in the DB constraint (historical
// rows use them) but are not offered for new tagging here.
const TOPIC_SLUGS = ["linkedin-networking", "interview-performance", "resume-not-working", "no-local-experience", "volume-no-results", "no-callbacks"];
const TRANSPLANT_VALUES = ["yes", "no", "with_changes"];

export default async function ReelDetailPage({ params }: { params: Promise<{ post_id: string }> }) {
  const { post_id } = await params;
  const supabase = getSupabaseServerClient();

  const { data: post, error } = await supabase
    .from("competitor_posts")
    .select("*")
    .eq("post_id", post_id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load post: ${error.message}`);
  if (!post) notFound();

  const [{ data: competitor }, { data: transcript }, { data: hook }, { data: outlierRow }] = await Promise.all([
    supabase.from("competitors").select("competitor_id, name, handle, market, tier, platform").eq("competitor_id", post.competitor_id).maybeSingle(),
    supabase.from("competitor_transcripts").select("*").eq("post_id", post_id).maybeSingle(),
    supabase.from("hook_library").select("*").eq("post_id", post_id).maybeSingle(),
    supabase.from("v_outliers").select("outlier_score, vpf").eq("post_id", post_id).maybeSingle(),
  ]);

  const vpf = post.followers_at_scrape ? (post.views ?? 0) / post.followers_at_scrape : null;
  const thumbnailUrl = deriveThumbnailUrl(post.thumbnail_url, post.raw);

  return (
    <div className="p-3 sm:p-4">
      <div className="mb-4 grid grid-cols-3 gap-4">
        <div className="panel overflow-hidden">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnailUrl} alt="" className="aspect-[9/16] w-full object-cover" />
          ) : (
            <div className="flex aspect-[9/16] w-full items-center justify-center text-xs text-faint">No thumbnail</div>
          )}
        </div>

        <div className="col-span-2">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {competitor && (
              <Link href={`/competitors/${competitor.handle}`} className="text-sm font-semibold text-text underline decoration-border underline-offset-2 hover:decoration-text">
                {competitor.name}
              </Link>
            )}
            {competitor && <Badge tone="neutral">{competitor.market}</Badge>}
            {competitor && <Badge tone="brand">{competitor.tier}</Badge>}
            <span className="text-xs text-faint">{formatDate(post.posted_at)}</span>
            {post.post_url && (
              <a href={post.post_url} target="_blank" rel="noreferrer" className="text-xs text-text underline decoration-border underline-offset-2 hover:decoration-text">
                Original ↗
              </a>
            )}
          </div>

          <div className="mb-3 grid grid-cols-5 gap-2">
            <div className="panel p-2.5">
              <p className="text-[10px] uppercase text-faint">Views</p>
              <p className="text-sm font-semibold text-text">{formatNumber(post.views)}</p>
            </div>
            <div className="panel p-2.5">
              <p className="text-[10px] uppercase text-faint">Likes</p>
              <p className="text-sm font-semibold text-text">{formatNumber(post.likes)}</p>
            </div>
            <div className="panel p-2.5">
              <p className="text-[10px] uppercase text-faint">Comments</p>
              <p className="text-sm font-semibold text-text">{formatNumber(post.comments)}</p>
            </div>
            <div className="panel p-2.5">
              <p className="text-[10px] uppercase text-faint">Shares</p>
              <p className="text-sm font-semibold text-text">{formatNumber(post.shares)}</p>
            </div>
            <div className="panel p-2.5">
              <p className="text-[10px] uppercase text-faint">Duration</p>
              <p className="text-sm font-semibold text-text">{post.duration_seconds ? `${post.duration_seconds}s` : "—"}</p>
            </div>
          </div>

          <div className="mb-3 flex gap-3 text-xs">
            <span className="text-dim">VPF <span className="font-medium text-text">{formatVpf(vpf)}</span></span>
            {outlierRow && <span className="text-dim">Outlier score <span className="num font-semibold text-brand">{formatScore(outlierRow.outlier_score)}</span></span>}
            {post.paid_partnership && <Badge tone="warn">paid partnership</Badge>}
            {post.is_repost && <Badge tone="neutral">repost</Badge>}
          </div>

          <div className="panel p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase text-faint">Caption</p>
            <p className="whitespace-pre-wrap text-xs text-dim">{post.caption || "—"}</p>
          </div>
        </div>
      </div>

      <div className="mb-4 panel p-4">
        <p className="mb-1 text-xs font-semibold uppercase text-faint">Transcript</p>
        {transcript?.transcript ? (
          <p className="whitespace-pre-wrap text-xs text-dim">{transcript.transcript}</p>
        ) : (
          <p className="text-xs text-faint">Not transcribed yet.</p>
        )}
      </div>

      {hook ? (
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-faint">Hook analysis</p>
            <Badge tone={hook.brand_fit === "yes" ? "good" : hook.brand_fit === "with_changes" ? "warn" : hook.brand_fit === "no" ? "bad" : "neutral"}>
              brand_fit: {hook.brand_fit ?? "untagged"}
            </Badge>
          </div>
          <p className="mb-3 text-sm font-medium text-text">&ldquo;{hook.opening_line}&rdquo;</p>
          <div className="mb-3 grid grid-cols-4 gap-3 text-xs">
            <div><p className="text-faint">Pattern</p><p className="text-text">{hook.hook_pattern ?? "—"}</p></div>
            <div><p className="text-faint">Format</p><p className="text-text">{hook.format ?? "—"}</p></div>
            <div><p className="text-faint">Topic</p><p className="text-text">{hook.topic_slug ?? "—"}</p></div>
            <div><p className="text-faint">Sub-topic</p><p className="text-text">{hook.sub_topic ?? "—"}</p></div>
            <div><p className="text-faint">Content angle</p><p className="text-text">{hook.content_angle ?? "—"}</p></div>
            <div><p className="text-faint">CTA</p><p className="text-text">{hook.cta ?? "—"}</p></div>
            <div><p className="text-faint">Narrative structure</p><p className="text-text">{hook.narrative_structure ?? "—"}</p></div>
            <div><p className="text-faint">AU transplant</p><p className="text-text">{hook.au_transplant ?? "—"}</p></div>
          </div>
          {hook.transplant_note && (
            <div className="mb-2 text-xs"><p className="text-faint">Transplant note</p><p className="text-dim">{hook.transplant_note}</p></div>
          )}
          {hook.brand_fit_note && (
            <div className="mb-2 text-xs"><p className="text-faint">Brand fit note</p><p className="text-dim">{hook.brand_fit_note}</p></div>
          )}
          <div className="text-xs">
            <p className="text-faint">Why it performed</p>
            <p className="text-dim">{hook.why_it_performed ?? "Not written yet."}</p>
          </div>
        </div>
      ) : (
        <div className="panel p-4">
          <p className="mb-3 text-xs font-semibold uppercase text-faint">Not yet tagged</p>
          <details>
            <summary className="cursor-pointer text-xs text-dim underline decoration-border underline-offset-2 hover:text-text">Tag this hook</summary>
            <form action={tagHook} className="mt-3 grid grid-cols-2 gap-3">
              <input type="hidden" name="post_id" value={post.post_id} />
              <input type="hidden" name="competitor_id" value={post.competitor_id} />
              <input type="hidden" name="outlier_score" value={outlierRow?.outlier_score ?? ""} />
              <input type="hidden" name="vpf" value={outlierRow?.vpf ?? vpf ?? ""} />
              <input type="hidden" name="duration_seconds" value={post.duration_seconds ?? ""} />

              <label className="col-span-2 text-xs text-dim">
                Your name
                <input name="tagged_by" required className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text" />
              </label>
              <label className="col-span-2 text-xs text-dim">
                Opening line
                <input name="opening_line" defaultValue={transcript?.opening_line ?? ""} className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text" />
              </label>
              <label className="text-xs text-dim">
                Hook pattern
                <select name="hook_pattern" className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text">
                  <option value="">—</option>
                  {HOOK_PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="text-xs text-dim">
                Format
                <select name="format" className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text">
                  <option value="">—</option>
                  {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label className="text-xs text-dim">
                Topic
                <select name="topic_slug" className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text">
                  <option value="">—</option>
                  {TOPIC_SLUGS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="text-xs text-dim">
                Sub-topic (free text)
                <input name="sub_topic" className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text" />
              </label>
              <label className="text-xs text-dim">
                Content angle
                <input name="content_angle" className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text" />
              </label>
              <label className="text-xs text-dim">
                CTA
                <input name="cta" className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text" />
              </label>
              <label className="col-span-2 text-xs text-dim">
                Narrative structure
                <input name="narrative_structure" className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text" />
              </label>
              <label className="text-xs text-dim">
                AU transplant
                <select name="au_transplant" className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text">
                  <option value="">—</option>
                  {TRANSPLANT_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="text-xs text-dim">
                Brand fit
                <select name="brand_fit" className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text">
                  <option value="">—</option>
                  {TRANSPLANT_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="col-span-2 text-xs text-dim">
                Transplant note
                <textarea name="transplant_note" rows={2} className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text" />
              </label>
              <label className="col-span-2 text-xs text-dim">
                Brand fit note -- checked against reference/arkabroad-voice.md
                <textarea name="brand_fit_note" rows={2} className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text" />
              </label>
              <label className="col-span-2 text-xs text-dim">
                Why it performed (human-written, max 2 sentences -- never auto-generated)
                <textarea name="why_it_performed" rows={2} className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text" />
              </label>
              <button type="submit" className="col-span-2 rounded-md bg-text px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-85">
                Save tag
              </button>
            </form>
          </details>
        </div>
      )}
    </div>
  );
}
