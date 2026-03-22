import "dotenv/config";
import readline from "readline";
import crypto from "crypto";
import type { BaseMessage } from "@langchain/core/messages";
import type { SandboxInstance } from "@blaxel/core";
import { SandboxInstance as SandboxClass } from "@blaxel/core";
import fs from "fs";
import path from "path";
import os from "os";
import { runAgentStream, collectOutputFiles, langChainToDbRow, dbRowToLangChain, compactHistory, type ToolEvent, type DatabaseConfig, type DeployConfig } from "./agent/index.js";
import { deploy } from "./services/deploy.js";
import type { StoredMessage } from "./services/projectStore.js";

const MODELS = ["claude-sonnet", "claude-haiku", "minimax", "kimi", "mimo"];
const BASE_DIR = path.join(os.homedir(), ".agent-vas");
const PREFS_PATH = path.join(BASE_DIR, "preferences.json");
const PROJECTS_DIR = path.join(BASE_DIR, "projects");

// ===== Project Meta =====
interface ProjectMeta {
  name: string;
  template: string;
  sandboxName: string;
  previewUrl: string | null;
  createdAt: string;
  // Database (Neon)
  databaseUrl?: string;
  jwtSecret?: string;
  // Storage (Cloudflare R2)
  r2BucketName?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2TokenId?: string; // for cleanup/deletion
  r2PublicDomain?: string; // public URL for serving files
}

// ===== Preferences =====
function loadPrefs(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(PREFS_PATH, "utf8")); } catch { return {}; }
}

function savePrefs(prefs: Record<string, string>) {
  fs.mkdirSync(path.dirname(PREFS_PATH), { recursive: true });
  fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
}

function getSavedModel(): string {
  return loadPrefs().model || "claude-sonnet";
}

function setSavedModel(model: string) {
  const prefs = loadPrefs();
  prefs.model = model;
  savePrefs(prefs);
}

// ===== Project Storage =====
function listProjects(): ProjectMeta[] {
  try {
    const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());
    const metas: ProjectMeta[] = [];
    for (const dir of dirs) {
      try {
        const meta = loadProjectMeta(dir.name);
        if (meta) metas.push(meta);
      } catch { /* skip corrupt projects */ }
    }
    return metas;
  } catch {
    return [];
  }
}

function loadProjectMeta(name: string): ProjectMeta | null {
  const metaPath = path.join(PROJECTS_DIR, name, "meta.json");
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
}

