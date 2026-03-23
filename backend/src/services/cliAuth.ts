import crypto from "crypto";
import { supabase } from "./supabase.js";

// ===== In-memory device code store =====
// In production, use Redis or a DB table. For now, memory is fine.
interface DeviceCode {
  code: string;
  status: "pending" | "approved" | "expired";
  userId?: string;
  apiKey?: string; // raw key, only available once
  expiresAt: number;
}

const deviceCodes = new Map<string, DeviceCode>();
const CODE_TTL = 5 * 60 * 1000; // 5 minutes

// Clean up expired codes every minute
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of deviceCodes) {
    if (now > data.expiresAt) deviceCodes.delete(code);
  }
}, 60_000);

// ===== Device code flow =====

export function createDeviceCode(): { code: string } {
  // Short human-readable code (4 chars)
  const code = crypto.randomBytes(2).toString("hex");

  deviceCodes.set(code, {
    code,
    status: "pending",
    expiresAt: Date.now() + CODE_TTL,
  });

  return { code };
}

export function pollDeviceCode(code: string): {
  status: "pending" | "approved" | "expired" | "not_found";
  apiKey?: string;
} {
  const data = deviceCodes.get(code);
  if (!data) return { status: "not_found" };

  if (Date.now() > data.expiresAt) {
    deviceCodes.delete(code);
    return { status: "expired" };
  }

  if (data.status === "approved" && data.apiKey) {
    const key = data.apiKey;
    // Delete after retrieval — key is shown only once
    deviceCodes.delete(code);
    return { status: "approved", apiKey: key };
  }

  return { status: "pending" };
}

export async function approveDeviceCode(
  code: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  const data = deviceCodes.get(code);
  if (!data) return { success: false, error: "Code not found" };

  if (Date.now() > data.expiresAt) {
    deviceCodes.delete(code);
    return { success: false, error: "Code expired" };
  }

  if (data.status === "approved") {
    return { success: false, error: "Code already used" };
  }

  // Generate API key
  const rawKey = `vas_sk_${crypto.randomBytes(32).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 11); // "vas_sk_xxxx"

  // Store in DB
  const { error } = await supabase.from("api_keys").insert({
    user_id: userId,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    name: "CLI",
  } as any);

  if (error) return { success: false, error: error.message };

  // Mark code as approved with the raw key
  data.status = "approved";
  data.userId = userId;
  data.apiKey = rawKey;

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
