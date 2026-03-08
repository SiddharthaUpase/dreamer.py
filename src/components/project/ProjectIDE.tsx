"use client";

import { useState, useRef, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import SendIcon from "@mui/icons-material/Send";
import StopIcon from "@mui/icons-material/Stop";
import CircleIcon from "@mui/icons-material/Circle";
import SmartphoneIcon from "@mui/icons-material/Smartphone";
import DesktopWindowsIcon from "@mui/icons-material/DesktopWindows";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TerminalIcon from "@mui/icons-material/Terminal";
import DescriptionIcon from "@mui/icons-material/Description";
import EditNoteIcon from "@mui/icons-material/EditNote";
import SearchIcon from "@mui/icons-material/Search";
import BuildIcon from "@mui/icons-material/Build";
import LanguageIcon from "@mui/icons-material/Language";
import { useRouter } from "next/navigation";
import { useProject, MODEL_OPTIONS } from "@/hooks/useProject";
import type { ToolActivity } from "@/hooks/useProject";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const TOOL_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  bash:        { icon: <TerminalIcon    sx={{ fontSize: 11 }} />, label: "Bash",        color: "#16A34A" },
  read:        { icon: <DescriptionIcon sx={{ fontSize: 11 }} />, label: "Read",        color: "#2563EB" },
  write:       { icon: <EditNoteIcon    sx={{ fontSize: 11 }} />, label: "Write",       color: "#D97706" },
  edit:        { icon: <EditNoteIcon    sx={{ fontSize: 11 }} />, label: "Edit",        color: "#EA580C" },
  grep:        { icon: <SearchIcon      sx={{ fontSize: 11 }} />, label: "Grep",        color: "#7C3AED" },
  glob:        { icon: <SearchIcon      sx={{ fontSize: 11 }} />, label: "Glob",        color: "#6D28D9" },
  preview_url: { icon: <LanguageIcon    sx={{ fontSize: 11 }} />, label: "Preview URL", color: "#0891B2" },
  start_server:{ icon: <TerminalIcon    sx={{ fontSize: 11 }} />, label: "Start Server",color: "#16A34A" },
};

function getToolMeta(name: string) {
  return TOOL_META[name] || { icon: <BuildIcon sx={{ fontSize: 11 }} />, label: name, color: "#71717A" };
}

interface Props {
  projectId: string;
}

