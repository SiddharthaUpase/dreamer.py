import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { SandboxInstance } from "@blaxel/core";
import FirecrawlApp from "@mendable/firecrawl-js";
import { neon } from "@neondatabase/serverless";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { deploy } from "../services/deploy.js";

// ===== Todo types =====
export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
}

export type OnTodoUpdate = (todos: TodoItem[]) => void;

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff"]);
const PDF_EXTENSIONS = new Set([".pdf"]);

// Text-readable file extensions — anything not in this set, images, or PDFs will be rejected
const TEXT_EXTENSIONS = new Set([
  // Code
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".scala", ".c", ".cpp", ".cc", ".h", ".hpp",
  ".cs", ".php", ".swift", ".m", ".mm", ".r", ".R", ".lua", ".pl", ".pm", ".sh", ".bash", ".zsh",
  ".fish", ".ps1", ".bat", ".cmd", ".zig", ".nim", ".ex", ".exs", ".erl", ".hrl", ".clj", ".cljs",
  ".dart", ".v", ".vhdl", ".verilog", ".asm", ".s", ".f90", ".f95", ".jl",
  // Web
  ".html", ".htm", ".css", ".scss", ".sass", ".less", ".vue", ".svelte", ".astro",
  // Data / Config
  ".json", ".yaml", ".yml", ".toml", ".xml", ".csv", ".tsv", ".ini", ".cfg", ".conf",
  ".env", ".env.local", ".env.example", ".properties",
  // Docs / Text
  ".md", ".mdx", ".txt", ".rst", ".tex", ".org", ".adoc",
  // Build / DevOps
  ".dockerfile", ".dockerignore", ".gitignore", ".gitattributes", ".editorconfig",
  ".eslintrc", ".prettierrc", ".babelrc", ".npmrc", ".nvmrc",
  // SQL
  ".sql",
  // Other
  ".graphql", ".gql", ".proto", ".prisma", ".tf", ".hcl",
  ".lock", ".log", ".patch", ".diff",
]);

// Files with no extension that are commonly text
const TEXT_FILENAMES = new Set([
  "Makefile", "Dockerfile", "Vagrantfile", "Gemfile", "Rakefile", "Procfile",
  "LICENSE", "CHANGELOG", "README", "CODEOWNERS", ".gitignore", ".dockerignore",
]);

export function isImagePath(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export function isPdfPath(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return PDF_EXTENSIONS.has(ext);
}

export function isTextReadable(filePath: string): boolean {
  const basename = filePath.slice(filePath.lastIndexOf("/") + 1);
  if (TEXT_FILENAMES.has(basename)) return true;
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (ext === basename.toLowerCase()) return true; // no extension
  return TEXT_EXTENSIONS.has(ext);
}

export function detectMimeFromBytes(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  if (buf[0] === 0x42 && buf[1] === 0x4D) return "image/bmp";
  return null;
}

export function getMimeType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const mimes: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".tiff": "image/tiff",
    ".pdf": "application/pdf",
  };
  return mimes[ext] || "image/png";
}


// Check if the dev server process is still running
async function checkDevServer(sandbox: SandboxInstance): Promise<string> {
  try {
    const info = await sandbox.process.get("dev-server");
    if (info.status === "running") {
      return "";
    }
    const stderr = (info.stderr || "").slice(-500);
    return `\n\n⚠️ DEV SERVER CRASHED (status: ${info.status}, exit code: ${info.exitCode}). Recent stderr:\n${stderr}\nYou should fix the error and restart with: bash tool → cd /app && npm run dev -- --port 3000 &`;
  } catch {
    return "\n\n⚠️ DEV SERVER IS NOT RUNNING. Start it with: bash tool → cd /app && npm run dev -- --port 3000 &";
  }
}

const TODO_DESCRIPTION = `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multistep tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos. Feel free to edit the todo list based on new information.
6. After completing a task - Mark it complete and add any new follow-up tasks
7. When you start working on a new task, mark the todo as in_progress. Ideally you should only have one todo as in_progress at a time. Complete existing tasks before starting new ones.

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully
   - cancelled: Task no longer needed

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Only have ONE task in_progress at any time
   - Complete current tasks before starting new ones
   - Cancel tasks that become irrelevant

3. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.`;


const DEFAULT_TIMEOUT = 60_000; // 1 minute

function withTimeout<T>(promise: Promise<T>, ms = DEFAULT_TIMEOUT): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Tool timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

export interface DatabaseConfig {
  connectionString: string;
}

export interface DeployConfig {
  projectName: string;
  vercelToken: string;
  vercelTeamId?: string;
  envVars?: Record<string, string>;
}

// ===== Subagent types =====
export type SubagentLogFn = (label: string, tool: string, detail: string) => void;

export interface SubagentConfig {
  parentModelId: string;
  modelFactory: Record<string, () => BaseChatModel>;
  previewUrl?: string;
  onLog?: SubagentLogFn;
}