function saveProjectMeta(name: string, meta: ProjectMeta) {
  const dir = path.join(PROJECTS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}

function loadHistory(name: string): BaseMessage[] {
  const histPath = path.join(PROJECTS_DIR, name, "history.json");
  try {
    const rows: StoredMessage[] = JSON.parse(fs.readFileSync(histPath, "utf8"));
    return rows.map(row => dbRowToLangChain(row));
  } catch {
    return [];
  }
}

function saveHistory(name: string, messages: BaseMessage[]) {
  const dir = path.join(PROJECTS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  const rows = messages.map(msg => langChainToDbRow(msg, name));
  fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(rows, null, 2));
}

function deleteProject(name: string) {
  const dir = path.join(PROJECTS_DIR, name);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ===== Neon Database Provisioning =====
const NEON_API = "https://console.neon.tech/api/v2";
const NEON_API_KEY = process.env.NEON_API_KEY || "";
const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID || "";
const NEON_BRANCH_ID = process.env.NEON_BRANCH_ID || "";
const NEON_ORG_ID = process.env.NEON_ORG_ID || "";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL || "";
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || "";
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || "";

async function createProjectDatabase(name: string): Promise<{ databaseUrl: string }> {
  const dbName = name.replace(/-/g, "_"); // Postgres doesn't like hyphens in db names

  console.log(dim(`Creating database "${dbName}"...`));
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
    // Ignore "already exists" — just get the connection string
    if (!err.includes("already exists")) {
      throw new Error(`Failed to create database: ${err}`);
    }
    console.log(dim(`Database "${dbName}" already exists.`));
  } else {
    console.log(green(`Database "${dbName}" created.`));
  }

  // Get connection string
  const uriRes = await fetch(
    `${NEON_API}/projects/${NEON_PROJECT_ID}/connection_uri?branch_id=${NEON_BRANCH_ID}&database_name=${dbName}&role_name=neondb_owner`,
    { headers: { Authorization: `Bearer ${NEON_API_KEY}` } }
  );

  if (!uriRes.ok) throw new Error("Failed to get connection string");
  const { uri } = await uriRes.json() as { uri: string };
  console.log(green("Connection string obtained."));

  return { databaseUrl: uri };
}

// ===== Cloudflare R2 Storage Provisioning =====
const CF_API = "https://api.cloudflare.com/client/v4";
const CF_API_TOKEN = process.env.CF_API_TOKEN || "";
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "";
const R2_BUCKET_ITEM_WRITE_PERMISSION = "2efd5506f9c8494dacb1fa10a3e7d5b6";

async function createProjectBucket(name: string): Promise<{
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  tokenId: string;
  publicDomain: string;
}> {
  const bucketName = `vas-${name}`;

  // 1. Create bucket
  console.log(dim(`Creating R2 bucket "${bucketName}"...`));
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
    console.log(dim(`Bucket "${bucketName}" already exists.`));
  } else {
    console.log(green(`Bucket "${bucketName}" created.`));
  }

  // 2. Enable public access (r2.dev domain)
  console.log(dim("Enabling public access..."));
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

  let publicDomain = "";
  if (publicRes.ok) {
    const pubData = await publicRes.json() as { result: { domain: string } };
    publicDomain = `https://${pubData.result.domain}`;
    console.log(green(`Public URL: ${publicDomain}`));
  } else {
    console.log(yellow("Warning: Could not enable public access"));
  }

  // 3. Create scoped token for this bucket only
  console.log(dim("Creating scoped storage token..."));
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
          permission_groups: [
            { id: R2_BUCKET_ITEM_WRITE_PERMISSION },
          ],
        }],
      }),
    }
  );

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Failed to create scoped token: ${err}`);
  }

  const tokenData = await tokenRes.json() as {
    result: { id: string; value: string };
  };

  const accessKeyId = tokenData.result.id;
  // Secret access key is SHA-256 of the token value
  const secretAccessKey = crypto.createHash("sha256")
    .update(tokenData.result.value)
    .digest("hex");

  console.log(green("Storage token created."));

  return { bucketName, accessKeyId, secretAccessKey, tokenId: tokenData.result.id, publicDomain };
}

// ===== Skills injection =====
const SKILLS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "agent", "prompts");
const SKILL_FILES = ["database.md", "google-auth.md", "storage.md"];

async function injectSkills(sb: SandboxInstance): Promise<void> {
  try {
    await sb.fs.mkdir("/skills");
  } catch { /* already exists */ }

  for (const file of SKILL_FILES) {
    try {
      const content = fs.readFileSync(path.join(SKILLS_DIR, file), "utf8");
      await sb.fs.write(`/skills/${file}`, content);
    } catch { /* skill file not found locally, skip */ }
  }
  console.log(green("Skills injected into sandbox /skills/"));
}

async function readSandboxEnvVars(sb: SandboxInstance): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  try {
    const content = await sb.fs.read("/app/.env.local");
    const text = typeof content === "string" ? content : "";
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx);
      const value = trimmed.slice(eqIdx + 1);
      vars[key] = value;
    }
  } catch { /* .env.local doesn't exist */ }
  return vars;
}

async function injectProjectEnv(sb: SandboxInstance, meta: ProjectMeta): Promise<void> {
  const envLines: string[] = [];

  if (meta.databaseUrl) envLines.push(`DATABASE_URL=${meta.databaseUrl}`);
  if (meta.jwtSecret) envLines.push(`JWT_SECRET=${meta.jwtSecret}`);
  if (GOOGLE_CLIENT_ID) envLines.push(`NEXT_PUBLIC_GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}`);
  if (AUTH_PROXY_URL) envLines.push(`NEXT_PUBLIC_AUTH_PROXY_URL=${AUTH_PROXY_URL}`);
  // R2 Storage
  if (meta.r2AccessKeyId) envLines.push(`R2_ACCESS_KEY_ID=${meta.r2AccessKeyId}`);
  if (meta.r2SecretAccessKey) envLines.push(`R2_SECRET_ACCESS_KEY=${meta.r2SecretAccessKey}`);
  if (CF_ACCOUNT_ID) envLines.push(`R2_ENDPOINT=https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`);
  if (meta.r2BucketName) envLines.push(`R2_BUCKET_NAME=${meta.r2BucketName}`);
  if (meta.r2PublicDomain) envLines.push(`R2_PUBLIC_URL=${meta.r2PublicDomain}`);

  if (envLines.length === 0) return;

  // Read existing .env.local and merge
  let existing = "";
  try {
    const files = await sb.fs.read("/app/.env.local");
    existing = typeof files === "string" ? files : "";
  } catch { /* doesn't exist yet */ }

  // Remove old lines if any
  const keysToReplace = new Set(envLines.map(l => l.split("=")[0]));
  const filtered = existing
    .split("\n")
    .filter(l => !keysToReplace.has(l.split("=")[0]))
    .join("\n")
    .trim();

  const final = filtered ? filtered + "\n" + envLines.join("\n") + "\n" : envLines.join("\n") + "\n";
  await sb.fs.write("/app/.env.local", final);
  console.log(green("Environment vars injected into sandbox .env.local"));
}

// ===== State =====
let currentModel = process.argv[2] || getSavedModel();
let currentProject: string = "";
let history: BaseMessage[] = [];
let sandbox: SandboxInstance;
let previewUrl: string | null = null;
let abortController: AbortController | null = null;

// ===== Colors =====
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

// ===== File upload detection =====
const UPLOAD_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff",
  ".svg", ".pdf", ".txt", ".csv", ".json", ".html", ".css", ".js", ".ts", ".tsx", ".jsx",
]);

function findLocalFiles(text: string): { file: string; raw: string; content: Buffer }[] {
  const seen = new Set<string>();
  const results: { file: string; raw: string; content: Buffer }[] = [];

  function tryAdd(raw: string, filePath: string) {
    const cleaned = filePath.replace(/\\ /g, " ");
    const resolved = cleaned.startsWith("~/")
      ? path.join(os.homedir(), cleaned.slice(2))
      : cleaned;

    if (seen.has(resolved)) return;

    const ext = path.extname(resolved).toLowerCase();
    if (!UPLOAD_EXTENSIONS.has(ext) && ext !== "") return;

    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) return;
      const content = fs.readFileSync(resolved);
      seen.add(resolved);
      results.push({ file: resolved, raw, content });
    } catch {
      // File doesn't exist
    }
  }

  // 1. Quoted paths (most reliable)
  const quotedPatterns = [
    /"((?:~\/|\/)[^"]+)"/g,   // "path with spaces.png"
    /'((?:~\/|\/)[^']+)'/g,   // 'path with spaces.png'
  ];
  for (const pattern of quotedPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      tryAdd(match[0], match[1]);
    }
  }

  // 2. Escaped spaces: /path/to/My\ File.png
  const escapedPattern = /(?:~\/|\/)[^\s,;'"]*(?:\\ [^\s,;'"]*)+/g;
  let match;
  while ((match = escapedPattern.exec(text)) !== null) {
    tryAdd(match[0], match[0]);
  }

  // 3. Unescaped paths — greedily match from / or ~/ to end of message or next newline,
  //    then progressively shorten until we find a file that exists
  const unescapedPattern = /(?:~\/|\/)[^\n,;'"]+/g;
  while ((match = unescapedPattern.exec(text)) !== null) {
    let candidate = match[0].trim();
    // Try the full match first, then remove words from the end until a file is found
    const words = candidate.split(/\s+/);
    for (let len = words.length; len >= 1; len--) {
      const attempt = words.slice(0, len).join(" ");
      const resolved = attempt.startsWith("~/")
        ? path.join(os.homedir(), attempt.slice(2))
        : attempt;
      try {
        const stat = fs.statSync(resolved);
        if (stat.isFile()) {
          const ext = path.extname(resolved).toLowerCase();
          if (UPLOAD_EXTENSIONS.has(ext) || ext === "") {
            if (!seen.has(resolved)) {
              const content = fs.readFileSync(resolved);
              seen.add(resolved);
              results.push({ file: resolved, raw: words.slice(0, len).join(" "), content });
            }
          }
          break; // Found a valid file, stop shortening
        }
      } catch {
        // Not a valid path, try shorter
      }
    }
  }

  return results;
}

async function uploadFilesToSandbox(files: { file: string; content: Buffer }[]): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  try { await sandbox.fs.mkdir("/app/uploads"); } catch { /* already exists */ }

  for (const { file: localPath, content } of files) {
    const filename = path.basename(localPath).replace(/[\s\u00A0\u202F\u2007\u2060]/g, "_");
    const sandboxPath = `/app/uploads/${filename}`;

    await sandbox.fs.writeBinary(sandboxPath, content);
    mapping.set(localPath, sandboxPath);
    console.log(`${magenta("↑ uploaded")} ${filename} (${(content.length / 1024).toFixed(1)} KB) → ${dim(sandboxPath)}`);
  }
  return mapping;
}

// ===== Pulsing dots spinner =====
const PULSE_FRAMES = ["·  ", "·· ", "···", " ··", "  ·", "   "];
let pulseInterval: ReturnType<typeof setInterval> | null = null;
let pulseFrame = 0;
let pulseLabel = "";

function startPulse(label: string) {
  stopPulse();
  pulseLabel = label;
  pulseFrame = 0;
  pulseInterval = setInterval(() => {
    const frame = PULSE_FRAMES[pulseFrame % PULSE_FRAMES.length];
    process.stdout.write(`\r${dim(pulseLabel + " " + frame)}`);
    pulseFrame++;
  }, 150);
}

function stopPulse() {
  if (pulseInterval) {
    clearInterval(pulseInterval);
    pulseInterval = null;
    process.stdout.write("\r\x1b[K"); // clear the line
  }
}

function parseArgs(args: Record<string, unknown>): Record<string, unknown> {
  // LangGraph sometimes passes tool input as { input: '{"command":"..."}' }
  if (typeof args.input === "string") {
    try { return JSON.parse(args.input); } catch { return args; }
  }
  if (typeof args.input === "object" && args.input !== null) {
    return args.input as Record<string, unknown>;
  }
  return args;
}

function formatToolArgs(tool: string, rawArgs: Record<string, unknown>): string {
  const args = parseArgs(rawArgs);
  switch (tool) {
    case "bash":
      return `$ ${args.command}`;
    case "read":
      return `${args.path}${args.offset ? ` [${args.offset}:${(args.offset as number) + ((args.limit as number) || 0)}]` : ""}`;
    case "write":
      return `${args.path} (${((args.content as string) || "").length} chars)`;
    case "edit":
      return `${args.path}\n${red("- " + truncate(String(args.old_string), 80))}\n${green("+ " + truncate(String(args.new_string), 80))}`;
    case "grep":
      return `/${args.pattern}/ in ${args.path}${args.include ? ` (${args.include})` : ""}`;
    case "glob":
      return `${args.pattern} in ${args.path}`;
    case "subagent":
      return `[${args.type || "custom"}${args.use_haiku ? " · haiku" : ""}] ${args.description || truncate(String(args.task), 80)}`;
    default:
      return truncate(JSON.stringify(args), 120);
  }
}

function formatToolOutput(tool: string, output: string): string {
  if (!output) return "";
  const lines = output.split("\n").filter(Boolean);
  if (lines.length <= 3) return dim(output.trim());
  return dim(lines.slice(0, 3).join("\n") + `\n... (+${lines.length - 3} more lines)`);
}

function printEvent(event: ToolEvent) {
  switch (event.type) {
    case "token":
      stopPulse();
      process.stdout.write(event.content || "");
      break;
    case "tool_start": {
      stopPulse();
      const label = event.tool || "unknown";
      const detail = event.args ? formatToolArgs(label, event.args) : "";
      console.log(`\n${cyan("⚡ " + label)} ${detail}`);
      startPulse(label);
      break;
    }
    case "tool_end": {
      stopPulse();
      const output = event.output ? formatToolOutput(event.tool || "", event.output) : "";
      console.log(`${green("✓ " + (event.tool || "unknown"))}${output ? "\n" + output : ""}`);
      startPulse("Thinking");
      break;
    }
    case "result":
      stopPulse();
      console.log(); // ensure cursor moves to new line after streamed tokens
      break;
    case "error":
      stopPulse();
      console.error(`\n${red("✗ " + (event.content || "Unknown error"))}`);
      break;
    case "outputs":
      if (event.files?.length) {
        console.log(`\n${green("📦 Output files:")} ${event.files.map(f => f.name).join(", ")}`);
      }
      break;
    case "todo_update":
      if (event.todos?.length) {
        stopPulse();
        console.log(`\n${bold("📋 Todos:")}`);
        for (const todo of event.todos) {
          const icon = todo.status === "completed" ? green("  ✓")
            : todo.status === "in_progress" ? yellow("  •")
            : todo.status === "cancelled" ? dim("  ✗")
            : dim("   ");
          const text = todo.status === "completed" ? dim(todo.content)
            : todo.status === "in_progress" ? yellow(todo.content)
            : todo.content;
          console.log(`${icon} ${text}`);
        }
        console.log();
        startPulse("Thinking");
      }
      break;
    case "subagent_log": {
      stopPulse();
      const toolName = event.tool || "";
      const detail = event.detail ? truncate(event.detail, 60) : "";
      process.stdout.write(`\r\x1b[K`); // clear line
      console.log(`  ${dim(`${event.label} → ${toolName}`)} ${dim(detail)}`);
      startPulse(event.label || "subagent");
      break;
    }
  }
}

// ===== Sandbox management =====
async function getOrCreateSandbox(sandboxName: string): Promise<SandboxInstance> {
  try {
    console.log(dim(`Reconnecting to sandbox ${sandboxName}...`));
    return await SandboxClass.get(sandboxName);
  } catch {
    console.log(dim(`Creating new sandbox ${sandboxName}...`));
    return await SandboxClass.create({
      name: sandboxName,
      image: "nextjs-template:latest",
      memory: 8192,
      ports: [{ target: 3000, protocol: "HTTP" }],
      region: "us-pdx-1",
    });
  }
}

async function getPreviewUrl(sb: SandboxInstance): Promise<string | null> {
  try {
    const preview = await sb.previews.createIfNotExists({
      metadata: { name: "dev-server-preview" },
      spec: { port: 3000, public: true },
    });
    return preview.spec?.url || null;
  } catch {
    return null;
  }
}

// ===== Project switching =====
async function connectToProject(name: string, rl?: readline.Interface): Promise<void> {
  // Save current history before switching
  if (currentProject && history.length > 0) {
    saveHistory(currentProject, history);
  }

  // Ensure project dir + meta exist
  let meta = loadProjectMeta(name);
  if (!meta) {
    // Create default meta for new/migrated project
    meta = {
      name,
      template: "nextjs",
      sandboxName: `proj-${name}`,
      previewUrl: null,
      createdAt: new Date().toISOString(),
    };
    saveProjectMeta(name, meta);
  }

  // Load history
  history = loadHistory(name);
  currentProject = name;

  // Connect sandbox
  console.log();
  sandbox = await getOrCreateSandbox(meta.sandboxName);
  console.log(green("Sandbox ready."));

  // Get preview URL
  previewUrl = await getPreviewUrl(sandbox);
  if (previewUrl) {
    // Update meta with latest preview URL
    meta.previewUrl = previewUrl;
    saveProjectMeta(name, meta);
    console.log(`${dim("Preview:")} ${cyan(previewUrl)}`);
  }

  // Provision R2 bucket for existing projects that don't have one
  if (!meta.r2BucketName && CF_API_TOKEN) {
    try {
      const r2 = await createProjectBucket(name);
      meta.r2BucketName = r2.bucketName;
      meta.r2AccessKeyId = r2.accessKeyId;
      meta.r2SecretAccessKey = r2.secretAccessKey;
      meta.r2TokenId = r2.tokenId;
      meta.r2PublicDomain = r2.publicDomain;
      saveProjectMeta(name, meta);
    } catch (err: any) {
      console.log(yellow(`R2 bucket creation skipped: ${err.message}`));
    }
  }

  // Enable public access for existing buckets that don't have it
  if (meta.r2BucketName && !meta.r2PublicDomain && CF_API_TOKEN) {
    try {
      console.log(dim("Enabling public access on R2 bucket..."));
      const publicRes = await fetch(
        `${CF_API}/accounts/${CF_ACCOUNT_ID}/r2/buckets/${meta.r2BucketName}/domains/managed`,
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
        meta.r2PublicDomain = `https://${pubData.result.domain}`;
        saveProjectMeta(name, meta);
        console.log(green(`Public URL: ${meta.r2PublicDomain}`));
      }
    } catch { /* skip */ }
  }

  // Ensure env vars and skills are in the sandbox
  await injectProjectEnv(sandbox, meta);
  await injectSkills(sandbox);

  // Update last project preference
  const prefs = loadPrefs();
  prefs.lastProject = name;
  savePrefs(prefs);

  if (history.length > 0) {
    console.log(dim(`Loaded ${history.length} messages from history.`));
  }

  console.log();

  // Update prompt if rl is available
  if (rl) {
    rl.setPrompt(bold(`(${currentProject}) > `));
  }
}

