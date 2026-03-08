import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Sandbox } from "@daytonaio/sdk";

export function createTools(sandbox: Sandbox) {
  const exec = async (command: string): Promise<string> => {
    const result = await sandbox.process.executeCommand(command);
    return result.exitCode !== 0
      ? `Error (exit ${result.exitCode}): ${result.result}`
      : result.result || "";
  };

  const bash = tool(
    async ({ command, timeout }) => {
      const timeoutMs = (timeout || 60) * 1000;
      try {
        const result = await Promise.race([
          sandbox.process.executeCommand(command),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timed out after ${timeout || 60}s`)), timeoutMs)
          ),
        ]);
        return result.exitCode !== 0
          ? `Error (exit ${result.exitCode}): ${result.result}`
          : result.result || "";
      } catch (error: any) {
        return `Error: ${error.message}`;
      }
    },
    {
      name: "bash",
      description:
        "Executes a bash command in the sandbox environment. " +
        "Use for: git, npm, pip, docker, curl, running scripts, installing packages, and other terminal operations. " +
        "IMPORTANT: Do NOT use bash for file operations (reading, writing, editing, searching files) — use the dedicated read, write, edit, grep, and glob tools instead. " +
        "Avoid using cat, head, tail, sed, awk, echo, find, or grep as bash commands. " +
        "Always quote file paths containing spaces. " +
        "If commands are independent, make multiple bash calls in parallel. " +
        "If commands depend on each other, chain them with && in a single call.",
      schema: z.object({
        command: z.string().describe("The bash command to execute"),
        timeout: z.number().optional().describe("Timeout in seconds (default: 60)"),
      }),
    }
  );

  const read = tool(
    async ({ path, offset, limit }) => {
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
        "Read a file from the filesystem. Returns contents with line numbers prefixed as '<line_number>\\t<content>'. " +
        "By default reads the entire file (up to 2000 lines). Use offset/limit for large files. " +
        "IMPORTANT: You MUST read a file before editing or overwriting it — never guess at file contents. " +
        "If you are unsure of the file path, use the glob tool first to find it. " +
        "Call this tool in parallel when you need to read multiple files.",
      schema: z.object({
        path: z.string().describe("Absolute path to the file"),
        offset: z.number().optional().describe("Line number to start reading from (1-indexed)"),
        limit: z.number().optional().describe("Maximum number of lines to read"),
      }),
    }
  );

  const write = tool(
    async ({ path, content }) => {
      // Base64-encode to avoid all shell escaping issues
      const b64 = Buffer.from(
        JSON.stringify({ path, content })
      ).toString("base64");
      const script =
        `python3 -c "import json,base64,os;` +
        `a=json.loads(base64.b64decode('${b64}').decode());` +
        `os.makedirs(os.path.dirname(a['path']),exist_ok=True);` +
        `open(a['path'],'w').write(a['content']);` +
        `print('Successfully wrote to '+a['path']+' ('+str(len(a['content']))+' chars)')"`;
      return await exec(script);
    },
    {
      name: "write",
      description:
        "Create or overwrite a file with the given content. Creates parent directories automatically. " +
        "IMPORTANT: If the file already exists, you MUST read it first before overwriting. " +
        "ALWAYS prefer using the edit tool over write for modifying existing files — edit is safer and preserves the rest of the file. " +
        "Only use write when creating new files or when you need to completely replace all content.",
      schema: z.object({
        path: z.string().describe("Absolute path to the file"),
        content: z.string().describe("The complete file content to write"),
      }),
    }
  );

  const edit = tool(
    async ({ path, old_string, new_string }) => {
      // Base64-encode args to avoid all shell escaping issues
      const argsB64 = Buffer.from(
        JSON.stringify({ path, oldStr: old_string, newStr: new_string })
      ).toString("base64");
      const script =
        `python3 -c "import json,base64,sys;` +
        `args=json.loads(base64.b64decode('${argsB64}').decode());` +
        `c=open(args['path']).read();` +
        `sys.exit('Error: Could not find the specified text') if args['oldStr'] not in c else None;` +
        `open(args['path'],'w').write(c.replace(args['oldStr'],args['newStr'],1));` +
        `print('File edited successfully')"`;
      return await exec(script);
    },
    {
      name: "edit",
      description:
        "Performs exact string replacement in a file. Replaces the first occurrence of old_string with new_string. " +
        "CRITICAL RULES: " +
        "1. You MUST read the file first before editing. Never guess at file contents. " +
        "2. old_string must EXACTLY match the file content — including all indentation, whitespace, and newlines. " +
        "3. When copying text from read output, do NOT include line number prefixes (the '<number>\\t' part). Only copy the actual content after the tab. " +
        "4. If the edit fails with 'Could not find the specified text', re-read the file to see the actual current content, then retry with the corrected old_string. " +
        "5. Make old_string long enough to be unique in the file. Include surrounding context lines if needed. " +
        "6. Prefer multiple small, targeted edits over one large edit.",
      schema: z.object({
        path: z.string().describe("Absolute path to the file"),
        old_string: z.string().describe("The exact text to find and replace. Must match the file content exactly including whitespace and indentation"),
        new_string: z.string().describe("The replacement text"),
      }),
    }
  );

  const grep = tool(
    async ({ pattern, path, include }) => {
      let command = `grep -rn "${pattern}" "${path}"`;
      if (include) command = `grep -rn --include="${include}" "${pattern}" "${path}"`;
      command += " | head -100";
      return await exec(command);
    },
    {
      name: "grep",
      description:
        "Fast content search tool. Searches file contents using regex patterns. " +
        "Returns matching lines with file paths and line numbers (up to 100 results). " +
        "Use the include parameter to filter by file type (e.g., '*.ts', '*.py'). " +
        "Supports full regex syntax (e.g., 'function\\s+\\w+', 'import.*from'). " +
        "Use this instead of bash grep or bash rg — this tool is optimized for the sandbox.",
      schema: z.object({
        pattern: z.string().describe("Regex pattern to search for"),
        path: z.string().describe("Absolute path to directory or file to search in"),
        include: z.string().optional().describe("File glob pattern to filter (e.g., '*.ts', '*.{js,jsx}')"),
      }),
    }
  );

  const glob = tool(
    async ({ pattern, path }) => {
      const command = `find "${path}" -type f -name "${pattern}" | head -100`;
      return await exec(command);
    },
    {
      name: "glob",
      description:
        "Fast file pattern matching tool. Finds files by name pattern within a directory (recursive). " +
        "Returns matching file paths (up to 100 results). " +
        "Use this to locate files before reading them. " +
        "Examples: '*.ts' finds all TypeScript files, 'package.json' finds all package.json files, '*.test.*' finds test files. " +
        "Use this instead of bash find — this tool is optimized for the sandbox.",
      schema: z.object({
        pattern: z.string().describe("File name glob pattern (e.g., '*.ts', 'package.json', '*.test.*')"),
        path: z.string().describe("Absolute path to directory to search in"),
      }),
    }
  );

  const preview_url = tool(
    async ({ port, expiresIn }) => {
      const expiration = expiresIn || 3600;
      try {
        const result = await sandbox.getSignedPreviewUrl(port, expiration);
        const rawUrl = typeof result === "string" ? result : (result as any).url || JSON.stringify(result);
        const url = rawUrl.replace("https://", "http://");
        return `Public URL for port ${port}: ${url}\n(Open this URL in a browser — expires in ${expiration} seconds)\nNote: The server must bind to 0.0.0.0, not localhost/127.0.0.1.`;
      } catch (error: any) {
        return `Error getting preview URL: ${error.message}`;
      }
    },
    {
      name: "preview_url",
      description:
        "Get a public URL for a service running on a specific port in the sandbox. The service must bind to 0.0.0.0 (not localhost). Useful for previewing web apps, APIs, etc.",
      schema: z.object({
        port: z.number().describe("The port number the service is running on"),
        expiresIn: z.number().optional().describe("How long the URL is valid in seconds (default: 3600)"),
      }),
    }
  );

  const start_server = tool(
    async ({ command, readyPattern, timeout, sessionName }) => {
      const sid = sessionName || `server-${Date.now()}`;
      const maxWait = (timeout || 60) * 1000;
      const pattern = new RegExp(readyPattern || "ready|listening|started|running on", "i");

      try {
        // Create session and start command async
        await sandbox.process.createSession(sid);
        const startResult = await sandbox.process.executeSessionCommand(sid, {
          command,
          runAsync: true,
        });
        const cmdId = startResult.cmdId;
        if (!cmdId) return "Error: failed to get command ID";

        // Poll logs until ready pattern or timeout
        const startTime = Date.now();
        let lastStdout = "";
        let lastStderr = "";

        while (Date.now() - startTime < maxWait) {
          await new Promise((r) => setTimeout(r, 2000));

          const logs = await sandbox.process.getSessionCommandLogs(sid, cmdId);
          lastStdout = logs.stdout || "";
          lastStderr = logs.stderr || "";
          const combined = lastStdout + lastStderr;

          // Check if process exited (crashed)
          const cmdInfo = await sandbox.process.getSessionCommand(sid, cmdId);
          if (cmdInfo.exitCode !== undefined && cmdInfo.exitCode !== null) {
            return `Server exited with code ${cmdInfo.exitCode}.\n\nSTDOUT:\n${lastStdout.slice(-1000)}\n\nSTDERR:\n${lastStderr.slice(-1000)}`;
          }

          // Check if ready
          if (pattern.test(combined)) {
            return `Server is ready! (session: ${sid})\n\nLogs:\n${combined.slice(-1000)}\n\nTip: Use preview_url tool to get a public URL for the running port.`;
          }
        }

        // Timeout — return whatever logs we have
        return `Timed out after ${timeout || 60}s waiting for server. It may still be starting.\nSession: ${sid}\n\nSTDOUT:\n${lastStdout.slice(-1000)}\n\nSTDERR:\n${lastStderr.slice(-1000)}\n\nUse check_server tool to check again later.`;
      } catch (error: any) {
        return `Error starting server: ${error.message}`;
      }
    },
    {
      name: "start_server",
      description:
        "Start a long-running server process in the background (e.g. npm run dev, python server.py). " +
        "The tool waits until the server outputs a ready message, then returns. " +
        "IMPORTANT: The server MUST bind to 0.0.0.0 (not localhost) for preview URLs to work. " +
        "For Next.js: 'npm run dev -- -H 0.0.0.0'. For Express: app.listen(port, '0.0.0.0').",
      schema: z.object({
        command: z.string().describe("The command to start the server (e.g. 'cd /home/daytona/myapp && npm run dev -- -H 0.0.0.0')"),
        readyPattern: z.string().optional().describe("Regex pattern to detect when server is ready (default: 'ready|listening|started|running on')"),
        timeout: z.number().optional().describe("Max seconds to wait for server to be ready (default: 60)"),
        sessionName: z.string().optional().describe("Unique name for this server session (default: auto-generated)"),
      }),
    }
  );

  const check_server = tool(
    async ({ sessionName }) => {
      try {
        const session = await sandbox.process.getSession(sessionName);
        if (!session.commands || session.commands.length === 0) {
          return `Session '${sessionName}' has no commands.`;
        }

        const cmd = session.commands[session.commands.length - 1];
        const logs = await sandbox.process.getSessionCommandLogs(sessionName, cmd.id!);
        const status = cmd.exitCode !== undefined && cmd.exitCode !== null
          ? `exited (code ${cmd.exitCode})`
          : "running";

        return `Server status: ${status}\nCommand: ${cmd.command}\n\nSTDOUT (last 1000 chars):\n${(logs.stdout || "").slice(-1000)}\n\nSTDERR (last 1000 chars):\n${(logs.stderr || "").slice(-1000)}`;
      } catch (error: any) {
        return `Error checking server: ${error.message}`;
      }
    },
    {
      name: "check_server",
      description: "Check the status and logs of a running background server started with start_server.",
      schema: z.object({
        sessionName: z.string().describe("The session name used when starting the server"),
      }),
    }
  );

  const stop_server = tool(
    async ({ sessionName }) => {
      try {
        await sandbox.process.deleteSession(sessionName);
        return `Server session '${sessionName}' stopped and deleted.`;
      } catch (error: any) {
        return `Error stopping server: ${error.message}`;
      }
    },
    {
      name: "stop_server",
      description: "Stop a background server by deleting its session.",
      schema: z.object({
        sessionName: z.string().describe("The session name to stop"),
      }),
    }
  );

  return [bash, read, write, edit, grep, glob, preview_url, start_server, check_server, stop_server];
}
