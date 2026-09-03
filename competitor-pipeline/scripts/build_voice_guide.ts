/**
 * Generates dashboard/lib/voice-guide.ts from the arkabroad-voice skill.
 *
 * The dashboard needs the voice guide at RUNTIME (the /api/generate-draft
 * endpoint puts it in the system prompt), but Vercel deploys only
 * competitor-pipeline/dashboard, so nothing under competitor-pipeline/
 * reference/ exists on the deployed filesystem. The guide therefore has to
 * be embedded in a .ts module that ships with the build.
 *
 * It was previously embedded by hand, and had already drifted: the
 * hand-copied version dropped the worked rewrites, the voice bank, and --
 * most importantly -- the entire proof bank, while the generate-draft
 * system prompt still instructed the model to obey "the guide's proof
 * bank". A rule the model is told to follow but never shown is not a rule.
 *
 * Running this script regenerates the module from the skill's real files,
 * so updating the voice means editing the skill and re-running this, not
 * hand-patching a string literal.
 *
 * Usage: npm run build-voice-guide
 */

import { readFileSync, writeFileSync } from "node:fs";

const SKILL_DIR = new URL("../reference/arkabroad-voice-skill/", import.meta.url);
const OUT = new URL("../dashboard/lib/voice-guide.ts", import.meta.url);

function read(rel: string): string {
  return readFileSync(new URL(rel, SKILL_DIR), "utf-8").trim();
}

// SKILL.md's YAML frontmatter is metadata for the skill loader, not voice
// guidance -- it would just be noise in a system prompt.
function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

const skill = stripFrontmatter(read("SKILL.md"));
const proofBank = read("references/proof-bank.md");
const voiceBank = read("references/voice-bank.md");

const guide = [
  skill,
  "\n---\n",
  "# Reference: proof bank",
  "",
  "These are the ONLY approved numbers. Never ships rule 7 is enforced against this list: if a figure is not here, it does not go in the draft. Do not extrapolate, round up, or infer new figures from these.",
  "",
  proofBank,
  "\n---\n",
  "# Reference: voice bank",
  "",
  "Verbatim cadence samples from founder transcripts. Match this rhythm. Do not quote these lines directly in a draft -- they are here to tune the ear, not to be reused as copy.",
  "",
  voiceBank,
].join("\n");

const module = `// GENERATED FILE -- DO NOT EDIT BY HAND.
// Regenerate with: npm run build-voice-guide
// Source: competitor-pipeline/reference/arkabroad-voice-skill/
//
// Embedded rather than read from disk because Vercel deploys only
// competitor-pipeline/dashboard/, so files under competitor-pipeline/
// reference/ do not exist at runtime on the deployed build.
export const ARK_VOICE_GUIDE = ${JSON.stringify(guide)};
`;

writeFileSync(OUT, module);
console.log(`Wrote ${OUT.pathname.split("/").pop()} -- ${guide.length} chars of guide (~${Math.round(guide.length / 4)} tokens).`);
console.log(`  SKILL.md:      ${skill.length} chars`);
console.log(`  proof-bank.md: ${proofBank.length} chars`);
console.log(`  voice-bank.md: ${voiceBank.length} chars`);
