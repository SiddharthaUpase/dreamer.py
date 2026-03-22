import "dotenv/config";
import express from "express";
import cors from "cors";
import type { Request, Response, NextFunction } from "express";
import type { SandboxInstance } from "@blaxel/core";
import { createSandbox, getSandbox, deleteSandbox } from "./services/sandbox.js";
import {
  runAgentStream,
  collectOutputFiles,
  MODEL_LIST,
  dbRowToLangChain,
  langChainToDbRow,
  sanitizeHistory,
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

const app = express();
app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json());

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
      console.log(`Reconnecting to sandbox proj-${projectId}...`);
      return await getSandbox(projectId);
    } catch (err: any) {
      console.log(`Failed to reconnect sandbox: ${err.message}. Creating new one.`);
    }
  }

  const template = stored?.template || "blank";
  console.log(`Creating sandbox for project ${projectId} (template: ${template})...`);
  const sandbox = await createSandbox(projectId, template);
  if (stored) {
    await updateProject(projectId, { sandbox_id: sandbox.metadata?.name || `proj-${projectId}` });
  }
  return sandbox;
}

// Close project — no-op, Blaxel auto-scales to zero after ~15s idle.
app.post("/api/projects/:id/close", (_req, res) => {
  res.json({ status: "ok" });
});

// Apply auth to all /api routes
app.use("/api", requireAuth);

// ===== Models =====
app.get("/api/models", (_req, res) => {
  res.json({ models: MODEL_LIST });
});

// ===== Project endpoints =====

// Create project
app.post("/api/projects", async (req: AuthRequest, res) => {
  const { id, name, template } = req.body;
  if (!id || !name) {
    res.status(400).json({ error: "id and name are required" });
    return;
  }
  try {
    await saveProject({
      id,
      user_id: req.userId!,
      name,
      template: template || "blank",
      sandbox_id: null,
      preview_url: null,
    });
    res.json({ project: { id, name, template: template || "blank" } });
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

// Open project — wake sandbox, return status + previewUrl + messages
app.post("/api/projects/:id/open", async (req: AuthRequest, res) => {
  const pid = paramId(req);
  try {
    const project = await getProject(pid);
    if (!project || project.user_id !== req.userId) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const sandbox = await getProjectSandbox(pid);
    const messages = await getProjectMessages(pid);

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

    // Auto-start dev server for Next.js template if not already running
    if (project.template === "nextjs") {
      try {
        const check = await sandbox.process.exec({
          command: "node -e \"const h=require('http');h.get('http://localhost:3000',r=>console.log(r.statusCode)).on('error',()=>console.log('down'))\"",
          waitForCompletion: true,
        });
        if (!check.stdout?.includes("200") && !check.stdout?.includes("304")) {
          console.log(`Auto-starting Next.js dev server for project ${pid}...`);
          await sandbox.process.exec({
            name: "dev-server",
            command: "npm run dev -- --port 3000",
            workingDir: "/app",
            restartOnFailure: true,
            maxRestarts: 25,
          });
          await new Promise((r) => setTimeout(r, 5000));
        }
      } catch {
        // Non-critical
      }
    }

    res.json({
      status: "ready",
      sandboxId: sandbox.metadata?.name || `proj-${pid}`,
      previewUrl,
      name: project.name,
      messages,
    });
  } catch (err: any) {
    console.error("Failed to open project sandbox:", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Project chat — SSE streaming
app.post("/api/projects/:id/chat", async (req: AuthRequest, res) => {
  const { message, model } = req.body;
  const projectId = paramId(req);

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const project = await getProject(projectId);
  if (!project || project.user_id !== req.userId) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const abortController = new AbortController();
  res.on("close", () => abortController.abort());

  try {
    const sandbox = await getProjectSandbox(projectId);

    // Load history from DB
    let history = sanitizeHistory(
      (await getProjectMessages(projectId)).map(dbRowToLangChain)
    );

    // Run agent
    const result = await runAgentStream(
      sandbox, history, message, model || "claude-sonnet",
      (event) => {
        if (abortController.signal.aborted) return;
        if (event.type === "tool_end" && event.tool === "preview_url" && event.output) {
          const urlMatch = event.output.match(/https?:\/\/[^\s]+/);
          if (urlMatch) updateProject(projectId, { preview_url: urlMatch[0] });
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      abortController.signal,
      project.preview_url || undefined,
    );

    // Persist new messages to DB
    if (result.newMessages.length > 0) {
      try {
        const dbRows = result.newMessages.map((m) => langChainToDbRow(m, projectId));
        await saveMessages(dbRows);
        console.log(`[chat ${projectId}] Persisted ${dbRows.length} messages`);
      } catch (err: any) {
        console.error(`[chat ${projectId}] Failed to persist:`, err.message);
      }
    }

    // Collect output files
    const files = await collectOutputFiles(sandbox);
    if (files.length > 0) {
      res.write(`data: ${JSON.stringify({ type: "outputs", files })}\n\n`);
    }
  } catch (err: any) {
    if (abortController.signal.aborted) {
      res.write(`data: ${JSON.stringify({ type: "error", content: "Aborted" })}\n\n`);
    } else {
      console.error("Project agent error:", err.message);
      res.write(`data: ${JSON.stringify({ type: "error", content: err.message })}\n\n`);
    }
  } finally {
    res.end();
  }
});

// Clear chat — delete all messages
app.post("/api/projects/:id/clear-chat", async (req: AuthRequest, res) => {
  try {
    const project = await getProject(paramId(req));
    if (!project || project.user_id !== req.userId) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    await deleteProjectMessages(paramId(req));
    res.json({ status: "cleared" });
  } catch (err: any) {
    console.error("Clear chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Abort project run — handled by client closing SSE connection
app.post("/api/projects/:id/abort", (_req, res) => {
  res.json({ status: "ok" });
});

// Delete project
app.delete("/api/projects/:id", async (req: AuthRequest, res) => {
  try {
    const project = await getProject(paramId(req));
    if (!project || project.user_id !== req.userId) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (project.sandbox_id) {
      try {
        await deleteSandbox(paramId(req));
      } catch (err: any) {
        console.log(`Could not delete sandbox: ${err.message}`);
      }
    }
    await deleteProject(paramId(req));
    res.json({ status: "deleted" });
  } catch (err: any) {
    console.error("Delete project error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
