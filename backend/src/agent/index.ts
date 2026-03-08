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
import type { Sandbox } from "@daytonaio/sdk";
import { createTools } from "./tools.js";

const openRouterConfig = {
  model: "",
  temperature: 0.8,
  streaming: true,
  apiKey: process.env.OPEN_ROUTER,
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://agent-vas.dev",
      "X-OpenRouter-Title": "Agent VAS",
    },
  },
};

const AVAILABLE_MODELS: Record<string, () => BaseChatModel> = {
  "claude-sonnet": () =>
    new ChatOpenAI({
      ...openRouterConfig,
      model: "anthropic/claude-sonnet-4.6",
    }),
  "claude-haiku": () =>
    new ChatOpenAI({
      ...openRouterConfig,
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

The working directory is /home/daytona. Always use absolute paths.

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
- For Next.js: npm run dev -- -H 0.0.0.0
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

# File Delivery — /home/daytona/outputs
When the user asks you to produce, generate, export, or "give" them a file (code, HTML, images, configs, etc.), **copy** the file to \`/home/daytona/outputs/\` so it can be delivered to the user's browser for download.
- The outputs folder is created automatically before each run.
- Always **copy** (not move) — keep the original file in place.
- Use: \`cp /path/to/file /home/daytona/outputs/\`
- At the end of the task, briefly mention which files were placed in outputs so the user knows what to expect.`;

const TOKEN_LIMIT = 200_000; // trigger compaction at 200k tokens

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
}

// In-memory conversation history per agent
const histories = new Map<string, BaseMessage[]>();

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
    // Count tool_calls on AIMessages
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

  return [new AIMessage(`## Previous Conversation Context (compacted)\n\n${summary}`)];
}

const DIR_FILE_CAP = 30;
const IGNORED_DIRS = ["node_modules", "dist", "build", "coverage", "out", ".turbo"];

async function getFileTree(sandbox: Sandbox): Promise<string> {
  try {
    const ignored = IGNORED_DIRS.map((d) => `-not -path "*/${d}/*"`).join(" ");
    const result = await sandbox.process.executeCommand(
      `find /home/daytona -type f -not -path "*/.*" ${ignored} 2>/dev/null | sort`
    );
    const paths = (result.result || "").split("\n").map((p) => p.trim()).filter(Boolean);
    if (paths.length === 0) return "";

    // Group files by directory
    const dirMap = new Map<string, string[]>();
    for (const p of paths) {
      const dir = p.substring(0, p.lastIndexOf("/")) || "/";
      if (!dirMap.has(dir)) dirMap.set(dir, []);
      dirMap.get(dir)!.push(p.substring(p.lastIndexOf("/") + 1));
    }

    // Build tree lines with per-dir cap
    const lines: string[] = ["<project_structure>"];
    for (const [dir, files] of dirMap) {
      const displayDir = dir.replace("/home/daytona/", "").replace("/home/daytona", ".") || ".";
      lines.push(`${displayDir}/`);
      const shown = files.slice(0, DIR_FILE_CAP);
      for (const f of shown) lines.push(`  ${f}`);
      if (files.length > DIR_FILE_CAP) {
        lines.push(`  {+${files.length - DIR_FILE_CAP} more}`);
      }
    }
    lines.push("</project_structure>");
    return lines.join("\n");
  } catch {
    return "";
  }
}

export async function runAgentStream(
  sandbox: Sandbox,
  agentId: string,
  prompt: string,
  modelId: string,
  onEvent: (event: ToolEvent) => void,
  signal?: AbortSignal,
  savedMessages?: { role: "user" | "assistant"; content: string }[]
) {
  const createModel = AVAILABLE_MODELS[modelId] || AVAILABLE_MODELS["claude-sonnet"];
  const model = createModel();

  const tools = createTools(sandbox);

  // Ensure outputs folder exists
  await sandbox.process.executeCommand("mkdir -p /home/daytona/outputs");

  // Prepend live file tree to every user message
  const fileTree = await getFileTree(sandbox);
  const promptWithContext = fileTree
    ? `${fileTree}\n\n${prompt}`
    : prompt;

  const agent = createReactAgent({
    llm: model,
    tools,
    messageModifier: new SystemMessage(SYSTEM_PROMPT),
  });

  // Build message list: past history + new user message
  let history = histories.get(agentId) || [];

  // If in-memory history is empty but we have saved messages (e.g. server restart or model switch),
  // reconstruct history from persisted chat so the agent has full conversation context
  if (history.length === 0 && savedMessages && savedMessages.length > 0) {
    history = savedMessages.map((m) =>
      m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)
    );
    histories.set(agentId, history);
    console.log(`[agent ${agentId}] Seeded history from ${savedMessages.length} saved messages`);
  }

  // Check if history exceeds token limit — compact if needed
  const tokenCount = estimateTokens(history);
  if (tokenCount >= TOKEN_LIMIT) {
    console.log(`[agent ${agentId}] History at ${tokenCount} tokens, compacting...`);
    history = await compactHistory(history);
    histories.set(agentId, history);
  }

  const userMsg = new HumanMessage(promptWithContext);
  const inputMessages = [...history, userMsg];

  // Stream events for the UI (tool indicators) and collect all messages
  const stream = await agent.streamEvents(
    { messages: inputMessages },
    { version: "v2", recursionLimit: 50, signal }
  );

  let lastContent = "";
  let allNewMessages: BaseMessage[] = [];

  for await (const event of stream) {
    if (signal?.aborted) break;

    if (event.event === "on_tool_start") {
      onEvent({
        type: "tool_start",
        tool: event.name,
        args: event.data?.input,
      });
    } else if (event.event === "on_tool_end") {
      const output = event.data?.output;
      const text = typeof output === "string" ? output : output?.content ?? "";
      const outputStr = typeof text === "string" ? text : "";
      // Send full output for preview_url so frontend can extract the URL
      const limit = event.name === "preview_url" ? 500 : 200;
      onEvent({
        type: "tool_end",
        tool: event.name,
        output: outputStr.slice(0, limit),
      });
    } else if (event.event === "on_chain_end" && event.name === "LangGraph") {
      // Final event from the graph — contains all messages including tool calls
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

  // Store the full message chain (includes user msg, AI msgs with tool_calls, ToolMessages, final AI response)
  // allNewMessages contains the complete list from the graph run (input + generated)
  // We only want the new messages (skip the ones we sent as input)
  const newOnly = allNewMessages.slice(inputMessages.length);
  if (newOnly.length > 0) {
    histories.set(agentId, [...history, userMsg, ...newOnly]);
  } else {
    // Fallback if we didn't get the full chain
    histories.set(agentId, [...history, userMsg, new AIMessage(lastContent)]);
  }

  onEvent({ type: "result", content: lastContent });

  // Fetch output files from sandbox and emit to frontend
  try {
    const listResult = await sandbox.process.executeCommand(
      "find /home/daytona/outputs -type f 2>/dev/null"
    );
    const filePaths = (listResult.result || "")
      .split("\n")
      .map((p: string) => p.trim())
      .filter(Boolean);

    if (filePaths.length > 0) {
      const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
      const outputFiles: OutputFile[] = [];

      for (const filePath of filePaths) {
        const sizeResult = await sandbox.process.executeCommand(
          `stat -c%s "${filePath}" 2>/dev/null || stat -f%z "${filePath}" 2>/dev/null`
        );
        const size = parseInt((sizeResult.result || "0").trim(), 10);
        if (size > MAX_FILE_SIZE || size === 0) continue;

        const b64Result = await sandbox.process.executeCommand(
          `base64 "${filePath}"`
        );
        const b64 = (b64Result.result || "").trim();
        if (!b64) continue;

        const name = filePath.split("/").pop() || filePath;
        const relativePath = filePath.replace("/home/daytona/outputs/", "");

        outputFiles.push({ name, path: relativePath, content: b64, size });
      }

      if (outputFiles.length > 0) {
        onEvent({ type: "outputs", files: outputFiles });
      }

      // Clear outputs folder for next run
      await sandbox.process.executeCommand("rm -rf /home/daytona/outputs/*");
    }
  } catch {
    // Ignore errors fetching outputs
  }
}
