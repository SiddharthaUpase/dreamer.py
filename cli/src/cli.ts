#!/usr/bin/env node

import "dotenv/config";
import readline, { emitKeypressEvents } from "readline";
import fs from "fs";
import path from "path";
import os from "os";
import { ApiClient } from "./apiClient.js";

const MODELS = ["claude-sonnet", "claude-haiku", "minimax", "kimi", "mimo"];
const BASE_DIR = path.join(os.homedir(), ".dreamer");
const PREFS_PATH = path.join(BASE_DIR, "preferences.json");
const BACKEND_URL = process.env.DREAMER_BACKEND_URL || "https://dreamer-py.onrender.com";
const APP_URL = process.env.DREAMER_APP_URL || "https://dreamer-py.vercel.app";

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

// ===== State =====
let currentModel = process.argv[2] || getSavedModel();
let currentProject: string = "";
let previewUrl: string | null = null;
let abortController: AbortController | null = null;
let api: ApiClient;

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

// ===== CLI Auth =====
function getApiKey(): string | null {
  return loadPrefs().apiKey || null;
}

function saveApiKey(key: string) {
  const prefs = loadPrefs();
  prefs.apiKey = key;
  savePrefs(prefs);
}

async function cliLogin(): Promise<string> {
  const startRes = await fetch(`${BACKEND_URL}/api/auth/cli/start`, { method: "POST" });
  if (!startRes.ok) throw new Error("Failed to start auth flow. Is the backend running?");
  const { code } = await startRes.json() as { code: string };

  const authUrl = `${APP_URL}/auth/cli?cli_code=${code}`;
  console.log(dim(`\nOpening browser at ${cyan(authUrl)}`));
  console.log(dim("If it didn't open, visit the URL manually.\n"));

  const { exec: execCmd } = await import("child_process");
  const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execCmd(`${openCmd} "${authUrl}"`);

  const maxWait = 300_000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 2000));
    process.stdout.write(`\r${dim("Waiting for login...")} `);
    try {
      const pollRes = await fetch(`${BACKEND_URL}/api/auth/cli/poll/${code}`);
      if (!pollRes.ok) continue;
      const result = await pollRes.json() as { status: string; apiKey?: string };
      if (result.status === "approved" && result.apiKey) {
        process.stdout.write("\r\x1b[K");
        saveApiKey(result.apiKey);
        return result.apiKey;
      }
      if (result.status === "expired" || result.status === "not_found") {
        throw new Error("Auth code expired. Try again.");
      }
    } catch (err: any) {
      if (err.message.includes("expired")) throw err;
    }
  }
  throw new Error("Login timed out.");
}

// ===== File upload detection =====
const UPLOAD_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff",
  ".svg", ".pdf", ".txt", ".csv", ".json", ".html", ".css", ".js", ".ts", ".tsx", ".jsx",
  ".mp3", ".mp4", ".wav", ".zip",
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
    } catch { /* doesn't exist */ }
  }

  // Quoted paths
  for (const pattern of [/"((?:~\/|\/)[^"]+)"/g, /'((?:~\/|\/)[^']+)'/g]) {
    let match;
    while ((match = pattern.exec(text)) !== null) tryAdd(match[0], match[1]);
  }

  // Escaped spaces
  const escapedPattern = /(?:~\/|\/)[^\s,;'"]*(?:\\ [^\s,;'"]*)+/g;
  let match;
  while ((match = escapedPattern.exec(text)) !== null) tryAdd(match[0], match[0]);

  // Unescaped — try progressively shorter matches
  const unescapedPattern = /(?:~\/|\/)[^\n,;'"]+/g;
  while ((match = unescapedPattern.exec(text)) !== null) {
    const words = match[0].trim().split(/\s+/);
    for (let len = words.length; len >= 1; len--) {
      const attempt = words.slice(0, len).join(" ");
      const resolved = attempt.startsWith("~/") ? path.join(os.homedir(), attempt.slice(2)) : attempt;
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
          break;
        }
      } catch { /* try shorter */ }
    }
  }

  return results;
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
    process.stdout.write("\r\x1b[K");
  }
}

