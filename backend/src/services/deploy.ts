import crypto from "crypto";
import type { SandboxInstance } from "@blaxel/core";

// ===== Types =====
export interface DeployResult {
  success: boolean;
  url?: string;
  deploymentId?: string;
  readyState?: string;
  error?: string;
  buildLogs?: string;
}

export interface DeployOptions {
  projectName: string;
  token: string;
  teamId?: string;
  envVars?: Record<string, string>;
}

interface CollectedFile {
  file: string;      // relative path
  content: Buffer;   // raw content
  sha: string;       // SHA1 of content
  size: number;
}

// ===== Constants =====
const VERCEL_API = "https://api.vercel.com";
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "outputs", ".tmp"]);
const SKIP_FILES = new Set([".env", ".env.local"]);
const MAX_CONCURRENT_UPLOADS = 10;

// ===== Collect files from sandbox =====
async function collectFiles(
  sandbox: SandboxInstance,
  dir: string,
  prefix: string = "",
): Promise<CollectedFile[]> {
  const files: CollectedFile[] = [];

  let listing;
  try {
    listing = await sandbox.fs.ls(dir);
  } catch {
    return files;
  }

  // Process files
  for (const f of listing.files || []) {
    const name = f.name;
    if (SKIP_FILES.has(name)) continue;
    if (name.startsWith(".")) continue;

    const relativePath = prefix ? `${prefix}/${name}` : name;
    const fullPath = `${dir}/${name}`;

    try {
      let content: Buffer;
      try {
        const blob = await sandbox.fs.readBinary(fullPath);
        content = Buffer.from(await blob.arrayBuffer());
      } catch {
        // Fallback: some files (e.g. .json) may fail with readBinary on some sandbox runtimes
        const text = await sandbox.fs.read(fullPath);
        content = Buffer.from(typeof text === "string" ? text : String(text), "utf-8");
      }
      if (content.length === 0) continue;
      const sha = crypto.createHash("sha1").update(content).digest("hex");
      files.push({ file: relativePath, content, sha, size: content.length });
    } catch (err: any) {
      console.error(`[deploy] Failed to read ${fullPath}: ${err.message}`);
    }
  }

  // Process subdirectories
  for (const sub of listing.subdirectories || []) {
    const name = sub.name;
    if (SKIP_DIRS.has(name)) continue;
    if (name.startsWith(".")) continue;

    const relativePath = prefix ? `${prefix}/${name}` : name;
    const subFiles = await collectFiles(sandbox, `${dir}/${name}`, relativePath);
    files.push(...subFiles);
  }

  return files;
}

// ===== Upload files individually =====
async function uploadFiles(
  files: CollectedFile[],
  token: string,
  teamId?: string,
  onStatus?: (message: string) => void,
): Promise<void> {
  let uploaded = 0;

  // Upload in batches to avoid overwhelming the API
  for (let i = 0; i < files.length; i += MAX_CONCURRENT_UPLOADS) {
    const batch = files.slice(i, i + MAX_CONCURRENT_UPLOADS);

    await Promise.all(batch.map(async (file) => {
      const url = teamId
        ? `${VERCEL_API}/v2/files?teamId=${teamId}`
        : `${VERCEL_API}/v2/files`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(file.size),
          "x-vercel-digest": file.sha,
        },
        body: new Uint8Array(file.content),
      });

      if (!res.ok && res.status !== 409) {
        // 409 = file already exists (fine)
        const errText = await res.text();
        throw new Error(`Upload failed for ${file.file} (${res.status}): ${errText}`);
      }

      uploaded++;
    }));

    if (onStatus) onStatus(`Uploaded ${uploaded}/${files.length} files...`);
  }
}

// ===== Set project-level env vars =====
async function setProjectEnvVars(
  projectName: string,
  envVars: Record<string, string>,
  token: string,
  teamId?: string,
): Promise<void> {
  const qs = teamId ? `?upsert=true&teamId=${teamId}` : "?upsert=true";
  const url = `${VERCEL_API}/v10/projects/${projectName}/env${qs}`;

  const vars = Object.entries(envVars).map(([key, value]) => ({
    key,
    value,
    type: "encrypted" as const,
    target: ["production", "preview"],
  }));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(vars),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to set env vars (${res.status}): ${errText}`);
  }
}

// ===== Create deployment referencing uploaded files =====
async function createDeployment(
  files: CollectedFile[],
  options: DeployOptions,
): Promise<{ id: string; url: string; readyState: string }> {
  const url = options.teamId
    ? `${VERCEL_API}/v13/deployments?teamId=${options.teamId}`
    : `${VERCEL_API}/v13/deployments`;

  const body: any = {
    name: options.projectName,
    target: "production",
    projectSettings: {
      framework: "nextjs",
      nodeVersion: "20.x",
      buildCommand: "npm run build",
      installCommand: "npm install",
    },
    files: files.map(f => ({
      file: f.file,
      sha: f.sha,
      size: f.size,
    })),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Vercel API error (${res.status}): ${errText}`);
  }

  const data = await res.json() as any;
  return {
    id: data.id,
    url: data.url,
    readyState: data.readyState || data.status || "QUEUED",
  };
}

