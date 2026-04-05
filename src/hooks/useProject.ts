"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export type StreamSegment =
  | { type: "text"; content: string }
  | { type: "tool"; tool: string; args?: Record<string, unknown>; output?: string; status: "running" | "done" };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  segments?: StreamSegment[];
}

// Legacy alias for components that reference this type
export interface ToolActivity {
  tool: string;
  args?: Record<string, unknown>;
  output?: string;
  status: "running" | "done";
}

export interface ContextInfo {
  tokens: number;
  limit: number;
}

export type SandboxStatus = "loading" | "ready" | "error";

export interface UploadedFile {
  fileName: string;
  remotePath: string;
  size: string;
}

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export const MODEL_PRESETS = [
  { id: "minimax",       name: "lite", label: "Lite — fast and lightweight", desc: "fast and lightweight" },
  { id: "mimo",          name: "pro",  label: "Pro — thorough and reliable", desc: "thorough and reliable" },
  { id: "claude-sonnet", name: "max",  label: "Max — expert with vision", desc: "expert with vision" },
] as const;

export const CUSTOM_MODELS = [
  { id: "claude-sonnet", label: "Claude Sonnet 4.6",  desc: "vision, expert reasoning" },
  { id: "claude-haiku",  label: "Claude Haiku 4.5",   desc: "fast, vision support" },
  { id: "minimax",       label: "MiniMax M2.7",       desc: "lightweight, fast tasks" },
  { id: "kimi",          label: "Kimi K2.5",          desc: "long context, reasoning" },
  { id: "mimo",          label: "MiMo V2 Pro",        desc: "thorough, code-focused" },
  { id: "kat-coder",     label: "KAT-Coder Pro V2",   desc: "enterprise coding, SaaS" },
  { id: "qwen",          label: "Qwen 3.6 Plus Preview", desc: "preview model" },
];

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