// ===== Event formatting =====
function formatToolArgs(tool: string, rawArgs: Record<string, unknown>): string {
  const args = typeof rawArgs.input === "string"
    ? (() => { try { return JSON.parse(rawArgs.input); } catch { return rawArgs; } })()
    : typeof rawArgs.input === "object" && rawArgs.input !== null
      ? rawArgs.input as Record<string, unknown>
      : rawArgs;

  switch (tool) {
    case "bash": return `$ ${args.command}`;
    case "read": return `${args.path}${args.offset ? ` [${args.offset}:${(args.offset as number) + ((args.limit as number) || 0)}]` : ""}`;
    case "write": return `${args.path} (${((args.content as string) || "").length} chars)`;
    case "edit": return `${args.path}\n${red("- " + truncate(String(args.old_string), 80))}\n${green("+ " + truncate(String(args.new_string), 80))}`;
    case "grep": return `/${args.pattern}/ in ${args.path}${args.include ? ` (${args.include})` : ""}`;
    case "glob": return `${args.pattern} in ${args.path}`;
    case "subagent": return `[${args.type || "custom"}${args.use_haiku ? " · haiku" : ""}] ${args.description || truncate(String(args.task), 80)}`;
    default: return truncate(JSON.stringify(args), 120);
  }
}

function formatToolOutput(tool: string, output: string): string {
  if (!output) return "";
  const lines = output.split("\n").filter(Boolean);
  if (lines.length <= 3) return dim(output.trim());
  return dim(lines.slice(0, 3).join("\n") + `\n... (+${lines.length - 3} more lines)`);
}

function printEvent(event: any) {
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
      console.log();
      break;
    case "error":
      stopPulse();
      console.error(`\n${red("✗ " + (event.content || event.message || "Unknown error"))}`);
      break;
    case "outputs":
      if (event.files?.length) {
        console.log(`\n${green("📦 Output files:")} ${event.files.map((f: any) => f.name).join(", ")}`);
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
      const detail = event.detail ? truncate(event.detail, 60) : "";
      process.stdout.write(`\r\x1b[K`);
      console.log(`  ${dim(`${event.label} → ${event.tool}`)} ${dim(detail)}`);
      startPulse(event.label || "subagent");
      break;
    }
  }
}

// ===== Connect to project =====
async function connectToProject(name: string, rl?: readline.Interface): Promise<void> {
  console.log();
  console.log(dim(`Connecting to project "${name}"...`));

  try {
    const result = await api.connect(name);
    currentProject = name;
    previewUrl = result.previewUrl;

    console.log(green("Sandbox ready."));
    if (previewUrl) {
      console.log(`${dim("Preview:")} ${cyan(previewUrl)}`);
    }
    if (result.messages?.length > 0) {
      console.log(dim(`Loaded ${result.messages.length} messages from history.`));
    }
  } catch (err: any) {
    // Project might not exist on backend yet — create it
    if (err.message.includes("not found") || err.message.includes("404")) {
      console.log(dim(`Project "${name}" not found. Creating...`));
      await api.createProject(name, name);
      const result = await api.connect(name);
      currentProject = name;
      previewUrl = result.previewUrl;
      console.log(green("Sandbox ready."));
      if (previewUrl) {
        console.log(`${dim("Preview:")} ${cyan(previewUrl)}`);
      }
    } else {
      throw err;
    }
  }

  // Save last project
  const prefs = loadPrefs();
  prefs.lastProject = name;
  savePrefs(prefs);

  console.log();
  if (rl) rl.setPrompt(bold(`(${currentProject}) > `));
}

// ===== Command handlers =====
async function handleProjectsCommand(rl: readline.Interface) {
  try {
    const { projects } = await api.listProjects();
    if (projects.length === 0) {
      console.log(dim("No projects. Use /new <name> to create one."));
    } else {
      console.log(bold("\nProjects:\n"));
      for (const p of projects) {
        const marker = p.name === currentProject ? cyan(" * ") : "   ";
        const date = new Date(p.created_at).toLocaleDateString();
        console.log(`${marker}${p.name}${p.name === currentProject ? dim(" (current)") : ""} ${dim(`[${p.template}] ${date}`)}`);
      }
      console.log();
    }
  } catch (err: any) {
    console.error(red(`Failed to list projects: ${err.message}`));
  }
  rl.prompt();
}

async function handleNewCommand(name: string, rl: readline.Interface) {
  if (!name) { console.log(red("Usage: /new <project-name>")); rl.prompt(); return; }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    console.log(red("Project name must only contain letters, numbers, hyphens, and underscores."));
    rl.prompt(); return;
  }

  console.log(dim(`\nCreating project "${name}"...\n`));
  try {
    await api.createProject(name, name);
    await connectToProject(name, rl);
    console.log(green(`\nProject "${name}" created.`));
  } catch (err: any) {
    console.error(red(`Failed to create project: ${err.message}`));
  }
  rl.prompt();
}

