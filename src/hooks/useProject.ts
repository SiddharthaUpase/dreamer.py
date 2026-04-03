"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tools?: ToolActivity[];
}

export interface ToolActivity {
  tool: string;
  args?: Record<string, unknown>;
  status: "running" | "done";
}

export interface ContextInfo {
  tokens: number;
  limit: number;
}

export type SandboxStatus = "loading" | "ready" | "error";

const API = "http://localhost:3001";

export const MODEL_PRESETS = [
  { id: "minimax",       name: "lite", desc: "fast and lightweight" },
  { id: "mimo",          name: "pro",  desc: "thorough and reliable" },
  { id: "claude-sonnet", name: "max",  desc: "expert with vision" },
] as const;

export const CUSTOM_MODELS = [
  { id: "claude-sonnet", label: "Claude Sonnet 4.6",  desc: "vision, expert reasoning" },
  { id: "claude-haiku",  label: "Claude Haiku 4.5",   desc: "fast, vision support" },
  { id: "minimax",       label: "MiniMax M2.7",       desc: "lightweight, fast tasks" },
  { id: "kimi",          label: "Kimi K2.5",          desc: "long context, reasoning" },
  { id: "mimo",          label: "MiMo V2 Pro",        desc: "thorough, code-focused" },
  { id: "kat-coder",     label: "KAT-Coder Pro V2",   desc: "enterprise coding, SaaS" },
];

// Kept for backwards compat — flat list used by legacy callers
export const MODEL_OPTIONS = CUSTOM_MODELS;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// Convert DB messages (human/ai/tool) to frontend ChatMessages (user/assistant with tools)
function dbMessagesToChat(dbMessages: any[]): ChatMessage[] {
  const chatMessages: ChatMessage[] = [];
  let i = 0;

  while (i < dbMessages.length) {
    const msg = dbMessages[i];

    if (msg.role === "human") {
      chatMessages.push({ role: "user", content: msg.content });
      i++;
    } else if (msg.role === "ai") {
      // Check if this AI message has tool_calls — if so, collect the tool chain
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const tools: ToolActivity[] = [];

        // Walk forward through ai+tool pairs until we hit a final ai (no tool_calls)
        let j = i;
        while (j < dbMessages.length) {
          const current = dbMessages[j];
          if (current.role === "ai" && current.tool_calls?.length > 0) {
            for (const tc of current.tool_calls) {
              tools.push({ tool: tc.name, args: tc.args, status: "done" });
            }
            j++;
          } else if (current.role === "tool") {
            j++;
          } else {
            break;
          }
        }

        // j now points to the final AI message (with content, no tool_calls)
        if (j < dbMessages.length && dbMessages[j].role === "ai") {
          chatMessages.push({
            role: "assistant",
            content: dbMessages[j].content || "",
            tools: tools.length > 0 ? tools : undefined,
          });
          i = j + 1;
        } else {
          // No final AI message found, show what we have
          chatMessages.push({
            role: "assistant",
            content: msg.content || "",
            tools: tools.length > 0 ? tools : undefined,
          });
          i = j;
        }
      } else {
        // Plain AI message (no tool calls) — just text
        chatMessages.push({ role: "assistant", content: msg.content });
        i++;
      }
    } else {
      // Skip orphan tool messages
      i++;
    }
  }

  return chatMessages;
}

