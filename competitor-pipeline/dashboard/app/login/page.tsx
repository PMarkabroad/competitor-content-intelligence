import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const params = await searchParams;
  const from = params.from ?? "/review";
  const errorMessage =
    params.error === "password" ? "Wrong password." : params.error === "name" ? "Enter your name." : null;

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <form action={login} className="w-72 rounded border border-[var(--color-border)] bg-[var(--color-bg-raised)] p-6">
        <h1 className="mb-1 text-sm font-semibold text-[var(--color-text)]">Ark Competitor Intel</h1>
        <p className="mb-4 text-xs text-[var(--color-text-dim)]">Internal dashboard. Shared password.</p>
        <input type="hidden" name="from" value={from} />
        <input
          type="text"
          name="name"
          placeholder="Your name"
          className="mb-2 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
        />
        <input
          type="password"
          name="password"
          placeholder="Password"
          className="mb-3 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
        />
        {errorMessage && <p className="mb-3 text-xs text-[var(--color-bad)]">{errorMessage}</p>}
        <button
          type="submit"
          className="w-full rounded bg-[var(--color-brand)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Enter
        </button>
      </form>
    </div>
  );
}
