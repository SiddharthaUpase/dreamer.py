"use client";

import { useRef, useCallback, useState, useEffect } from "react";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface OutputFile {
  name: string;
  path: string;
  content: string;
  size: number;
}

export interface ToolActivity {
  tool: string;
  args?: Record<string, unknown>;
  status: "running" | "done";
}

interface UseAgentChatOpts {
  nodeId: string;
  savedMessages?: ChatMessage[];
  savedModel?: string;
  savedPreviewUrl?: string;
  onMessagesChange?: (id: string, messages: ChatMessage[]) => void;
  onModelChange?: (id: string, model: string) => void;
  onPreviewUrlChange?: (id: string, url: string) => void;
}

export function useAgentChat({
  nodeId,
  savedMessages,
  savedModel,
  savedPreviewUrl,
  onMessagesChange,
  onModelChange,
  onPreviewUrlChange,
}: UseAgentChatOpts) {
  const [messages, setMessages] = useState<ChatMessage[]>(savedMessages || []);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState(savedModel || "claude-sonnet");
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(savedPreviewUrl || null);
  const [iframeKey, setIframeKey] = useState(0);
  const [outputFiles, setOutputFiles] = useState<OutputFile[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Persist messages when they change (skip initial load)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onMessagesChange?.(nodeId, messages);
  }, [messages, nodeId, onMessagesChange]);

  const changeModel = useCallback(
    (model: string) => {
      setSelectedModel(model);
      onModelChange?.(nodeId, model);
    },
    [nodeId, onModelChange]
  );

  const handleAbort = useCallback(async () => {
    abortRef.current?.abort();
    try {
      await fetch("http://localhost:3001/api/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: nodeId }),
      });
    } catch { /* ignore */ }
    setLoading(false);
    setToolActivities([]);
    setMessages((prev) => [...prev, { role: "assistant", content: "Aborted." }]);
  }, [nodeId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setToolActivities([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, agentId: nodeId, model: selectedModel }),
        signal: controller.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";

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
              setToolActivities((prev) => [
                ...prev,
                { tool: event.tool, args: event.args, status: "running" },
              ]);
            } else if (event.type === "tool_end") {
              setToolActivities((prev) =>
                prev.map((t) =>
                  t.tool === event.tool && t.status === "running"
                    ? { ...t, status: "done" }
                    : t
                )
              );
              if (event.tool === "edit") {
                setIframeKey((k) => k + 1);
              }
              if (event.tool === "preview_url" && event.output) {
                const urlMatch = event.output.match(/https?:\/\/[^\s]+/);
                if (urlMatch) {
                  const url = urlMatch[0];
                  setPreviewUrl(url);
                  onPreviewUrlChange?.(nodeId, url);
                }
              }
            } else if (event.type === "result") {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: event.content || "Done" },
              ]);
            } else if (event.type === "error") {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: `Error: ${event.content}` },
              ]);
            } else if (event.type === "outputs" && event.files?.length) {
              setOutputFiles(event.files);
            }
          } catch {
            // skip malformed lines
          }
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to connect to backend" },
      ]);
    } finally {
      setLoading(false);
      setToolActivities([]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [input, loading, nodeId, selectedModel, onPreviewUrlChange]);

  return {
    messages,
    input,
    setInput,
    loading,
    selectedModel,
    changeModel,
    toolActivities,
    previewUrl,
    setPreviewUrl,
    iframeKey,
    setIframeKey,
    outputFiles,
    setOutputFiles,
    messagesEndRef,
    handleSend,
    handleAbort,
  };
}

export type AgentChatState = ReturnType<typeof useAgentChat>;
