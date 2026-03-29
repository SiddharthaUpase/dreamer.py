import crypto from "crypto";
import type { SandboxInstance } from "@blaxel/core";
import * as fsNode from "fs";
import * as pathNode from "path";

// ===== Neon Database =====
const NEON_API = "https://console.neon.tech/api/v2";
const NEON_API_KEY = process.env.NEON_API_KEY || "";
const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID || "";
const NEON_BRANCH_ID = process.env.NEON_BRANCH_ID || "";

export async function createProjectDatabase(name: string): Promise<{ databaseUrl: string }> {
  const dbName = name.replace(/-/g, "_");

  const createRes = await fetch(
    `${NEON_API}/projects/${NEON_PROJECT_ID}/branches/${NEON_BRANCH_ID}/databases`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NEON_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ database: { name: dbName, owner_name: "neondb_owner" } }),
    }
  );

  if (!createRes.ok) {
    const err = await createRes.text();
    if (!err.includes("already exists")) {
      throw new Error(`Failed to create database: ${err}`);
    }
  }

  const uriRes = await fetch(
    `${NEON_API}/projects/${NEON_PROJECT_ID}/connection_uri?branch_id=${NEON_BRANCH_ID}&database_name=${dbName}&role_name=neondb_owner`,
    { headers: { Authorization: `Bearer ${NEON_API_KEY}` } }
  );

  if (!uriRes.ok) throw new Error("Failed to get connection string");
  const { uri } = await uriRes.json() as { uri: string };
  return { databaseUrl: uri };
}

// ===== Cloudflare R2 =====
const CF_API = "https://api.cloudflare.com/client/v4";
const CF_API_TOKEN = process.env.CF_API_TOKEN || "";
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "";
const R2_BUCKET_ITEM_WRITE_PERMISSION = "2efd5506f9c8494dacb1fa10a3e7d5b6";

export interface R2Result {
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  tokenId: string;
  publicDomain: string;
}

export async function createProjectBucket(name: string): Promise<R2Result> {
  const bucketName = `vas-${name}`;

  // Create bucket
  const bucketRes = await fetch(
    `${CF_API}/accounts/${CF_ACCOUNT_ID}/r2/buckets`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: bucketName }),
    }
  );

  if (!bucketRes.ok) {
    const err = await bucketRes.text();
    if (!err.includes("already exists")) {
      throw new Error(`Failed to create R2 bucket: ${err}`);
    }
  }

  // Enable public access
  let publicDomain = "";
  const publicRes = await fetch(
    `${CF_API}/accounts/${CF_ACCOUNT_ID}/r2/buckets/${bucketName}/domains/managed`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    }
  );
  if (publicRes.ok) {
    const pubData = await publicRes.json() as { result: { domain: string } };
    publicDomain = `https://${pubData.result.domain}`;
  }

  // Create scoped token
  const tokenRes = await fetch(
    `${CF_API}/accounts/${CF_ACCOUNT_ID}/tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `${bucketName}-token`,
        policies: [{
          effect: "allow",
          resources: {
            [`com.cloudflare.edge.r2.bucket.${CF_ACCOUNT_ID}_default_${bucketName}`]: "*",
          },
          permission_groups: [{ id: R2_BUCKET_ITEM_WRITE_PERMISSION }],
        }],
      }),
    }
  );

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Failed to create scoped token: ${err}`);
  }

  const tokenData = await tokenRes.json() as { result: { id: string; value: string } };
  const accessKeyId = tokenData.result.id;
  const secretAccessKey = crypto.createHash("sha256").update(tokenData.result.value).digest("hex");

  return { bucketName, accessKeyId, secretAccessKey, tokenId: tokenData.result.id, publicDomain };
}

export async function enableBucketPublicAccess(bucketName: string): Promise<string> {
  const res = await fetch(
    `${CF_API}/accounts/${CF_ACCOUNT_ID}/r2/buckets/${bucketName}/domains/managed`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    }
  );
  if (!res.ok) return "";
  const data = await res.json() as { result: { domain: string } };
  return `https://${data.result.domain}`;
}

// ===== Environment & Skills injection =====
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL || "";

