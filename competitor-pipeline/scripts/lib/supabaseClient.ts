/**
 * Shared Supabase client factory for competitor-pipeline scripts.
 *
 * None of these scripts use Supabase Realtime, but supabase-js
 * unconditionally constructs a RealtimeClient on createClient() and, on
 * Node < 22, that throws unless a WebSocket implementation is supplied
 * explicitly. `ws` is installed as a plain dependency (not a workaround
 * import elsewhere) purely to satisfy this.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

export function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set (see .env.example)."
    );
  }
  return createClient(supabaseUrl, supabaseKey, {
    // Type-forced: the realtime client's WebSocketLikeConstructor type
    // doesn't line up with Node's `ws` types, but `ws` is exactly what
    // the library's own runtime error message says to pass here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  });
}
