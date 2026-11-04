/**
 * Which SUBJECTS may be offered to the draft generator as Ark content.
 *
 * Only subjects. Hook PATTERNS come from anywhere, including lifestyle and
 * travel accounts -- that split is the point of the 2026-11-04 change, and
 * this file is the subject half of it.
 *
 * Structured as match + exception rather than a keyword list, because every
 * one of these terms is in scope in one context and out of it in another:
 *
 *   "visa"         -- a visa APPLICATION is a migration agent's business.
 *                     "Employers rejecting you over your 485" is Ark's core
 *                     content. Same word, opposite verdicts.
 *   "migration"    -- "skilled migration points test" is out. "IMG doctor
 *                     post-migration disillusionment" is a career story and
 *                     a flat keyword list removed it, which is the bug that
 *                     prompted this rewrite.
 *   "moving to"    -- "moving to Australia" is out; "moving to a senior
 *                     role" is exactly what Ark sells.
 *   "culture shock"-- arrival culture shock is lifestyle; WORKPLACE culture
 *                     shock is the first-90-days problem Ark coaches.
 *
 * Whole-word matching throughout. Substring matching put "PR" inside
 * product/project/prep and "OPT" inside optimise, so every short token here
 * is bounded.
 */

export interface ScopeRule {
  name: string;
  /** Subject is out of scope when this matches... */
  match: RegExp;
  /** ...unless this also matches, which puts it back in scope. */
  unless?: RegExp;
}

/** Job-search context that rescues an otherwise out-of-scope term. */
const JOB_CONTEXT =
  /\b(job|jobs|role|roles|hiring|hire|employer|employers|interview|interviews|resume|cv|recruiter|recruit|salary|promotion|career|workplace|work rights|colleague|colleagues|manager|office|onboarding|probation)\b/i;

export const SCOPE_RULES: ScopeRule[] = [
  {
    // The PROCESS of obtaining status, which is licensed work in Australia.
    // Status as it collides with hiring stays in scope.
    name: "immigration process",
    match:
      /\b(visa|pr|permanent residency|citizenship)\s+(application|applications|process|grant|granted|pathway|timeline|rule|rules|change|changes|policy|requirements?|lodg\w*)\b|\bapply(ing)?\s+for\s+(a\s+)?(visa|pr|permanent residency|citizenship)\b|\bsubclass\s*\d{3}\b|\b(skilled\s+migration|migration\s+agent|immigration\s+lawyer|points\s+test|EOI|expression\s+of\s+interest)\b|\bcitizenship\s+(test|ceremony)\b|\bsuperannuation\s+refund\b/i,
    unless: JOB_CONTEXT,
  },
  {
    // Visa POLICY, where the rule word is not adjacent to "visa" -- e.g.
    // "407 training visa offshore rule change". Adjacency alone missed it.
    // JOB_CONTEXT still rescues the job-search framings: "how to answer visa
    // questions in interviews" has no rule word, and "employers rejecting you
    // over your 485" is rescued by "employers".
    name: "visa policy change",
    match: /\bvisa\b[^|]*\b(rule|rules|change|changes|policy|policies|requirement|requirements|eligibility)\b|\b(rule|rules|change|changes|policy|policies)\b[^|]*\bvisa\b/i,
    unless: JOB_CONTEXT,
  },
  {
    name: "another country's system",
    match: /\b(H-?1B|OPT|CPT|green\s+card|express\s+entry|LMIA|PGWP|EAD|USCIS|IRCC)\b/i,
  },
  {
    // A move between countries or cities -- not a move between roles.
    name: "relocation / arrival",
    match:
      /\b(moving|move|moved|relocating|relocate|relocation|settling|arriv\w+|returning|going\s+back)\s+(back\s+)?(to|in|into|from)\s+(a\s+new\s+country|another\s+country|abroad|overseas|australia|melbourne|sydney|brisbane|perth|adelaide|canada|toronto|vancouver|india|the\s+uk|london)\b|\bfirst\s+(days|weeks|months)\s+in\s+(australia|a\s+new\s+country|abroad)\b/i,
    unless: /\b(role|roles|job|position|team|company|employer)\b/i,
  },
  {
    name: "study abroad / student recruitment",
    match:
      /\b(scholarship|scholarships|study\s+abroad|student\s+visa|IELTS|PTE|intake|semester|tuition)\b|\b(university|master'?s|bachelor'?s|course)\s+(application|applications|applying|admission|offer)\b/i,
  },
  {
    // Licensing PROCESSES, never the professions. Getting a nursing or
    // engineering job in Australia is Ark's audience.
    name: "licensing / registration",
    match:
      /\bahpra\b|\bskills\s+assessment\b|\bregistration\s+(pathway|process|exam|requirements?|timeline)\b|\b(medical|nursing|engineering|teaching)\s+registration\b|\blicensure\b|\blicensing\s+exam\b|\bteacher\s+certif\w*\b|\brecognition\s+of\s+prior\s+learning\b|\bcredentials?\s+assessment\b|\b(NCLEX|OET|AMC\s+exam)\b/i,
  },
  {
    // Lifestyle and product. Bare "travel" and "college" are gone: they hit
    // "travel time to the office" and the American sense of university.
    name: "lifestyle / travel / product",
    match:
      /\bitinerary\b|\btourist\b|\brestaurant\b|\brecipe\b|\bcafe\b|\bwatch\s+sale\b|\bblack\s+friday\b|\bdiscount\s+code\b|\bgiveaway\b|\bvlog\b|\bwhat\s+i\s+eat\b|\bday\s+in\s+the\s+life\b|\bsafety\s+in\b|\btravel\s+(guide|tips|diary|vlog)\b/i,
    unless: JOB_CONTEXT,
  },
  {
    // Arrival culture shock is lifestyle; workplace culture shock is the
    // first-90-days problem Ark coaches, so the exception does the work.
    name: "arrival culture shock",
    match: /\bculture\s+shock\b/i,
    unless: /\b(workplace|work|office|corporate|colleague|colleagues|meeting|manager|team|job)\b/i,
  },
];

export interface ScopeVerdict {
  inScope: boolean;
  /** Which rule removed it, if any. */
  rule: string | null;
  /** Which exception rescued it, if any. */
  rescuedBy: string | null;
}

export function subjectScope(subject: string | null | undefined): ScopeVerdict {
  const s = String(subject ?? "");
  if (!s.trim()) return { inScope: true, rule: null, rescuedBy: null };

  for (const rule of SCOPE_RULES) {
    if (!rule.match.test(s)) continue;
    if (rule.unless?.test(s)) {
      return { inScope: true, rule: rule.name, rescuedBy: rule.name };
    }
    return { inScope: false, rule: rule.name, rescuedBy: null };
  }
  return { inScope: true, rule: null, rescuedBy: null };
}

export const isOffBusinessSubject = (subject: string | null | undefined): boolean =>
  !subjectScope(subject).inScope;
