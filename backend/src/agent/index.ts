import { task, entrypoint, addMessages } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import * as fsNode from "fs";
import * as pathNode from "path";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { SandboxInstance } from "@blaxel/core";
import { createTools, isImagePath, isPdfPath, getMimeType, type TodoItem, type DatabaseConfig, type SubagentConfig, type DeployConfig } from "./tools.js";
export type { DatabaseConfig, DeployConfig } from "./tools.js";
import type { StoredMessage } from "../services/projectStore.js";

// Injects cache_control into the request body for Anthropic prompt caching via OpenRouter.
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

export const AVAILABLE_MODELS: Record<string, () => BaseChatModel> = {
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
  "mimo": () =>
    new ChatOpenAI({
      ...openRouterConfig,
      model: "xiaomi/mimo-v2-pro",
    }),
};

export const MODEL_LIST = Object.keys(AVAILABLE_MODELS);

// Models that support image/vision input
const VISION_MODELS = new Set(["claude-sonnet", "claude-haiku"]);

// ===== Modular system prompt =====
const PROMPTS_DIR = pathNode.join(pathNode.dirname(new URL(import.meta.url).pathname), "prompts");
const PROMPT_FILES = ["core", "workflow", "tools", "sandbox", "skills", "response"];

function loadSystemPrompt(): string {
  const parts: string[] = [];
  for (const name of PROMPT_FILES) {
    try {
      const content = fsNode.readFileSync(pathNode.join(PROMPTS_DIR, `${name}.md`), "utf8").trim();
      if (content) parts.push(content);
    } catch { /* prompt file not found, skip */ }
  }
  return parts.join("\n\n");
}

const SYSTEM_PROMPT = loadSystemPrompt();

export interface OutputFile {
  name: string;
  path: string;
  content: string;
  size: number;
}

export interface ToolEvent {
  type: "tool_start" | "tool_end" | "result" | "error" | "outputs" | "token" | "todo_update" | "subagent_log";
  tool?: string;
  args?: Record<string, unknown>;
  output?: string;
  content?: string;
  files?: OutputFile[];
  todos?: TodoItem[];
  contextTokens?: number;
  contextLimit?: number;
  // subagent_log fields
  label?: string;
  detail?: string;
}

export interface AgentResult {
  newMessages: BaseMessage[];
  lastContent: string;
  contextTokens: number;
  aborted?: boolean;
  /** If pre-run compaction occurred, this contains the full replacement history (compacted + new messages). When set, the caller should replace its history with this instead of appending newMessages. */
  compactedHistory?: BaseMessage[];
}

// ===== Utilities (exported for Express server) =====

export function estimateTokens(messages: BaseMessage[], overheadTokens = 0): number {
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
  return Math.ceil(chars / 2.7) + overheadTokens;
}

