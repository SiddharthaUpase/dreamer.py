import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { SandboxInstance } from "@blaxel/core";
import { createTools } from "./tools.js";
import {
  getProjectMessages,
  saveMessages,
  deleteProjectMessages,
  type StoredMessage,
} from "../services/projectStore.js";

// Injects cache_control into the request body for Anthropic prompt caching via OpenRouter.
// LangChain's ChatOpenAI uses the openai SDK which rejects unknown top-level params,
// so we inject it at the HTTP layer before the request is sent.
function createCachingFetch(): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        body.cache_control = { type: "ephemeral" };
        init = { ...init, body: JSON.stringify(body) };
      } catch { /* not JSON, pass through */ }
    }
    return globalThis.fetch(input, init);
  };
}

const openRouterBase = {
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://agent-vas.dev",
    "X-OpenRouter-Title": "Agent VAS",
  },
};

const openRouterConfig = {
  model: "",
  temperature: 0.8,
  streaming: true,
  apiKey: process.env.OPEN_ROUTER,
  configuration: openRouterBase,
};

const anthropicConfig = {
  ...openRouterConfig,
  configuration: {
    ...openRouterBase,
    fetch: createCachingFetch(),
  },
};

const AVAILABLE_MODELS: Record<string, () => BaseChatModel> = {
  "claude-sonnet": () =>
    new ChatOpenAI({
      ...anthropicConfig,
      model: "anthropic/claude-sonnet-4.6",
    }),
  "claude-haiku": () =>
    new ChatOpenAI({
      ...anthropicConfig,
      model: "anthropic/claude-haiku-4.5",
    }),
  "minimax": () =>
    new ChatOpenAI({
      ...openRouterConfig,
      model: "minimax/minimax-m2.5",
    }),
  "kimi": () =>
    new ChatOpenAI({
      ...openRouterConfig,
      model: "moonshotai/kimi-k2.5",
    }),
};

export const MODEL_LIST = Object.keys(AVAILABLE_MODELS);

const SYSTEM_PROMPT = `You are an expert coding agent with access to a sandboxed cloud environment. You help users with software engineering tasks including solving bugs, building features, refactoring code, and running applications.

The working directory is /app. Always use absolute paths. The project files live in /app.

# Tone and Style
- Be concise and direct. Minimize output — get to the point quickly.
- Do NOT add unnecessary preamble ("Sure!", "Great question!") or postamble ("Let me know if you need anything else!").
- When you run commands, share the relevant output.
- Prioritize technical accuracy over validation. Disagree when necessary.

# Doing Tasks
Follow this workflow for software engineering tasks:
1. **Understand**: Use read, grep, and glob to understand the codebase before making changes. NEVER guess at code structure — always verify first.
2. **Plan**: Break down complex tasks into steps. For large tasks, explain your plan before starting.
3. **Implement**: Make changes using the appropriate tools. Follow existing code conventions and style.
4. **Verify**: After making changes, verify they work (run builds, tests, linters if available).

# Tool Usage Policy — CRITICAL

You have specialized tools for file operations. Using the RIGHT tool is essential for reliability:

- **read**: Read files. ALWAYS read a file before editing it. Use offset/limit for large files.
- **write**: Create or overwrite files. ALWAYS read the file first if it already exists.
- **edit**: Make surgical edits to files. The old_string must EXACTLY match the file content (including indentation and whitespace). If the edit fails because old_string was not found, re-read the file to get the exact current content and try again. Prefer edit over write when modifying existing files — it is safer and preserves the rest of the file.
- **bash**: Execute shell commands (git, npm, pip, docker, curl, etc.). Do NOT use bash for file operations — use the dedicated tools instead. Avoid using cat, head, tail, sed, awk, or echo for reading/writing/editing files.
- **grep**: Search file contents using regex patterns. Returns matching lines with file paths and line numbers. Use the include parameter to filter by file type (e.g., "*.ts").
- **glob**: Find files by name pattern. Returns matching file paths. Use this to locate files before reading them.

IMPORTANT rules:
- ALWAYS read a file before editing or overwriting it. Never guess at file contents.
- When using the edit tool, copy the old_string EXACTLY from the read output — preserve all indentation, whitespace, and newlines precisely. The line number prefix format from read is: line_number + tab + content. Never include line numbers in old_string or new_string.
- If an edit fails with "Could not find the specified text", re-read the file to see the actual current content, then retry with the corrected old_string.
- Prefer edit over write for modifying existing files. Only use write when creating new files or when you need to completely replace a file's content.
- When searching the codebase, use grep for content search and glob for finding files by name. Do NOT use bash find or bash grep.
- You can call multiple tools in a single response. If the calls are independent, make them in parallel for efficiency.

# Server & Preview Management
For running servers or long-running processes:
- Use the start_server tool instead of bash. It runs the command in the background and waits until the server is ready.
- Servers MUST bind to 0.0.0.0 (not localhost/127.0.0.1) for preview URLs to work.
- For Next.js: npm run dev -- --port 3000
- For Express/Node: app.listen(port, '0.0.0.0')
- For Python: use --host 0.0.0.0
- After the server is ready, use preview_url to get a public URL the user can open in their browser.
- Use check_server to check logs of a running server, and stop_server to stop it.
- ALWAYS call preview_url after starting a server so the user gets a clickable link.

# Code Quality
- Follow existing code conventions — check the surrounding code before making changes.
- Do NOT add comments unless the logic is genuinely non-obvious. Never add comments like "// Import X" or "// Define variable".
- Keep changes minimal and focused. Do not refactor unrelated code.
- Use proper error handling at system boundaries.

# File Delivery — /app/outputs
When the user asks you to produce, generate, export, or "give" them a file (code, HTML, images, configs, etc.), **copy** the file to \`/app/outputs/\` so it can be delivered to the user's browser for download.
- The outputs folder is created automatically before each run.
- Always **copy** (not move) — keep the original file in place.
- Use: \`cp /path/to/file /app/outputs/\`
- At the end of the task, briefly mention which files were placed in outputs so the user knows what to expect.

# Response Format — CRITICAL
You MUST always end your turn with a text response to the user. NEVER end on a tool call without a follow-up message. After using tools, always provide a brief summary of what you did and the outcome. Even if the task is simple (e.g., a single file write), confirm what was done in plain text.`;