export function useProject(projectId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus>("loading");
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("claude-sonnet");
  const [contextInfo, setContextInfo] = useState<ContextInfo | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Wake sandbox on mount
  useEffect(() => {
    let cancelled = false;
    setSandboxStatus("loading");

    async function openProject() {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API}/api/projects/${projectId}/open`, {
          method: "POST",
          headers,
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.previewUrl) setPreviewUrl(data.previewUrl);
        if (data.name) setProjectName(data.name);
        if (data.messages?.length) {
          setMessages(dbMessagesToChat(data.messages));
        }
        if (data.contextTokens != null) {
          setContextInfo({ tokens: data.contextTokens, limit: data.contextLimit });
        }
        setSandboxStatus("ready");
      } catch (err: any) {
        if (cancelled) return;
        setSandboxError(err.message);
        setSandboxStatus("error");
      }
    }

    openProject();
    return () => { cancelled = true; };
  }, [projectId]);

  // Clear in-memory ref when leaving — Blaxel auto-scales to zero
  const handleClose = useCallback(() => {
    navigator.sendBeacon(
      `${API}/api/projects/${projectId}/close`,
      new Blob([JSON.stringify({})], { type: "application/json" })
    );
  }, [projectId]);

  useEffect(() => {
    window.addEventListener("beforeunload", handleClose);
    return () => {
      window.removeEventListener("beforeunload", handleClose);
    };
  }, [handleClose]);

  const handleClearChat = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API}/api/projects/${projectId}/clear-chat`, {
        method: "POST",
        headers,
      });
      setMessages([]);
      setContextInfo(null);
    } catch { /* ignore */ }
  }, [projectId]);

  const [compacting, setCompacting] = useState(false);

  const handleCompact = useCallback(async () => {
    setCompacting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/api/projects/${projectId}/compact`, {
        method: "POST",
        headers,
      });
      const data = await res.json();
      if (data.tokens != null) {
        setContextInfo({ tokens: data.tokens, limit: data.limit });
      }
      // Reload messages from server
      const openRes = await fetch(`${API}/api/projects/${projectId}/open`, {
        method: "POST",
        headers,
      });
      const openData = await openRes.json();
      if (openData.messages?.length) {
        setMessages(dbMessagesToChat(openData.messages));
      } else {
        setMessages([]);
      }
    } catch { /* ignore */ }
    setCompacting(false);
  }, [projectId]);

  const handleAbort = useCallback(async () => {
    abortRef.current?.abort();
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API}/api/projects/${projectId}/abort`, {
        method: "POST",
        headers,
      });
    } catch { /* ignore */ }
    setLoading(false);
    setToolActivities([]);
    setMessages((prev) => [...prev, { role: "assistant", content: "Aborted." }]);
  }, [projectId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setLoading(true);
    setToolActivities([]);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 30);

    const controller = new AbortController();
    abortRef.current = controller;

    let runTools: ToolActivity[] = [];

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/api/projects/${projectId}/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: text, model: selectedModel }),
        signal: controller.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let finalMessages = nextMessages;
      let streamingContent = ""; // Accumulates token chunks for live display
      let isStreaming = false;   // Whether we're in a token-streaming phase

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === "token") {
              streamingContent += event.content || "";
              if (!isStreaming) {
                isStreaming = true;
                // Add a new streaming assistant message
                finalMessages = [...finalMessages, {
                  role: "assistant" as const,
                  content: streamingContent,
                  tools: runTools.length > 0 ? [...runTools] : undefined,
                }];
              } else {
                // Update the last message in place
                finalMessages = [
                  ...finalMessages.slice(0, -1),
                  {
                    role: "assistant" as const,
                    content: streamingContent,
                    tools: runTools.length > 0 ? [...runTools] : undefined,
                  },
                ];
              }
              setMessages(finalMessages);
            } else if (event.type === "tool_start") {
              // If we were streaming text, finalize that message before tool calls
              if (isStreaming) {
                isStreaming = false;
                streamingContent = "";
              }
              const newTool: ToolActivity = { tool: event.tool, args: event.args, status: "running" };
              runTools = [...runTools, newTool];
              setToolActivities([...runTools]);
              if (event.contextTokens != null) {
                setContextInfo({ tokens: event.contextTokens, limit: event.contextLimit });
              }
            } else if (event.type === "tool_end") {
              runTools = runTools.map((t) =>
                t.tool === event.tool && t.status === "running" ? { ...t, status: "done" } : t
              );
              setToolActivities([...runTools]);
              if (event.contextTokens != null) {
                setContextInfo({ tokens: event.contextTokens, limit: event.contextLimit });
              }
              if (event.tool === "edit" || event.tool === "write") {
                setIframeKey((k) => k + 1);
              }
              if (event.tool === "preview_url" && event.output) {
                const urlMatch = event.output.match(/https?:\/\/[^\s]+/);
                if (urlMatch) setPreviewUrl(urlMatch[0]);
              }
            } else if (event.type === "result") {
              // Final result replaces any streaming message with the complete content
              isStreaming = false;
              streamingContent = "";
              // Remove any in-progress streaming message before adding the final one
              const base = finalMessages[finalMessages.length - 1]?.role === "assistant"
                ? finalMessages.slice(0, -1)
                : finalMessages;
              const assistantMsg: ChatMessage = {
                role: "assistant",
                content: event.content || "",
                tools: runTools.length > 0 ? [...runTools] : undefined,
              };
              finalMessages = [...base, assistantMsg];
              setMessages(finalMessages);
              if (event.contextTokens != null && event.contextLimit != null) {
                setContextInfo({ tokens: event.contextTokens, limit: event.contextLimit });
              }
            } else if (event.type === "error") {
              isStreaming = false;
              streamingContent = "";
              const errMsg: ChatMessage = {
                role: "assistant",
                content: `Error: ${event.content}`,
              };
              finalMessages = [...finalMessages, errMsg];
              setMessages(finalMessages);
            }
          } catch {
            // skip malformed lines
          }
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Failed to connect to backend" },
        ]);
      }
    } finally {
      setLoading(false);
      setToolActivities([]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [input, loading, messages, projectId, selectedModel]);

  return {
    messages,
    projectName,
    input,
    setInput,
    loading,
    toolActivities,
    previewUrl,
    iframeKey,
    setIframeKey,
    sandboxStatus,
    sandboxError,
    selectedModel,
    setSelectedModel,
    contextInfo,
    compacting,
    messagesEndRef,
    handleSend,
    handleAbort,
    handleClose,
    handleClearChat,
    handleCompact,
  };
}