export async function compactHistory(messages: BaseMessage[]): Promise<{ human: string; ai: string }> {
  // Build a plain-text transcript of the conversation
  const lines: string[] = [];

  // Extract the last todo state from todowrite tool calls
  let lastTodoState: string | null = null;
  for (const msg of messages) {
    // Look for AI messages with todowrite tool calls
    if (msg instanceof AIMessage && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        if (tc.name === "todowrite" && tc.args?.todos) {
          lastTodoState = JSON.stringify(tc.args.todos, null, 2);
        }
      }
    }

    const content = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((b: any) => b.text || "").filter(Boolean).join("")
        : "";
    if (!content) continue;

    if (msg instanceof HumanMessage) {
      lines.push(`User: ${content}`);
    } else if (msg instanceof AIMessage) {
      lines.push(`Assistant: ${content}`);
    } else if (msg instanceof ToolMessage) {
      // skip tool messages — the AI responses already capture the outcomes
    }
  }

  const transcript = lines.join("\n\n");

  const haiku = new ChatOpenAI({
    ...anthropicConfig,
    model: "anthropic/claude-haiku-4.5",
    streaming: false,
  });

  const result = await haiku.invoke([
    new SystemMessage(
      "You are a conversation compactor. Given a transcript of a user-assistant coding conversation, produce a concise summary that preserves all important context:\n" +
      "- What the user asked for (goals, requirements, preferences)\n" +
      "- What was built/changed (files modified, key decisions, architecture)\n" +
      "- Current state of the project (what works, what's pending, any known issues)\n" +
      "- Any user preferences or corrections expressed during the conversation\n\n" +
      "Output TWO sections separated by '---SPLIT---':\n" +
      "1. A summary written as if the user is reminding the assistant of prior context (first person: 'I asked you to...', 'We built...')\n" +
      "2. A summary written as the assistant acknowledging the context (first person: 'I helped you...', 'We implemented...')\n\n" +
      "Be concise but don't lose important details. Skip pleasantries."
    ),
    new HumanMessage(`Here is the conversation transcript to compact:\n\n${transcript}`),
  ]);

  const output = typeof result.content === "string" ? result.content : "";
  const parts = output.split("---SPLIT---");
  const humanSummary = (parts[0] || "").trim();
  let aiSummary = (parts[1] || output).trim();

  // Append the last todo state so the agent can continue tracking progress
  if (lastTodoState) {
    aiSummary += `\n\n## Current Task List\nHere is the exact todo state from before compaction. Use the todowrite tool to restore this list and continue from where you left off:\n\`\`\`json\n${lastTodoState}\n\`\`\``;
  }

  return { human: humanSummary, ai: aiSummary };
}

export function dbRowToLangChain(row: StoredMessage): BaseMessage {
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

export function langChainToDbRow(msg: BaseMessage, projectId: string): Omit<StoredMessage, "id" | "created_at"> {
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

  const aiMsg = msg as AIMessage;
  let toolCalls: any[] | null = null;
  if (aiMsg.tool_calls?.length) {
    toolCalls = aiMsg.tool_calls.map((tc) => ({ name: tc.name, args: tc.args, id: tc.id }));
  }
  return { project_id: projectId, role: "ai", content, tool_calls: toolCalls, tool_call_id: null, name: null };
}

export function sanitizeHistory(messages: BaseMessage[]): BaseMessage[] {
  if (messages.length === 0) return [];

  const result: BaseMessage[] = [];

  let start = 0;
  while (start < messages.length && !(messages[start] instanceof HumanMessage)) {
    start++;
  }

  for (let i = start; i < messages.length; i++) {
    const msg = messages[i];

    if (msg instanceof ToolMessage) {
      const prev = result[result.length - 1];
      if (prev instanceof AIMessage && prev.tool_calls?.some(tc => tc.id === msg.tool_call_id)) {
        result.push(msg);
      }
    } else if (msg instanceof AIMessage) {
      result.push(msg);
    } else if (msg instanceof HumanMessage) {
      result.push(msg);
    }
  }

  while (result.length > 0) {
    const last = result[result.length - 1];

    if (last instanceof ToolMessage) break;

    if (last instanceof AIMessage && last.tool_calls?.length) {
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
        result.splice(aiIndex);
        continue;
      }
      break;
    }

    break;
  }

  return result;
}

// ===== Context assembly =====

const DIR_FILE_CAP = 30;
const IGNORED_DIRS = ["node_modules", "dist", "build", "coverage", "out", ".turbo"];

