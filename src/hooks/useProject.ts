"use client";

import { useRef, useCallback, useState, useEffect } from "react";

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

export type SandboxStatus = "loading" | "ready" | "error";

const API = "http://localhost:3001";

export const MODEL_OPTIONS = [
  { id: "claude-sonnet", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku",  label: "Claude Haiku 4.5"  },
  { id: "minimax",       label: "MiniMax M2.5"       },
  { id: "kimi",          label: "Kimi K2.5"          },
];

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Wake sandbox on mount
  useEffect(() => {
    let cancelled = false;
    setSandboxStatus("loading");

    async function openProject() {
      try {
        const res = await fetch(`${API}/api/projects/${projectId}/open`, { method: "POST" });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.previewUrl) setPreviewUrl(data.previewUrl);
        if (data.name) setProjectName(data.name);
        if (data.messages?.length) setMessages(data.messages);
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

  // Persist messages after each exchange
  const persistMessages = useCallback(async (msgs: ChatMessage[]) => {
    try {
      await fetch(`${API}/api/projects/${projectId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs }),
      });
    } catch { /* ignore */ }
  }, [projectId]);

  const handleAbort = useCallback(async () => {
    abortRef.current?.abort();
    try {
      await fetch(`${API}/api/projects/${projectId}/abort`, { method: "POST" });
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
    // Scroll immediately so user sees their own message
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 30);

    const controller = new AbortController();
    abortRef.current = controller;

    // Local mirror of tool activities for this run (state may be stale in async closure)
    let runTools: ToolActivity[] = [];

    try {
      const res = await fetch(`${API}/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, model: selectedModel }),
        signal: controller.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let finalMessages = nextMessages;

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

            if (event.type === "tool_start") {
              const newTool: ToolActivity = { tool: event.tool, args: event.args, status: "running" };
              runTools = [...runTools, newTool];
              setToolActivities([...runTools]);
            } else if (event.type === "tool_end") {
              runTools = runTools.map((t) =>
                t.tool === event.tool && t.status === "running" ? { ...t, status: "done" } : t
              );
              setToolActivities([...runTools]);
              // Refresh iframe on file edits
              if (event.tool === "edit" || event.tool === "write") {
                setIframeKey((k) => k + 1);
              }
              // Capture preview URL when agent calls preview_url tool
              if (event.tool === "preview_url" && event.output) {
                const urlMatch = event.output.match(/https?:\/\/[^\s]+/);
                if (urlMatch) setPreviewUrl(urlMatch[0]);
              }
            } else if (event.type === "result") {
              const assistantMsg: ChatMessage = {
                role: "assistant",
                content: event.content || "Done",
                tools: runTools.length > 0 ? [...runTools] : undefined,
              };
              finalMessages = [...finalMessages, assistantMsg];
              setMessages(finalMessages);
            } else if (event.type === "error") {
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

      persistMessages(finalMessages);
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
  }, [input, loading, messages, projectId, persistMessages]);

  return {
    messages,
    projectName,
    input,
    setInput,
    loading,
    toolActivities,
    previewUrl,
    iframeKey,
    sandboxStatus,
    sandboxError,
    selectedModel,
    setSelectedModel,
    messagesEndRef,
    handleSend,
    handleAbort,
  };
}
