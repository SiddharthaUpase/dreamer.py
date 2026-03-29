import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, useInput, useApp, useStdout } from "ink";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import { ApiClient } from "../apiClient.js";
import { formatToolArgs, formatToolOutput, truncate } from "../format.js";
import { detectFiles, uploadFiles, normalizeDroppedPath } from "../files.js";
import { enableBracketedPaste, disableBracketedPaste, isPasting } from "../keyboard.js";

const MODELS = ["claude-sonnet", "claude-haiku", "minimax", "kimi", "mimo"];

interface ProjectInfo {
  id: string;
  name: string;
  previewUrl?: string;
  messageCount: number;
  messages: any[];
}

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface ChatMessage {
  type: "user" | "assistant" | "streaming" | "tool" | "error" | "info" | "success" | "todo";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, any>;
  todos?: TodoItem[];
}

interface Props {
  api: ApiClient;
  project: ProjectInfo;
  model: string;
  onModelChange: (model: string) => void;
  onSwitchProject: () => void;
  onLogout: () => void;
}

type Phase = "input" | "streaming" | "model-select" | "confirm-delete";

type InputPart =
  | { type: "typed"; content: string }
  | { type: "paste"; content: string; lines: number; index: number };

function partsToText(parts: InputPart[]): string {
  return parts.map((p) => p.content).join("");
}