export default function ProjectIDE({ projectId }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<"mobile" | "desktop">("desktop");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const prevLoadingRef = useRef(false);

  const {
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
  } = useProject(projectId);

  // Show final response as a toast for 3s in direct mode
  useEffect(() => {
    if (prevLoadingRef.current && !loading && !expanded) {
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      if (lastAssistant) {
        setToast(lastAssistant.content);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setToast(null), 3500);
      }
    }
    prevLoadingRef.current = loading;
  }, [loading, expanded, messages]);

  if (sandboxStatus === "loading") {
    return <LoadingScreen message="Starting your sandbox..." />;
  }

  if (sandboxStatus === "error") {
    return <LoadingScreen message={`Failed to start sandbox: ${sandboxError}`} error />;
  }

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
      {/* Top bar */}
      <Box
        sx={{
          height: 52,
          px: 2,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          flexShrink: 0,
        }}
      >
        <Tooltip title="Back to projects">
          <IconButton size="small" onClick={() => router.push("/")} sx={{ color: "text.secondary" }}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Typography variant="body2" fontWeight={600} sx={{ color: "text.primary", flex: 1 }}>
          {projectName ?? "Loading..."}
        </Typography>

        {/* Model selector */}
        <Select
          size="small"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={loading}
          sx={{
            fontSize: "0.75rem",
            height: 28,
            "& .MuiOutlinedInput-notchedOutline": { borderColor: "divider" },
            "& .MuiSelect-select": { py: 0, px: 1.25 },
          }}
        >
          {MODEL_OPTIONS.map((m) => (
            <MenuItem key={m.id} value={m.id} sx={{ fontSize: "0.8rem" }}>
              {m.label}
            </MenuItem>
          ))}
        </Select>

        <Tooltip title="Refresh preview">
          <IconButton
            size="small"
            onClick={() => iframeRef.current?.contentWindow?.location.reload()}
            sx={{ color: "text.secondary" }}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Open in new tab">
          <IconButton
            size="small"
            disabled={!previewUrl}
            onClick={() => previewUrl && window.open(previewUrl, "_blank")}
            sx={{ color: "text.secondary" }}
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        {/* Mobile / Desktop toggle */}
        <Box sx={{ display: "flex", bgcolor: "#F4F4F5", borderRadius: 1.5, p: 0.4, gap: 0.25 }}>
          <Tooltip title="Mobile view">
            <IconButton
              size="small"
              onClick={() => setViewMode("mobile")}
              sx={{
                width: 26, height: 26, borderRadius: 1,
                color: viewMode === "mobile" ? "primary.main" : "text.secondary",
                bgcolor: viewMode === "mobile" ? "background.paper" : "transparent",
                boxShadow: viewMode === "mobile" ? "0 1px 3px rgb(0 0 0 / 0.1)" : "none",
                transition: "all 0.12s",
              }}
            >
              <SmartphoneIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Desktop view">
            <IconButton
              size="small"
              onClick={() => setViewMode("desktop")}
              sx={{
                width: 26, height: 26, borderRadius: 1,
                color: viewMode === "desktop" ? "primary.main" : "text.secondary",
                bgcolor: viewMode === "desktop" ? "background.paper" : "transparent",
                boxShadow: viewMode === "desktop" ? "0 1px 3px rgb(0 0 0 / 0.1)" : "none",
                transition: "all 0.12s",
              }}
            >
              <DesktopWindowsIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Box>

        <Tooltip title={expanded ? "Direct mode" : "Expanded mode"}>
          <IconButton
            size="small"
            onClick={() => setExpanded((v) => !v)}
            sx={{ color: expanded ? "primary.main" : "text.secondary" }}
          >
            {expanded ? <UnfoldLessIcon fontSize="small" /> : <UnfoldMoreIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>

      {/* Main area */}
      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {expanded ? (
          <>
            {/* Preview pane */}
            <Box
              sx={{
                flex: "0 0 60%",
                borderRight: "1px solid",
                borderColor: "divider",
                bgcolor: "#E8E8EC",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                p: 3,
              }}
            >
              <IframeFrame iframeRef={iframeRef} previewUrl={previewUrl} iframeKey={iframeKey} viewMode={viewMode} wide />
            </Box>

            {/* Chat panel */}
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", bgcolor: "background.paper", overflow: "hidden" }}>
              <Box sx={{ flex: 1, overflowY: "auto", px: 3, py: 2.5 }}>
                {messages.length === 0 && (
                  <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", mt: 4 }}>
                    Your sandbox is ready. What do you want to build?
                  </Typography>
                )}
                {messages.map((msg, i) => (
                  <ChatMessage key={i} role={msg.role} content={msg.content} tools={msg.tools} />
                ))}
                {loading && <ToolActivityList activities={toolActivities} isActive />}
                <div ref={messagesEndRef} />
              </Box>
              <ChatInputBar
                input={input}
                setInput={setInput}
                onSend={handleSend}
                onAbort={handleAbort}
                loading={loading}
              />
            </Box>
          </>
        ) : (
          /* Direct mode */
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <Box
              sx={{
                flex: 1,
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                p: viewMode === "mobile" ? 4 : 2,
                bgcolor: "#EBEBEF",
                overflow: "hidden",
              }}
            >
              <IframeFrame iframeRef={iframeRef} previewUrl={previewUrl} iframeKey={iframeKey} viewMode={viewMode} />

              {/* Tool calls overlay — floats above iframe bottom, max 3, older ones faded */}
              {loading && toolActivities.length > 0 && (
                <Box
                  sx={{
                    position: "absolute",
                    bottom: 16,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: "40%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 0.5,
                    pointerEvents: "none",
                  }}
                >
                  {toolActivities.slice(-3).map((activity, i, arr) => {
                    const meta = getToolMeta(activity.tool);
                    const isRunning = activity.status === "running";
                    const age = arr.length - 1 - i; // 0 = newest, 2 = oldest shown
                    const opacity = age === 0 ? 1 : age === 1 ? 0.5 : 0.2;
                    const argSummary = activity.args
                      ? Object.entries(activity.args)
                          .map(([, v]) => (typeof v === "string" ? v : JSON.stringify(v)))
                          .join(" ").slice(0, 60)
                      : "";
                    return (
                      <Box
                        key={i}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 0.75,
                          px: 1.25,
                          py: 0.5,
                          borderRadius: 1.5,
                          bgcolor: "rgba(255,255,255,0.88)",
                          backdropFilter: "blur(8px)",
                          border: "1px solid rgba(0,0,0,0.07)",
                          boxShadow: "0 1px 4px rgb(0 0 0 / 0.08)",
                          opacity,
                          transition: "opacity 0.2s",
                        }}
                      >
                        {isRunning ? (
                          <CircularProgress size={10} thickness={5} sx={{ color: meta.color, flexShrink: 0 }} />
                        ) : (
                          <Box sx={{ color: meta.color, display: "flex", alignItems: "center", flexShrink: 0 }}>
                            {meta.icon}
                          </Box>
                        )}
                        <Typography sx={{ color: meta.color, fontSize: "0.7rem", fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", flexShrink: 0 }}>
                          {meta.label}
                        </Typography>
                        {argSummary && (
                          <Typography sx={{ color: "text.secondary", fontSize: "0.68rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                            {argSummary}
                          </Typography>
                        )}
                      </Box>
                    );
                  })}
                  {/* Spinner row at bottom */}
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.4 }}>
                    <CircularProgress size={10} thickness={5} sx={{ color: "#71717A" }} />
                    <Typography sx={{ color: "text.secondary", fontSize: "0.68rem" }}>working...</Typography>
                  </Box>
                </Box>
              )}

              {/* Toast: final agent response, fades after 3.5s */}
              {toast && (
                <Box
                  sx={{
                    position: "absolute",
                    bottom: 24,
                    left: "50%",
                    transform: "translateX(-50%)",
                    maxWidth: 420,
                    width: "calc(100% - 48px)",
                    bgcolor: "rgba(24,24,27,0.92)",
                    color: "#fff",
                    borderRadius: 2.5,
                    px: 2.5,
                    py: 1.5,
                    boxShadow: "0 4px 24px rgb(0 0 0 / 0.18)",
                    animation: "fadeSlideUp 0.2s ease",
                    "@keyframes fadeSlideUp": {
                      from: { opacity: 0, transform: "translateX(-50%) translateY(8px)" },
                      to:   { opacity: 1, transform: "translateX(-50%) translateY(0)" },
                    },
                  }}
                >
                  <Typography variant="body2" sx={{ fontSize: "0.8rem", lineHeight: 1.55 }}>
                    {toast}
                  </Typography>
                </Box>
              )}
            </Box>
            <Box sx={{ bgcolor: "background.paper", borderTop: "1px solid", borderColor: "divider", display: "flex", justifyContent: "center" }}>
              <Box sx={{ width: "40%" }}>
                <ChatInputBar
                  input={input}
                  setInput={setInput}
                  onSend={handleSend}
                  onAbort={handleAbort}
                  loading={loading}
                />
              </Box>
            </Box>
          </Box>
        )}
      </Box>

      {/* Status bar */}
      <Box
        sx={{
          height: 28,
          px: 3,
          borderTop: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexShrink: 0,
        }}
      >
        <CircleIcon sx={{ fontSize: 8, color: "#22C55E" }} />
        <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem" }}>
          sandbox ready{previewUrl ? ` · ${previewUrl}` : " · no preview yet"}
        </Typography>
      </Box>
    </Box>
  );
}