export interface ProjectEnvData {
  databaseUrl?: string;
  jwtSecret?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2BucketName?: string;
  r2PublicDomain?: string;
}

export async function injectProjectEnv(sb: SandboxInstance, envData: ProjectEnvData): Promise<void> {
  const envLines: string[] = [];

  if (envData.databaseUrl) envLines.push(`DATABASE_URL=${envData.databaseUrl}`);
  if (envData.jwtSecret) envLines.push(`JWT_SECRET=${envData.jwtSecret}`);
  if (GOOGLE_CLIENT_ID) envLines.push(`NEXT_PUBLIC_GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}`);
  if (AUTH_PROXY_URL) envLines.push(`NEXT_PUBLIC_AUTH_PROXY_URL=${AUTH_PROXY_URL}`);
  if (envData.r2AccessKeyId) envLines.push(`R2_ACCESS_KEY_ID=${envData.r2AccessKeyId}`);
  if (envData.r2SecretAccessKey) envLines.push(`R2_SECRET_ACCESS_KEY=${envData.r2SecretAccessKey}`);
  if (CF_ACCOUNT_ID) envLines.push(`R2_ENDPOINT=https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`);
  if (envData.r2BucketName) envLines.push(`R2_BUCKET_NAME=${envData.r2BucketName}`);
  if (envData.r2PublicDomain) envLines.push(`R2_PUBLIC_URL=${envData.r2PublicDomain}`);

  if (envLines.length === 0) return;

  let existing = "";
  try {
    const files = await sb.fs.read("/app/.env.local");
    existing = typeof files === "string" ? files : "";
  } catch { /* doesn't exist */ }

  const keysToReplace = new Set(envLines.map(l => l.split("=")[0]));
  const filtered = existing.split("\n").filter(l => !keysToReplace.has(l.split("=")[0])).join("\n").trim();
  const final = filtered ? filtered + "\n" + envLines.join("\n") + "\n" : envLines.join("\n") + "\n";
  await sb.fs.write("/app/.env.local", final);
}

const SKILLS_DIR = pathNode.join(pathNode.dirname(new URL(import.meta.url).pathname), "..", "agent", "prompts", "skills");

export async function injectSkills(sb: SandboxInstance): Promise<void> {
  try { await sb.fs.mkdir("/skills"); } catch { /* exists */ }
  try {
    const files = fsNode.readdirSync(SKILLS_DIR).filter((f: string) => f.endsWith(".md"));
    for (const file of files) {
      try {
        const content = fsNode.readFileSync(pathNode.join(SKILLS_DIR, file), "utf8");
        await sb.fs.write(`/skills/${file}`, content);
      } catch { /* skip */ }
    }
  } catch { /* skills dir not found */ }
}

export async function readSandboxEnvVars(sb: SandboxInstance): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  try {
    const content = await sb.fs.read("/app/.env.local");
    const text = typeof content === "string" ? content : "";
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
  } catch { /* no .env.local */ }
  return vars;
}

// ===== Provision all resources for a new project =====
export interface ProvisionResult {
  databaseUrl: string;
  jwtSecret: string;
  r2BucketName?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2TokenId?: string;
  r2PublicDomain?: string;
}

export async function provisionProject(name: string): Promise<ProvisionResult> {
  // Database
  const { databaseUrl } = await createProjectDatabase(name);

  // JWT secret
  const jwtSecret = crypto.randomUUID() + crypto.randomUUID();

  // R2 bucket
  let r2: R2Result | null = null;
  if (CF_API_TOKEN) {
    try {
      r2 = await createProjectBucket(name);
    } catch { /* skip if R2 not configured */ }
  }

  return {
    databaseUrl,
    jwtSecret,
    ...(r2 ? {
      r2BucketName: r2.bucketName,
      r2AccessKeyId: r2.accessKeyId,
      r2SecretAccessKey: r2.secretAccessKey,
      r2TokenId: r2.tokenId,
      r2PublicDomain: r2.publicDomain,
    } : {}),
  };
}

export function isConfigured() {
  return {
    neon: !!NEON_API_KEY && !!NEON_PROJECT_ID,
    r2: !!CF_API_TOKEN,
    vercel: !!process.env.VERCEL_TOKEN,
  };
}