export function ChatScreen({ api, project, model, onModelChange, onSwitchProject, onLogout }: Props) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const cols = stdout?.columns ?? 80;
  const [phase, setPhase] = useState<Phase>("input");
  const [uploading, setUploading] = useState(false);
  const [parts, setParts] = useState<InputPart[]>([{ type: "typed", content: "" }]);
  const pasteCounter = useRef(0);
  const [scrollOffset, setScrollOffset] = useState(0); // lines from bottom, 0 = auto-scroll
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const initial: ChatMessage[] = [];
    if (project.previewUrl) {
      initial.push({ type: "info", content: `Preview: ${project.previewUrl}` });
    }
    // Convert history messages to ChatMessage format
    // Backend roles: "human" | "ai" | "tool"
    for (const m of project.messages) {
      const role = m.role ?? m.type;
      const content = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
          : "";
      if (!content) continue;
      if (role === "human" || role === "user") {
        initial.push({ type: "user", content });
      } else if (role === "ai" || role === "assistant") {
        initial.push({ type: "assistant", content });
      } else if (role === "tool") {
        initial.push({ type: "tool", content: `✓ ${m.name || "tool"}: ${content}` });
      }
    }
    return initial;
  });
  const [toolStatus, setToolStatus] = useState("");
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Batch token updates — accumulate in ref, flush every 50ms
  const tokenBuffer = useRef("");
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastToolArgs = useRef<Record<string, any> | null>(null);
  const pendingUploads = useRef<string[]>([]);

  const startTokenBatching = useCallback(() => {
    tokenBuffer.current = "";
    if (flushTimer.current) clearInterval(flushTimer.current);
    flushTimer.current = setInterval(() => {
      if (tokenBuffer.current) {
        const chunk = tokenBuffer.current;
        tokenBuffer.current = "";
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.type === "streaming") {
            return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
          }
          return [...prev, { type: "streaming", content: chunk }];
        });
      }
    }, 50);
  }, []);

  const stopTokenBatching = useCallback(() => {
    if (flushTimer.current) {
      clearInterval(flushTimer.current);
      flushTimer.current = null;
    }
    // Flush remaining into streaming message
    const remaining = tokenBuffer.current;
    tokenBuffer.current = "";
    if (remaining) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.type === "streaming") {
          return [...prev.slice(0, -1), { ...last, content: last.content + remaining }];
        }
        return [...prev, { type: "streaming", content: remaining }];
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      if (flushTimer.current) clearInterval(flushTimer.current);
    };
  }, []);

  // Bracketed paste: detect file drops or store as a named block
  useEffect(() => {
    enableBracketedPaste((text) => {
      // Check if pasted text contains file paths (drag-drop from Finder)
      // Could be single path or multiple paths (one per line)
      const pasteLines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const droppedFiles = pasteLines.map((l) => normalizeDroppedPath(l)).filter((p): p is string => p !== null);
      if (droppedFiles.length > 0) {
        setUploading(true);
        addMessage("info", `↑ uploading ${droppedFiles.length} file${droppedFiles.length > 1 ? "s" : ""}...`);
        uploadFiles(api, project.id, droppedFiles).then((results) => {
          setMessages((prev) => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].type === "info" && updated[i].content.startsWith("↑ uploading")) {
                updated.splice(i, 1);
                break;
              }
            }
            for (const u of results) {
              if (u.remotePath) {
                pendingUploads.current.push(u.remotePath!);
                updated.push({ type: "success", content: `${u.fileName} (${u.size}) → ${u.remotePath}` });
              } else if (u.error) {
                updated.push({ type: "error", content: `Upload failed: ${u.fileName}: ${u.error}` });
              }
            }
            return updated;
          });
          setUploading(false);
        }).catch(() => { setUploading(false); });
        return;
      }

      // Normal paste: store as a named block
      pasteCounter.current += 1;
      const index = pasteCounter.current;
      const lines = text.split("\n").length;
      setParts((prev) => [
        ...prev,
        { type: "paste", content: text, lines, index },
        { type: "typed", content: "" },
      ]);
    });
    return () => disableBracketedPaste();
  }, []);


  const COMMANDS = [
    { name: "/clear",    desc: "clear conversation history" },
    { name: "/compact",  desc: "summarise history to save context" },
    { name: "/history",  desc: "show message count" },
    { name: "/url",      desc: "show preview URL" },
    { name: "/model",    desc: "switch AI model" },
    { name: "/projects", desc: "switch project" },
    { name: "/deploy",   desc: "deploy to Vercel" },
    { name: "/share",    desc: "share project with another user" },
    { name: "/leave",    desc: "leave a shared project" },
    { name: "/reset",    desc: "clear screen (keeps history)" },
    { name: "/delete",   desc: "delete this project" },
    { name: "/help",     desc: "show all commands" },
    { name: "/logout",   desc: "log out" },
    { name: "/exit",     desc: "quit" },
  ];

  // Compute suggestions from the last typed part
  const lastTyped = (() => {
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].type === "typed") return (parts[i] as { type: "typed"; content: string }).content;
    }
    return "";
  })();
  const suggestions = lastTyped.startsWith("/") && !lastTyped.includes(" ")
    ? COMMANDS.filter((c) => c.name.startsWith(lastTyped))
    : [];
  const clampedSuggestionIndex = Math.min(suggestionIndex, Math.max(0, suggestions.length - 1));

  // Handle keyboard input
  useInput((ch, key) => {
    // ESC to abort streaming
    if (key.escape && abortController) {
      abortController.abort();
      // Stop batching and finalize in one atomic update
      if (flushTimer.current) { clearInterval(flushTimer.current); flushTimer.current = null; }
      const abortChunk = tokenBuffer.current;
      tokenBuffer.current = "";
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.type === "streaming") {
          const finalContent = last.content + abortChunk;
          if (finalContent.trim()) {
            return [...prev.slice(0, -1), { type: "assistant", content: finalContent }];
          }
          return prev.slice(0, -1);
        }
        if (abortChunk.trim()) {
          return [...prev, { type: "assistant", content: abortChunk }];
        }
        return prev;
      });
      setAbortController(null);
      setPhase("input");
      setToolStatus("");
      addMessage("info", "Aborted.");
      return;
    }

    // Confirm delete: y/n
    if (phase === "confirm-delete") {
      if (ch === "y" || ch === "Y") {
        setPhase("streaming");
        setToolStatus("Deleting project...");
        api.request(`/api/projects/${project.id}`, { method: "DELETE" }).then((res) => {
          setToolStatus("");
          if (res.ok) {
            addMessage("success", "Project deleted.");
            onSwitchProject();
          } else {
            res.json().then((d: any) => addMessage("error", d.error || "Delete failed."));
            setPhase("input");
          }
        }).catch((err: any) => {
          setToolStatus("");
          addMessage("error", err.message);
          setPhase("input");
        });
      } else {
        addMessage("info", "Delete cancelled.");
        setPhase("input");
      }
      return;
    }

    // Up/Down: navigate suggestions when open, otherwise scroll history
    if (key.upArrow) {
      if (suggestions.length > 0) {
        setSuggestionIndex((prev) => Math.max(0, prev - 1));
      } else {
        setScrollOffset((prev) => prev + 3);
      }
      return;
    }
    if (key.downArrow) {
      if (suggestions.length > 0) {
        setSuggestionIndex((prev) => Math.min(suggestions.length - 1, prev + 1));
      } else {
        setScrollOffset((prev) => Math.max(0, prev - 3));
      }
      return;
    }

    if (phase !== "input") return;

    // Skip all input while a bracketed paste is being processed
    if (isPasting) return;

    // Helpers to mutate the last typed part
    const appendToTyped = (s: string) => {
      setParts((prev) => {
        const last = prev[prev.length - 1];
        if (last?.type === "typed") {
          return [...prev.slice(0, -1), { ...last, content: last.content + s }];
        }
        return [...prev, { type: "typed", content: s }];
      });
    };

    // Enter with suggestion open → complete the command
    if (key.return && suggestions.length > 0) {
      const chosen = suggestions[clampedSuggestionIndex].name + " ";
      setParts((prev) => {
        const last = prev[prev.length - 1];
        if (last?.type === "typed") {
          return [...prev.slice(0, -1), { ...last, content: chosen }];
        }
        return prev;
      });
      setSuggestionIndex(0);
      return;
    }

    // Enter = submit (or backslash-Enter = newline)
    if (key.return) {
      if (uploading) return; // Block submit while files are uploading
      setParts((prev) => {
        const last = prev[prev.length - 1];
        // Backslash-Enter: strip \ and add newline, keep editing
        if (last?.type === "typed" && last.content.endsWith("\\")) {
          return [...prev.slice(0, -1), { ...last, content: last.content.slice(0, -1) + "\n" }];
        }
        // Submit
        const full = partsToText(prev).trim();
        if (full) {
          handleSubmit(full);
          return [{ type: "typed", content: "" }];
        }
        return prev;
      });
      return;
    }

    // Backspace — remove from last typed part, or remove last paste block
    if (key.backspace || key.delete) {
      setSuggestionIndex(0);
      setParts((prev) => {
        const last = prev[prev.length - 1];
        if (last?.type === "typed" && last.content.length > 0) {
          return [...prev.slice(0, -1), { ...last, content: last.content.slice(0, -1) }];
        }
        // Last typed part is empty — remove it and the paste block before it
        if (last?.type === "typed" && last.content === "" && prev.length > 1) {
          return prev.slice(0, -2).concat({ type: "typed", content: "" });
        }
        return prev;
      });
      return;
    }

    // Ignore control sequences, arrows, escape
    if (key.escape || key.ctrl || key.meta) return;
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;

    // Tab → accept highlighted suggestion, or 2 spaces
    if (key.tab) {
      if (suggestions.length > 0) {
        const chosen = suggestions[clampedSuggestionIndex].name + " ";
        setParts((prev) => {
          const last = prev[prev.length - 1];
          if (last?.type === "typed") {
            return [...prev.slice(0, -1), { ...last, content: chosen }];
          }
          return prev;
        });
        setSuggestionIndex(0);
      } else {
        appendToTyped("  ");
      }
      return;
    }

    // Regular character — reset suggestion index when typing
    if (ch) {
      setSuggestionIndex(0);
      appendToTyped(ch);
    }
  });

  const addMessage = useCallback((type: ChatMessage["type"], content: string) => {
    setMessages((prev) => [...prev, { type, content }]);
  }, []);

  async function handleSubmit(text: string) {
    if (!text.trim()) return;

    // Handle commands — only if first word matches a known command (not file paths)
    const firstWord = text.trim().split(" ")[0];
    if (firstWord.startsWith("/") && KNOWN_COMMANDS.has(firstWord)) {
      await handleCommand(text.trim());
      return;
    }

    // Attach any pending file uploads (from drag-drop)
    let processedText = text;
    if (pendingUploads.current.length > 0) {
      const uploads = pendingUploads.current.map((p) => `[uploaded file: ${p}]`).join("\n");
      processedText = uploads + "\n" + processedText;
      pendingUploads.current = [];
    }

    // Detect and upload files from typed paths
    const filePaths = detectFiles(text);
    if (filePaths.length > 0) {
      const uploads = await uploadFiles(api, project.id, filePaths);
      for (const u of uploads) {
        if (u.remotePath) {
          processedText = processedText.replace(u.localPath, u.remotePath);
          addMessage("info", `↑ uploaded ${u.fileName} (${u.size}) → ${u.remotePath}`);
        } else if (u.error) {
          addMessage("error", `Upload failed: ${u.fileName}: ${u.error}`);
        }
      }
    }

    addMessage("user", text);
    setScrollOffset(0); // snap to bottom on new message
    setPhase("streaming");
    setToolStatus("Thinking");
    startTokenBatching();

    const controller = new AbortController();
    setAbortController(controller);

    try {
      await api.chatStream(project.id, processedText, model, (event: any) => {
        switch (event.type) {
          case "token":
            setToolStatus("");
            tokenBuffer.current += event.content || "";
            break;
          case "tool_start": {
            // Flush any buffered tokens and convert in-progress streaming message → assistant
            const pending = tokenBuffer.current;
            tokenBuffer.current = "";
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.type === "streaming") {
                const finalContent = last.content + pending;
                if (finalContent.trim()) {
                  return [...prev.slice(0, -1), { type: "assistant", content: finalContent }];
                }
                return prev.slice(0, -1);
              }
              if (pending.trim()) {
                return [...prev, { type: "assistant", content: pending }];
              }
              return prev;
            });
            const style = TOOL_STYLES[event.tool] || { label: event.tool };
            const fmtArgs = formatToolArgs(event.tool, event.args || {});
            lastToolArgs.current = event.args || null;
            setToolStatus(`${style.label}  ${fmtArgs}`);
            break;
          }
          case "tool_end": {
            const rawOutput = event.output || "";
            const args = lastToolArgs.current;
            lastToolArgs.current = null;
            // For write/edit/read, keep raw output — ToolLine renders it specially
            const content = ["write", "edit", "read"].includes(event.tool)
              ? rawOutput
              : formatToolOutput(event.tool, rawOutput);
            setMessages((prev) => [...prev, { type: "tool", content, toolName: event.tool, toolArgs: args || undefined }]);
            setToolStatus("Thinking");
            break;
          }
          case "result":
            break;
          case "error":
            addMessage("error", `✗ ${event.content || event.message || "Unknown error"}`);
            break;
          case "todo_update":
            if (event.todos) {
              setMessages((prev) => {
                let idx = -1;
              for (let i = prev.length - 1; i >= 0; i--) { if (prev[i].type === "todo") { idx = i; break; } }
                const msg: ChatMessage = { type: "todo", content: "", todos: event.todos };
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = msg;
                  return next;
                }
                return [...prev, msg];
              });
            }
            break;
          case "subagent_log":
            addMessage("info", `  ${event.label} → ${event.tool} ${event.detail || ""}`);
            break;
          case "compacted":
            setMessages([{ type: "info", content: `Auto-compacted ${event.before} → ${event.after} messages.` }]);
            setScrollOffset(0);
            break;
        }
      }, controller.signal);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        addMessage("error", err.message);
      }
    }

    // Stop batching and finalize streaming → assistant in one atomic update
    if (flushTimer.current) {
      clearInterval(flushTimer.current);
      flushTimer.current = null;
    }
    const finalChunk = tokenBuffer.current;
    tokenBuffer.current = "";
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.type === "streaming") {
        const finalContent = last.content + finalChunk;
        if (finalContent.trim()) {
          return [...prev.slice(0, -1), { type: "assistant", content: finalContent }];
        }
        return prev.slice(0, -1);
      }
      if (finalChunk.trim()) {
        return [...prev, { type: "assistant", content: finalChunk }];
      }
      return prev;
    });

    setToolStatus("");
    setAbortController(null);
    setPhase("input");
  }

  async function handleCommand(cmd: string) {
    const [command, ...args] = cmd.split(" ");

    switch (command) {
      case "/clear":
        await api.request(`/api/projects/${project.id}/history`, { method: "DELETE" });
        setMessages([{ type: "info", content: "History cleared." }]);
        setScrollOffset(0);
        break;

      case "/reset":
        setMessages([{ type: "info", content: "─── screen cleared · history preserved ───" }]);
        setScrollOffset(0);
        break;

      case "/compact": {
        setPhase("streaming");
        setToolStatus("Compacting history...");
        const res = await api.request(`/api/projects/${project.id}/compact`, { method: "POST" });
        const data = (await res.json()) as any;
        setToolStatus("");
        setPhase("input");
        setMessages([{ type: "info", content: `Compacted ${data.before} → ${data.after} messages.` }]);
        setScrollOffset(0);
        break;
      }

      case "/history": {
        const res = await api.request(`/api/projects/${project.id}/history`);
        const data = (await res.json()) as any;
        addMessage("info", `${data.messages?.length || 0} messages in history.`);
        break;
      }

      case "/url":
        addMessage("info", project.previewUrl ? `Preview: ${project.previewUrl}` : "No preview URL available.");
        break;

      case "/model":
        if (args[0] && MODELS.includes(args[0])) {
          onModelChange(args[0]);
          addMessage("info", `Model: ${args[0]}`);
        } else {
          setPhase("model-select");
        }
        break;

      case "/projects":
        onSwitchProject();
        break;

      case "/switch":
        onSwitchProject();
        break;

      case "/new":
        onSwitchProject();
        break;

      case "/deploy": {
        addMessage("info", "Deploying...");
        setPhase("streaming");
        setToolStatus("Deploying");
        try {
          await api.deployStream(project.id, (event: any) => {
            if (event.type === "token") {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.type === "streaming") {
                  return [...prev.slice(0, -1), { ...last, content: last.content + (event.content || "") }];
                }
                return [...prev, { type: "streaming", content: event.content || "" }];
              });
            } else if (event.type === "error") {
              addMessage("error", event.content || event.message || "Deploy failed");
            } else if (event.url) {
              addMessage("info", `Deployed: ${event.url}`);
            }
          });
        } catch (err: any) {
          addMessage("error", err.message);
        }
        // Finalize streaming message
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.type === "streaming") {
            if (last.content.trim()) return [...prev.slice(0, -1), { type: "info", content: last.content }];
            return prev.slice(0, -1);
          }
          return prev;
        });
        setToolStatus("");
        setPhase("input");
        break;
      }

      case "/share": {
        const email = args[0];
        if (!email) {
          addMessage("info", "Usage: /share <email>");
          break;
        }
        try {
          const res = await api.request(`/api/projects/${project.id}/share`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          const text = await res.text();
          let data: any;
          try { data = JSON.parse(text); } catch { data = {}; }
          if (!res.ok) {
            addMessage("error", data.error || `Share failed (${res.status}): ${text}`);
          } else if (data.status === "already_shared") {
            addMessage("success", `${data.email} already has access.`);
          } else {
            addMessage("success", `Shared with ${data.email || "user"}.`);
          }
        } catch (err: any) {
          addMessage("error", err.message);
        }
        break;
      }

      case "/leave": {
        try {
          const res = await api.request(`/api/projects/${project.id}/collaborator`, {
            method: "DELETE",
          });
          const data = (await res.json()) as any;
          if (!res.ok) {
            addMessage("error", data.error || "Failed to leave project.");
          } else {
            addMessage("success", "Left the project.");
            onSwitchProject();
          }
        } catch (err: any) {
          addMessage("error", err.message);
        }
        break;
      }

      case "/delete":
        addMessage("error", `Delete project "${project.name}"? This cannot be undone. (y/N)`);
        setPhase("confirm-delete");
        break;

      case "/help":
        addMessage("info", [
          "Available commands:",
          "  /clear      — clear conversation history",
          "  /compact    — summarise history to save context",
          "  /reset      — clear screen (keeps history)",
          "  /history    — show message count",
          "  /url        — show preview URL",
          "  /model      — switch AI model",
          "  /projects   — switch project",
          "  /deploy     — deploy to Vercel",
          "  /share      — share project with another user",
          "  /leave      — leave a shared project",
          "  /delete     — delete this project",
          "  /logout     — log out",
          "  /exit       — quit",
        ].join("\n"));
        break;

      case "/logout":
        onLogout();
        exit();
        break;

      case "/exit":
      case "/quit":
        exit();
        break;

      default:
        addMessage("error", `Unknown command: ${command}`);
    }
  }

  const modelItems = MODELS.map((m) => ({
    label: `${m === model ? "● " : "  "}${m}`,
    value: m,
  }));

  // How many display lines each message occupies (approximate, accounts for wrapping)
  function msgLines(msg: ChatMessage): number {
    if (msg.type === "todo") return (msg.todos?.length ?? 0) + 2;
    if (msg.type === "tool") {
      const args = msg.toolArgs;
      if (msg.toolName === "read" && args?.path && msg.content) {
        const lines = msg.content.split("\n").length;
        return 1 + Math.min(lines, READ_PREVIEW_LINES) + (lines > READ_PREVIEW_LINES ? 1 : 0);
      }
      if (msg.toolName === "write" && args?.path) {
        const lines = (args.content || "").split("\n").length;
        return 1 + Math.min(lines, WRITE_PREVIEW_LINES) + (lines > WRITE_PREVIEW_LINES ? 1 : 0);
      }
      if (msg.toolName === "edit" && args?.old_string != null) {
        const ol = (args.old_string || "").split("\n").length;
        const nl = (args.new_string || "").split("\n").length;
        return 1 + Math.min(ol, EDIT_PREVIEW_LINES) + (ol > EDIT_PREVIEW_LINES ? 1 : 0)
                 + Math.min(nl, EDIT_PREVIEW_LINES) + (nl > EDIT_PREVIEW_LINES ? 1 : 0);
      }
      return msg.content ? 2 : 1;
    }
    return msg.content.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length || 1) / cols)), 0);
  }

  // Reserve rows: 2 header (preview + model) + 1 stream + 1 tool status + 3 input + 1 bottom padding
  const reserved = project.previewUrl ? 8 : 7;
  const available = Math.max(4, rows - reserved);

  // Build cumulative line positions from the end
  const lineCounts = messages.map(msgLines);
  const totalLines = lineCounts.reduce((a, b) => a + b, 0);

  // Clamp scrollOffset so you can't scroll past the top
  const maxScroll = Math.max(0, totalLines - available);
  const clampedOffset = Math.min(scrollOffset, maxScroll);

  // Find which messages fall in the visible window [windowStart, windowStart + available)
  const windowStart = Math.max(0, totalLines - available - clampedOffset);
  const windowEnd = windowStart + available;

  let cum = 0;
  const visibleMessages = messages.filter((_, i) => {
    const start = cum;
    const end = cum + lineCounts[i];
    cum = end;
    return end > windowStart && start < windowEnd;
  });

  const hasMoreAbove = windowStart > 0;

  // OSC 8 hyperlink: \x1b]8;;URL\x07LABEL\x1b]8;;\x07
  const previewLink = project.previewUrl
    ? `\x1b]8;;${project.previewUrl}\x07${project.previewUrl}\x1b]8;;\x07`
    : null;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box flexDirection="column">
        <Box>
          <Text bold color="magenta">{project.name}</Text>
          <Text dimColor>  {model}</Text>
        </Box>
        {previewLink && (
          <Text dimColor>{previewLink}</Text>
        )}
      </Box>

      {/* Scroll indicator */}
      {hasMoreAbove && (
        <Text dimColor>  ↑ {windowStart} more lines ↑</Text>
      )}

      {/* Messages */}
      {visibleMessages.map((msg, i) => (
        <MessageLine key={i} msg={msg} />
      ))}

      {/* Tool status / spinner */}
      {phase === "streaming" && toolStatus && (
        toolStatus === "Thinking" ? (
          <Box>
            <Text color="magenta"><Spinner type="dots" /></Text>
            <Text color="magenta" bold>  Dreamer is thinking...</Text>
          </Box>
        ) : (
          <Box>
            <Text color="magenta"><Spinner type="dots" /></Text>
            <Text color="white">{"  "}{toolStatus}</Text>
          </Box>
        )
      )}

      {/* Model picker */}
      {phase === "model-select" && (
        <Box flexDirection="column">
          <Text bold>Select a model:</Text>
          <SelectInput
            items={modelItems}
            initialIndex={MODELS.indexOf(model) >= 0 ? MODELS.indexOf(model) : 0}
            onSelect={(item) => {
              onModelChange(item.value);
              addMessage("info", `Model: ${item.value}`);
              setPhase("input");
            }}
          />
        </Box>
      )}

      {/* Delete confirmation */}
      {phase === "confirm-delete" && (
        <Text dimColor>  Press <Text color="red" bold>y</Text> to confirm, any other key to cancel</Text>
      )}

      {/* Input */}
      {phase === "input" && (
        <Box flexDirection="column">
          {suggestions.length > 0 && (
            <Box flexDirection="column" marginLeft={2}>
              {suggestions.map((s, i) => (
                <Box key={s.name}>
                  <Text
                    bold={i === clampedSuggestionIndex}
                    color={i === clampedSuggestionIndex ? "magenta" : "white"}
                  >
                    {i === clampedSuggestionIndex ? "▸ " : "  "}
                    {s.name}
                  </Text>
                  <Text dimColor>{`  ${s.desc}`}</Text>
                </Box>
              ))}
            </Box>
          )}
          <Box flexDirection="row" flexWrap="wrap">
            <Text bold color="magenta">{"› "}</Text>
            {parts.map((part, i) => {
              if (part.type === "paste") {
                return (
                  <Text key={i} dimColor>{`[pasted +${part.lines} lines]`}</Text>
                );
              }
              // Last typed part gets the cursor
              const isLast = i === parts.length - 1;
              const content = part.content;
              if (isLast) {
                return (
                  <Text key={i}>
                    {content}
                    <Text backgroundColor="white" color="black">{" "}</Text>
                  </Text>
                );
              }
              return <Text key={i}>{content}</Text>;
            })}
          </Box>
          {uploading ? (
            <Box>
              <Text color="cyan"><Spinner type="dots" /></Text>
              <Text color="cyan">  Uploading files...</Text>
            </Box>
          ) : (
            <Text dimColor>  / for commands</Text>
          )}
        </Box>
      )}
      <Text> </Text>
    </Box>
  );
}

