import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import type { Request, Response, NextFunction } from "express";
import type { SandboxInstance } from "@blaxel/core";
import { createSandbox, getSandbox, deleteSandbox } from "./services/sandbox.js";
import {
  runAgentStream,
  collectOutputFiles,
  compactHistory,
  MODEL_LIST,
  dbRowToLangChain,
  langChainToDbRow,
  sanitizeHistory,
  type DatabaseConfig,
  type DeployConfig,
} from "./agent/index.js";
import { verifyUser, getUserByEmail } from "./services/supabase.js";
import {
  getAllProjects,
  getProject,
  saveProject,
  updateProject,
  deleteProject,
  getProjectMessages,
  saveMessages,
  deleteProjectMessages,
  updateMessageCommitSha,
  getMessageByCommitSha,
  deleteMessagesAfter,
  addCollaborator,
  removeCollaborator,
  isCollaborator,
  getSharedProjects,
} from "./services/projectStore.js";
import {
  provisionProject,
  injectProjectEnv,
  injectSkills,
  readSandboxEnvVars,
  enableBucketPublicAccess,
} from "./services/provisioning.js";
import { deploy } from "./services/deploy.js";
import { createDeviceCode, pollDeviceCode, approveDeviceCode, verifyApiKey } from "./services/cliAuth.js";
import { isGitInitialized, initRepo, commitChanges, resetToCommit } from "./services/gitService.js";
import { redeemStarterCode, checkUserAccess } from "./services/starterCode.js";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

// ===== Startup validation =====
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPEN_ROUTER"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`\x1b[31mMissing required env var: ${key}\x1b[0m`);
    process.exit(1);
  }
}

const app = express();

// CORS — restrict to allowed origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:3000", "http://localhost:3001", "https://dreamer-py.vercel.app"];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (CLI, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(null, true); // TODO: restrict in production
  },
  credentials: true,
}));
app.use(express.json({ limit: "50mb" }));

// ===== Request logger =====
app.use((req: Request, _res, next) => {
  const ts = new Date().toISOString().slice(11, 19);
  const method = req.method.padEnd(6);
  const path = req.path;
  console.log(`\x1b[2m[${ts}]\x1b[0m \x1b[36m${method}\x1b[0m ${path}`);
  next();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ===== Auth middleware =====
interface AuthRequest extends Request {
  userId?: string;
}

function paramId(req: Request): string {
  return req.params.id as string;
}

async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }
  const token = authHeader.slice(7);

  // Try API key first (CLI auth)
  if (token.startsWith("vas_sk_")) {
    console.log(`[auth] API key auth attempt: ${token.slice(0, 12)}...`);
    const result = await verifyApiKey(token);
    if (result) {
      console.log(`[auth] API key valid, userId: ${result.userId}`);
      req.userId = result.userId;
      next();
      return;
    }
    console.log(`[auth] API key invalid`);
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  // Fall back to Supabase JWT (web app auth)
  console.log(`[auth] JWT auth attempt`);
  const user = await verifyUser(token);
  if (!user) {
    console.log(`[auth] JWT invalid`);
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  console.log(`[auth] JWT valid, userId: ${user.id}`);
  req.userId = user.id;
  next();
}

// ===== Sandbox helpers =====
async function getProjectSandbox(projectId: string): Promise<SandboxInstance> {
  console.log(`[sandbox] getProjectSandbox("${projectId}")`);

  const stored = await getProject(projectId);
  console.log(`[sandbox] stored project:`, stored ? { sandbox_id: stored.sandbox_id, template: stored.template } : "null");

  if (stored?.sandbox_id) {
    console.log(`[sandbox] trying getSandbox("${projectId}")...`);
    try {
      const sb = await getSandbox(projectId);
      console.log(`[sandbox] getSandbox succeeded: ${sb.metadata?.name}`);
      return sb;
    } catch (err: any) {
      console.error(`[sandbox] getSandbox failed:`, { code: err.code, message: err.message, status_code: err.status_code });
      /* fall through to create */
    }
  }

  const template = stored?.template || "nextjs";
  console.log(`[sandbox] creating new sandbox, template="${template}"...`);
  console.log(`[sandbox] BL_API_KEY=${process.env.BL_API_KEY?.slice(0, 15)}...`);
  console.log(`[sandbox] BL_WORKSPACE=${process.env.BL_WORKSPACE}`);

  const sandbox = await createSandbox(projectId, template);
  console.log(`[sandbox] createSandbox succeeded: ${sandbox.metadata?.name}`);

  if (stored) {
    await updateProject(projectId, { sandbox_id: sandbox.metadata?.name || `proj-${projectId}` });
  }
  return sandbox;
}

// Verify project ownership (owner-only operations)
async function getOwnedProject(projectId: string, userId: string) {
  const project = await getProject(projectId);
  if (!project || project.user_id !== userId) return null;
  return project;
}

// Check owner OR collaborator access (read/use operations)
async function getAccessibleProject(projectId: string, userId: string) {
  const project = await getProject(projectId);
  if (!project) return null;
  if (project.user_id === userId) return project;
  const collab = await isCollaborator(projectId, userId);
  return collab ? project : null;
}

// Close project — no-op
app.post("/api/projects/:id/close", (_req, res) => {
  res.json({ status: "ok" });
});

// ===== CLI Auth (no auth required) =====

// Start device code flow
app.post("/api/auth/cli/start", async (_req, res) => {
  const { code } = await createDeviceCode();
  res.json({ code });
});

// CLI polls this until approved
app.get("/api/auth/cli/poll/:code", async (req, res) => {
  const result = await pollDeviceCode(req.params.code);
  res.json(result);
});

// Browser approves (requires Supabase auth)
app.post("/api/auth/cli/approve", async (req: AuthRequest, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not logged in" });
    return;
  }
  const token = authHeader.slice(7);
  const user = await verifyUser(token);
  if (!user) {
    res.status(401).json({ error: "Invalid session" });
    return;
  }

  const { code } = req.body;
  if (!code) {
    res.status(400).json({ error: "Code is required" });
    return;
  }

  const result = await approveDeviceCode(code, user.id);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ status: "approved", email: user.email });
});

