import { getSupabaseServerClient } from "@/lib/supabase";
import { GatedScreen } from "@/components/GatedScreen";

export const dynamic = "force-dynamic";

const MIN_TRANSCRIPTS = 25;
const STOPWORDS = new Set(["the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "is", "it", "i", "you", "this", "that", "for", "so", "my"]);

export default async function TranscriptsPage() {
  const supabase = getSupabaseServerClient();
  const { count, error } = await supabase.from("competitor_transcripts").select("transcript_id", { count: "exact", head: true });
  if (error) throw new Error(`Failed to count competitor_transcripts: ${error.message}`);

  if ((count ?? 0) < MIN_TRANSCRIPTS) {
    return (
      <GatedScreen title="Phrase and opening-pattern mining" requirement={`${MIN_TRANSCRIPTS} transcripts`} current={count ?? 0} minimum={MIN_TRANSCRIPTS} />
    );
  }

  const { data: transcripts } = await supabase.from("competitor_transcripts").select("opening_line, transcript");

  // Opening-word frequency: the first real word of each opening_line,
  // lowercased -- a simple, defensible signal for "what kind of move do
  // competitors open with" without pulling in an NLP dependency for a
  // screen this dormant.
  const openingWordCounts = new Map<string, number>();
  for (const t of transcripts ?? []) {
    const firstWord = t.opening_line?.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
    if (!firstWord || STOPWORDS.has(firstWord)) continue;
    openingWordCounts.set(firstWord, (openingWordCounts.get(firstWord) ?? 0) + 1);
  }

  // Common bigrams across full transcripts, stopwords filtered from the
  // first token of the pair -- a lightweight phrase-frequency proxy.
  const bigramCounts = new Map<string, number>();
  for (const t of transcripts ?? []) {
    const words = (t.transcript ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length - 1; i++) {
      if (STOPWORDS.has(words[i])) continue;
      const bigram = `${words[i]} ${words[i + 1]}`;
      bigramCounts.set(bigram, (bigramCounts.get(bigram) ?? 0) + 1);
    }
  }

  const topOpeningWords = Array.from(openingWordCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const topBigrams = Array.from(bigramCounts.entries()).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 15);

  return (
    <div className="p-4">
      <h1 className="mb-4 text-sm font-semibold text-text">Transcript phrase mining</h1>
      <div className="grid grid-cols-2 gap-4">
        <div className="panel p-4">
          <h2 className="mb-2 text-xs font-semibold text-faint">Opening words</h2>
          <table className="w-full text-left text-xs">
            <tbody>
              {topOpeningWords.map(([word, n]) => (
                <tr key={word} className="border-b border-border last:border-b-0">
                  <td className="py-1 text-text">{word}</td>
                  <td className="py-1 text-right text-dim">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel p-4">
          <h2 className="mb-2 text-xs font-semibold text-faint">Recurring phrases (3+ uses)</h2>
          {topBigrams.length === 0 ? (
            <p className="text-xs text-faint">No phrase repeats 3+ times yet.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <tbody>
                {topBigrams.map(([phrase, n]) => (
                  <tr key={phrase} className="border-b border-border last:border-b-0">
                    <td className="py-1 text-text">{phrase}</td>
                    <td className="py-1 text-right text-dim">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