export const TOKEN_LIMIT = 150_000;

export interface OutputFile {
  name: string;
  path: string;
  content: string;
  size: number;
}

export interface ToolEvent {
  type: "tool_start" | "tool_end" | "result" | "error" | "outputs";
  tool?: string;
  args?: Record<string, unknown>;
  output?: string;
  content?: string;
  files?: OutputFile[];
  contextTokens?: number;
  contextLimit?: number;
}

function estimateTokens(messages: BaseMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content as any[]) {
        if (typeof block === "string") chars += block.length;
        else if (block.text) chars += (block.text as string).length;
        else chars += JSON.stringify(block).length;
      }
    }
    const additional = msg.additional_kwargs;
    if (additional?.tool_calls) {
      chars += JSON.stringify(additional.tool_calls).length;
    }
  }
  return Math.ceil(chars / 4);
}

function serializeHistoryForSummary(messages: BaseMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const content = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((b: any) => b.text || JSON.stringify(b)).join("")
        : JSON.stringify(msg.content);

    if (msg instanceof HumanMessage) {
      parts.push(`[USER]: ${content}`);
    } else if (msg instanceof AIMessage) {
      const toolCalls = msg.additional_kwargs?.tool_calls;
      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
        const calls = toolCalls.map((tc: any) =>
          `  tool: ${tc.function?.name || "unknown"}, args: ${tc.function?.arguments || "{}"}`
        ).join("\n");
        parts.push(`[ASSISTANT (tool_calls)]:\n${calls}`);
      }
      if (content) {
        parts.push(`[ASSISTANT]: ${content}`);
      }
    } else if (msg instanceof ToolMessage) {
      parts.push(`[TOOL RESULT (${msg.name || "unknown"})]: ${content}`);
    }
  }
  return parts.join("\n\n");
}