// ===== Command handlers =====
async function handleProjectsCommand(rl: readline.Interface) {
  const projects = listProjects();
  if (projects.length === 0) {
    console.log(dim("No projects. Use /new <name> to create one."));
  } else {
    console.log(bold("\nProjects:\n"));
    for (const p of projects) {
      const marker = p.name === currentProject ? cyan(" * ") : "   ";
      const date = new Date(p.createdAt).toLocaleDateString();
      console.log(`${marker}${p.name}${p.name === currentProject ? dim(" (current)") : ""} ${dim(`[${p.template}] ${date}`)}`);
    }
    console.log();
  }
  rl.prompt();
}

async function handleNewCommand(name: string, rl: readline.Interface) {
  if (!name) {
    console.log(red("Usage: /new <project-name>"));
    rl.prompt();
    return;
  }

  // Validate name (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    console.log(red("Project name must only contain letters, numbers, hyphens, and underscores."));
    rl.prompt();
    return;
  }

  // Check if already exists
  if (loadProjectMeta(name)) {
    console.log(red(`Project "${name}" already exists. Use /switch ${name} to switch to it.`));
    rl.prompt();
    return;
  }

  console.log(dim(`\nCreating project "${name}"...\n`));
  try {
    // 1. Create sandbox + connect
    await connectToProject(name, rl);

    // 2. Provision Neon database
    const { databaseUrl } = await createProjectDatabase(name);

    // 3. Generate JWT secret for auth sessions
    const jwtSecret = crypto.randomUUID() + crypto.randomUUID();

    // 4. Save to meta (R2 bucket was already created by connectToProject)
    const meta = loadProjectMeta(name)!;
    meta.databaseUrl = databaseUrl;
    meta.jwtSecret = jwtSecret;
    saveProjectMeta(name, meta);

    // 5. Inject env vars into sandbox
    await injectProjectEnv(sandbox, meta);

    console.log(green(`\nProject "${name}" created with database + storage.`));
  } catch (err: any) {
    console.error(red(`Failed to create project: ${err.message}`));
  }
  rl.prompt();
}

