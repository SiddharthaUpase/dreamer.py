import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// Lazy-initialized to ensure env vars are loaded before client creation
let _supabase: ReturnType<typeof createClient> | null = null;

function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// Re-export as a getter so existing code (`supabase.auth...`) keeps working
export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_, prop) {
    return (getSupabase() as any)[prop];
  },
});

// Verify a user's JWT and return the user object
export async function verifyUser(token: string) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

// Look up an existing user by email using the Supabase admin REST API
export async function getUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      },
    }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { users?: any[] };
  const user = (data.users || []).find(
    (u: any) => u.email?.toLowerCase() === email.toLowerCase()
  );
  return user ? { id: user.id, email: user.email } : null;
}
