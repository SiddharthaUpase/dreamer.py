import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, useInput, useApp, useStdout } from "ink";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import { ApiClient } from "../apiClient.js";
import { formatToolArgs, formatToolOutput, truncate } from "../format.js";
import { detectFiles, uploadFiles } from "../files.js";
import { enableBracketedPaste, disableBracketedPaste, isPasting } from "../keyboard.js";

const MODELS = ["claude-sonnet", "claude-haiku", "minimax", "kimi", "mimo"];

interface ProjectInfo {
  id: string;
  name: string;
  previewUrl?: string;
  messageCount: number;
  messages: any[];
}

interface ChatMessage {
  type: "user" | "assistant" | "tool" | "error" | "info";
  content: string;
}

interface Props {
  api: ApiClient;
  project: ProjectInfo;
  model: string;
  onModelChange: (model: string) => void;
  onSwitchProject: () => void;
  onLogout: () => void;
}

type Phase = "input" | "streaming" | "model-select";

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
  const [streamText, setStreamText] = useState("");
  const [toolStatus, setToolStatus] = useState("");
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Batch token updates — accumulate in ref, flush every 50ms
  const tokenBuffer = useRef("");
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTokenBatching = useCallback(() => {
    tokenBuffer.current = "";
    if (flushTimer.current) clearInterval(flushTimer.current);
    flushTimer.current = setInterval(() => {
      if (tokenBuffer.current) {
        const chunk = tokenBuffer.current;
        tokenBuffer.current = "";
        setStreamText((prev) => prev + chunk);
      }
    }, 50);
  }, []);

  const stopTokenBatching = useCallback(() => {
    if (flushTimer.current) {
      clearInterval(flushTimer.current);
      flushTimer.current = null;
    }
    // Flush remaining
    if (tokenBuffer.current) {
      const chunk = tokenBuffer.current;
      tokenBuffer.current = "";
      setStreamText((prev) => prev + chunk);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (flushTimer.current) clearInterval(flushTimer.current);
    };
  }, []);

  // Bracketed paste: store as a named block, display as summary
  useEffect(() => {
    enableBracketedPaste((text) => {
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
      stopTokenBatching();
      setAbortController(null);
      setPhase("input");
      setToolStatus("");
      addMessage("info", "Aborted.");
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

    // Handle commands
    if (text.startsWith("/")) {
      await handleCommand(text.trim());
      return;
    }

    // Detect and upload files
    let processedText = text;
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
    setStreamText("");
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
          case "tool_start":
            setToolStatus(`⚡ ${event.tool} ${formatToolArgs(event.tool, event.args || {})}`);
            break;
          case "tool_end": {
            const output = formatToolOutput(event.tool, event.output || "");
            addMessage("tool", `✓ ${event.tool}${output ? "\n" + output : ""}`);
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
              const lines = event.todos.map((t: any) => {
                const icon = t.status === "completed" ? "✓" : t.status === "in_progress" ? "•" : "✗";
                return `  ${icon} ${t.content}`;
              });
              addMessage("info", `📋 Todos:\n${lines.join("\n")}`);
            }
            break;
          case "subagent_log":
            addMessage("info", `  ${event.label} → ${event.tool} ${event.detail || ""}`);
            break;
        }
      }, controller.signal);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        addMessage("error", err.message);
      }
    }

    stopTokenBatching();

    // Flush streaming text as assistant message
    setStreamText((prev) => {
      if (prev) {
        setMessages((msgs) => [...msgs, { type: "assistant", content: prev }]);
      }
      return "";
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
        addMessage("info", "History cleared.");
        break;

      case "/compact": {
        const res = await api.request(`/api/projects/${project.id}/compact`, { method: "POST" });
        const data = (await res.json()) as any;
        addMessage("info", `Compacted ${data.before} → ${data.after} messages.`);
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
              setStreamText((prev) => prev + (event.content || ""));
            } else if (event.type === "error") {
              addMessage("error", event.content || event.message || "Deploy failed");
            } else if (event.url) {
              addMessage("info", `Deployed: ${event.url}`);
            }
          });
        } catch (err: any) {
          addMessage("error", err.message);
        }
        setStreamText((prev) => {
          if (prev) setMessages((msgs) => [...msgs, { type: "info", content: prev }]);
          return "";
        });
        setToolStatus("");
        setPhase("input");
        break;
      }

      case "/help":
        addMessage("info", [
          "Available commands:",
          "  /clear      — clear conversation history",
          "  /compact    — summarise history to save context",
          "  /history    — show message count",
          "  /url        — show preview URL",
          "  /model      — switch AI model",
          "  /projects   — switch project",
          "  /deploy     — deploy to Vercel",
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
    return msg.content.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length || 1) / cols)), 0);
  }

  // Reserve rows: 1 header + 1 stream + 1 tool status + 3 input + 1 bottom padding
  const reserved = 7;
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

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text dimColor>Model: {model} | type /help for commands</Text>
      </Box>

      {/* Scroll indicator */}
      {hasMoreAbove && (
        <Text dimColor>  ↑ {windowStart} lines above · ↑/↓ to scroll</Text>
      )}

      {/* Messages */}
      {visibleMessages.map((msg, i) => (
        <MessageLine key={i} msg={msg} />
      ))}

      {/* Streaming response */}
      {streamText && <Text>{streamText}</Text>}

      {/* Tool status / spinner */}
      {phase === "streaming" && toolStatus && (
        <Text dimColor>
          <Text color="green"><Spinner type="dots" /></Text>
          {" "}{toolStatus}
        </Text>
      )}

      {/* Model picker */}
      {phase === "model-select" && (
        <Box flexDirection="column">
          <Text bold>Select a model:</Text>
          <SelectInput
            items={modelItems}
            onSelect={(item) => {
              onModelChange(item.value);
              addMessage("info", `Model: ${item.value}`);
              setPhase("input");
            }}
          />
        </Box>
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
                    color={i === clampedSuggestionIndex ? "cyan" : undefined}
                  >
                    {i === clampedSuggestionIndex ? "▶ " : "  "}
                    {s.name}
                  </Text>
                  <Text dimColor>{`  ${s.desc}`}</Text>
                </Box>
              ))}
            </Box>
          )}
          <Box flexDirection="row" flexWrap="wrap">
            <Text bold color="cyan">{`(${project.name}) > `}</Text>
            {parts.map((part, i) => {
              if (part.type === "paste") {
                return (
                  <Text key={i} color="yellow">{`[Pasted text #${part.index} +${part.lines} lines]`}</Text>
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
          <Text dimColor>  Type / for commands</Text>
        </Box>
      )}
      <Text> </Text>
    </Box>
  );
}

function MessageLine({ msg }: { msg: ChatMessage }) {
  switch (msg.type) {
    case "user":
      return <Text><Text bold color="cyan">You: </Text>{msg.content}</Text>;
    case "assistant":
      return <Text>{msg.content}</Text>;
    case "tool":
      return <Text color="green">{msg.content}</Text>;
    case "error":
      return <Text color="red">{msg.content}</Text>;
    case "info":
      return <Text dimColor>{msg.content}</Text>;
  }
}