async function handleSwitchCommand(name: string, rl: readline.Interface) {
  if (!name) {
    console.log(red("Usage: /switch <project-name>"));
    rl.prompt();
    return;
  }

  if (name === currentProject) {
    console.log(dim(`Already on project "${name}".`));
    rl.prompt();
    return;
  }

  const meta = loadProjectMeta(name);
  if (!meta) {
    console.log(red(`Project "${name}" not found. Use /projects to see available projects.`));
    rl.prompt();
    return;
  }

  console.log(dim(`Switching to project "${name}"...`));
  try {
    await connectToProject(name, rl);
    console.log(green(`Switched to project "${name}".`));
  } catch (err: any) {
    console.error(red(`Failed to switch: ${err.message}`));
  }
  rl.prompt();
}

async function handleDeleteCommand(name: string, rl: readline.Interface) {
  if (!name) {
    console.log(red("Usage: /delete <project-name>"));
    rl.prompt();
    return;
  }

  if (name === currentProject) {
    console.log(red("Cannot delete the active project. Switch to another project first."));
    rl.prompt();
    return;
  }

  const meta = loadProjectMeta(name);
  if (!meta) {
    console.log(red(`Project "${name}" not found.`));
    rl.prompt();
    return;
  }

  deleteProject(name);
  console.log(green(`Project "${name}" deleted.`));
  rl.prompt();
}

