import "dotenv/config";
import express from "express";
import cors from "cors";
import type { Sandbox } from "@daytonaio/sdk";
import { createSandbox, daytona } from "./services/daytona.js";
import { runAgentStream, MODEL_LIST } from "./agent/index.js";
import {
  getAllAgents,
  getAgent,
  saveAgent,
  updateAgent,
  deleteAgent,
  type StoredAgent,
} from "./services/store.js";
import {
  getAllProjects,
  getProject,
  saveProject,
  updateProject,
  deleteProject,
  type StoredProject,
} from "./services/projectStore.js";

const app = express();
app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json());

// Store sandboxes per agent (in-memory, keyed by agentId from frontend)
const sandboxes = new Map<string, Sandbox>();
// Track active abort controllers per agent
const activeRuns = new Map<string, AbortController>();

// Get or create a sandbox for an agent
async function getSandbox(agentId: string): Promise<Sandbox> {
  let sandbox = sandboxes.get(agentId);
  if (!sandbox) {
    // Check if agent has a stored sandboxId — try to reconnect
    const stored = getAgent(agentId);
    if (stored?.sandboxId) {
      try {
        console.log(`Reconnecting to sandbox ${stored.sandboxId} for agent ${agentId}...`);
        sandbox = await daytona.findOne({ idOrName: stored.sandboxId });
        // If sandbox was auto-stopped, restart it
        if (sandbox.state !== "started") {
          console.log(`Sandbox ${stored.sandboxId} is ${sandbox.state}, starting...`);
          await sandbox.start(60);
        }
        sandboxes.set(agentId, sandbox);
        return sandbox;
      } catch (err: any) {
        console.log(`Failed to reconnect sandbox: ${err.message}. Creating new one.`);
      }
    }

    console.log(`Creating sandbox for agent ${agentId}...`);
    sandbox = await createSandbox();
    sandboxes.set(agentId, sandbox);

    // Persist sandbox ID
    if (stored) {
      updateAgent(agentId, { sandboxId: sandbox.id });
    }
  }
  return sandbox;
}