const SUBAGENT_TYPES: Record<string, { prompt: string; tools: string[] }> = {
  explore: {
    prompt:
      "You are a codebase explorer. Your ONLY job is to find and understand code.\n\n" +
      "You can read files, search file contents with grep, and find files by pattern with glob. " +
      "You CANNOT create, modify, or delete any files.\n\n" +
      "Work efficiently:\n" +
      "- Use glob to find files by name pattern\n" +
      "- Use grep to search for specific code patterns\n" +
      "- Use read to examine file contents\n" +
      "- Make multiple tool calls in parallel when possible\n\n" +
      "Return a clear, structured summary of what you found. Include file paths and " +
      "relevant code snippets. Do not speculate — only report what you actually see in the code.",
    tools: ["read", "grep", "glob"],
  },
  research: {
    prompt:
      "You are a research assistant. Your job is to find information from the web and the codebase to answer questions.\n\n" +
      "You can search the web, fetch and read web pages, read files, and search code. " +
      "You CANNOT create or modify files.\n\n" +
      "Work efficiently:\n" +
      "- Use web_search to find relevant URLs\n" +
      "- Use url_fetch to read documentation and articles\n" +
      "- Use grep/glob/read to check the existing codebase for context\n" +
      "- Make multiple tool calls in parallel when possible\n\n" +
      "Return specific, actionable findings. Include code examples from documentation when relevant. " +
      "Cite URLs for any external information.",
    tools: ["read", "grep", "glob", "web_search", "url_fetch"],
  },
  execute: {
    prompt:
      "You are a task executor. Your job is to complete the assigned task using all available tools.\n\n" +
      "You can run shell commands, read/write/edit files, search code, and run SQL queries on the database.\n\n" +
      "Work efficiently:\n" +
      "- Read files before editing them\n" +
      "- Run builds/tests after making changes to verify they work\n" +
      "- Make multiple tool calls in parallel when possible\n\n" +
      "Return a concise summary of what you did and the outcome. List any files you created or modified.",
    tools: ["bash", "read", "write", "edit", "grep", "glob", "run_sql"],
  },
};

const SUBAGENT_MAX_ITERATIONS = 30;

const WORK_DIR = "/app";

