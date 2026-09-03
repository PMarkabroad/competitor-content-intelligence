// Shared "what shape is this video" grouping, used by /formats and
// /content-ideas so a card and the formats table never disagree about
// what shape a given video is.
//
// The `format` column (talking_head / screen_walkthrough / pov) is set on
// only a fraction of rows -- format is a VISUAL property and the tagging
// runs on transcripts -- so shape is derived from `narrative_structure`
// instead, which is populated on nearly every row and is the more useful
// answer for a producer anyway.
//
// Structures are free text and never repeat verbatim, so they're matched
// into families by keyword. This is a scanning convenience, not a
// taxonomy: always show the row's real structure text next to the label.

export interface Shape {
  name: string;
  blurb: string;
  test: RegExp;
}

// Ordered: first match wins, so more specific shapes come first. Countdown
// sits above Numbered list because withholding #1 to drive comments is a
// distinct device worth copying, and its text contains "numbered" so the
// list rule would otherwise swallow it.
export const SHAPES: Shape[] = [
  {
    name: "Job posting",
    blurb: "A live vacancy read out: pay, company, duties, who qualifies, where to apply.",
    test: /job (alert|drop|posting|lead)|(pay|salary)\s*(figure|hook|band|\+|and)|where to apply|application path|apply\b|opportunity announcement|vacancy|link CTA|entry.level.claim/i,
  },
  {
    name: "Countdown",
    blurb: "Counts down to number one and holds it back, usually pushing people into the comments for it.",
    test: /countdown|\b\d+\s*to\s*1\b|withheld for comments|#1 withheld/i,
  },
  {
    name: "Numbered list",
    blurb: "A counted run of tips, employers or examples, often teasing the last one to hold people to the end.",
    test: /numbered list|list of (two|three|four|five|six|seven|eight|nine|ten|\d)|ranked list|\blisticle\b|enumerated|\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(named|options|fixes|signals|translations|tips|steps|reasons|mechanisms|scripts|employers)/i,
  },
  {
    name: "Myth broken",
    blurb: "Name the belief the viewer holds, break it, then explain the real mechanism.",
    test: /belief|myth|assumption|misconception|reject the easy explanation|live contradiction|contradiction/i,
  },
  {
    name: "Question opener",
    blurb: "Open on a question aimed straight at the viewer, then answer it immediately.",
    test: /question ->|rhetorical question|qualifying question|direct question|question opener|qualifying if.statement|audience call.out/i,
  },
  {
    name: "Story cold open",
    blurb: "Drop into a moment or incident first; the topic only becomes clear afterwards.",
    test: /cold open|story|incident|scenario setup|biographical|experiment setup|shared experience/i,
  },
  {
    name: "Audit or teardown",
    blurb: "Walk through something real — a resume, a profile, a site — and mark what's wrong.",
    test: /audit|teardown|breakdown|section|review|before\/after|before and after|walkthrough|step.by.step|demystified/i,
  },
  {
    name: "Warning",
    blurb: "Lead with the thing that will cost them, then what to do instead.",
    test: /warning|mistake|red flag|don'?t\b|avoid|stop doing|never fabricate|reality check/i,
  },
  {
    name: "Claim then proof",
    blurb: "State a flat claim up front, then stack the evidence or reasoning behind it.",
    test: /^claim|claim \+|thesis statement|verdict|promise|stat|evidence|comparison/i,
  },
];

export const OTHER_SHAPE = "Other";

export function shapeOf(structure: string | null | undefined): string {
  if (!structure) return OTHER_SHAPE;
  for (const s of SHAPES) if (s.test.test(structure)) return s.name;
  return OTHER_SHAPE;
}

export function blurbFor(shapeName: string): string {
  return SHAPES.find((s) => s.name === shapeName)?.blurb ?? "Structures that don't fit the other shapes.";
}

// Free-text fields occasionally carry the literal string "null" where the
// source had nothing usable.
export function cleanText(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return !t || t.toLowerCase() === "null" ? null : t;
}