const KNOWN_COMMANDS = new Set([
  "/clear", "/compact", "/reset", "/history", "/url", "/model", "/projects",
  "/deploy", "/share", "/leave", "/delete", "/help", "/logout",
  "/exit", "/quit", "/switch", "/new",
]);

const TOOL_STYLES: Record<string, { icon: string; color: string; label: string }> = {
  write:      { icon: "✎", color: "green",   label: "write"   },
  edit:       { icon: "✐", color: "yellow",  label: "edit"    },
  read:       { icon: "≡", color: "white",   label: "read"    },
  bash:       { icon: "$", color: "cyan",    label: "run"     },
  grep:       { icon: "⌕", color: "white",   label: "grep"    },
  glob:       { icon: "◈", color: "white",   label: "glob"    },
  run_sql:    { icon: "⬡", color: "blue",    label: "sql"     },
  url_fetch:  { icon: "◎", color: "cyan",    label: "fetch"   },
  subagent:   { icon: "⟳", color: "magenta", label: "agent"   },
  todowrite:  { icon: "☑", color: "cyan",    label: "tasks"   },
  deploy:     { icon: "⬆", color: "magenta", label: "deploy"  },
};

const READ_PREVIEW_LINES = 8;
const WRITE_PREVIEW_LINES = 6;
const EDIT_PREVIEW_LINES = 8;