/* ── Subcomponents ── */

function LoadingScreen({ message, error = false }: { message: string; error?: boolean }) {
  return (
    <Box
      sx={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        bgcolor: "background.default",
      }}
    >
      {!error && <CircularProgress size={28} thickness={3} />}
      <Typography variant="body2" sx={{ color: error ? "error.main" : "text.secondary" }}>
        {message}
      </Typography>
    </Box>
  );
}

const VIEW_DIMENSIONS = {
  mobile:  { width: 390,    maxWidth: 390,  maxHeight: 720  },
  desktop: { width: "100%", maxWidth: 1024, maxHeight: "100%" },
};

function IframeFrame({
  iframeRef,
  previewUrl,
  iframeKey,
  viewMode,
  wide = false,
}: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  previewUrl: string | null;
  iframeKey: number;
  viewMode: "mobile" | "desktop";
  wide?: boolean;
}) {
  const dim = VIEW_DIMENSIONS[viewMode];
  return (
    <Box
      sx={{
        width: viewMode === "mobile" ? 390 : "100%",
        maxWidth: viewMode === "mobile" ? 390 : "100%",
        height: "100%",
        maxHeight: viewMode === "mobile" ? 720 : "100%",
        bgcolor: "background.paper",
        borderRadius: 3,
        overflow: "hidden",
        border: "1px solid",
        borderColor: "divider",
        boxShadow: "0 8px 40px 0 rgb(0 0 0 / 0.12)",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.2s ease, max-width 0.2s ease",
      }}
    >
      {/* Browser chrome */}
      <Box
        sx={{
          height: 36,
          px: 2,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "#F8F8FA",
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          flexShrink: 0,
        }}
      >
        {["#FF5F57", "#FFBD2E", "#28C840"].map((color) => (
          <Box key={color} sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color }} />
        ))}
        <Box
          sx={{
            flex: 1, mx: 2, height: 20, bgcolor: "#EFEFEF",
            borderRadius: 1, display: "flex", alignItems: "center", px: 1.5,
          }}
        >
          <Typography variant="caption" sx={{ color: "#888", fontSize: "0.65rem" }}>
            {previewUrl || "localhost:3000"}
          </Typography>
        </Box>
      </Box>

      {/* Iframe */}
      <Box sx={{ flex: 1, position: "relative" }}>
        {previewUrl ? (
          <iframe
            key={iframeKey}
            ref={iframeRef}
            src={previewUrl}
            style={{ width: "100%", height: "100%", border: "none" }}
            title="Preview"
          />
        ) : (
          <Box
            sx={{
              width: "100%", height: "100%", display: "flex",
              flexDirection: "column", alignItems: "center",
              justifyContent: "center", gap: 1.5, bgcolor: "#FAFAFA",
            }}
          >
            <Typography variant="caption" sx={{ color: "#B0B0B8", fontSize: "0.72rem" }}>
              Ask the agent to start a dev server to see the preview
            </Typography>
          </Box>
        )}

      </Box>
    </Box>
  );
}

