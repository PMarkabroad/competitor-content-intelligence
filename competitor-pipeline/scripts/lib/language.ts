/**
 * Is this text English?
 *
 * Lives in lib/ rather than beside the purge script because draft_hook_tags
 * imports it too, and importing a script with a top-level main() runs that
 * main() as a side effect -- tagging would have printed a purge report
 * every time it ran.
 *
 * Ark publishes in English to a reader in Australia, so non-English content
 * can never become an Ark post. It can still score, though, and it did: a
 * 198x hook sitting third in the library was the single line
 * "사랑합니다" attached to an English subject about AI
 * auto-apply.
 */

// [start, end] inclusive code point ranges for scripts that are never
// English. Checked by CODE POINT rather than a regex character class
// written with literal characters -- such a class is silently mangled by
// shell and file encoding, which is how an earlier scan reported zero
// non-English hooks while one sat in plain view.
const NON_LATIN_RANGES: [number, number][] = [
  [0x0400, 0x04ff], // Cyrillic
  [0x0590, 0x05ff], // Hebrew
  [0x0600, 0x06ff], // Arabic
  [0x0900, 0x097f], // Devanagari
  [0x0e00, 0x0e7f], // Thai
  [0x3040, 0x30ff], // Hiragana + Katakana
  [0x4e00, 0x9fff], // CJK
  [0xac00, 0xd7a3], // Hangul
];

function hasNonLatinScript(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    for (const [lo, hi] of NON_LATIN_RANGES) {
      if (cp >= lo && cp <= hi) return true;
    }
  }
  return false;
}

// Words common in Spanish, Portuguese, Tagalog, Indonesian, French and
// German, and rare or absent in English career content.
const NON_ENGLISH =
  /\b(que|los|las|una|con|por|para|pero|como|este|esta|todo|hacer|tienes|mas|muy|nao|voce|com|uma|isso|mais|sao|dans|pour|vous|nous|avec|cette|est|sur|sont|und|ist|mit|auf|nicht|dem|sich|ng|mga|ako|yung|naman|kang|dyan|nila|yang|untuk|tidak|saya|kerja|adalah|dengan|itu)\b/gi;

const ENGLISH =
  /\b(the|and|you|your|for|with|that|this|are|have|from|they|what|when|not|but|job|jobs|work|resume|interview|hiring|career|role|company|manager|apply)\b/gi;

/**
 * Returns why the text is not English, or null if it is (or if there is not
 * enough of it to say).
 */
export function nonEnglishReason(text: string | null | undefined): string | null {
  const t = String(text ?? "").trim();
  if (!t) return null;

  // Script is checked FIRST, before any length guard. A single Hangul
  // character is conclusive at any length, and the line that prompted all
  // of this -- "사랑합니다." -- is six characters long.
  // Ordering these the other way round is why it was missed.
  if (hasNonLatinScript(t)) return "non-Latin script";

  // Below this, only the word-ratio test remains, and it needs enough text
  // to be worth anything. "no way" is not evidence of a language.
  if (t.length < 12) return null;

  const foreign = (t.match(NON_ENGLISH) ?? []).length;
  const english = (t.match(ENGLISH) ?? []).length;
  // Several markers AND fewer English ones, so a single loan word or a
  // place name does not condemn a post.
  if (foreign >= 3 && foreign > english) return "Latin script, not English";
  return null;
}
