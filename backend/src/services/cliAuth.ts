import crypto from "crypto";
import { supabase } from "./supabase.js";

const CODE_TTL_MINUTES = 15;

// ===== Device code flow (Supabase-backed) =====

export async function createDeviceCode(): Promise<{ code: string }> {
  const code = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

  const { error } = await supabase.from("device_codes").insert({
    code,
    status: "pending",
    expires_at: expiresAt,
  });

  console.log(`[cli-auth] createDeviceCode: code=${code.slice(0, 8)}... error=${error?.message || "none"}`);
  return { code };
}

export async function pollDeviceCode(code: string): Promise<{
  status: "pending" | "approved" | "expired" | "not_found";
  apiKey?: string;
}> {
  const { data, error } = await supabase
    .from("device_codes")
    .select("status, api_key, expires_at")
    .eq("code", code)
    .single();

  if (!data) {
    console.log(`[cli-auth] poll: code=${code.slice(0, 8)}... NOT FOUND (error=${error?.message || "none"})`);
    return { status: "not_found" };
  }

  if (new Date(data.expires_at) < new Date()) {
    await supabase.from("device_codes").delete().eq("code", code);
    return { status: "expired" };
  }

  if (data.status === "approved" && data.api_key) {
    const key = data.api_key;
    // Delete after retrieval — key is shown only once
    await supabase.from("device_codes").delete().eq("code", code);
    return { status: "approved", apiKey: key };
  }

  return { status: "pending" };
}

export async function approveDeviceCode(
  code: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  console.log(`[cli-auth] approve: code=${code.slice(0, 8)}... userId=${userId}`);

  const { data, error: fetchError } = await supabase
    .from("device_codes")
    .select("status, expires_at")
    .eq("code", code)
    .single();

  console.log(`[cli-auth] approve lookup: data=${JSON.stringify(data)} error=${fetchError?.message || "none"}`);

  if (!data) return { success: false, error: "Code not found" };

  if (new Date(data.expires_at) < new Date()) {
    await supabase.from("device_codes").delete().eq("code", code);
    return { success: false, error: "Code expired" };
  }

  if (data.status === "approved") {
    return { success: false, error: "Code already used" };
  }

  // Generate API key
  const rawKey = `vas_sk_${crypto.randomBytes(32).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 11); // "vas_sk_xxxx"

  // Store API key in DB
  const { error } = await supabase.from("api_keys").insert({
    user_id: userId,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    name: "CLI",
  } as any);

  if (error) return { success: false, error: error.message };

  // Mark code as approved with the raw key
  await supabase
    .from("device_codes")
    .update({ status: "approved", user_id: userId, api_key: rawKey })
    .eq("code", code);

  return { success: true };
}

// ===== API key verification =====

export async function verifyApiKey(key: string): Promise<{ userId: string } | null> {
  const keyHash = crypto.createHash("sha256").update(key).digest("hex");

  const { data, error } = await supabase
    .from("api_keys")
    .select("user_id")
    .eq("key_hash", keyHash)
    .single();

  if (error || !data) return null;

  // Update last_used_at (fire and forget)
  (supabase.from("api_keys") as any)
    .update({ last_used_at: new Date().toISOString() })
    .eq("key_hash", keyHash)
    .then(() => {});

  return { userId: (data as any).user_id };
}