function ChatMessage({ role, content, tools }: { role: string; content: string; tools?: ToolActivity[] }) {
  const isUser = role === "user";
  const [toolsOpen, setToolsOpen] = useState(false);

  return (
    <Box sx={{ mb: 2, display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
      {/* Tool calls toggle — above the bubble for assistant messages */}
      {!isUser && tools && tools.length > 0 && (
        <Box
          onClick={() => setToolsOpen((v) => !v)}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            mb: 0.5,
            cursor: "pointer",
            color: "text.secondary",
            "&:hover": { color: "text.primary" },
          }}
        >
          <Typography variant="caption" sx={{ fontSize: "0.68rem", fontWeight: 500 }}>
            {toolsOpen ? "▾" : "▸"} {tools.length} tool call{tools.length !== 1 ? "s" : ""}
          </Typography>
        </Box>
      )}

      {/* Collapsible tool list */}
      {!isUser && toolsOpen && tools && (
        <Box sx={{ mb: 0.75, width: "100%", maxWidth: "85%" }}>
          <ToolActivityList activities={tools} compact />
        </Box>
      )}

      {/* Message bubble */}
      <Box
        sx={{
          maxWidth: "85%", px: 2, py: 1.25,
          borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          bgcolor: isUser ? "primary.main" : "#F4F4F6",
          color: isUser ? "#fff" : "text.primary",
          // Markdown styles
          "& p": { m: 0, mb: 0.75, fontSize: "0.82rem", lineHeight: 1.6, "&:last-child": { mb: 0 } },
          "& p + p": { mt: 0.5 },
          "& strong": { fontWeight: 700 },
          "& em": { fontStyle: "italic" },
          "& ul, & ol": { pl: 2.5, mb: 0.5, mt: 0.25 },
          "& li": { fontSize: "0.82rem", lineHeight: 1.6, mb: 0.25 },
          "& h1, & h2, & h3": { fontWeight: 700, mt: 1, mb: 0.5, lineHeight: 1.3 },
          "& h1": { fontSize: "1rem" },
          "& h2": { fontSize: "0.9rem" },
          "& h3": { fontSize: "0.85rem" },
          "& code": {
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: "0.76rem",
            bgcolor: isUser ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.07)",
            px: 0.6, py: 0.15,
            borderRadius: 0.75,
          },
          "& pre": {
            bgcolor: isUser ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)",
            border: "1px solid",
            borderColor: isUser ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.08)",
            borderRadius: 1.5,
            p: 1.25,
            overflowX: "auto",
            mt: 0.5, mb: 0.75,
            "& code": { bgcolor: "transparent", px: 0, py: 0, fontSize: "0.75rem" },
          },
          "& a": { color: isUser ? "#fff" : "primary.main", textDecoration: "underline" },
          "& blockquote": {
            borderLeft: "3px solid",
            borderColor: isUser ? "rgba(255,255,255,0.4)" : "divider",
            pl: 1.5, ml: 0, my: 0.5,
            "& p": { color: isUser ? "rgba(255,255,255,0.8)" : "text.secondary" },
          },
          "& hr": { border: "none", borderTop: "1px solid", borderColor: "divider", my: 1 },
        }}
      >
        {isUser ? (
          <Typography variant="body2" sx={{ lineHeight: 1.55, fontSize: "0.82rem" }}>
            {content}
          </Typography>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        )}
      </Box>
    </Box>
  );
}