app.post("/api/chat", async (req, res) => {
  const { message, agentId, model } = req.body;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  if (!agentId || typeof agentId !== "string") {
    res.status(400).json({ error: "agentId is required" });
    return;
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Abort any existing run for this agent
  activeRuns.get(agentId)?.abort();

  const abortController = new AbortController();
  activeRuns.set(agentId, abortController);

  try {
    const sandbox = await getSandbox(agentId);
    await runAgentStream(sandbox, agentId, message, model || "claude-sonnet", (event) => {
      if (abortController.signal.aborted) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }, abortController.signal);
  } catch (err: any) {
    if (abortController.signal.aborted) {
      res.write(`data: ${JSON.stringify({ type: "error", content: "Aborted" })}\n\n`);
    } else {
      console.error("Agent error:", err.message);
      res.write(`data: ${JSON.stringify({ type: "error", content: err.message })}\n\n`);
    }
  } finally {
    activeRuns.delete(agentId);
    res.end();
  }
});

// Save messages from frontend (called after each chat exchange)
app.post("/api/agents/:id/messages", (req, res) => {
  const { messages } = req.body;
  const updated = updateAgent(req.params.id, { messages });
  if (!updated) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json({ status: "ok" });
});

app.post("/api/abort", (req, res) => {
  const { agentId } = req.body;
  const controller = activeRuns.get(agentId);
  if (controller) {
    controller.abort();
    activeRuns.delete(agentId);
    res.json({ status: "aborted" });
  } else {
    res.json({ status: "no active run" });
  }
});

app.get("/api/models", (_req, res) => {
  res.json({ models: MODEL_LIST });
});

// ===== Agent persistence endpoints =====

app.get("/api/agents", (_req, res) => {
  res.json({ agents: getAllAgents() });
});

app.post("/api/agents", (req, res) => {
  const { id, name, x, y, model } = req.body;
  const agent: StoredAgent = {
    id,
    name,
    x,
    y,
    model: model || "claude-sonnet",
    sandboxId: null,
    messages: [],
  };
  saveAgent(agent);
  res.json({ agent });
});

app.put("/api/agents/:id", (req, res) => {
  const updated = updateAgent(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json({ agent: updated });
});

app.delete("/api/agents/:id", (req, res) => {
  deleteAgent(req.params.id);
  res.json({ status: "deleted" });
});

// ===== Project sandboxes (separate map from agent sandboxes) =====
const projectSandboxes = new Map<string, Sandbox>();
const activeProjectRuns = new Map<string, AbortController>();

async function getProjectSandbox(projectId: string): Promise<Sandbox> {
  let sandbox = projectSandboxes.get(projectId);
  if (!sandbox) {
    const stored = getProject(projectId);
    if (stored?.sandboxId) {
      try {
        console.log(`Reconnecting to project sandbox ${stored.sandboxId}...`);
        sandbox = await daytona.findOne({ idOrName: stored.sandboxId });
        if (sandbox.state !== "started") {
          console.log(`Project sandbox ${stored.sandboxId} is ${sandbox.state}, starting...`);
          await sandbox.start(60);
        }
        projectSandboxes.set(projectId, sandbox);
        return sandbox;
      } catch (err: any) {
        console.log(`Failed to reconnect project sandbox: ${err.message}. Creating new one.`);
      }
    }
    console.log(`Creating sandbox for project ${projectId}...`);
    sandbox = await createSandbox();
    projectSandboxes.set(projectId, sandbox);
    if (stored) {
      updateProject(projectId, { sandboxId: sandbox.id });
    }
  }
  return sandbox;
}

// Create project
app.post("/api/projects", async (req, res) => {
  const { id, name, template } = req.body;
  if (!id || !name) {
    res.status(400).json({ error: "id and name are required" });
    return;
  }
  const project: StoredProject = {
    id,
    name,
    template: template || "blank",
    sandboxId: null,
    previewUrl: null,
    messages: [],
    createdAt: new Date().toISOString(),
  };
  saveProject(project);
  res.json({ project });
});

// List projects
app.get("/api/projects", (_req, res) => {
  res.json({ projects: getAllProjects() });
});

// Open project — wake sandbox, return status + previewUrl
app.post("/api/projects/:id/open", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  try {
    const sandbox = await getProjectSandbox(req.params.id);
    res.json({
      status: "ready",
      sandboxId: sandbox.id,
      previewUrl: project.previewUrl,
      name: project.name,
      messages: project.messages,
    });
  } catch (err: any) {
    console.error("Failed to open project sandbox:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Project chat — same streaming logic as /api/chat
app.post("/api/projects/:id/chat", async (req, res) => {
  const { message, model } = req.body;
  const projectId = req.params.id;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const project = getProject(projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  activeProjectRuns.get(projectId)?.abort();
  const abortController = new AbortController();
  activeProjectRuns.set(projectId, abortController);

  try {
    const sandbox = await getProjectSandbox(projectId);
    await runAgentStream(sandbox, projectId, message, model || "claude-sonnet", (event) => {
      if (abortController.signal.aborted) return;
      // Persist previewUrl when agent calls preview_url tool
      if (event.type === "tool_end" && event.tool === "preview_url" && event.output) {
        const urlMatch = event.output.match(/https?:\/\/[^\s]+/);
        if (urlMatch) updateProject(projectId, { previewUrl: urlMatch[0] });
      }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }, abortController.signal, project.messages);
  } catch (err: any) {
    if (abortController.signal.aborted) {
      res.write(`data: ${JSON.stringify({ type: "error", content: "Aborted" })}\n\n`);
    } else {
      console.error("Project agent error:", err.message);
      res.write(`data: ${JSON.stringify({ type: "error", content: err.message })}\n\n`);
    }
  } finally {
    activeProjectRuns.delete(projectId);
    res.end();
  }
});

// Abort project run
app.post("/api/projects/:id/abort", (req, res) => {
  const controller = activeProjectRuns.get(req.params.id);
  if (controller) {
    controller.abort();
    activeProjectRuns.delete(req.params.id);
    res.json({ status: "aborted" });
  } else {
    res.json({ status: "no active run" });
  }
});

// Save project messages
app.post("/api/projects/:id/messages", (req, res) => {
  const { messages } = req.body;
  const updated = updateProject(req.params.id, { messages });
  if (!updated) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json({ status: "ok" });
});

// Delete project
app.delete("/api/projects/:id", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (project.sandboxId) {
    try {
      const sandbox = await daytona.findOne({ idOrName: project.sandboxId });
      await sandbox.delete();
    } catch (err: any) {
      console.log(`Could not delete sandbox: ${err.message}`);
    }
  }
  projectSandboxes.delete(req.params.id);
  deleteProject(req.params.id);
  res.json({ status: "deleted" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", sandboxes: sandboxes.size, projectSandboxes: projectSandboxes.size });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
