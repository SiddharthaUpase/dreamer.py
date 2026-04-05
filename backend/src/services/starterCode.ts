import { supabase } from "./supabase.js";

/**
 * Redeem a starter code for a user.
 * Validates the code exists, is not expired, and has not exceeded max_uses.
 * Creates a user_access row and increments times_used.
 */
export async function redeemStarterCode(
  userId: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  // Check if user already has access
  const { data: existing } = await (supabase.from("user_access") as any)
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return { success: true }; // Already has access, idempotent
  }

  // Look up the starter code
  const { data: codeRow, error: lookupErr } = await (supabase.from("starter_codes") as any)
    .select("id, code, max_uses, times_used, expires_at")
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();

  if (lookupErr || !codeRow) {
    return { success: false, error: "Invalid starter code" };
  }

  // Check expiry
  if (codeRow.expires_at && new Date(codeRow.expires_at) < new Date()) {
    return { success: false, error: "This starter code has expired" };
  }

  // Check max uses
  if (codeRow.max_uses !== null && codeRow.times_used >= codeRow.max_uses) {
    return { success: false, error: "This starter code has reached its usage limit" };
  }

  // Create user_access row
  const { error: insertErr } = await (supabase.from("user_access") as any).insert({
    user_id: userId,
    starter_code_id: codeRow.id,
    activated_at: new Date().toISOString(),
  });

  if (insertErr) {
    console.error("[starter-code] insert user_access error:", insertErr.message);
    return { success: false, error: "Failed to activate access" };
  }

  // Increment times_used
  await (supabase.from("starter_codes") as any)
    .update({ times_used: codeRow.times_used + 1 })
    .eq("id", codeRow.id);

  return { success: true };
}

/**
 * Check if a user has access (i.e. has redeemed a starter code).
 */
export async function checkUserAccess(userId: string): Promise<boolean> {
  const { data } = await (supabase.from("user_access") as any)
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  return !!data;
}