// Convert DB messages (human/ai/tool) to frontend ChatMessages with interleaved segments
function dbMessagesToChat(dbMessages: any[]): ChatMessage[] {
  const chatMessages: ChatMessage[] = [];
  let i = 0;

  while (i < dbMessages.length) {
    const msg = dbMessages[i];

    if (msg.role === "human") {
      chatMessages.push({ role: "user", content: msg.content });
      i++;
    } else if (msg.role === "ai") {
      // Check if this AI message has tool_calls — if so, collect interleaved segments
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const segments: StreamSegment[] = [];

        // Walk forward through ai+tool pairs until we hit a final ai (no tool_calls)
        let j = i;
        while (j < dbMessages.length) {
          const current = dbMessages[j];
          if (current.role === "ai" && current.tool_calls?.length > 0) {
            // Add reasoning text as a text segment if present
            if (current.content && current.content.trim()) {
              segments.push({ type: "text", content: current.content });
            }
            // Add each tool call as a tool segment
            for (const tc of current.tool_calls) {
              segments.push({ type: "tool", tool: tc.name, args: tc.args, status: "done" });
            }
            j++;
          } else if (current.role === "tool") {
            // Match tool output to the last tool segment
            const lastTool = [...segments].reverse().find((s) => s.type === "tool" && !("output" in s && s.output));
            if (lastTool && lastTool.type === "tool") {
              lastTool.output = current.content?.slice(0, 200);
            }
            j++;
          } else {
            break;
          }
        }

        // j now points to the final AI message (with content, no tool_calls)
        let finalContent = "";
        if (j < dbMessages.length && dbMessages[j].role === "ai") {
          finalContent = dbMessages[j].content || "";
          // Add final text as a segment too
          if (finalContent.trim()) {
            segments.push({ type: "text", content: finalContent });
          }
          j++;
        }

        chatMessages.push({
          role: "assistant",
          content: finalContent,
          segments: segments.length > 0 ? segments : undefined,
        });
        i = j;
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
  const [previewPort, setPreviewPort] = useState<number>(3000);
  const [projectTemplate, setProjectTemplate] = useState<string>("nextjs");
  const [terminalUrl, setTerminalUrl] = useState<string | null>(null);
  const [savedLayout, setSavedLayout] = useState<any>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus>("loading");
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("mimo");
  const [contextInfo, setContextInfo] = useState<ContextInfo | null>(null);
  const [pendingUploads, setPendingUploads] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Share project with another user by email
  const handleShare = useCallback(async (email: string): Promise<{ status: string; error?: string }> => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/api/projects/${projectId}/share`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { status: "error", error: data.error || `Share failed (${res.status})` };
      }
      return { status: data.status };
    } catch (err: any) {
      return { status: "error", error: err.message };
    }
  }, [projectId]);

  // Upload files to sandbox
  const handleUploadFiles = useCallback(async (files: FileList | File[]) => {
    setUploading(true);
    const headers = await getAuthHeaders();
    const results: UploadedFile[] = [];
    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`${API}/api/projects/${projectId}/upload`, {
          method: "POST",
          headers: { ...(headers.Authorization ? { Authorization: headers.Authorization } : {}) },
          body: formData,
        });
        if (!res.ok) continue;
        const data = await res.json();
        const size = file.size < 1024
          ? `${file.size}B`
          : file.size < 1048576
            ? `${(file.size / 1024).toFixed(1)}KB`
            : `${(file.size / 1048576).toFixed(1)}MB`;
        results.push({ fileName: file.name, remotePath: data.path, size });
      } catch { /* skip failed */ }
    }
    setPendingUploads((prev) => [...prev, ...results]);
    setUploading(false);
    return results;
  }, [projectId]);

  const removePendingUpload = useCallback((index: number) => {
    setPendingUploads((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Change preview port — creates a new preview URL for the given port
  const changePreviewPort = useCallback(async (port: number): Promise<string | null> => {
    setPreviewPort(port);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/api/projects/${projectId}/preview`, {
        method: "POST",
        headers,
        body: JSON.stringify({ port }),
      });
      const data = await res.json();
      if (!res.ok) {
        return data.error || `Failed (${res.status})`;
      }
      if (data.previewUrl) {
        setPreviewUrl(data.previewUrl);
        setIframeKey((k) => k + 1);
      }
      return null;
    } catch (err: any) {
      console.error("[useProject] changePreviewPort error:", err.message);
      return err.message || "Failed to change port";
    }
  }, [projectId]);

  // Wake sandbox on mount
  useEffect(() => {
    let cancelled = false;
    setSandboxStatus("loading");

    async function openProject() {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API}/api/projects/${projectId}/connect`, {
          method: "POST",
          headers,
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.previewUrl) setPreviewUrl(data.previewUrl);
        if (data.terminalUrl) setTerminalUrl(data.terminalUrl);
        if (data.name) setProjectName(data.name);
        if (data.template) setProjectTemplate(data.template);
        console.log("[useProject] connect response layout:", data.layout ? "present" : "null");
        if (data.layout) setSavedLayout(data.layout);
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
      await fetch(`${API}/api/projects/${projectId}/history`, {
        method: "DELETE",
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
      const openRes = await fetch(`${API}/api/projects/${projectId}/connect`, {
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

  const handleSend = useCallback(async (extraUploads?: UploadedFile[]) => {
    const text = input.trim();
    const allUploads = [...pendingUploads, ...(extraUploads || [])];
    if (!text && allUploads.length === 0) return;
    if (loading) return;

    // Build the message sent to the agent (includes upload paths)
    let agentMessage = text || "See the attached file(s).";
    if (allUploads.length > 0) {
      const uploads = allUploads.map((u) => `[uploaded file: ${u.remotePath}]`).join("\n");
      agentMessage = uploads + "\n" + (text || "");
      setPendingUploads([]);
    }

    setInput("");
    // Show the clean text to the user (without upload prefixes)
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setLoading(true);
    setToolActivities([]);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 30);

    const controller = new AbortController();
    abortRef.current = controller;

    // Build interleaved segments during streaming
    let segments: StreamSegment[] = [];
    let currentTextContent = ""; // accumulates token chunks for the current text segment

    /** Helper: update the assistant message in the messages array with current segments */
    const updateAssistantMsg = (msgs: ChatMessage[]) => {
      const lastContent = segments.filter((s) => s.type === "text").map((s) => s.content).join("");
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: lastContent,
        segments: [...segments],
      };
      // Replace existing assistant msg or add new one
      if (msgs[msgs.length - 1]?.role === "assistant") {
        return [...msgs.slice(0, -1), assistantMsg];
      }
      return [...msgs, assistantMsg];
    };

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/api/projects/${projectId}/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: agentMessage, model: selectedModel }),
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

            if (event.type === "token") {
              currentTextContent += event.content || "";
              // Update or create the current text segment
              const lastSeg = segments[segments.length - 1];
              if (lastSeg && lastSeg.type === "text") {
                lastSeg.content = currentTextContent;
              } else {
                // New text segment (after tool calls or at start)
                currentTextContent = event.content || "";
                segments.push({ type: "text", content: currentTextContent });
              }
              finalMessages = updateAssistantMsg(finalMessages);
              setMessages(finalMessages);
            } else if (event.type === "tool_start") {
              // Finalize any current text segment before adding tool
              currentTextContent = "";
              const toolSeg: StreamSegment = { type: "tool", tool: event.tool, args: event.args, status: "running" };
              segments.push(toolSeg);
              // Also update legacy toolActivities for the loading spinner area
              const toolActivitiesFromSegments = segments
                .filter((s): s is StreamSegment & { type: "tool" } => s.type === "tool")
                .map((s) => ({ tool: s.tool, args: s.args, output: s.output, status: s.status }));
              setToolActivities(toolActivitiesFromSegments);
              finalMessages = updateAssistantMsg(finalMessages);
              setMessages(finalMessages);
              if (event.contextTokens != null) {
                setContextInfo({ tokens: event.contextTokens, limit: event.contextLimit });
              }
            } else if (event.type === "tool_end") {
              // Find the matching running tool segment and update it
              for (let si = segments.length - 1; si >= 0; si--) {
                const s = segments[si];
                if (s.type === "tool" && s.tool === event.tool && s.status === "running") {
                  s.status = "done";
                  s.output = event.output;
                  break;
                }
              }
              const toolActivitiesFromSegments = segments
                .filter((s): s is StreamSegment & { type: "tool" } => s.type === "tool")
                .map((s) => ({ tool: s.tool, args: s.args, output: s.output, status: s.status }));
              setToolActivities(toolActivitiesFromSegments);
              finalMessages = updateAssistantMsg(finalMessages);
              setMessages(finalMessages);
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
              // Final result — add or update the final text segment
              currentTextContent = "";
              const resultContent = event.content || "";
              if (resultContent.trim()) {
                const lastSeg = segments[segments.length - 1];
                if (lastSeg && lastSeg.type === "text") {
                  lastSeg.content = resultContent;
                } else {
                  segments.push({ type: "text", content: resultContent });
                }
              }
              finalMessages = updateAssistantMsg(finalMessages);
              setMessages(finalMessages);
              if (event.contextTokens != null && event.contextLimit != null) {
                setContextInfo({ tokens: event.contextTokens, limit: event.contextLimit });
              }
            } else if (event.type === "error") {
              currentTextContent = "";
              segments.push({ type: "text", content: `Error: ${event.content}` });
              finalMessages = updateAssistantMsg(finalMessages);
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
  }, [input, loading, messages, pendingUploads, projectId, selectedModel]);

  const saveLayout = useCallback(async (layout: any) => {
    try {
      const headers = await getAuthHeaders();
      console.log("[useProject] PUT layout to server...");
      const res = await fetch(`${API}/api/projects/${projectId}/layout`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ layout }),
      });
      console.log("[useProject] PUT layout response:", res.status);
    } catch (err: any) {
      console.error("[useProject] save layout failed:", err.message);
    }
  }, [projectId]);

  const [deploying, setDeploying] = useState(false);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);

  const handleDeploy = useCallback(async () => {
    setDeploying(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "Deploying to Vercel..." }]);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/api/projects/${projectId}/deploy`, {
        method: "POST",
        headers,
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
            if (event.type === "result" && event.url) {
              setDeployUrl(event.url);
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: `Deployed! ${event.url}` },
              ]);
            } else if (event.type === "error") {
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: `Deploy failed: ${event.message || event.content}` },
              ]);
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: `Deploy failed: ${err.message}` },
      ]);
    }
    setDeploying(false);
  }, [projectId]);

  const handleUploadFile = useCallback(async (file: File) => {
    const headers = await getAuthHeaders();
    delete headers["Content-Type"];
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/upload`, {
        method: "POST",
        headers,
        body: formData,
      });
      const data = await res.json();
      return data.path as string;
    } catch {
      return null;
    }
  }, [projectId]);

  return {
    messages,
    projectName,
    input,
    setInput,
    loading,
    toolActivities,
    previewUrl,
    previewPort,
    projectTemplate,
    changePreviewPort,
    terminalUrl,
    iframeKey,
    setIframeKey,
    sandboxStatus,
    sandboxError,
    selectedModel,
    setSelectedModel,
    contextInfo,
    compacting,
    deploying,
    deployUrl,
    savedLayout,
    saveLayout,
    messagesEndRef,
    pendingUploads,
    uploading,
    handleSend,
    handleAbort,
    handleClose,
    handleClearChat,
    handleCompact,
    handleDeploy,
    handleUploadFile,
    handleShare,
    handleUploadFiles,
    removePendingUpload,
  };
}
