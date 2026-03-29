export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

export function formatToolArgs(tool: string, args: Record<string, any>): string {
  try {
    switch (tool) {
      case "bash":
        return `$ ${truncate(args.command || "", 120)}`;
      case "read":
        if (args.offset) return `${args.path} [${args.offset}:${args.offset + (args.limit || 100)}]`;
        return args.path || "";
      case "write":
        return `${args.path} (${(args.content || "").length} chars)`;
      case "edit":
        return args.path || "";
      case "grep":
        return `/${args.pattern}/ in ${args.path || "."}`;
      case "glob":
        return `${args.pattern} in ${args.path || "."}`;
      case "subagent":
        return `[${args.type || "execute"}${args.use_haiku ? " · haiku" : ""}] ${truncate(args.task || "", 80)}`;
      case "run_sql":
        return truncate(args.query || "", 120);
      case "deploy":
        return args.projectName ? `→ ${args.projectName.replace(/^vas-/, "")}` : "deploying...";
      case "todowrite":
        return "";
      case "url_fetch":
        return truncate(args.url || "", 100);
      default:
        return truncate(JSON.stringify(args), 120);
    }
  } catch {
    return "";
  }
}

export function formatToolOutput(tool: string, output: string): string {
  if (!output) return "";
  const lines = output.split("\n");
  if (lines.length <= 3) return output;
  return lines.slice(0, 3).join("\n") + `\n(+${lines.length - 3} more lines)`;
}