function ToolLine({ msg }: { msg: ChatMessage }) {
  const tool = msg.toolName || "tool";
  const style = TOOL_STYLES[tool] || { icon: "✓", color: "white", label: tool };
  const isPassive = ["read", "grep", "glob"].includes(tool);
  const args = msg.toolArgs;

  // Read tool: show file path + numbered content preview with cyan highlight
  if (tool === "read" && args?.path) {
    const content = msg.content || "";
    const allLines = content.split("\n");
    const startLine = (args.offset || 0) + 1;
    const preview = allLines.slice(0, READ_PREVIEW_LINES);
    const more = allLines.length - READ_PREVIEW_LINES;
    const gutterWidth = String(startLine + preview.length - 1).length;
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="cyan">{style.icon} </Text>
          <Text color="cyan">{style.label}</Text>
          <Text dimColor>  {args.path}</Text>
        </Box>
        {content && (
          <Box flexDirection="column" marginLeft={2}>
            {preview.map((line: string, i: number) => (
              <Text key={i}>
                <Text color="gray">{String(startLine + i).padStart(gutterWidth)}  </Text>
                <Text color="cyan">{line}</Text>
              </Text>
            ))}
            {more > 0 && <Text dimColor>  (+{more} more lines)</Text>}
          </Box>
        )}
      </Box>
    );
  }

  // Write tool: show file path + content preview
  if (tool === "write" && args?.path) {
    const content = args.content || "";
    const lines = content.split("\n");
    const preview = lines.slice(0, WRITE_PREVIEW_LINES);
    const more = lines.length - WRITE_PREVIEW_LINES;
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="green" bold>{style.icon} </Text>
          <Text color="green" bold>{style.label}</Text>
          <Text dimColor>  {args.path}</Text>
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          {preview.map((line: string, i: number) => (
            <Text key={i} color="green">+ {line}</Text>
          ))}
          {more > 0 && <Text dimColor>  (+{more} more lines)</Text>}
        </Box>
      </Box>
    );
  }

  // Edit tool: show old → new diff
  if (tool === "edit" && args?.old_string != null) {
    const oldLines = (args.old_string || "").split("\n").slice(0, EDIT_PREVIEW_LINES);
    const newLines = (args.new_string || "").split("\n").slice(0, EDIT_PREVIEW_LINES);
    const oldTotal = (args.old_string || "").split("\n").length;
    const newTotal = (args.new_string || "").split("\n").length;
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="yellow" bold>{style.icon} </Text>
          <Text color="yellow" bold>{style.label}</Text>
          <Text dimColor>  {args.file_path || args.path || ""}</Text>
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          {oldLines.map((line: string, i: number) => (
            <Text key={`o${i}`} color="red">- {line}</Text>
          ))}
          {oldTotal > EDIT_PREVIEW_LINES && <Text dimColor>  (-{oldTotal - EDIT_PREVIEW_LINES} more)</Text>}
          {newLines.map((line: string, i: number) => (
            <Text key={`n${i}`} color="green">+ {line}</Text>
          ))}
          {newTotal > EDIT_PREVIEW_LINES && <Text dimColor>  (+{newTotal - EDIT_PREVIEW_LINES} more)</Text>}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={style.color as any} bold={!isPassive}>{style.icon} </Text>
        <Text color={style.color as any} bold={!isPassive} dimColor={isPassive}>{style.label}</Text>
      </Box>
      {msg.content && (
        <Text dimColor>  {msg.content}</Text>
      )}
    </Box>
  );
}