// ===== Main input handler =====
async function handleInput(line: string, rl: readline.Interface) {
  const text = line.trim();
  if (!text) { rl.prompt(); return; }

  // Commands
  if (text === "/clear") {
    history = [];
    // Delete history file
    const histPath = path.join(PROJECTS_DIR, currentProject, "history.json");
    try { fs.unlinkSync(histPath); } catch { /* ignore */ }
    console.log(dim("History cleared."));
    rl.prompt();
    return;
  }
  if (text === "/compact") {
    if (history.length < 4) {
      console.log(dim("Not enough history to compact."));
      rl.prompt();
      return;
    }
    const beforeCount = history.length;
    console.log(dim(`Compacting ${beforeCount} messages...`));
    try {
      const { human, ai } = await compactHistory(history);
      const { HumanMessage, AIMessage } = await import("@langchain/core/messages");
      history = [new HumanMessage(human), new AIMessage(ai)];
      saveHistory(currentProject, history);
      console.log(green(`Compacted ${beforeCount} messages → 2 messages.`));
    } catch (err: any) {
      console.error(red(`Compact failed: ${err.message}`));
    }
    rl.prompt();
    return;
  }
  if (text === "/exit" || text === "/quit") {
    // Save history before exit
    if (currentProject && history.length > 0) {
      saveHistory(currentProject, history);
    }
    console.log(dim("Bye."));
    process.exit(0);
  }
  if (text === "/url") {
    if (previewUrl) {
      console.log(cyan(previewUrl));
    } else {
      console.log(dim("No preview URL available."));
    }
    rl.prompt();
    return;
  }
  if (text === "/history") {
    console.log(dim(`${history.length} messages in history`));
    rl.prompt();
    return;
  }
  if (text === "/projects") {
    await handleProjectsCommand(rl);
    return;
  }
  if (text.startsWith("/new ")) {
    await handleNewCommand(text.slice(5).trim(), rl);
    return;
  }
  if (text.startsWith("/switch ")) {
    await handleSwitchCommand(text.slice(8).trim(), rl);
    return;
  }
  if (text.startsWith("/delete ")) {
    await handleDeleteCommand(text.slice(8).trim(), rl);
    return;
  }
  if (text === "/deploy") {
    if (!VERCEL_TOKEN) {
      console.log(red("Vercel not configured. Set VERCEL_TOKEN in .env"));
      rl.prompt();
      return;
    }
    console.log(dim("\nDeploying to Vercel...\n"));
    try {
      const envVars = await readSandboxEnvVars(sandbox);
      const result = await deploy(sandbox, {
        projectName: `vas-${currentProject}`,
        token: VERCEL_TOKEN,
        teamId: VERCEL_TEAM_ID || undefined,
        envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
      }, (msg) => console.log(dim(`  ${msg}`)));

      if (result.success) {
        console.log(green(`\nDeployed: ${result.url}`));
      } else {
        console.log(red(`\nDeploy failed: ${result.error}`));
      }
    } catch (err: any) {
      console.error(red(`Deploy error: ${err.message}`));
    }
    rl.prompt();
    return;
  }
  if (text.startsWith("/model")) {
    const newModel = text.split(" ")[1];
    if (newModel && MODELS.includes(newModel)) {
      currentModel = newModel;
      setSavedModel(newModel);
      console.log(green(`Model switched to: ${currentModel}`));
      rl.prompt();
    } else if (newModel) {
      console.log(red(`Unknown model: ${newModel}`));
      console.log(dim(`Available: ${MODELS.join(", ")}`));
      rl.prompt();
    } else {
      // Interactive model picker
      console.log(bold("\nSelect a model:\n"));
      MODELS.forEach((m, i) => {
        const marker = m === currentModel ? cyan(" ● ") : dim(" ○ ");
        console.log(`${marker}${dim(`${i + 1})`)} ${m}${m === currentModel ? dim(" (current)") : ""}`);
      });
      console.log();
      process.stdout.write(dim("Enter number (1-" + MODELS.length + "): "));

      const onModelSelect = (line: string) => {
        rl.removeListener("line", onModelSelect);
        const num = parseInt(line.trim(), 10);
        if (num >= 1 && num <= MODELS.length) {
          currentModel = MODELS[num - 1];
          setSavedModel(currentModel);
          console.log(green(`Model switched to: ${currentModel}`));
        } else if (line.trim()) {
          console.log(dim("Cancelled."));
        }
        rl.prompt();
        rl.on("line", (l) => handleInput(l, rl));
      };

      rl.removeAllListeners("line");
      rl.on("line", onModelSelect);
    }
    return;
  }

  abortController = new AbortController();

  // Detect and upload local files referenced in the message
  let prompt = text;
  const localFiles = findLocalFiles(text);
  if (localFiles.length > 0) {
    const mapping = await uploadFilesToSandbox(localFiles);
    for (const { file: localPath, raw } of localFiles) {
      const sandboxPath = mapping.get(localPath);
      if (sandboxPath) {
        // Replace the raw token (with escapes/quotes) in the prompt
        prompt = prompt.replace(raw, sandboxPath);
      }
    }
  }

  startPulse("Thinking");

  try {
    // Build database config for run_sql tool if available
    const meta = loadProjectMeta(currentProject);
    const dbConfig: DatabaseConfig | undefined = meta?.databaseUrl
      ? { connectionString: meta.databaseUrl }
      : undefined;

    // Build deploy config — read ALL env vars from sandbox .env.local
    const sandboxEnvVars = VERCEL_TOKEN ? await readSandboxEnvVars(sandbox) : {};
    const deployConfig: DeployConfig | undefined = VERCEL_TOKEN
      ? {
          projectName: `vas-${currentProject}`,
          vercelToken: VERCEL_TOKEN,
          vercelTeamId: VERCEL_TEAM_ID || undefined,
          envVars: Object.keys(sandboxEnvVars).length > 0 ? sandboxEnvVars : undefined,
        }
      : undefined;

    const result = await runAgentStream(
      sandbox,
      history,
      prompt,
      currentModel,
      printEvent,
      abortController.signal,
      previewUrl || undefined,
      dbConfig,
      deployConfig,
    );

    if (result.compactedHistory) {
      // Pre-run compaction happened — replace entire history with compacted version
      history = result.compactedHistory;
    } else {
      history.push(...result.newMessages);
    }

    // Persist history after each agent run
    saveHistory(currentProject, history);

    if (result.aborted) {
      console.log(`\n${dim("Aborted. Partial messages saved to history.")}`);
    }

    console.log(dim(`[${result.contextTokens} tokens]\n`));

    // Collect output files in the background — don't block the prompt
    if (!result.aborted) {
      collectOutputFiles(sandbox).then((files) => {
        if (files.length > 0) {
          const outputDir = path.join(os.homedir(), "Desktop", "agent-outputs");
          fs.mkdirSync(outputDir, { recursive: true });
          for (const file of files) {
            const dest = path.join(outputDir, file.name);
            fs.writeFileSync(dest, Buffer.from(file.content, "base64"));
            console.log(`${green("📦 " + file.name)} → ${cyan(dest)}`);
          }
        }
      }).catch(() => {});
    }
  } catch (err: any) {
    stopPulse();
    console.error(`\n${red("Error: " + err.message)}`);
  }

  abortController = null;
  rl.prompt();
}