export function createTools(sandbox: SandboxInstance, onTodoUpdate?: OnTodoUpdate, dbConfig?: DatabaseConfig, subagentConfig?: SubagentConfig, deployConfig?: DeployConfig) {
  const exec = async (command: string): Promise<string> => {
    const result = await sandbox.process.exec({ command, workingDir: WORK_DIR, waitForCompletion: true });
    return result.exitCode !== 0
      ? `Error (exit ${result.exitCode}): ${result.stderr || result.stdout || ""}`
      : result.stdout || "";
  };

  // After write/edit to app files, check if the dev server is still alive
  async function withServerCheck(result: string, path: string): Promise<string> {
    if (!path.startsWith("/app/")) return result;
    // Small delay to let Next.js process the file change
    await new Promise((r) => setTimeout(r, 1500));
    const serverStatus = await checkDevServer(sandbox);
    return result + serverStatus;
  }

  const bash = tool(
    async ({ command, timeout }) => {
      const timeoutMs = (timeout || 60) * 1000;
      try {
        const result = await Promise.race([
          sandbox.process.exec({ command, workingDir: WORK_DIR, waitForCompletion: true }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timed out after ${timeout || 60}s`)), timeoutMs)
          ),
        ]);
        return result.exitCode !== 0
          ? `Error (exit ${result.exitCode}): ${result.stderr || result.stdout || ""}`
          : result.stdout || "";
      } catch (error: any) {
        return `Error: ${error.message}`;
      }
    },
    {
      name: "bash",
      description:
        "Executes a given bash command in the sandbox environment with optional timeout.\n\n" +
        "IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) — use the specialized tools instead.\n\n" +
        "Before executing the command, follow these steps:\n" +
        "1. Directory Verification: If the command will create new directories or files, first verify the parent directory exists.\n" +
        "2. Always quote file paths that contain spaces with double quotes.\n\n" +
        "Usage notes:\n" +
        "- Avoid using bash with find, grep, cat, head, tail, sed, awk, or echo commands. Instead use the dedicated tools:\n" +
        "  - File search: Use glob (NOT find or ls)\n" +
        "  - Content search: Use grep (NOT grep or rg)\n" +
        "  - Read files: Use read (NOT cat/head/tail)\n" +
        "  - Edit files: Use edit (NOT sed/awk)\n" +
        "  - Write files: Use write (NOT echo >/cat <<EOF)\n" +
        "- When issuing multiple commands:\n" +
        "  - If independent, make multiple bash calls in parallel.\n" +
        "  - If dependent, chain with && in a single call.\n" +
        "  - Use ; only when you need sequential execution but don't care if earlier commands fail.\n" +
        "  - DO NOT use newlines to separate commands.",
      schema: z.object({
        command: z.string().describe("The bash command to execute"),
        timeout: z.number().optional().describe("Timeout in seconds (default: 60)"),
      }),
    }
  );

  const read = tool(
    async ({ path, offset, limit }) => {
      // === Image files ===
      if (isImagePath(path)) {
        try {
          const MAX_RAW_SIZE = 10 * 1024 * 1024;
          const MAX_API_SIZE = 1 * 1024 * 1024;

          const blob = await sandbox.fs.readBinary(path);
          let buffer = Buffer.from(await blob.arrayBuffer());
          const originalSize = buffer.length;

          if (originalSize > MAX_RAW_SIZE) {
            return `[Image: ${path} (${(originalSize / 1024 / 1024).toFixed(1)} MB)] — Too large (max 10MB).`;
          }

          if (originalSize > MAX_API_SIZE) {
            const resizedPath = "/tmp/_resized_preview.jpg";
            const scriptB64 = Buffer.from(JSON.stringify({ input: path, output: resizedPath })).toString("base64");
            const resizeCmd =
              `node -e "const a=JSON.parse(Buffer.from('${scriptB64}','base64').toString());` +
              `let s;try{s=require('sharp')}catch{process.exit(1)}` +
              `s(a.input).resize({width:1024,height:1024,fit:'inside'}).jpeg({quality:80}).toFile(a.output).then(()=>console.log('ok')).catch(()=>process.exit(1))"`;
            const resizeResult = await sandbox.process.exec({ command: resizeCmd, waitForCompletion: true });

            if (resizeResult.exitCode === 0) {
              const resizedBlob = await sandbox.fs.readBinary(resizedPath);
              buffer = Buffer.from(await resizedBlob.arrayBuffer());
            }
          }

          const b64 = buffer.toString("base64");
          const mime = originalSize > MAX_API_SIZE && buffer.length < originalSize
            ? "image/jpeg"
            : detectMimeFromBytes(buffer) || getMimeType(path);
          return JSON.stringify({ __image: true, path, mimeType: mime, base64: b64, size: buffer.length });
        } catch (err: any) {
          return `Error reading image: ${err.message}`;
        }
      }

      // === PDF files ===
      if (isPdfPath(path)) {
        try {
          const MAX_PDF_SIZE = 30 * 1024 * 1024; // 30MB cap (Anthropic supports up to 32MB)
          const blob = await sandbox.fs.readBinary(path);
          const buffer = Buffer.from(await blob.arrayBuffer());

          if (buffer.length > MAX_PDF_SIZE) {
            return `[PDF: ${path} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)] — Too large (max 30MB).`;
          }

          const b64 = buffer.toString("base64");
          return JSON.stringify({ __pdf: true, path, base64: b64, size: buffer.length });
        } catch (err: any) {
          return `Error reading PDF: ${err.message}`;
        }
      }

      // === Guardrail: reject unsupported binary files ===
      if (!isTextReadable(path)) {
        const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
        return `Error: Cannot read '${ext}' files — unsupported binary format. Supported types: text/code files, images (png/jpg/gif/webp), and PDFs.`;
      }

      // === Text files ===
      let command = `cat -n "${path}"`;
      if (offset && limit) {
        command = `cat -n "${path}" | tail -n +${offset} | head -n ${limit}`;
      } else if (offset) {
        command = `cat -n "${path}" | tail -n +${offset}`;
      } else if (limit) {
        command = `cat -n "${path}" | head -n ${limit}`;
      }
      return await exec(command);
    },
    {
      name: "read",
      description:
        "Read a file from the local filesystem. If the path does not exist, an error is returned.\n\n" +
        "Usage:\n" +
        "- The path parameter should be an absolute path.\n" +
        "- By default, this tool returns up to 2000 lines from the start of the file.\n" +
        "- The offset parameter is the line number to start from (1-indexed).\n" +
        "- To read later sections, call this tool again with a larger offset.\n" +
        "- Use the grep tool to find specific content in large files.\n" +
        "- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.\n" +
        "- Contents are returned with each line prefixed by its line number as '<line_number>\\t<content>'.\n" +
        "- Any line longer than 2000 characters is truncated.\n" +
        "- Call this tool in parallel when you know there are multiple files you want to read.\n" +
        "- Avoid tiny repeated slices (30 line chunks). If you need more context, read a larger window.\n" +
        "- This tool can read image files (png, jpg, jpeg, gif, webp) and PDFs — they are returned directly so you can see them.\n" +
        "- Only supports text/code files, images, and PDFs — unsupported binary files will return an error.\n" +
        "- IMPORTANT: You MUST read a file before editing or overwriting it — never guess at file contents.",
      schema: z.object({
        path: z.string().describe("Absolute path to the file"),
        offset: z.number().optional().describe("Line number to start reading from (1-indexed)"),
        limit: z.number().optional().describe("Maximum number of lines to read"),
      }),
    }
  );

  const write = tool(
    async ({ path, content }) => {
      const b64 = Buffer.from(
        JSON.stringify({ path, content })
      ).toString("base64");
      const script =
        `node -e "const a=JSON.parse(Buffer.from('${b64}','base64').toString());` +
        `const p=require('path');const fs=require('fs');` +
        `fs.mkdirSync(p.dirname(a.path),{recursive:true});` +
        `fs.writeFileSync(a.path,a.content);` +
        `console.log('Successfully wrote to '+a.path+' ('+a.content.length+' chars)')"`;
      const result = await exec(script);
      return await withServerCheck(result, path);
    },
    {
      name: "write",
      description:
        "Writes a file to the local filesystem. Creates parent directories automatically.\n\n" +
        "Usage:\n" +
        "- This tool will overwrite the existing file if there is one at the provided path.\n" +
        "- If this is an existing file, you MUST use the read tool first to read the file's contents. This tool will fail if you did not read the file first.\n" +
        "- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n" +
        "- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the user.\n" +
        "- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.",
      schema: z.object({
        path: z.string().describe("Absolute path to the file"),
        content: z.string().describe("The complete file content to write"),
      }),
    }
  );

  const edit = tool(
    async ({ path, old_string, new_string }) => withTimeout((async () => {
      const argsB64 = Buffer.from(
        JSON.stringify({ path, oldStr: old_string, newStr: new_string })
      ).toString("base64");
      const script =
        `node -e "const a=JSON.parse(Buffer.from('${argsB64}','base64').toString());` +
        `const fs=require('fs');` +
        `const c=fs.readFileSync(a.path,'utf8');` +
        `if(!c.includes(a.oldStr)){console.error('Error: Could not find the specified text');process.exit(1)}` +
        `fs.writeFileSync(a.path,c.replace(a.oldStr,a.newStr));` +
        `console.log('File edited successfully')"`;
      const result = await exec(script);
      return await withServerCheck(result, path);
    })()),
    {
      name: "edit",
      description:
        "Performs exact string replacements in files.\n\n" +
        "Usage:\n" +
        "- You must use the read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.\n" +
        "- When editing text from read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.\n" +
        "- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n" +
        "- The edit will FAIL if old_string is not found in the file.\n" +
        "- If old_string matches multiple locations, provide more surrounding context lines to make it unique.\n" +
        "- Only use emojis if the user explicitly requests it.",
      schema: z.object({
        path: z.string().describe("Absolute path to the file"),
        old_string: z.string().describe("The exact text to find and replace. Must match the file content exactly including whitespace and indentation"),
        new_string: z.string().describe("The replacement text"),
      }),
    }
  );

  const grep = tool(
    async ({ pattern, path, include }) => withTimeout((async () => {
      let command = `grep -rn "${pattern}" "${path}"`;
      if (include) command = `grep -rn --include="${include}" "${pattern}" "${path}"`;
      command += " | head -100";
      return await exec(command);
    })()),
    {
      name: "grep",
      description:
        "Fast content search tool that works with any codebase size.\n" +
        "- Searches file contents using regular expressions.\n" +
        "- Supports full regex syntax (e.g., 'log.*Error', 'function\\s+\\w+').\n" +
        "- Filter files by pattern with the include parameter (e.g., '*.js', '*.{ts,tsx}').\n" +
        "- Returns file paths and line numbers with at least one match (up to 100 results).\n" +
        "- Use this tool when you need to find files containing specific patterns.\n" +
        "- Do NOT use bash grep or bash rg — use this tool instead.",
      schema: z.object({
        pattern: z.string().describe("Regex pattern to search for"),
        path: z.string().describe("Absolute path to directory or file to search in"),
        include: z.string().optional().describe("File glob pattern to filter (e.g., '*.ts', '*.{js,jsx}')"),
      }),
    }
  );

  const glob = tool(
    async ({ pattern, path }) => withTimeout((async () => {
      const command = `find "${path}" -type f -name "${pattern}" | head -100`;
      return await exec(command);
    })()),
    {
      name: "glob",
      description:
        "Fast file pattern matching tool that works with any codebase size.\n" +
        "- Supports glob patterns like '*.js' or '*.ts'.\n" +
        "- Returns matching file paths sorted by modification time (up to 100 results).\n" +
        "- Use this tool when you need to find files by name patterns.\n" +
        "- It is always better to speculatively perform multiple searches as a batch that are potentially useful.\n" +
        "- Do NOT use bash find — use this tool instead.",
      schema: z.object({
        pattern: z.string().describe("File name glob pattern (e.g., '*.ts', 'package.json', '*.test.*')"),
        path: z.string().describe("Absolute path to directory to search in"),
      }),
    }
  );

  let screenshotCount = 0;
  let todos: TodoItem[] = [];

  const todowrite = tool(
    async ({ todos: newTodos }) => {
      todos = newTodos;
      if (onTodoUpdate) onTodoUpdate(todos);
      const pending = todos.filter((t) => t.status === "pending").length;
      const inProgress = todos.filter((t) => t.status === "in_progress").length;
      const completed = todos.filter((t) => t.status === "completed").length;
      return `Todo list updated: ${completed} completed, ${inProgress} in progress, ${pending} pending.\n${JSON.stringify(todos, null, 2)}`;
    },
    {
      name: "todowrite",
      description: TODO_DESCRIPTION,
      schema: z.object({
        todos: z.array(z.object({
          content: z.string().describe("Brief description of the task"),
          status: z.enum(["pending", "in_progress", "completed", "cancelled"]).describe("Current status of the task"),
          priority: z.enum(["high", "medium", "low"]).describe("Priority level of the task"),
        })).describe("The complete updated todo list"),
      }),
    }
  );

  // ===== Firecrawl-powered web tools =====
  const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY || "" });

  const webSearch = tool(
    async ({ query, limit }) => withTimeout((async () => {
      try {
        const result = await firecrawl.v1.search(query, { limit: limit || 10 });
        if (!result.success || !result.data?.length) {
          return "No results found.";
        }
        return result.data
          .map((r: any, i: number) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description || ""}`)
          .join("\n\n");
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    })()),
    {
      name: "web_search",
      description:
        "Search the web for information. Returns titles, URLs, and descriptions.\n" +
        "- Use this to find documentation, tutorials, API references, or any web information.\n" +
        "- Returns up to 5 results by default.\n" +
        "- Use url_fetch on the returned URLs to read the full page content.",
      schema: z.object({
        query: z.string().describe("The search query"),
        limit: z.number().optional().describe("Max results to return (default: 10)"),
      }),
    }
  );

  const urlFetch = tool(
    async ({ url, formats }) => withTimeout((async () => {
      try {
        const requestedFormats = formats || ["markdown"];
        const hasScreenshot = requestedFormats.includes("screenshot");
        const hasFullPageScreenshot = requestedFormats.includes("screenshot@fullPage");
        const wantsScreenshot = hasScreenshot || hasFullPageScreenshot;
        // When screenshot is requested, use actions with viewport instead of the formats screenshot
        // This gives us control over viewport size and avoids cached screenshots
        const firecrawlFormats = requestedFormats
          .filter((f: string) => f !== "screenshot" && f !== "screenshot@fullPage")
          .map((f: string) => f === "html" ? "rawHtml" : f);
        // Firecrawl needs at least one format — add markdown as a silent fallback
        const markdownIsFallback = firecrawlFormats.length === 0;
        if (markdownIsFallback) firecrawlFormats.push("markdown");
        const result = await firecrawl.v1.scrapeUrl(url, {
          formats: firecrawlFormats as any,
          maxAge: 0,
          ...(wantsScreenshot && {
            actions: [
              {
                type: "screenshot" as const,
                fullPage: hasFullPageScreenshot,
                viewport: { width: 1440, height: 900 },
              },
            ],
          }),
        } as any);
        if (!result.success) {
          return `Error: Failed to fetch ${url}`;
        }

        const parts: string[] = [];

        // Markdown content (skip if it was just a fallback format)
        if (result.markdown && !markdownIsFallback) {
          let md = result.markdown;
          if (md.length > 20000) {
            md = md.substring(0, 20000) + "\n\n... [truncated — page too long]";
          }
          parts.push(md);
        }

        // Summary
        if ((result as any).summary) {
          parts.push(`## Summary\n${(result as any).summary}`);
        }

        // HTML (raw)
        if ((result as any).rawHtml) {
          const rawHtml = (result as any).rawHtml;
          if (rawHtml.length > 5000) {
            const tmpPath = `/app/.tmp/fetched-${Date.now()}.html`;
            await sandbox.process.exec({ command: "mkdir -p /app/.tmp", waitForCompletion: true });
            await sandbox.fs.write(tmpPath, rawHtml);
            parts.push(`## HTML\nContent is ${rawHtml.length} chars. Saved to ${tmpPath} — use the read tool to inspect it.`);
          } else {
            parts.push(`## HTML\n${rawHtml}`);
          }
        }

        // Screenshot — check actions.screenshots first, then fallback to result.screenshot
        const screenshotUrl =
          (result as any).actions?.screenshots?.[0] || result.screenshot;
        if (screenshotUrl) {
          try {
            const resp = await fetch(screenshotUrl);
            let buf = Buffer.from(await resp.arrayBuffer());
            let mime = "image/png";

            // Resize if image is too large for Claude (max 8000px any dimension)
            // Write to sandbox, resize with sharp, read back
            if (buf.length > 500_000 || hasFullPageScreenshot) {
              try {
                await sandbox.fs.writeBinary("/tmp/_screenshot_raw.png", buf);
                const resizeCmd =
                  `node -e "const s=require('sharp');` +
                  `s('/tmp/_screenshot_raw.png')` +
                  `.resize({width:1440,height:7000,fit:'inside'})` +
                  `.jpeg({quality:80})` +
                  `.toFile('/tmp/_screenshot_resized.jpg')` +
                  `.then(()=>console.log('ok'))` +
                  `.catch(e=>{console.error(e);process.exit(1)})"`;
                const resizeResult = await sandbox.process.exec({ command: resizeCmd, waitForCompletion: true });
                if (resizeResult.exitCode === 0) {
                  const resizedBlob = await sandbox.fs.readBinary("/tmp/_screenshot_resized.jpg");
                  buf = Buffer.from(await resizedBlob.arrayBuffer());
                  mime = "image/jpeg";
                }
              } catch { /* resize failed, use original */ }
            }

            // Track screenshot usage per run
            screenshotCount++;
            let screenshotNotice = "";
            if (screenshotCount === 1) {
              screenshotNotice = "\n\n[Screenshot 1/3]";
            } else if (screenshotCount === 2) {
              screenshotNotice = "\n\n[Screenshot 2/3 — This is your last screenshot before you must hand off to the user. After this, write your final response.]";
            } else {
              screenshotNotice = "\n\n[Screenshot 3/3 — LIMIT REACHED. You MUST stop using tools now. Write your final response summarizing what you did and list any remaining issues for the user to review. Do NOT take more screenshots or make more fixes.]";
            }

            const extraText = (parts.length > 0 ? parts.join("\n\n") : "") + screenshotNotice;

            return JSON.stringify({
              __image: true,
              path: url,
              mimeType: mime,
              base64: buf.toString("base64"),
              size: buf.length,
              extraText,
            });
          } catch (imgErr: any) {
            parts.push(`[Screenshot error: ${imgErr.message}]`);
          }
        }

        return parts.join("\n\n") || "Page returned no content.";
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    })()),
    {
      name: "url_fetch",
      description:
        "Fetch a web page in multiple formats. Supports markdown, screenshot, summary, and html.\n" +
        "- **markdown** (default): Clean, readable text content. Best for reading docs, articles, code references.\n" +
        "- **screenshot**: Visual capture of the viewport (1440x900). Returns the image directly so you can see it. Use for checking layouts and visual design.\n" +
        "- **screenshot@fullPage**: Full-page screenshot capturing the entire scrollable page.\n" +
        "- **summary**: Condensed overview of the page content. Use for quick understanding without reading the full page.\n" +
        "- **html**: Full raw HTML of the page. If content exceeds 5k chars, it is saved to a temp file in the sandbox — use the read tool to inspect it.\n" +
        "- You can request multiple formats at once (e.g., ['markdown', 'screenshot']).\n" +
        "- If only screenshot is requested, the image is returned directly.\n" +
        "- Use web_search first to find relevant URLs, then url_fetch to read them.",
      schema: z.object({
        url: z.string().describe("The URL to fetch"),
        formats: z.array(z.enum(["markdown", "screenshot", "screenshot@fullPage", "summary", "html"])).optional()
          .describe("Output formats to return. Default: ['markdown']. Use ['screenshot'] for viewport capture, ['screenshot@fullPage'] for full page."),
      }),
    }
  );

  // Fire-and-forget image generation helper
  async function generateImageInBackground(
    prompt: string,
    aspectRatio: string,
    savePath: string,
  ): Promise<void> {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPEN_ROUTER}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://agent-vas.dev",
        },
        body: JSON.stringify({
          model: "google/gemini-3-pro-image-preview",
          modalities: ["image", "text"],
          image_config: { aspect_ratio: aspectRatio },
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        // Write an error marker so the agent can detect failure
        await sandbox.process.exec({
          command: `echo "GENERATION FAILED: ${res.status}" > "${savePath}.error"`,
          waitForCompletion: true,
        });
        console.error(`[image_generate] Failed for ${savePath}: ${res.status} ${errText}`);
        return;
      }

      const data = await res.json();
      const msg = data.choices?.[0]?.message;
      if (!msg?.images?.length) {
        await sandbox.process.exec({
          command: `echo "GENERATION FAILED: No image returned" > "${savePath}.error"`,
          waitForCompletion: true,
        });
        return;
      }

      const imgUrl = msg.images[0]?.image_url?.url;
      if (!imgUrl) return;

      const base64Match = imgUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!base64Match) return;

      const imageData = base64Match[2];
      await sandbox.fs.writeBinary(savePath, Buffer.from(imageData, "base64"));
    } catch (err: any) {
      await sandbox.process.exec({
        command: `echo "GENERATION FAILED: ${err.message}" > "${savePath}.error"`,
        waitForCompletion: true,
      }).catch(() => {});
    }
  }

  const imageGenerate = tool(
    async ({ prompt, size, save_path }) => {
      const sizeMap: Record<string, string> = {
        "square": "1:1",
        "landscape": "16:9",
        "portrait": "9:16",
        "wide": "21:9",
        "banner": "4:1",
      };
      const aspectRatio = (size && sizeMap[size]) || size || "1:1";
      const ext = "jpg";
      const finalPath = save_path || `/app/uploads/generated-${Date.now()}.${ext}`;

      // Fire and forget — don't await
      generateImageInBackground(prompt, aspectRatio, finalPath);

      return (
        `Image generation started. The image will be saved to ${finalPath} (aspect ratio: ${aspectRatio}).\n` +
        `This takes ~5-10 seconds. Continue with other work and use the read tool on ${finalPath} later to verify it was created. ` +
        `If generation failed, a ${finalPath}.error file will exist instead.`
      );
    },
    {
      name: "image_generate",
      description:
        "Generate an image using AI (Nano Banana Pro). This is a NON-BLOCKING tool — it returns immediately with the file path while the image generates in the background (~5-10 seconds).\n" +
        "Use this for generating website assets like logos, icons, hero images, illustrations, backgrounds, etc.\n" +
        "Be descriptive in your prompt — include style, colors, composition, and mood.\n" +
        "After calling this, continue with other work. Check back on the file path later with the read tool to verify the image was created.",
      schema: z.object({
        prompt: z.string().describe("Detailed description of the image to generate. Be specific about style, colors, composition."),
        size: z.string().optional().describe(
          "Image size preset or custom aspect ratio. Presets: 'square' (1:1), 'landscape' (16:9), 'portrait' (9:16), 'wide' (21:9), 'banner' (4:1). " +
          "Or pass a custom ratio like '3:2'. Default: 'square'."
        ),
        save_path: z.string().optional().describe("Path in the sandbox to save the image. Default: /app/uploads/generated-<timestamp>.<ext>"),
      }),
    }
  );

  // ===== run_sql =====
  const runSql = tool(
    async ({ query }) => {
      if (!dbConfig) {
        return "Error: No database configured for this project. Create a new project with /new to get a database.";
      }

      try {
        const sql = neon(dbConfig.connectionString);
        const result = await sql.query(query);
        return JSON.stringify(result, null, 2);
      } catch (err: any) {
        return `SQL Error: ${err.message}`;
      }
    },
    {
      name: "run_sql",
      description:
        "Execute SQL queries on the project's PostgreSQL database (Neon). " +
        "Use this to create tables, alter schemas, insert seed data, etc. " +
        "The query runs with full admin privileges. Supports any valid PostgreSQL SQL.",
      schema: z.object({
        query: z.string().describe("The SQL query to execute"),
      }),
    }
  );

  // ===== subagent =====
  const allBaseTools: Record<string, any> = {
    bash, read, write, edit, grep, glob, web_search: webSearch, url_fetch: urlFetch,
    image_generate: imageGenerate, run_sql: runSql,
  };

  async function runSubagentLoop(
    systemPrompt: string,
    task: string,
    toolNames: string[],
    model: BaseChatModel,
    label: string,
    onLog?: SubagentLogFn,
  ): Promise<string> {
    // Build tool subset for this subagent (no subagent tool = no recursion)
    const subTools = toolNames
      .map(name => allBaseTools[name])
      .filter(Boolean);
    const subToolsByName: Record<string, any> = {};
    for (const t of subTools) subToolsByName[t.name] = t;

    const modelWithTools = (model as any).bindTools(subTools);
    const systemMsg = new SystemMessage(systemPrompt);
    let messages: any[] = [new HumanMessage(task)];
    let lastContent = "";

    for (let i = 0; i < SUBAGENT_MAX_ITERATIONS; i++) {
      const response: AIMessage = await modelWithTools.invoke([systemMsg, ...messages]);

      if (response.content) {
        lastContent = typeof response.content === "string"
          ? response.content
          : Array.isArray(response.content)
            ? response.content.map((c: any) => c.text || "").join("")
            : "";
      }

      messages.push(response);

      if (!response.tool_calls?.length) break;

      // Execute tools
      const toolResults = await Promise.all(
        response.tool_calls.map(async (tc: any) => {
          const toolDef = subToolsByName[tc.name];
          if (!toolDef) {
            if (onLog) onLog(label, tc.name, "unknown tool");
            return new ToolMessage({
              content: `Error: Unknown tool "${tc.name}"`,
              tool_call_id: tc.id!,
              name: tc.name,
            });
          }

          // Format a short detail string for logging
          const args = tc.args || {};
          let detail = "";
          if (tc.name === "bash") detail = args.command || "";
          else if (tc.name === "read") detail = args.path || "";
          else if (tc.name === "write") detail = args.path || "";
          else if (tc.name === "edit") detail = args.path || "";
          else if (tc.name === "grep") detail = `/${args.pattern}/ in ${args.path || ""}`;
          else if (tc.name === "glob") detail = `${args.pattern} in ${args.path || ""}`;
          else if (tc.name === "web_search") detail = args.query || "";
          else if (tc.name === "url_fetch") detail = args.url || "";
          else if (tc.name === "run_sql") detail = (args.query || "").slice(0, 60);

          if (onLog) onLog(label, tc.name, detail);

          try {
            const result = await toolDef.invoke(tc);
            const resultText = typeof result === "string" ? result : result?.content ?? String(result);
            return new ToolMessage({
              content: resultText,
              tool_call_id: tc.id!,
              name: tc.name,
            });
          } catch (err: any) {
            return new ToolMessage({
              content: `Error: ${err.message}`,
              tool_call_id: tc.id!,
              name: tc.name,
            });
          }
        })
      );

      messages.push(...toolResults);
    }

    return lastContent || "Subagent completed without producing output.";
  }

  const subagentTool = tool(
    async ({ task, type, use_haiku, description }) => {
      if (!subagentConfig) {
        return "Error: Subagent configuration not available.";
      }

      const agentType = type ? SUBAGENT_TYPES[type] : null;
      const systemPrompt = agentType?.prompt || SUBAGENT_TYPES.execute.prompt;
      const toolNames = agentType?.tools || SUBAGENT_TYPES.execute.tools;

      // Pick model: haiku for cheap read-only tasks, parent model otherwise
      const modelId = use_haiku ? "claude-haiku" : subagentConfig.parentModelId;
      const createModel = subagentConfig.modelFactory[modelId];
      if (!createModel) {
        return `Error: Model "${modelId}" not available.`;
      }
      const model = createModel();

      const label = description || type || "subagent";
      try {
        const result = await runSubagentLoop(systemPrompt, task, toolNames, model, label, subagentConfig.onLog);
        return result;
      } catch (err: any) {
        return `Subagent "${label}" failed: ${err.message}`;
      }
    },
    {
      name: "subagent",
      description:
        "Spawn a subagent to handle a task in its own isolated context. " +
        "The subagent runs independently with its own tools and returns only its final summary. " +
        "Use this to delegate exploration, research, or execution tasks without bloating your context.\n\n" +
        "Premade types:\n" +
        "- **explore**: Read-only codebase search (grep, glob, read). Use for understanding code structure.\n" +
        "- **research**: Web search + docs + code reading. Use for finding solutions, APIs, documentation.\n" +
        "- **execute**: Full tool access (bash, read, write, edit, run_sql). Use for running tests, fixing errors, installing packages.\n\n" +
        "You can spawn multiple subagents in parallel by making multiple tool calls in one response.\n" +
        "Set use_haiku=true for cheap read-only tasks (explore, research). Use the parent model for execute tasks that need higher quality.",
      schema: z.object({
        task: z.string().describe("Detailed description of what the subagent should do. Be specific — the subagent has no context from your conversation."),
        type: z.enum(["explore", "research", "execute"]).optional()
          .describe("Premade agent type. Determines which tools and system prompt the subagent gets."),
        use_haiku: z.boolean().optional()
          .describe("Use claude-haiku (cheaper/faster) instead of the parent model. Good for explore and research tasks. Default: false."),
        description: z.string().optional()
          .describe("Short 3-5 word label for logging (e.g. 'find auth routes')"),
      }),
    }
  );

  // ===== deploy =====
  const deployTool = tool(
    async () => {
      if (!deployConfig) {
        return "Error: Deployment not configured. Set VERCEL_TOKEN in .env to enable deployments.";
      }

      try {
        const logs: string[] = [];
        const result = await deploy(sandbox, {
          projectName: deployConfig.projectName,
          token: deployConfig.vercelToken,
          teamId: deployConfig.vercelTeamId,
          envVars: deployConfig.envVars,
        }, (msg) => { logs.push(msg); });

        if (result.success) {
          return `Deployment successful!\nURL: ${result.url}\nDeployment ID: ${result.deploymentId}\n\nBuild log:\n${logs.join("\n")}`;
        } else {
          return `Deployment failed (${result.readyState}).\n\nError:\n${result.error || "Unknown error"}\n\nBuild log:\n${logs.join("\n")}`;
        }
      } catch (err: any) {
        return `Deploy error: ${err.message}`;
      }
    },
    {
      name: "deploy",
      description:
        "Deploy the current project to Vercel. This reads all files from /app, uploads them to Vercel, " +
        "and creates a production deployment. Returns the deployment URL on success, or build errors on failure.\n\n" +
        "Use this when:\n" +
        "- The user asks to deploy, publish, or go live\n" +
        "- You need to test if the production build works\n" +
        "- After fixing build errors from a previous failed deployment\n\n" +
        "The tool handles everything automatically — no arguments needed.",
      schema: z.object({}),
    }
  );

  const allTools: any[] = [bash, read, write, edit, grep, glob, todowrite, webSearch, urlFetch, imageGenerate];
  if (dbConfig) allTools.push(runSql);
  if (subagentConfig) allTools.push(subagentTool);
  if (deployConfig) allTools.push(deployTool);
  return allTools;
}