function ToolActivityList({ activities, compact = false, isActive = false }: { activities: ToolActivity[]; compact?: boolean; isActive?: boolean }) {
  const hasRunning = activities.some((a) => a.status === "running");
  const showSpinner = isActive || hasRunning;

  if (activities.length === 0) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, py: 0.5, px: compact ? 0 : 1 }}>
        <CircularProgress size={11} thickness={5} sx={{ color: "#71717A" }} />
        <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.72rem" }}>
          Thinking...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4, py: 0.3, px: compact ? 0 : 1 }}>
      {activities.map((activity, i) => {
        const meta = getToolMeta(activity.tool);
        const isRunning = activity.status === "running";
        const argSummary = activity.args
          ? Object.entries(activity.args)
              .map(([, v]) => {
                const val = typeof v === "string" ? v : JSON.stringify(v);
                return val.length > 40 ? val.slice(0, 40) + "…" : val;
              })
              .join(" ")
              .slice(0, 60)
          : "";

        return (
          <Box
            key={i}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              px: 1,
              py: 0.4,
              borderRadius: 1,
              bgcolor: isRunning ? `${meta.color}10` : `${meta.color}08`,
              border: "1px solid",
              borderColor: isRunning ? `${meta.color}30` : `${meta.color}18`,
              opacity: isRunning ? 1 : 0.55,
              transition: "all 0.2s",
            }}
          >
            {isRunning ? (
              <CircularProgress size={10} thickness={5} sx={{ color: meta.color, flexShrink: 0 }} />
            ) : (
              <Box sx={{ color: meta.color, display: "flex", alignItems: "center", flexShrink: 0 }}>
                {meta.icon}
              </Box>
            )}
            <Typography
              variant="caption"
              sx={{ color: meta.color, fontSize: "0.7rem", fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", flexShrink: 0 }}
            >
              {meta.label}
            </Typography>
            {argSummary && (
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", fontSize: "0.68rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
              >
                {argSummary}
              </Typography>
            )}
          </Box>
        );
      })}

      {/* Spinner at the bottom while agent run is active */}
      {showSpinner && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1, py: 0.5, mt: 0.25 }}>
          <CircularProgress size={10} thickness={5} sx={{ color: "#71717A" }} />
          <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.68rem" }}>
            working...
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function ChatInputBar({
  input,
  setInput,
  onSend,
  onAbort,
  loading,
}: {
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onAbort: () => void;
  loading: boolean;
}) {
  return (
    <Box sx={{ px: 3, pt: 1.5, pb: 2 }}>

      <TextField
        fullWidth
        size="small"
        multiline
        maxRows={4}
        placeholder={loading ? "Agent is working..." : "Tell the agent what to change..."}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        disabled={loading}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              {loading ? (
                <IconButton
                  size="small"
                  onClick={onAbort}
                  sx={{ width: 28, height: 28, color: "error.main" }}
                >
                  <StopIcon sx={{ fontSize: 14 }} />
                </IconButton>
              ) : (
                <IconButton
                  size="small"
                  onClick={onSend}
                  disabled={!input.trim()}
                  sx={{
                    bgcolor: input.trim() ? "primary.main" : "transparent",
                    color: input.trim() ? "#fff" : "text.secondary",
                    width: 28, height: 28,
                    "&:hover": { bgcolor: input.trim() ? "primary.dark" : "transparent" },
                  }}
                >
                  <SendIcon sx={{ fontSize: 14 }} />
                </IconButton>
              )}
            </InputAdornment>
          ),
        }}
        sx={{
          "& .MuiOutlinedInput-root": {
            borderRadius: 2.5, bgcolor: "#F8F8FA", fontSize: "0.84rem",
          },
        }}
      />
    </Box>
  );
}
