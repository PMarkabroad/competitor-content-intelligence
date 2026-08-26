import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only. `import "server-only"` above makes it a build error for any
// client component to import this file, even indirectly -- the service
// role key must never reach the browser bundle.
export function getSupabaseServerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set (see .env.example).");
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