function TodoBlock({ todos }: { todos: TodoItem[] }) {
  const done = todos.filter((t) => t.status === "completed").length;
  const allDone = done === todos.length;

  if (allDone) {
    return (
      <Box>
        <Text color="green" bold>✓ </Text>
        <Text color="green">All done  </Text>
        <Text dimColor>{done}/{todos.length} tasks completed</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {todos.map((t, i) => {
        if (t.status === "completed") {
          return (
            <Box key={i}>
              <Text color="green">  ✓  </Text>
              <Text dimColor>{t.content}</Text>
            </Box>
          );
        }
        if (t.status === "in_progress") {
          return (
            <Box key={i}>
              <Text color="magenta" bold>  ●  </Text>
              <Text bold>{t.content}</Text>
            </Box>
          );
        }
        return (
          <Box key={i}>
            <Text dimColor>  ○  {t.content}</Text>
          </Box>
        );
      })}
      <Text dimColor>  ─────────────────────</Text>
      <Text dimColor>  {done}/{todos.length} done</Text>
    </Box>
  );
}

function MessageLine({ msg }: { msg: ChatMessage }) {
  switch (msg.type) {
    case "user":
      return <Text><Text bold color="magenta">You  </Text>{msg.content}</Text>;
    case "assistant":
    case "streaming":
      return <Text>{msg.content}</Text>;
    case "tool":
      return <ToolLine msg={msg} />;
    case "todo":
      return <TodoBlock todos={msg.todos || []} />;
    case "error":
      return <Text color="red">{msg.content}</Text>;
    case "info":
      return <Text dimColor>{msg.content}</Text>;
    case "success":
      return <Text color="green">✔ {msg.content}</Text>;
  }
}