async function handleSwitchCommand(name: string, rl: readline.Interface) {
  if (!name) { console.log(red("Usage: /switch <project-name>")); rl.prompt(); return; }
  if (name === currentProject) { console.log(dim(`Already on project "${name}".`)); rl.prompt(); return; }

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
  if (!name) { console.log(red("Usage: /delete <project-name>")); rl.prompt(); return; }
  if (name === currentProject) {
    console.log(red("Cannot delete the active project. Switch to another project first."));
    rl.prompt(); return;
  }

  try {
    await api.deleteProject(name);
    console.log(green(`Project "${name}" deleted.`));
  } catch (err: any) {
    console.error(red(`Failed to delete: ${err.message}`));
  }
  rl.prompt();
}

// ===== Main input handler =====
async function handleInput(line: string, rl: readline.Interface) {
  const text = line.trim();
  if (!text) { rl.prompt(); return; }

  // Commands
  if (text === "/clear") {
    try {
      await api.clearHistory(currentProject);
      console.log(dim("History cleared."));
    } catch (err: any) {
      console.error(red(`Failed: ${err.message}`));
    }
    rl.prompt(); return;
  }
  if (text === "/compact") {
    console.log(dim("Compacting history..."));
    try {
      const result = await api.compactHistory(currentProject);
      console.log(green(`Compacted ${result.before} messages → ${result.after} messages.`));
    } catch (err: any) {
      console.error(red(`Compact failed: ${err.message}`));
    }
    rl.prompt(); return;
  }
  if (text === "/history") {
    try {
      const { messages } = await api.getHistory(currentProject);
      console.log(dim(`${messages.length} messages in history`));
    } catch (err: any) {
      console.error(red(`Failed: ${err.message}`));
    }
    rl.prompt(); return;
  }
  if (text === "/logout") {
    const prefs = loadPrefs();
    delete prefs.apiKey;
    savePrefs(prefs);
    console.log(dim("Logged out. Restart the CLI to log in again."));
    process.exit(0);
  }
  if (text === "/exit" || text === "/quit") {
    console.log(dim("Bye."));
    process.exit(0);
  }
  if (text === "/url") {
    if (previewUrl) console.log(cyan(previewUrl));
    else console.log(dim("No preview URL available."));
    rl.prompt(); return;
  }
  if (text === "/projects") { await handleProjectsCommand(rl); return; }
  if (text.startsWith("/new ")) { await handleNewCommand(text.slice(5).trim(), rl); return; }
  if (text.startsWith("/switch ")) { await handleSwitchCommand(text.slice(8).trim(), rl); return; }
  if (text.startsWith("/delete ")) { await handleDeleteCommand(text.slice(8).trim(), rl); return; }

  if (text === "/deploy") {
    console.log(dim("\nDeploying to Vercel...\n"));
    try {
      await api.deploy(currentProject, (event) => {
        if (event.type === "status") {
          console.log(dim(`  ${event.message}`));
        } else if (event.type === "result") {
          if (event.success) console.log(green(`\nDeployed: ${event.url}`));
          else console.log(red(`\nDeploy failed: ${event.error}`));
        } else if (event.type === "error") {
          console.log(red(`\nDeploy error: ${event.message}`));
        }
      });
    } catch (err: any) {
      console.error(red(`Deploy error: ${err.message}`));
    }
    rl.prompt(); return;
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

  // ===== Chat =====
  abortController = new AbortController();

  // Detect and upload local files
  let prompt = text;
  const localFiles = findLocalFiles(text);
  if (localFiles.length > 0) {
    for (const { file: localPath, raw, content } of localFiles) {
      try {
        const filename = path.basename(localPath).replace(/[\s\u00A0]/g, "_");
        const result = await api.uploadFile(currentProject, filename, content);
        prompt = prompt.replace(raw, result.path);
        console.log(`${magenta("↑ uploaded")} ${filename} (${(content.length / 1024).toFixed(1)} KB) → ${dim(result.path)}`);
      } catch (err: any) {
        console.log(yellow(`Upload failed for ${path.basename(localPath)}: ${err.message}`));
      }
    }
  }

  startPulse("Thinking");

  try {
    await api.chat(currentProject, prompt, currentModel, printEvent, abortController.signal);
  } catch (err: any) {
    stopPulse();
    if (err.name !== "AbortError") {
      console.error(`\n${red("Error: " + err.message)}`);
    }
  }

  stopPulse();
  abortController = null;
  rl.prompt();
}

// ===== Main =====
async function main() {
  console.log(bold("Dreamer CLI\n"));
  console.log(dim(`Backend: ${BACKEND_URL}`));
  console.log(dim(`App:     ${APP_URL}\n`));

  // Auth check
  let apiKey = getApiKey();
  if (!apiKey) {
    console.log(dim("Not logged in. Starting authentication...\n"));
    try {
      apiKey = await cliLogin();
      console.log(green("✓ Logged in successfully.\n"));
    } catch (err: any) {
      console.error(red(`Login failed: ${err.message}`));
      process.exit(1);
    }
  }

  // Initialize API client
  api = new ApiClient({ baseUrl: BACKEND_URL, apiKey });

  // Project selection
  const prefs = loadPrefs();
  let startProject: string | null = null;

  try {
    const { projects } = await api.listProjects();

    if (projects.length === 0) {
      // No projects — prompt to create one
      console.log(dim("No projects found. Let's create one.\n"));
      const tmpRl = readline.createInterface({ input: process.stdin, output: process.stdout });
      startProject = await new Promise<string>((resolve) => {
        tmpRl.question(bold("Project name: "), (answer) => {
          tmpRl.close();
          resolve(answer.trim());
        });
      });
      if (!startProject || !/^[a-zA-Z0-9_-]+$/.test(startProject)) {
        console.error(red("Invalid project name."));
        process.exit(1);
      }
      await api.createProject(startProject, startProject);
    } else {
      // Show project picker
      const lastProject = prefs.lastProject;
      const lastIdx = lastProject ? projects.findIndex(p => p.id === lastProject || p.name === lastProject) : -1;

      console.log(bold("Select a project:\n"));
      projects.forEach((p, i) => {
        const marker = i === lastIdx ? cyan(" ● ") : dim(" ○ ");
        const date = new Date(p.created_at).toLocaleDateString();
        console.log(`${marker}${dim(`${i + 1})`)} ${p.name} ${dim(`[${p.template}] ${date}`)}`);
      });
      console.log(`\n  ${dim(`${projects.length + 1})`)} ${green("+ Create new project")}`);
      console.log();

      const tmpRl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const pick = await new Promise<string>((resolve) => {
        tmpRl.question(dim(`Enter number (1-${projects.length + 1})${lastIdx >= 0 ? ` [default: ${lastIdx + 1}]` : ""}: `), (answer) => {
          tmpRl.close();
          resolve(answer.trim());
        });
      });

      const num = pick === "" && lastIdx >= 0 ? lastIdx + 1 : parseInt(pick, 10);

      if (num === projects.length + 1) {
        // Create new project
        const tmpRl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
        startProject = await new Promise<string>((resolve) => {
          tmpRl2.question(bold("Project name: "), (answer) => {
            tmpRl2.close();
            resolve(answer.trim());
          });
        });
        if (!startProject || !/^[a-zA-Z0-9_-]+$/.test(startProject)) {
          console.error(red("Invalid project name."));
          process.exit(1);
        }
        await api.createProject(startProject, startProject);
      } else if (num >= 1 && num <= projects.length) {
        startProject = projects[num - 1].id;
      } else {
        // Default to last project or first
        startProject = lastIdx >= 0 ? projects[lastIdx].id : projects[0].id;
      }
    }
  } catch (err: any) {
    console.error(red(`Failed to load projects: ${err.message}`));
    console.error(dim("Make sure the backend is running."));
    process.exit(1);
  }

  console.log(dim(`\nModel: ${currentModel}`));
  console.log(dim("Commands: /clear /compact /history /url /model /projects /new /switch /delete /deploy /logout /exit\n"));

  try {
    await connectToProject(startProject!);
  } catch (err: any) {
    console.error(red(`Failed to connect: ${err.message}`));
    process.exit(1);
  }

  emitKeypressEvents(process.stdin);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: bold(`(${currentProject}) > `),
  });

  // Ctrl+C to exit (when not running agent), or abort (when running)
  rl.on("SIGINT", () => {
    if (abortController) {
      abortController.abort();
      console.log(`\n${dim("Aborting...")}`);
    } else {
      console.log(`\n${dim("Bye.")}`);
      process.exit(0);
    }
  });

  // ESC key to abort current agent run
  process.stdin.on("keypress", (_ch: string, key: { name?: string; sequence?: string }) => {
    if (key?.name === "escape" && abortController) {
      abortController.abort();
      console.log(`\n${dim("Aborting...")}`);
    }
  });

  rl.prompt();
  rl.on("line", (line) => handleInput(line, rl));
}

main().catch((err) => {
  console.error(`\x1b[31mFatal: ${err.message}\x1b[0m`);
  process.exit(1);
});