async function getRunningServerContext(sandbox: SandboxInstance): Promise<string> {
  try {
    const portResult = await sandbox.process.exec({
      command: `ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "no port info"`,
      waitForCompletion: true,
    });
    const portOutput = (portResult.stdout || "").trim();

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

    const root: Record<string, any> = {};
    for (const p of paths) {
      const rel = p.replace("/app/", "");
      const parts = rel.split("/");
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node[parts[i]]) node[parts[i]] = {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = null;
    }

    function renderTree(node: Record<string, any>, prefix: string): string[] {
      const entries = Object.keys(node).sort((a, b) => {
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
          fileCount++;
          if (fileCount <= DIR_FILE_CAP) {
            lines.push(`${prefix}${connector}${name}`);
          } else if (fileCount === DIR_FILE_CAP + 1) {
            const remaining = entries.filter((e, idx) => idx >= i && node[e] === null).length;
            lines.push(`${prefix}${connector}... (+${remaining} more files)`);
            break;
          }
        } else {
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

// ===== Output file collection =====

export async function collectOutputFiles(sandbox: SandboxInstance): Promise<OutputFile[]> {
  try {
    const listResult = await sandbox.process.exec({
      command: "find /app/outputs -type f 2>/dev/null",
      waitForCompletion: true,
    });
    const filePaths = (listResult.stdout || "")
      .split("\n")
      .map((p: string) => p.trim())
      .filter(Boolean);

    if (filePaths.length === 0) return [];

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

    await sandbox.process.exec({ command: "rm -rf /app/outputs/*", waitForCompletion: true });
    return outputFiles;
  } catch {
    return [];
  }
}

// ===== Main agent runner (pure — no DB dependency) =====

const MAX_ITERATIONS = 50;
const COMPACTION_THRESHOLD = 160_000; // trigger mid-run compaction at 160k estimated tokens

// LangGraph functional API tasks — auto-traced in LangSmith
const callLlm = task("callLlm", async (params: {
  modelWithTools: any;
  systemMsg: SystemMessage;
  messages: BaseMessage[];
  signal?: AbortSignal;
  onEvent: (event: ToolEvent) => void;
}) => {
  const { modelWithTools, systemMsg, messages, signal, onEvent } = params;

  const stream = await modelWithTools.stream(
    [systemMsg, ...messages],
    { signal }
  );

  let fullResponse: AIMessage | null = null;
  let hasToolCalls = false;

  for await (const chunk of stream) {
    if (signal?.aborted) break;

    if (chunk.tool_call_chunks?.length || chunk.tool_calls?.length) {
      hasToolCalls = true;
    }

    if (!hasToolCalls) {
      const token = typeof chunk.content === "string"
        ? chunk.content
        : Array.isArray(chunk.content)
          ? chunk.content.map((c: any) => c.text || "").join("")
          : "";
      if (token) {
        onEvent({ type: "token", content: token });
      }
    }

    if (!fullResponse) {
      fullResponse = chunk as unknown as AIMessage;
    } else {
      fullResponse = (fullResponse as any).concat(chunk) as AIMessage;
    }
  }

  return fullResponse;
});

const callTool = task("callTool", async (params: {
  toolCall: ToolCall;
  toolsByName: Record<string, any>;
  onEvent: (event: ToolEvent) => void;
  signal?: AbortSignal;
  supportsVision?: boolean;
}): Promise<{ toolMsg: ToolMessage; mediaMsg?: HumanMessage }> => {
  const { toolCall, toolsByName, onEvent, signal, supportsVision } = params;

  const toolDef = toolsByName[toolCall.name];
  if (!toolDef) {
    return {
      toolMsg: new ToolMessage({
        content: `Error: Unknown tool "${toolCall.name}"`,
        tool_call_id: toolCall.id!,
        name: toolCall.name,
      }),
    };
  }

  if (signal?.aborted) {
    return {
      toolMsg: new ToolMessage({
        content: "Aborted.",
        tool_call_id: toolCall.id!,
        name: toolCall.name,
      }),
    };
  }

  onEvent({ type: "tool_start", tool: toolCall.name, args: toolCall.args });

  try {
    // Race tool execution against abort signal
    const resultPromise = toolDef.invoke(toolCall);
    const result = signal
      ? await Promise.race([
          resultPromise,
          new Promise<never>((_, reject) => {
            if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          }),
        ])
      : await resultPromise;
    const resultContent = typeof result === "string" ? result : result?.content ?? String(result);

    let toolOutput = resultContent;
    let mediaMsg: HumanMessage | undefined;

    try {
      const parsed = JSON.parse(resultContent);
      if (parsed?.__image) {
        toolOutput = `[Image: ${parsed.path} (${(parsed.size / 1024).toFixed(1)} KB)]`;
        if (parsed.extraText) {
          toolOutput += `\n\n${parsed.extraText}`;
        }
        if (supportsVision) {
          mediaMsg = new HumanMessage({
            content: [
              { type: "text", text: `Here is the image from ${parsed.path}:` },
              {
                type: "image_url",
                image_url: {
                  url: `data:${parsed.mimeType};base64,${parsed.base64}`,
                },
              },
            ],
          });
        } else {
          toolOutput += "\n\n⚠️ Your current model does not support image input. You cannot see this image. Describe what you expected to see, or suggest the user switch to a vision-capable model (claude-sonnet, claude-haiku) if visual verification is needed.";
        }
      } else if (parsed?.__pdf) {
        toolOutput = `[PDF: ${parsed.path} (${(parsed.size / 1024).toFixed(1)} KB)]`;
        if (supportsVision) {
          mediaMsg = new HumanMessage({
            content: [
              { type: "text", text: `Here is the PDF document from ${parsed.path}:` },
              {
                type: "file",
                file: {
                  filename: parsed.path.split("/").pop() || "document.pdf",
                  file_data: `data:application/pdf;base64,${parsed.base64}`,
                },
              } as any,
            ],
          });
        } else {
          toolOutput += "\n\n⚠️ Your current model does not support PDF input. You cannot read this PDF. Use a text extraction tool or suggest the user switch to a vision-capable model (claude-sonnet, claude-haiku).";
        }
      }
    } catch {
      // Not JSON, regular tool output
    }

    onEvent({ type: "tool_end", tool: toolCall.name, output: toolOutput.slice(0, 200) });

    return {
      toolMsg: new ToolMessage({
        content: toolOutput,
        tool_call_id: toolCall.id!,
        name: toolCall.name,
      }),
      mediaMsg,
    };
  } catch (err: any) {
    if (err.name === "AbortError") throw err; // propagate abort up
    const errMsg = `Error: ${err.message}`;
    onEvent({ type: "tool_end", tool: toolCall.name, output: errMsg });
    return {
      toolMsg: new ToolMessage({
        content: errMsg,
        tool_call_id: toolCall.id!,
        name: toolCall.name,
      }),
    };
  }
});

export async function runAgentStream(
  sandbox: SandboxInstance,
  history: BaseMessage[],
  prompt: string,
  modelId: string,
  onEvent: (event: ToolEvent) => void,
  signal?: AbortSignal,
  previewUrl?: string,
  dbConfig?: DatabaseConfig,
  deployConfig?: DeployConfig,
): Promise<AgentResult> {
  const createModel = AVAILABLE_MODELS[modelId] || AVAILABLE_MODELS["claude-sonnet"];
  const model = createModel();
  const subagentConfig: SubagentConfig = {
    parentModelId: modelId,
    modelFactory: AVAILABLE_MODELS,
    previewUrl,
    onLog: (label, toolName, detail) => {
      onEvent({ type: "subagent_log", label, tool: toolName, detail });
    },
  };
  const tools = createTools(sandbox, (todos) => {
    onEvent({ type: "todo_update", todos });
  }, dbConfig, subagentConfig, deployConfig);
  const toolsByName: Record<string, any> = {};
  for (const t of tools) toolsByName[t.name] = t;
  const modelWithTools = (model as any).bindTools(tools);

  await sandbox.process.exec({ command: "mkdir -p /app/outputs", waitForCompletion: true });

  const [fileTree, serverContext] = await Promise.all([
    getFileTree(sandbox),
    getRunningServerContext(sandbox),
  ]);

  let systemPromptText = SYSTEM_PROMPT;
  if (previewUrl) systemPromptText += `\n\n## Sandbox Preview URL\nThe dev server's public preview URL is: ${previewUrl}\nALWAYS use this URL when taking screenshots of the app with url_fetch. Do NOT use localhost or internal sandbox URLs — they are not reachable by external tools.`;
  if (serverContext) systemPromptText += `\n\n${serverContext}`;
  if (fileTree) systemPromptText += `\n\n${fileTree}`;

  const systemMsg = new SystemMessage(systemPromptText);

  // Calculate fixed overhead: system prompt + tool schemas (sent with every LLM call but not in messages array)
  const systemPromptTokens = Math.ceil(systemPromptText.length / 4);
  const toolSchemaTokens = Math.ceil(tools.reduce((acc, t) => acc + (t.description?.length || 0) + JSON.stringify((t as any).schema?.shape || {}).length, 0) / 4);
  const overheadTokens = systemPromptTokens + toolSchemaTokens;

  // Track messages outside the entrypoint so we can recover them on abort
  let inputMessages = [...history, new HumanMessage(prompt)];

  // Pre-run compaction: if history is already too large, compact before starting
  let didPreRunCompact = false;
  const preRunTokens = estimateTokens(inputMessages, overheadTokens);
  if (preRunTokens > COMPACTION_THRESHOLD) {
    onEvent({ type: "token", content: `\n[Pre-run compaction: ~${Math.round(preRunTokens / 1000)}k tokens → compacting...]\n` });
    try {
      const { human, ai } = await compactHistory(inputMessages);
      inputMessages = [new HumanMessage(human), new AIMessage(ai), new HumanMessage(prompt)];
      didPreRunCompact = true;
      const newTokens = estimateTokens(inputMessages, overheadTokens);
      onEvent({ type: "token", content: `[Compacted: ~${Math.round(preRunTokens / 1000)}k → ~${Math.round(newTokens / 1000)}k tokens]\n` });
    } catch (compactErr: any) {
      onEvent({ type: "token", content: `[Pre-run compaction failed: ${compactErr.message} — continuing with full context]\n` });
    }
  }

  let capturedMessages: BaseMessage[] = [...inputMessages];

  const agent = entrypoint("agent", async (messages: BaseMessage[]) => {
    let lastContent = "";
    let pendingMedia: HumanMessage | null = null;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (signal?.aborted) break;

      // If there's a pending media message from a previous tool call, prepend it
      const llmMessages = pendingMedia ? [...messages, pendingMedia] : messages;
      pendingMedia = null;

      const fullResponse = await callLlm({ modelWithTools, systemMsg, messages: llmMessages, signal, onEvent });
      if (!fullResponse) break;

      // Extract text content
      if (fullResponse.content) {
        lastContent = typeof fullResponse.content === "string"
          ? fullResponse.content
          : Array.isArray(fullResponse.content)
            ? fullResponse.content.map((c: any) => c.text || "").join("")
            : "";
      }

      messages = addMessages(messages, [fullResponse]);
      capturedMessages = [...messages];

      if (!fullResponse.tool_calls?.length) break;

      // Execute tools
      const results = await Promise.all(
        fullResponse.tool_calls.map((tc) => callTool({ toolCall: tc, toolsByName, onEvent, signal, supportsVision: VISION_MODELS.has(modelId) }))
      );

      const toolMsgs = results.map((r) => r.toolMsg);
      const mediaMsgs = results.filter((r) => r.mediaMsg).map((r) => r.mediaMsg!);

      messages = addMessages(messages, toolMsgs);
      capturedMessages = [...messages];

      // Keep only the latest media message — pass it to the next LLM call
      // but don't add it to the persisted message history (avoids breaking tool_use pairing)
      if (mediaMsgs.length > 0) {
        pendingMedia = mediaMsgs[mediaMsgs.length - 1];
      }

      // Mid-run compaction: check token usage before next LLM call
      const currentTokens = estimateTokens(messages, overheadTokens);
      if (currentTokens > COMPACTION_THRESHOLD) {
        onEvent({ type: "token", content: `\n[Mid-run compaction: ~${Math.round(currentTokens / 1000)}k tokens → compacting...]\n` });
        try {
          const { human, ai } = await compactHistory(messages);
          // End with a HumanMessage so models that don't support assistant prefill still work
          messages = [
            new HumanMessage(human),
            new AIMessage(ai),
            new HumanMessage("Continue working on the task. Pick up where you left off. If there is a task list in the context above, restore it with the todowrite tool first, then continue."),
          ];
          capturedMessages = [...messages];
          // Drop pending media — it referenced pre-compaction context
          pendingMedia = null;
          const newTokens = estimateTokens(messages, overheadTokens);
          onEvent({ type: "token", content: `[Compacted: ~${Math.round(currentTokens / 1000)}k → ~${Math.round(newTokens / 1000)}k tokens]\n` });
        } catch (compactErr: any) {
          onEvent({ type: "token", content: `[Compaction failed: ${compactErr.message} — continuing with full context]\n` });
        }
      }
    }

    return { messages, lastContent };
  });

  try {
    const result = await agent.invoke(inputMessages);

    const startIdx = didPreRunCompact ? 0 : history.length;
    const newMessages = result.messages.slice(startIdx);
    const contextTokens = estimateTokens(result.messages, overheadTokens);

    onEvent({ type: "result", content: result.lastContent, contextTokens });

    return {
      newMessages,
      lastContent: result.lastContent,
      contextTokens,
      ...(didPreRunCompact && { compactedHistory: result.messages }),
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      // Build partial result from captured messages
      let partialMessages = capturedMessages.slice(history.length);

      // If the last message is an AI message with tool_calls that have no responses,
      // add stub ToolMessages so the history remains valid for the LLM
      const last = partialMessages[partialMessages.length - 1];
      if (last instanceof AIMessage && last.tool_calls?.length) {
        const answeredIds = new Set(
          partialMessages
            .filter((m): m is ToolMessage => m instanceof ToolMessage)
            .map(m => m.tool_call_id)
        );
        for (const tc of last.tool_calls) {
          if (!answeredIds.has(tc.id!)) {
            partialMessages.push(new ToolMessage({
              content: "[Aborted by user]",
              tool_call_id: tc.id!,
              name: tc.name,
            }));
          }
        }
      }

      // Append an AI message so the agent knows the previous run was aborted
      partialMessages.push(new AIMessage("[Task aborted by user]"));

      const contextTokens = estimateTokens([...history, ...partialMessages], overheadTokens);
      onEvent({ type: "result", content: "", contextTokens });

      return { newMessages: partialMessages, lastContent: "", contextTokens, aborted: true };
    }

    // For any other error, save partial messages so history isn't lost
    let partialMessages = capturedMessages.slice(history.length);

    if (partialMessages.length > 0) {
      // Add stub ToolMessages for unanswered tool calls
      const last = partialMessages[partialMessages.length - 1];
      if (last instanceof AIMessage && last.tool_calls?.length) {
        const answeredIds = new Set(
          partialMessages
            .filter((m): m is ToolMessage => m instanceof ToolMessage)
            .map(m => m.tool_call_id)
        );
        for (const tc of last.tool_calls) {
          if (!answeredIds.has(tc.id!)) {
            partialMessages.push(new ToolMessage({
              content: `[Error: ${err.message}]`,
              tool_call_id: tc.id!,
              name: tc.name,
            }));
          }
        }
      }

      partialMessages.push(new AIMessage(`[Task interrupted by error: ${err.message}]`));

      const contextTokens = estimateTokens([...history, ...partialMessages], overheadTokens);
      onEvent({ type: "error", content: err.message });
      onEvent({ type: "result", content: "", contextTokens });

      return { newMessages: partialMessages, lastContent: "", contextTokens, aborted: true };
    }

    throw err;
  }
}