// ===== Poll deployment status =====
async function pollDeployment(
  deploymentId: string,
  token: string,
  teamId?: string,
  onStatus?: (state: string) => void,
): Promise<{ readyState: string; url: string; alias: string[]; error?: string }> {
  const maxWait = 300_000; // 5 minutes
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const url = teamId
      ? `${VERCEL_API}/v13/deployments/${deploymentId}?teamId=${teamId}`
      : `${VERCEL_API}/v13/deployments/${deploymentId}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) break;

    const data = await res.json() as any;
    const state = data.readyState || data.status;

    if (onStatus) onStatus(state);

    if (state === "READY") {
      return {
        readyState: "READY",
        url: data.url,
        alias: data.alias || [],
      };
    }

    if (state === "ERROR" || state === "CANCELED") {
      let errorMsg = "Deployment failed";
      try {
        const logsUrl = teamId
          ? `${VERCEL_API}/v3/deployments/${deploymentId}/events?teamId=${teamId}`
          : `${VERCEL_API}/v3/deployments/${deploymentId}/events`;
        const logsRes = await fetch(logsUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (logsRes.ok) {
          const events = await logsRes.json() as any[];
          // Get all build output text
          const allLines = events
            .filter((e: any) => e.text)
            .map((e: any) => e.text);
          if (allLines.length > 0) {
            errorMsg = allLines.slice(-30).join("\n");
          }
        }
      } catch { /* ignore log fetch errors */ }

      return {
        readyState: state,
        url: data.url,
        alias: [],
        error: errorMsg,
      };
    }

    await new Promise(r => setTimeout(r, 5000));
  }

  return {
    readyState: "TIMEOUT",
    url: "",
    alias: [],
    error: "Deployment timed out after 5 minutes",
  };
}

// ===== Main deploy function =====
export async function deploy(
  sandbox: SandboxInstance,
  options: DeployOptions,
  onStatus?: (message: string) => void,
): Promise<DeployResult> {
  try {
    // 1. Collect files
    if (onStatus) onStatus("Collecting files from sandbox...");
    const files = await collectFiles(sandbox, "/app");

    if (files.length === 0) {
      return { success: false, error: "No files found in /app" };
    }

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (onStatus) {
      onStatus(`Collected ${files.length} files (${(totalSize / 1024 / 1024).toFixed(1)} MB)`);
      // Log file list for debugging
      for (const f of files) {
        onStatus(`  ${f.file} (${(f.size / 1024).toFixed(1)} KB)`);
      }
    }

    // 2. Upload files
    if (onStatus) onStatus("Uploading files to Vercel...");
    await uploadFiles(files, options.token, options.teamId, onStatus);

    // 3. Set project-level env vars (try before deployment — may fail if project doesn't exist yet)
    let envVarsSet = false;
    if (options.envVars && Object.keys(options.envVars).length > 0) {
      if (onStatus) onStatus("Setting environment variables...");
      try {
        await setProjectEnvVars(options.projectName, options.envVars, options.token, options.teamId);
        envVarsSet = true;
      } catch {
        // Project doesn't exist yet — will be created by first deployment
        if (onStatus) onStatus("Project doesn't exist yet, will set env vars after first deploy...");
      }
    }

    // 4. Create deployment (this auto-creates the Vercel project if it doesn't exist)
    if (onStatus) onStatus("Creating deployment...");
    const deployment = await createDeployment(files, options);
    if (onStatus) onStatus(`Deployment created: ${deployment.id}`);

    // 5. If env vars weren't set (new project), set them now and create a second deployment
    if (!envVarsSet && options.envVars && Object.keys(options.envVars).length > 0) {
      if (onStatus) onStatus("Setting environment variables on new project...");
      try {
        await setProjectEnvVars(options.projectName, options.envVars, options.token, options.teamId);
        // Need a second deployment for env vars to take effect
        if (onStatus) onStatus("Redeploying with environment variables...");
        const redeploy = await createDeployment(files, options);
        if (onStatus) onStatus(`Redeployment created: ${redeploy.id}`);
        // Poll the redeploy instead
        if (onStatus) onStatus("Building...");
        const result = await pollDeployment(
          redeploy.id, options.token, options.teamId,
          (state) => { if (onStatus) onStatus(`Status: ${state}`); },
        );
        if (result.readyState === "READY") {
          const prodUrl = result.alias?.[0] || result.url;
          return { success: true, url: `https://${prodUrl}`, deploymentId: redeploy.id, readyState: "READY" };
        }
        return {
          success: false, url: result.url ? `https://${result.url}` : undefined,
          deploymentId: redeploy.id, readyState: result.readyState, error: result.error, buildLogs: result.error,
        };
      } catch (err: any) {
        if (onStatus) onStatus(`Warning: Could not set env vars: ${err.message}`);
      }
    }

    // 4. Poll until ready
    if (onStatus) onStatus("Building...");
    const result = await pollDeployment(
      deployment.id,
      options.token,
      options.teamId,
      (state) => { if (onStatus) onStatus(`Status: ${state}`); },
    );

    if (result.readyState === "READY") {
      const prodUrl = result.alias?.[0] || result.url;
      return {
        success: true,
        url: `https://${prodUrl}`,
        deploymentId: deployment.id,
        readyState: "READY",
      };
    }

    return {
      success: false,
      url: result.url ? `https://${result.url}` : undefined,
      deploymentId: deployment.id,
      readyState: result.readyState,
      error: result.error,
      buildLogs: result.error,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