// ===== Starter Code Redemption (requires auth) =====

app.post("/api/auth/redeem-code", requireAuth, async (req: AuthRequest, res) => {
  const { code } = req.body;
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "code is required" });
    return;
  }
  const result = await redeemStarterCode(req.userId!, code);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true });
});

app.get("/api/auth/access-status", requireAuth, async (req: AuthRequest, res) => {
  const hasAccess = await checkUserAccess(req.userId!);
  res.json({ hasAccess });
});

// Apply auth to all /api routes (below this line)
app.use("/api", requireAuth);

// ===== Models =====
app.get("/api/models", (_req, res) => {
  res.json({ models: MODEL_LIST });
});

// ===== Project CRUD =====

// Create project (with provisioning)
app.post("/api/projects", async (req: AuthRequest, res) => {
  const { id, name, template } = req.body;
  if (!id || !name) {
    res.status(400).json({ error: "id and name are required" });
    return;
  }
  try {
    // Save project to DB first
    await saveProject({
      id,
      user_id: req.userId!,
      name,
      template: template || "nextjs",
      sandbox_id: null,
      preview_url: null,
      database_url: null,
      jwt_secret: null,
      r2_bucket_name: null,
      r2_access_key_id: null,
      r2_secret_access_key: null,
      r2_token_id: null,
      r2_public_domain: null,
      layout: null,
    });

    // Provision resources (Neon DB + R2 bucket)
    const provision = await provisionProject(name);

    // Store provisioning results in project metadata
    await updateProject(id, {
      database_url: provision.databaseUrl,
      jwt_secret: provision.jwtSecret,
      r2_bucket_name: provision.r2BucketName || null,
      r2_access_key_id: provision.r2AccessKeyId || null,
      r2_secret_access_key: provision.r2SecretAccessKey || null,
      r2_token_id: provision.r2TokenId || null,
      r2_public_domain: provision.r2PublicDomain || null,
    });

    res.json({
      project: { id, name, template: template || "nextjs" },
      provisioning: {
        database: !!provision.databaseUrl,
        storage: !!provision.r2BucketName,
      },
    });
  } catch (err: any) {
    console.error("Failed to create project:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// List projects (owned + shared)
app.get("/api/projects", async (req: AuthRequest, res) => {
  try {
    const [owned, shared] = await Promise.all([
      getAllProjects(req.userId!),
      getSharedProjects(req.userId!),
    ]);
    res.json({ projects: [...owned, ...shared] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get project details
app.get("/api/projects/:id", async (req: AuthRequest, res) => {
  try {
    const project = await getAccessibleProject(paramId(req), req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    res.json({ project });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete project
app.delete("/api/projects/:id", async (req: AuthRequest, res) => {
  try {
    const project = await getOwnedProject(paramId(req), req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (project.sandbox_id) {
      try { await deleteSandbox(paramId(req)); } catch { /* ignore */ }
    }
    await deleteProject(paramId(req));
    res.json({ status: "deleted" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Share project with another user (owner only)
app.post("/api/projects/:id/share", async (req: AuthRequest, res) => {
  const pid = paramId(req);
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }
  try {
    const project = await getOwnedProject(pid, req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const target = await getUserByEmail(email.trim().toLowerCase());
    if (!target) {
      res.status(404).json({ error: "No account found with that email" });
      return;
    }
    if (target.id === req.userId) {
      res.status(400).json({ error: "You already own this project" });
      return;
    }

    // No-op if already a collaborator (idempotent)
    const already = await isCollaborator(pid, target.id);
    if (already) {
      res.json({ status: "already_shared", email: target.email });
      return;
    }

    await addCollaborator(pid, target.id, req.userId!);
    res.json({ status: "shared", email: target.email });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Leave a shared project (collaborator removes themselves)
app.delete("/api/projects/:id/collaborator", async (req: AuthRequest, res) => {
  const pid = paramId(req);
  try {
    const project = await getProject(pid);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (project.user_id === req.userId) {
      res.status(400).json({ error: "Owner cannot leave their own project" });
      return;
    }
    const collab = await isCollaborator(pid, req.userId!);
    if (!collab) {
      res.status(404).json({ error: "You are not a collaborator on this project" });
      return;
    }
    await removeCollaborator(pid, req.userId!);
    res.json({ status: "left" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Sandbox / Connect =====

// Connect to project — wake sandbox, inject env/skills, return preview URL
app.post("/api/projects/:id/connect", async (req: AuthRequest, res) => {
  const pid = paramId(req);
  console.log(`[connect] project=${pid} userId=${req.userId}`);
  try {
    const project = await getAccessibleProject(pid, req.userId!);
    if (!project) {
      console.log(`[connect] project not found or not owned by user`);
      res.status(404).json({ error: "Project not found" });
      return;
    }
    console.log(`[connect] project found, owner=${project.user_id}`);

    console.log(`[connect] getting/creating sandbox...`);
    let sandbox;
    try {
      sandbox = await getProjectSandbox(pid);
      console.log(`[connect] sandbox ready: ${sandbox.metadata?.name}`);
    } catch (sbErr: any) {
      console.error(`[connect] sandbox error:`, sbErr);
      throw sbErr;
    }

    // Get preview URL
    let previewUrl: string | null = null;
    try {
      const preview = await sandbox.previews.createIfNotExists({
        metadata: { name: "dev-server-preview" },
        spec: { port: 3000, public: true },
      });
      previewUrl = preview.spec?.url || null;
      if (previewUrl && previewUrl !== project.preview_url) {
        await updateProject(pid, { preview_url: previewUrl });
      }
    } catch {
      previewUrl = project.preview_url;
    }

    // Get terminal URL (private preview on port 443, auth via BL API key)
    let terminalUrl: string | null = null;
    try {
      const termPreview = await sandbox.previews.createIfNotExists({
        metadata: { name: "terminal-preview" },
        spec: { port: 443, public: false },
      });
      const baseUrl = termPreview.spec?.url;
      if (baseUrl) {
        terminalUrl = `${baseUrl}/terminal?token=${process.env.BL_API_KEY}`;
      }
    } catch (termErr: any) {
      console.log(`[connect] terminal preview failed (non-critical):`, termErr.message);
    }

    // Inject env vars
    const envData = {
      databaseUrl: project.database_url || undefined,
      jwtSecret: project.jwt_secret || undefined,
      r2AccessKeyId: project.r2_access_key_id || undefined,
      r2SecretAccessKey: project.r2_secret_access_key || undefined,
      r2BucketName: project.r2_bucket_name || undefined,
      r2PublicDomain: project.r2_public_domain || undefined,
    };
    await injectProjectEnv(sandbox, envData);
    await injectSkills(sandbox);

    // Initialize git repo for nextjs projects (idempotent)
    if (project.template === "nextjs") {
      try {
        const gitReady = await isGitInitialized(sandbox);
        if (!gitReady) {
          const sha = await initRepo(sandbox);
          console.log(`[connect] git repo initialized for project ${pid}, initial commit: ${sha}`);
        }
      } catch (gitErr: any) {
        console.error(`[connect] git init failed (non-critical):`, gitErr.message);
      }
    }

    // Auto-start dev server for Next.js (fire-and-forget, don't block response)
    if (project.template === "nextjs") {
      (async () => {
        try {
          const check = await sandbox.process.exec({
            command: "node -e \"const h=require('http');h.get('http://localhost:3000',r=>console.log(r.statusCode)).on('error',()=>console.log('down'))\"",
            waitForCompletion: true,
          });
          if (!check.stdout?.includes("200") && !check.stdout?.includes("304")) {
            await sandbox.process.exec({
              name: "dev-server",
              command: "npm run dev -- --port 3000",
              workingDir: "/app",
              restartOnFailure: true,
              maxRestarts: 25,
            });
          }
        } catch { /* non-critical */ }
      })();
    }

    const messages = await getProjectMessages(pid, req.userId!);

    res.json({
      status: "ready",
      sandboxId: sandbox.metadata?.name || `proj-${pid}`,
      previewUrl,
      terminalUrl,
      name: project.name,
      messages,
      layout: project.layout || null,
    });
  } catch (err: any) {
    console.error("Failed to connect:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== Layout Persistence =====

app.get("/api/projects/:id/layout", async (req: AuthRequest, res) => {
  const pid = paramId(req);
  console.log(`[layout] GET layout for project=${pid}`);
  try {
    const project = await getAccessibleProject(pid, req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    console.log(`[layout] returning layout: ${project.layout ? "found" : "null"}`);
    res.json({ layout: project.layout || null });
  } catch (err: any) {
    console.error(`[layout] GET error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/projects/:id/layout", async (req: AuthRequest, res) => {
  const pid = paramId(req);
  console.log(`[layout] PUT layout for project=${pid}`, JSON.stringify(req.body?.layout).slice(0, 200));
  try {
    const project = await getAccessibleProject(pid, req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    await updateProject(pid, { layout: req.body.layout });
    console.log(`[layout] saved successfully`);
    res.json({ status: "saved" });
  } catch (err: any) {
    console.error(`[layout] PUT error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== Terminal Paste =====

app.post("/api/projects/:id/terminal-paste", async (req: AuthRequest, res) => {
  const pid = paramId(req);
  const { sessionId, text } = req.body;
  if (!sessionId || !text) {
    res.status(400).json({ error: "sessionId and text required" });
    return;
  }

  try {
    const project = await getAccessibleProject(pid, req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const sandbox = await getProjectSandbox(pid);

    // Find the terminal preview to get the WebSocket host
    let terminalHost: string | null = null;
    try {
      const preview = await sandbox.previews.get("terminal-preview");
      const url = preview.spec?.url;
      if (url) terminalHost = new URL(url).host;
    } catch { /* ignore */ }

    if (!terminalHost) {
      res.status(400).json({ error: "No terminal preview found" });
      return;
    }

    // Open WebSocket to the terminal session and send the text as input
    const { default: WebSocket } = await import("ws");
    const wsUrl = `wss://${terminalHost}/terminal/ws?cols=80&rows=24&sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(process.env.BL_API_KEY!)}`;

    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket connection timeout"));
      }, 5000);

      ws.on("open", () => {
        // Send the text as terminal input
        ws.send(JSON.stringify({ type: "input", data: text }));
        clearTimeout(timeout);
        // Give it a moment to flush then close
        setTimeout(() => {
          ws.close();
          resolve();
        }, 200);
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    res.json({ status: "ok" });
  } catch (err: any) {
    console.error("[terminal-paste] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== File Upload =====

app.post("/api/projects/:id/upload", upload.single("file"), async (req: AuthRequest, res) => {
  const pid = paramId(req);
  try {
    const project = await getAccessibleProject(pid, req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const file = req.file;
    if (!file) { res.status(400).json({ error: "No file provided" }); return; }

    const sandbox = await getProjectSandbox(pid);
    try { await sandbox.fs.mkdir("/app/uploads"); } catch { /* exists */ }

    const filename = file.originalname.replace(/[\s\u00A0]/g, "_");
    const sandboxPath = `/app/uploads/${filename}`;
    await sandbox.fs.writeBinary(sandboxPath, file.buffer);

    res.json({ path: sandboxPath, size: file.size });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Agent Chat (SSE) =====

app.post("/api/projects/:id/chat", async (req: AuthRequest, res) => {
  const { message, model } = req.body;
  const pid = paramId(req);

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }
  if (message.length > 50000) {
    res.status(400).json({ error: "message too long (max 50,000 chars)" });
    return;
  }

  const project = await getAccessibleProject(pid, req.userId!);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  console.log(`\x1b[33m[chat]\x1b[0m project=${pid} model=${model || "claude-sonnet"} msg="${message.slice(0, 60)}${message.length > 60 ? "..." : ""}"`);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering if proxied
  res.flushHeaders();

  const abortController = new AbortController();
  res.on("close", () => { abortController.abort(); console.log(`\x1b[2m[chat]\x1b[0m stream closed for ${pid}`); });

  // Disable response buffering for SSE
  res.socket?.setNoDelay(true);

  const sendEvent = (event: any) => {
    if (abortController.signal.aborted) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const sandbox = await getProjectSandbox(pid);
    console.log(`\x1b[2m[chat]\x1b[0m sandbox connected, loading history...`);

    const history = sanitizeHistory(
      (await getProjectMessages(pid, req.userId!)).map(dbRowToLangChain)
    );
    console.log(`\x1b[2m[chat]\x1b[0m ${history.length} history messages, starting agent...`);

    // Build configs
    const dbConfig: DatabaseConfig | undefined = project.database_url
      ? { connectionString: project.database_url }
      : undefined;

    const envVars = await readSandboxEnvVars(sandbox);
    const deployConfig: DeployConfig | undefined = process.env.VERCEL_TOKEN
      ? {
          projectName: `vas-${project.name}`,
          vercelToken: process.env.VERCEL_TOKEN,
          vercelTeamId: process.env.VERCEL_TEAM_ID || undefined,
          envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
        }
      : undefined;

    // Check user has access (redeemed a starter code)
    const hasAccess = await checkUserAccess(req.userId!);
    if (!hasAccess) {
      res.write(`data: ${JSON.stringify({ type: "error", content: "No access. Please redeem a starter code at /setup." })}\n\n`);
      res.end();
      return;
    }

    const result = await runAgentStream(
      sandbox, history, message, model || "claude-sonnet",
      sendEvent,
      abortController.signal,
      project.preview_url || undefined,
      dbConfig,
      deployConfig,
    );

    console.log(`\x1b[32m[chat]\x1b[0m agent done, ${result.newMessages.length} new messages, ${result.contextTokens} tokens`);

    // Persist messages
    if (result.newMessages.length > 0) {
      try {
        if ((result as any).compactedHistory) {
          // Pre-run compaction happened — replace all old messages with compacted history
          // This prevents the same 160k+ history from triggering compaction on every message
          await deleteProjectMessages(pid, req.userId!);
          const dbRows = (result as any).compactedHistory.map((m: any) => langChainToDbRow(m, pid, req.userId!));
          await saveMessages(dbRows);
          sendEvent({ type: "compacted", before: history.length, after: dbRows.length });
          console.log(`\x1b[2m[chat]\x1b[0m compacted: replaced history with ${dbRows.length} messages`);
        } else {
          const dbRows = result.newMessages.map((m) => langChainToDbRow(m, pid, req.userId!));
          await saveMessages(dbRows);
          console.log(`\x1b[2m[chat]\x1b[0m persisted ${dbRows.length} messages`);
        }
      } catch (err: any) {
        console.error(`\x1b[31m[chat]\x1b[0m failed to persist:`, err.message);
      }
    }

    // Auto-commit for nextjs projects
    if (project.template === "nextjs") {
      try {
        const commitSha = await commitChanges(sandbox, `Update: ${message.slice(0, 50)}`);
        if (commitSha) {
          console.log(`\x1b[2m[chat]\x1b[0m auto-commit: ${commitSha}`);
          sendEvent({ type: "commit", sha: commitSha });
          await updateMessageCommitSha(pid, req.userId!, commitSha);
        }
      } catch (gitErr: any) {
        console.error(`\x1b[2m[chat]\x1b[0m auto-commit failed (non-critical):`, gitErr.message);
      }
    }

    // Collect output files
    const files = await collectOutputFiles(sandbox);
    if (files.length > 0) {
      res.write(`data: ${JSON.stringify({ type: "outputs", files })}\n\n`);
    }
  } catch (err: any) {
    if (!abortController.signal.aborted) {
      res.write(`data: ${JSON.stringify({ type: "error", content: err.message })}\n\n`);
    }
  } finally {
    res.end();
  }
});

// Abort — handled by client closing SSE connection
app.post("/api/projects/:id/abort", (_req, res) => {
  res.json({ status: "ok" });
});

// ===== Git Revert =====

app.post("/api/projects/:id/revert", async (req: AuthRequest, res) => {
  const pid = paramId(req);
  const { commit_sha } = req.body;

  if (!commit_sha || typeof commit_sha !== "string") {
    res.status(400).json({ error: "commit_sha is required" });
    return;
  }

  try {
    const project = await getAccessibleProject(pid, req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    if (project.template !== "nextjs") {
      res.status(400).json({ error: "Revert is only supported for web app projects" });
      return;
    }

    // Find the message with this commit SHA
    const targetMsg = await getMessageByCommitSha(pid, req.userId!, commit_sha);
    if (!targetMsg) {
      res.status(404).json({ error: "Commit not found in message history" });
      return;
    }

    // Reset sandbox to that commit
    const sandbox = await getProjectSandbox(pid);
    await resetToCommit(sandbox, commit_sha);
    console.log(`[revert] project=${pid} reset to commit ${commit_sha}`);

    // Delete all messages after the target message
    await deleteMessagesAfter(pid, req.userId!, targetMsg.created_at);
    console.log(`[revert] deleted messages after ${targetMsg.created_at}`);

    res.json({ status: "reverted", commit_sha });
  } catch (err: any) {
    console.error(`[revert] failed:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== History =====

app.get("/api/projects/:id/history", async (req: AuthRequest, res) => {
  try {
    const project = await getAccessibleProject(paramId(req), req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    const messages = await getProjectMessages(paramId(req), req.userId!);
    res.json({ messages });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:id/history", async (req: AuthRequest, res) => {
  try {
    const project = await getAccessibleProject(paramId(req), req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    await deleteProjectMessages(paramId(req), req.userId!);
    res.json({ status: "cleared" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:id/compact", async (req: AuthRequest, res) => {
  const pid = paramId(req);
  try {
    const project = await getAccessibleProject(pid, req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const storedMsgs = await getProjectMessages(pid, req.userId!);
    if (storedMsgs.length < 4) {
      res.status(400).json({ error: "Not enough history to compact" });
      return;
    }

    const history = storedMsgs.map(dbRowToLangChain);
    const { human, ai } = await compactHistory(history);

    // Clear old messages and save compacted ones (scoped to this user)
    await deleteProjectMessages(pid, req.userId!);
    const now = Date.now();
    await saveMessages([
      { project_id: pid, role: "human", content: human, tool_calls: null, tool_call_id: null, name: null, user_id: req.userId!, created_at: new Date(now).toISOString() } as any,
      { project_id: pid, role: "ai", content: ai, tool_calls: null, tool_call_id: null, name: null, user_id: req.userId!, created_at: new Date(now + 1).toISOString() } as any,
    ]);

    res.json({ status: "compacted", before: storedMsgs.length, after: 2 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Deploy =====

app.post("/api/projects/:id/deploy", async (req: AuthRequest, res) => {
  const pid = paramId(req);
  try {
    const project = await getAccessibleProject(pid, req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    if (!process.env.VERCEL_TOKEN) {
      res.status(400).json({ error: "Vercel not configured" });
      return;
    }

    // SSE for deploy status
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.socket?.setNoDelay(true);

    const sandbox = await getProjectSandbox(pid);
    const envVars = await readSandboxEnvVars(sandbox);

    const result = await deploy(sandbox, {
      projectName: `vas-${project.name}`,
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_TEAM_ID || undefined,
      envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
    }, (msg) => {
      res.write(`data: ${JSON.stringify({ type: "status", message: msg })}\n\n`);
    });

    res.write(`data: ${JSON.stringify({ type: "result", ...result })}\n\n`);
    res.end();
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
    res.end();
  }
});

// ===== Health =====
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const PORT = parseInt(process.env.PORT || "3001", 10);
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
