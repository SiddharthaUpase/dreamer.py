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
import { verifyUser } from "./services/supabase.js";
import {
  getAllProjects,
  getProject,
  saveProject,
  updateProject,
  deleteProject,
  getProjectMessages,
  saveMessages,
  deleteProjectMessages,
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
  : ["http://localhost:3000", "http://localhost:3001", "https://dreamer-55vh08re0-siddharthaupases-projects.vercel.app"];
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
    const result = await verifyApiKey(token);
    if (result) {
      req.userId = result.userId;
      next();
      return;
    }
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  // Fall back to Supabase JWT (web app auth)
  const user = await verifyUser(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  req.userId = user.id;
  next();
}

// ===== Sandbox helpers =====
async function getProjectSandbox(projectId: string): Promise<SandboxInstance> {
  const stored = await getProject(projectId);
  if (stored?.sandbox_id) {
    try {
      return await getSandbox(projectId);
    } catch { /* fall through to create */ }
  }

  const template = stored?.template || "nextjs";
  const sandbox = await createSandbox(projectId, template);
  if (stored) {
    await updateProject(projectId, { sandbox_id: sandbox.metadata?.name || `proj-${projectId}` });
  }
  return sandbox;
}

// Verify project ownership
async function getOwnedProject(projectId: string, userId: string) {
  const project = await getProject(projectId);
  if (!project || project.user_id !== userId) return null;
  return project;
}

// Close project — no-op
app.post("/api/projects/:id/close", (_req, res) => {
  res.json({ status: "ok" });
});

// ===== CLI Auth (no auth required) =====

// Start device code flow
app.post("/api/auth/cli/start", (_req, res) => {
  const { code } = createDeviceCode();
  res.json({ code });
});

// CLI polls this until approved
app.get("/api/auth/cli/poll/:code", (req, res) => {
  const result = pollDeviceCode(req.params.code);
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

// List projects
app.get("/api/projects", async (req: AuthRequest, res) => {
  try {
    const projects = await getAllProjects(req.userId!);
    res.json({ projects });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get project details
app.get("/api/projects/:id", async (req: AuthRequest, res) => {
  try {
    const project = await getOwnedProject(paramId(req), req.userId!);
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

// ===== Sandbox / Connect =====

// Connect to project — wake sandbox, inject env/skills, return preview URL
app.post("/api/projects/:id/connect", async (req: AuthRequest, res) => {
  const pid = paramId(req);
  try {
    const project = await getOwnedProject(pid, req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const sandbox = await getProjectSandbox(pid);

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

    // Auto-start dev server for Next.js
    if (project.template === "nextjs") {
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
          await new Promise((r) => setTimeout(r, 5000));
        }
      } catch { /* non-critical */ }
    }

    const messages = await getProjectMessages(pid);

    res.json({
      status: "ready",
      sandboxId: sandbox.metadata?.name || `proj-${pid}`,
      previewUrl,
      name: project.name,
      messages,
    });
  } catch (err: any) {
    console.error("Failed to connect:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== File Upload =====

app.post("/api/projects/:id/upload", upload.single("file"), async (req: AuthRequest, res) => {
  const pid = paramId(req);
  try {
    const project = await getOwnedProject(pid, req.userId!);
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

  const project = await getOwnedProject(pid, req.userId!);
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
      (await getProjectMessages(pid)).map(dbRowToLangChain)
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
        const dbRows = result.newMessages.map((m) => langChainToDbRow(m, pid));
        await saveMessages(dbRows);
        console.log(`\x1b[2m[chat]\x1b[0m persisted ${dbRows.length} messages`);
      } catch (err: any) {
        console.error(`\x1b[31m[chat]\x1b[0m failed to persist:`, err.message);
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

// ===== History =====

app.get("/api/projects/:id/history", async (req: AuthRequest, res) => {
  try {
    const project = await getOwnedProject(paramId(req), req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    const messages = await getProjectMessages(paramId(req));
    res.json({ messages });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:id/history", async (req: AuthRequest, res) => {
  try {
    const project = await getOwnedProject(paramId(req), req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    await deleteProjectMessages(paramId(req));
    res.json({ status: "cleared" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:id/compact", async (req: AuthRequest, res) => {
  const pid = paramId(req);
  try {
    const project = await getOwnedProject(pid, req.userId!);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const storedMsgs = await getProjectMessages(pid);
    if (storedMsgs.length < 4) {
      res.status(400).json({ error: "Not enough history to compact" });
      return;
    }

    const history = storedMsgs.map(dbRowToLangChain);
    const { human, ai } = await compactHistory(history);

    // Clear old messages and save compacted ones
    await deleteProjectMessages(pid);
    const now = Date.now();
    await saveMessages([
      { project_id: pid, role: "human", content: human, tool_calls: null, tool_call_id: null, name: null, created_at: new Date(now).toISOString() } as any,
      { project_id: pid, role: "ai", content: ai, tool_calls: null, tool_call_id: null, name: null, created_at: new Date(now + 1).toISOString() } as any,
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
    const project = await getOwnedProject(pid, req.userId!);
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
