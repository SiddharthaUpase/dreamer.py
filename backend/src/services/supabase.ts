import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

// Service role client — bypasses RLS, used for all backend DB operations
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Verify a user's JWT and return the user object
export async function verifyUser(token: string) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}
