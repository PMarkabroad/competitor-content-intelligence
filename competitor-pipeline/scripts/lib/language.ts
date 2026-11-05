/**
 * Is this text in a language Ark can publish in?
 *
 * Lives in lib/ rather than beside the purge script because draft_hook_tags
 * imports it too, and importing a script with a top-level main() runs that
 * main() as a side effect -- tagging would have printed a purge report
 * every time it ran.
 *
 * ENGLISH, HINDI AND HINGLISH ARE ALL ALLOWED (changed 2026-11-05).
 *
 * The roster is mostly Indian creators speaking to Indian students and
 * graduates in Australia, and a large share of that is Hindi or Hinglish
 * (romanised Hindi). Those are the audience Ark serves, so the hook craft in
 * them transfers -- a contrarian inversion works the same in Hindi.
 *
 * What this used to do, and what it cost: Devanagari was on the blocked-
 * script list, so every Hindi transcript was dropped before a model ever saw
 * it. On the first roster-wide pass that was 37 of 52 exclusions -- the
 * single largest category, thrown away as "non-English". Hinglish was never
 * the problem: it is Latin script, and the word-ratio test below flagged
 * exactly zero transcripts. The whole loss came from the script check.
 *
 * Still excluded: every other non-Latin script, and Latin-script content
 * that is clearly another language (Spanish, Portuguese, Tagalog, Indonesian,
 * French, German). Ark publishes to a reader in Australia in English or
 * Hinglish; a Korean punchline cannot become an Ark post, and one did reach
 * third place in the hook library before any of this existed.
 *
 * KNOWN CONSEQUENCE: Devanagari is shared by Hindi, Marathi, Nepali and
 * Sanskrit. Allowing the script allows all of them, and no script test can
 * separate them -- that needs real language identification. Judged an
 * acceptable trade: those creators are talking to substantially the same
 * audience. Urdu is NOT allowed, which is the uncomfortable edge of this
 * rule, because Urdu and Hindi are close and some Urdu career content is
 * squarely on Ark's subject. It sits outside "English, Hindi, Hinglish" as
 * written, so it stays out until someone decides otherwise.
 */

/**
 * Scripts that are fine: Latin (English and Hinglish) and Devanagari
 * (Hindi). Checked by CODE POINT rather than a regex character class
 * written with literal characters -- such a class is silently mangled by
 * shell and file encoding, which is how an earlier scan reported zero
 * non-English hooks while one sat in plain view.
 */
const ALLOWED_RANGES: [number, number][] = [
  [0x0900, 0x097f], // Devanagari -- Hindi
];

/** [start, end] inclusive, scripts Ark cannot publish in. */
const DISALLOWED_RANGES: [number, number][] = [
  [0x0400, 0x04ff], // Cyrillic
  [0x0590, 0x05ff], // Hebrew
  [0x0600, 0x06ff], // Arabic, including Urdu
  [0x0980, 0x09ff], // Bengali
  [0x0a00, 0x0a7f], // Gurmukhi -- Punjabi
  [0x0a80, 0x0aff], // Gujarati
  [0x0b80, 0x0bff], // Tamil
  [0x0c00, 0x0c7f], // Telugu
  [0x0e00, 0x0e7f], // Thai
  [0x3040, 0x30ff], // Hiragana + Katakana
  [0x4e00, 0x9fff], // CJK
  [0xac00, 0xd7a3], // Hangul
];

function inRanges(cp: number, ranges: [number, number][]): boolean {
  for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return true;
  return false;
}

/**
 * The share of meaningful characters that are in a script Ark cannot use.
 *
 * A RATIO, not a presence check. A single character used to be conclusive,
 * which was right for "사랑합니다." (six characters, all Korean) and wrong
 * for a 1,500-character Hindi transcript containing one stray glyph from a
 * brand name or a mis-transcription. The same reasoning already governs the
 * word test below: one loan word does not condemn a post.
 *
 * Short all-foreign text still fails, because the ratio there is 1.0 -- the
 * case that prompted the original rule is handled by the rule that replaces
 * it, not despite it.
 */
function disallowedScriptRatio(text: string): number {
  let allowed = 0;
  let disallowed = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (inRanges(cp, DISALLOWED_RANGES)) disallowed++;
    else if (inRanges(cp, ALLOWED_RANGES) || /[A-Za-z]/.test(ch)) allowed++;
  }
  const total = allowed + disallowed;
  return total === 0 ? 0 : disallowed / total;
}

/**
 * Above this share of disallowed-script characters, the text is in another
 * language rather than merely quoting one. 10% is deliberately low: a
 * genuine Hindi or English transcript sits at 0, and anything mixed enough
 * to clear 10% is not a stray glyph.
 */
const DISALLOWED_SCRIPT_LIMIT = 0.1;

// Words common in Spanish, Portuguese, Tagalog, Indonesian, French and
// German, and rare or absent in English career content.
const NON_ENGLISH =
  /\b(que|los|las|una|con|por|para|pero|como|este|esta|todo|hacer|tienes|mas|muy|nao|voce|com|uma|isso|mais|sao|dans|pour|vous|nous|avec|cette|est|sur|sont|und|ist|mit|auf|nicht|dem|sich|ng|mga|ako|yung|naman|kang|dyan|nila|yang|untuk|tidak|saya|kerja|adalah|dengan|itu)\b/gi;

const ENGLISH =
  /\b(the|and|you|your|for|with|that|this|are|have|from|they|what|when|not|but|job|jobs|work|resume|interview|hiring|career|role|company|manager|apply)\b/gi;

/**
 * Romanised Hindi markers. Their presence means the text is HINGLISH, which
 * is allowed, so the foreign-word test must not run on it.
 *
 * This is belt and braces: the word test has never actually flagged a
 * Hinglish transcript, because Hinglish shares almost no vocabulary with the
 * Romance and Austronesian languages in that list. But "hai" next to "mas"
 * or "como" in one sentence is a plausible way to get there, and silently
 * dropping Hindi is the exact failure this file was just corrected for.
 */
const HINGLISH =
  /\b(hai|hain|nahi|nahin|kya|kyun|kyunki|aap|aapko|mera|meri|tera|apna|apne|karo|karna|karke|kaise|kaisa|bhai|yaar|matlab|bohot|bahut|thoda|accha|achha|sahi|bilkul|lekin|phir|abhi|jaise|liye|wala|wali|hoga|hogi|raha|rahi|rahe|gaya|diya|lena|dena|bata|batao|samajh|chahiye|zaroori|paisa|naukri|kaam)\b/i;

/**
 * Returns why the text is not publishable, or null if it is (or if there is
 * not enough of it to say).
 */
export function nonEnglishReason(text: string | null | undefined): string | null {
  const t = String(text ?? "").trim();
  if (!t) return null;

  // Script is checked FIRST, before any length guard -- short text that is
  // entirely in another script is conclusive, and the line that prompted
  // this check ("사랑합니다.") is six characters long.
  if (disallowedScriptRatio(t) > DISALLOWED_SCRIPT_LIMIT) {
    return "script Ark cannot publish in";
  }

  // Hindi in Devanagari, or Hinglish in Latin. Either way it is allowed, and
  // the Romance/Austronesian word test below would only ever be wrong about
  // it.
  if (inRangesAnywhere(t, ALLOWED_RANGES) || HINGLISH.test(t)) return null;

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

function inRangesAnywhere(text: string, ranges: [number, number][]): boolean {
  for (const ch of text) if (inRanges(ch.codePointAt(0)!, ranges)) return true;
  return false;
}