async function compactHistory(messages: BaseMessage[]): Promise<BaseMessage[]> {
  const serialized = serializeHistoryForSummary(messages);

  const compactionModel = new ChatOpenAI({
    ...openRouterConfig,
    model: "openai/gpt-4.1-mini",
    temperature: 0,
    streaming: false,
  });

  const summaryResponse = await compactionModel.invoke([
    new SystemMessage(
      `You are a conversation summarizer for a coding agent. Produce a detailed summary of the conversation below. Include:

1. **User requests**: What the user asked for, in order
2. **Actions taken**: What files were created, modified, or deleted. What commands were run.
3. **Tool calls**: Key tool calls made (tool name, what it did, important outputs)
4. **Current project state**: What exists now — files, running servers, installed packages, project structure
5. **Important context**: Any decisions made, errors encountered and how they were resolved, configurations set up
6. **Preview URLs**: Any active preview URLs or server ports

Be thorough and specific — include file paths, port numbers, package names. This summary will be used as the only context for continuing the conversation.`
    ),
    new HumanMessage(serialized),
  ]);

  const summary = typeof summaryResponse.content === "string"
    ? summaryResponse.content
    : (summaryResponse.content as any[]).map((b: any) => b.text || "").join("");

  console.log(`[compaction] Compacted ${messages.length} messages (${estimateTokens(messages)} tokens) → summary (${Math.ceil(summary.length / 4)} tokens)`);

  return [
    new HumanMessage("Continue from previous context:"),
    new AIMessage(`## Previous Conversation Context\n\n${summary}`),
  ];
}

// ===== Exported helpers for API endpoints =====

export async function compactProjectHistory(projectId: string): Promise<{ tokens: number; limit: number }> {
  const dbMessages = await getProjectMessages(projectId);
  if (dbMessages.length === 0) {
    return { tokens: 0, limit: TOKEN_LIMIT };
  }

  const history = dbMessages.map(dbRowToLangChain);
  const compacted = await compactHistory(history);

  // Replace DB messages with compacted version

  await deleteProjectMessages(projectId);
  await saveMessages(compacted.map((m) => langChainToDbRow(m, projectId)));

  return { tokens: estimateTokens(compacted), limit: TOKEN_LIMIT };
}

export async function getProjectContextInfo(projectId: string): Promise<{ tokens: number; limit: number }> {
  const dbMessages = await getProjectMessages(projectId);
  const history = dbMessages.map(dbRowToLangChain);
  return { tokens: estimateTokens(history), limit: TOKEN_LIMIT };
}

const DIR_FILE_CAP = 30;
const IGNORED_DIRS = ["node_modules", "dist", "build", "coverage", "out", ".turbo"];