async function main() {
  console.log(bold("Agent VAS CLI"));

  // Determine starting project
  const prefs = loadPrefs();
  const startProject = prefs.lastProject || "cli-test";

  console.log(dim(`Model: ${currentModel} | Project: ${startProject}`));
  console.log(dim("Commands: /clear /compact /history /url /model /projects /new /switch /delete /deploy /exit\n"));

  // Check Neon setup
  if (!NEON_API_KEY || !NEON_PROJECT_ID) {
    console.log(dim("Neon DB not configured. Set NEON_API_KEY and NEON_PROJECT_ID in .env\n"));
  }

  try {
    await connectToProject(startProject);
  } catch (err: any) {
    console.error(red(`Failed to connect to sandbox: ${err.message}`));
    console.error(dim("Make sure BLAXEL_API_KEY is set in .env"));
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: bold(`(${currentProject}) > `),
  });

  // Ctrl+C: abort current request or exit
  rl.on("SIGINT", () => {
    if (abortController) {
      abortController.abort();
      console.log(`\n${dim("Aborting...")}`);
    } else {
      // Save history before exit
      if (currentProject && history.length > 0) {
        saveHistory(currentProject, history);
      }
      console.log(`\n${dim("Bye.")}`);
      process.exit(0);
    }
  });

  rl.prompt();

  rl.on("line", (line) => handleInput(line, rl));
}

main().catch((err) => {
  console.error(red(`Fatal: ${err.message}`));
  process.exit(1);
});
