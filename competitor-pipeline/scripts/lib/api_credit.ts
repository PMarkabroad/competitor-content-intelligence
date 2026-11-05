/**
 * Refuses to start a run the Anthropic account cannot pay for.
 *
 * On 2026-11-05 a 50-post draft run got four batches in and then failed the
 * remaining six on "Your credit balance is too low to access the Anthropic
 * API". Each failure took a full request round trip to discover, the run
 * reported a shortfall it could do nothing about, and the chained rendering
 * step started straight afterwards and failed the same way for every draft
 * it tried.
 *
 * The cost of finding out late is not the failed calls -- those are free.
 * It is that a long run looks like it is working, a stage records a
 * shortfall that reads like "not enough evidence", and whoever reads the
 * summary has to dig into per-batch errors to learn the real cause. A run
 * that cannot pay should say so in its first second, in those words.
 *
 * WHY A CANARY CALL AND NOT A BALANCE LOOKUP: the Messages API exposes no
 * balance endpoint, and the Admin API's usage reporting needs a separate
 * admin key this pipeline does not hold and should not hold. The thing that
 * actually matters is "can this account make a call right now", and the only
 * honest way to answer it is to make one. A single token on the cheapest
 * model costs a rounding error and tests the real path, including an expired
 * or revoked key, which a balance figure would not catch.
 */

export interface CreditCheck {
  ok: boolean;
  reason: string;
}

/** Matches the API's own wording for an account that cannot pay. */
const OUT_OF_CREDIT = /credit balance is too low|insufficient.{0,20}credit|billing|payment required/i;

/**
 * Makes one minimal call to confirm the account can pay.
 *
 * Returns ok:false ONLY for a credit or auth problem. A network blip, a
 * timeout or a 500 returns ok:true -- those are transient and the run's own
 * per-batch handling deals with them. Refusing to start over a flaky socket
 * would turn this guard into a second way to lose a night's work.
 */
export async function checkApiCredit(apiKey: string): Promise<CreditCheck> {
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "." }],
    });
    return { ok: true, reason: "credit check passed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (OUT_OF_CREDIT.test(message)) {
      return { ok: false, reason: `Anthropic account cannot be billed: ${message.slice(0, 200)}` };
    }
    const status = (err as { status?: number })?.status;
    if (status === 401 || status === 403) {
      return { ok: false, reason: `Anthropic key rejected (${status}): ${message.slice(0, 160)}` };
    }
    // Anything else -- 429, 500, a dropped socket -- is not a reason to
    // refuse to start. Let the run begin and handle it per batch.
    return { ok: true, reason: `credit check inconclusive (${message.slice(0, 120)}), proceeding` };
  }
}

/**
 * Exits non-zero before any batch starts when the account cannot pay.
 *
 * Deliberately a hard stop rather than a warning. The alternative is what
 * happened on 2026-11-05: 30 model calls that could never succeed, a
 * misleading shortfall in the run summary, and a chained step that failed
 * for every item it touched.
 */
export async function assertApiCredit(apiKey: string, stage: string): Promise<void> {
  const r = await checkApiCredit(apiKey);
  if (r.ok) return;
  console.error(
    `\n*** ${stage.toUpperCase()} NOT STARTED: ${r.reason} ***\n` +
      `No batches were attempted, so nothing was half-written and no partial run has to be ` +
      `unpicked. Top up the Anthropic account and re-run -- generation resumes from what is ` +
      `already saved rather than repeating it.`
  );
  process.exitCode = 1;
  throw new Error(`${stage} aborted: ${r.reason}`);
}