async function getRunningServerContext(sandbox: SandboxInstance): Promise<string> {
  try {
    // Check which ports are listening
    const portResult = await sandbox.process.exec({
      command: `ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "no port info"`,
      waitForCompletion: true,
    });
    const portOutput = (portResult.stdout || "").trim();

    // Extract listening ports (exclude sandbox-api on 8080)
    const listeningPorts: { port: number; process: string }[] = [];
    for (const line of portOutput.split("\n")) {
      const portMatch = line.match(/:(\d+)\s/);
      if (portMatch) {
        const port = parseInt(portMatch[1]);
        if (port !== 8080 && port > 0 && port < 65536) {
          const procMatch = line.match(/users:\(\("([^"]+)"/);
          listeningPorts.push({ port, process: procMatch?.[1] || "unknown" });
        }
      }
    }

    // Check known server process names
    const knownServers = ["dev-server"];
    const runningServers: { name: string; status: string; command: string }[] = [];
    for (const name of knownServers) {
      try {
        const info = await sandbox.process.get(name);
        if (info.status === "running") {
          runningServers.push({
            name,
            status: info.status,
            command: info.command || "unknown",
          });
        }
      } catch {
        // Process doesn't exist
      }
    }

    if (runningServers.length === 0 && listeningPorts.length === 0) {
      return "";
    }

    const lines: string[] = ["## Running Services"];
    if (runningServers.length > 0) {
      for (const s of runningServers) {
        lines.push(`- Process "${s.name}" is RUNNING (command: \`${s.command}\`)`);
      }
    }
    if (listeningPorts.length > 0) {
      lines.push("- Listening ports: " + listeningPorts.map(p => `${p.port} (${p.process})`).join(", "));
    }
    lines.push("");
    lines.push("IMPORTANT: A dev server is already running. Do NOT start another one. Use the existing server. If you need to restart it, stop it first with stop_server, then start a new one on the SAME port.");

    return lines.join("\n");
  } catch {
    return "";
  }
}

async function getFileTree(sandbox: SandboxInstance): Promise<string> {
  try {
    const ignored = IGNORED_DIRS.map((d) => `-not -path "*/${d}/*"`).join(" ");
    const result = await sandbox.process.exec({
      command: `find /app -type f -not -path "*/.*" ${ignored} 2>/dev/null | sort`,
      waitForCompletion: true,
    });
    const paths = (result.stdout || "").split("\n").map((p) => p.trim()).filter(Boolean);
    if (paths.length === 0) return "";

    // Build a nested tree structure
    const root: Record<string, any> = {};
    for (const p of paths) {
      const rel = p.replace("/app/", "");
      const parts = rel.split("/");
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node[parts[i]]) node[parts[i]] = {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = null; // null = file
    }

    // Render as markdown tree with box-drawing chars
    function renderTree(node: Record<string, any>, prefix: string): string[] {
      const entries = Object.keys(node).sort((a, b) => {
        // Directories first, then files
        const aIsDir = node[a] !== null;
        const bIsDir = node[b] !== null;
        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;
        return a.localeCompare(b);
      });

      const lines: string[] = [];
      let fileCount = 0;

      for (let i = 0; i < entries.length; i++) {
        const name = entries[i];
        const isLast = i === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const childPrefix = isLast ? "    " : "│   ";

        if (node[name] === null) {
          // File
          fileCount++;
          if (fileCount <= DIR_FILE_CAP) {
            lines.push(`${prefix}${connector}${name}`);
          } else if (fileCount === DIR_FILE_CAP + 1) {
            const remaining = entries.filter((e, idx) => idx >= i && node[e] === null).length;
            lines.push(`${prefix}${connector}... (+${remaining} more files)`);
            break;
          }
        } else {
          // Directory
          lines.push(`${prefix}${connector}${name}/`);
          lines.push(...renderTree(node[name], prefix + childPrefix));
        }
      }
      return lines;
    }

    const treeLines = renderTree(root, "");
    return `## Current Project Structure\n\`\`\`\n.\n${treeLines.join("\n")}\n\`\`\``;
  } catch {
    return "";
  }
}

// ===== DB <-> LangChain message conversion =====

function dbRowToLangChain(row: StoredMessage): BaseMessage {
  if (row.role === "human") {
    return new HumanMessage(row.content);
  }
  if (row.role === "tool") {
    return new ToolMessage({
      content: row.content,
      tool_call_id: row.tool_call_id || "",
      name: row.name || undefined,
    });
  }
  // ai — use constructor to properly initialize both tool_calls and additional_kwargs
  if (row.tool_calls?.length) {
    const toolCalls = row.tool_calls.map((tc: any) => ({
      name: tc.name,
      args: typeof tc.args === "string" ? JSON.parse(tc.args) : tc.args || {},
      id: tc.id,
      type: "tool_call" as const,
    }));
    return new AIMessage({
      content: row.content,
      tool_calls: toolCalls,
      additional_kwargs: {
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      },
    });
  }
  return new AIMessage(row.content);
}

function langChainToDbRow(msg: BaseMessage, projectId: string): Omit<StoredMessage, "id" | "created_at"> {
  const content = typeof msg.content === "string"
    ? msg.content
    : Array.isArray(msg.content)
      ? msg.content.map((b: any) => b.text || JSON.stringify(b)).join("")
      : JSON.stringify(msg.content);

  if (msg instanceof HumanMessage) {
    return { project_id: projectId, role: "human", content, tool_calls: null, tool_call_id: null, name: null };
  }

  if (msg instanceof ToolMessage) {
    return {
      project_id: projectId,
      role: "tool",
      content,
      tool_calls: null,
      tool_call_id: msg.tool_call_id || null,
      name: msg.name || null,
    };
  }

  // AIMessage
  const aiMsg = msg as AIMessage;
  let toolCalls: any[] | null = null;
  if (aiMsg.tool_calls?.length) {
    toolCalls = aiMsg.tool_calls.map((tc) => ({ name: tc.name, args: tc.args, id: tc.id }));
  }
  return { project_id: projectId, role: "ai", content, tool_calls: toolCalls, tool_call_id: null, name: null };
}


// ===== History sanitization =====
// Ensures message history is valid for the LLM API.
// Fixes issues from aborted requests, crashes, or partial saves.

function sanitizeHistory(messages: BaseMessage[]): BaseMessage[] {
  if (messages.length === 0) return [];

  const result: BaseMessage[] = [];

  // 1. Skip leading non-human messages
  let start = 0;
  while (start < messages.length && !(messages[start] instanceof HumanMessage)) {
    start++;
  }

  for (let i = start; i < messages.length; i++) {
    const msg = messages[i];

    if (msg instanceof ToolMessage) {
      // Only include tool messages if the previous message in result is an AI with matching tool_calls
      const prev = result[result.length - 1];
      if (prev instanceof AIMessage && prev.tool_calls?.some(tc => tc.id === msg.tool_call_id)) {
        result.push(msg);
      }
      // Otherwise skip orphaned tool messages
    } else if (msg instanceof AIMessage) {
      result.push(msg);
    } else if (msg instanceof HumanMessage) {
      result.push(msg);
    }
  }

  // 2. Trim trailing incomplete tool call sequences
  // If the last AI message has tool_calls, check all tool_calls have matching tool messages after it
  while (result.length > 0) {
    const last = result[result.length - 1];

    if (last instanceof ToolMessage) {
      // Tool message at end is fine (it's a response)
      break;
    }

    if (last instanceof AIMessage && last.tool_calls?.length) {
      // AI with tool_calls at the end — check if all tool_calls have responses
      const aiIndex = result.length - 1;
      const expectedIds = new Set(last.tool_calls.map(tc => tc.id));
      const foundIds = new Set<string>();
      for (let j = aiIndex + 1; j < result.length; j++) {
        const m = result[j];
        if (m instanceof ToolMessage && m.tool_call_id) {
          foundIds.add(m.tool_call_id);
        }
      }
      if (foundIds.size < expectedIds.size) {
        // Incomplete — remove this AI message and any tool messages after it
        result.splice(aiIndex);
        continue;
      }
      break;
    }

    break;
  }

  // 3. Don't end on a trailing human message with no response (it'll be re-sent)
  // Actually this is fine — the current user message will be appended after

  return result;
}

// ===== Main agent runner =====

export async function runAgentStream(
  sandbox: SandboxInstance,
  projectId: string,
  prompt: string,
  modelId: string,
  onEvent: (event: ToolEvent) => void,
  signal?: AbortSignal,
) {
  const createModel = AVAILABLE_MODELS[modelId] || AVAILABLE_MODELS["claude-sonnet"];
  const model = createModel();
  const tools = createTools(sandbox);

  await sandbox.process.exec({ command: "mkdir -p /app/outputs", waitForCompletion: true });

  const [fileTree, serverContext] = await Promise.all([
    getFileTree(sandbox),
    getRunningServerContext(sandbox),
  ]);

  let systemPromptText = SYSTEM_PROMPT;
  if (serverContext) systemPromptText += `\n\n${serverContext}`;
  if (fileTree) systemPromptText += `\n\n${fileTree}`;

  const agent = createReactAgent({
    llm: model,
    tools,
    messageModifier: new SystemMessage(systemPromptText),
  });

  // Load history from DB
  let history: BaseMessage[] = [];
  try {
    const dbMessages = await getProjectMessages(projectId);
    if (dbMessages.length > 0) {
      history = sanitizeHistory(dbMessages.map(dbRowToLangChain));
      console.log(`[agent ${projectId}] Loaded ${dbMessages.length} messages from DB, ${history.length} after sanitization`);
    }
  } catch (err: any) {
    console.error(`[agent ${projectId}] Failed to load history from DB:`, err.message);
  }

  // Auto-compact if needed
  const tokenCount = estimateTokens(history);
  if (tokenCount >= TOKEN_LIMIT) {
    console.log(`[agent ${projectId}] History at ${tokenCount} tokens, auto-compacting...`);
    history = await compactHistory(history);
    // Replace DB messages with compacted version
  
    await deleteProjectMessages(projectId);
    await saveMessages(history.map((m) => langChainToDbRow(m, projectId)));
  }

  const userMsg = new HumanMessage(prompt);
  const inputMessages = [...history, userMsg];

  const stream = await agent.streamEvents(
    { messages: inputMessages },
    { version: "v2", recursionLimit: 50, signal }
  );

  let lastContent = "";
  let allNewMessages: BaseMessage[] = [];
  // Running token estimate: start from input context
  let runningTokens = estimateTokens(inputMessages);

  for await (const event of stream) {
    if (signal?.aborted) break;

    if (event.event === "on_tool_start") {
      const argsStr = event.data?.input ? JSON.stringify(event.data.input) : "";
      runningTokens += Math.ceil(argsStr.length / 4);
      onEvent({
        type: "tool_start",
        tool: event.name,
        args: event.data?.input,
        contextTokens: runningTokens,
        contextLimit: TOKEN_LIMIT,
      });
    } else if (event.event === "on_tool_end") {
      const output = event.data?.output;
      const text = typeof output === "string" ? output : output?.content ?? "";
      const outputStr = typeof text === "string" ? text : "";
      runningTokens += Math.ceil(outputStr.length / 4);
      const limit = event.name === "preview_url" ? 500 : 200;
      onEvent({
        type: "tool_end",
        tool: event.name,
        output: outputStr.slice(0, limit),
        contextTokens: runningTokens,
        contextLimit: TOKEN_LIMIT,
      });
    } else if (event.event === "on_chain_end" && event.name === "LangGraph") {
      const output = event.data?.output;
      if (output?.messages) {
        allNewMessages = output.messages;
      }
    } else if (event.event === "on_chat_model_end") {
      const msg = event.data?.output;
      if (msg?.content) {
        lastContent = typeof msg.content === "string"
          ? msg.content
          : msg.content.map((c: any) => c.text || "").join("");
      }
    }
  }

  // Extract only the new messages (skip what we sent as input)
  const newOnly = allNewMessages.slice(inputMessages.length);

  if (newOnly.length > 0) {
    // Persist to DB: user message + all new messages from the agent
    try {
      const dbRows = [
        langChainToDbRow(userMsg, projectId),
        ...newOnly.map((m) => langChainToDbRow(m, projectId)),
      ];
      await saveMessages(dbRows);
      console.log(`[agent ${projectId}] Persisted ${dbRows.length} messages to DB`);
    } catch (err: any) {
      console.error(`[agent ${projectId}] Failed to persist messages:`, err.message);
    }
  } else if (lastContent) {
    // Fallback — only save if there's actual content
    try {
      await saveMessages([
        langChainToDbRow(userMsg, projectId),
        langChainToDbRow(new AIMessage(lastContent), projectId),
      ]);
    } catch (err: any) {
      console.error(`[agent ${projectId}] Failed to persist fallback:`, err.message);
    }
  } else {
    // No response at all — just save the user message so it's not lost
    try {
      await saveMessages([langChainToDbRow(userMsg, projectId)]);
    } catch (err: any) {
      console.error(`[agent ${projectId}] Failed to persist user message:`, err.message);
    }
  }

  const contextTokens = estimateTokens([...history, userMsg, ...newOnly]);
  onEvent({ type: "result", content: lastContent, contextTokens, contextLimit: TOKEN_LIMIT });

  // Fetch output files
  try {
    const listResult = await sandbox.process.exec({
      command: "find /app/outputs -type f 2>/dev/null",
      waitForCompletion: true,
    });
    const filePaths = (listResult.stdout || "")
      .split("\n")
      .map((p: string) => p.trim())
      .filter(Boolean);

    if (filePaths.length > 0) {
      const MAX_FILE_SIZE = 5 * 1024 * 1024;
      const outputFiles: OutputFile[] = [];

      for (const filePath of filePaths) {
        const sizeResult = await sandbox.process.exec({
          command: `stat -c%s "${filePath}" 2>/dev/null || stat -f%z "${filePath}" 2>/dev/null`,
          waitForCompletion: true,
        });
        const size = parseInt((sizeResult.stdout || "0").trim(), 10);
        if (size > MAX_FILE_SIZE || size === 0) continue;

        const b64Result = await sandbox.process.exec({
          command: `base64 "${filePath}"`,
          waitForCompletion: true,
        });
        const b64 = (b64Result.stdout || "").trim();
        if (!b64) continue;

        const name = filePath.split("/").pop() || filePath;
        const relativePath = filePath.replace("/app/outputs/", "");
        outputFiles.push({ name, path: relativePath, content: b64, size });
      }

      if (outputFiles.length > 0) {
        onEvent({ type: "outputs", files: outputFiles });
      }

      await sandbox.process.exec({ command: "rm -rf /app/outputs/*", waitForCompletion: true });
    }
  } catch {
    // Ignore
  }
}
