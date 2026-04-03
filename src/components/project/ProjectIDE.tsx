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
import CompressIcon from "@mui/icons-material/Compress";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useRouter } from "next/navigation";
import { useProject, MODEL_PRESETS, CUSTOM_MODELS } from "@/hooks/useProject";
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

const MOBILE_DEVICES = [
  { id: "iphone-16-pro-max", label: "iPhone 16 Pro Max", width: 440, height: 956 },
  { id: "iphone-16-pro",     label: "iPhone 16 Pro",     width: 402, height: 874 },
  { id: "iphone-16",         label: "iPhone 16",         width: 393, height: 852 },
  { id: "iphone-15",         label: "iPhone 15",         width: 393, height: 852 },
  { id: "iphone-se",         label: "iPhone SE",         width: 320, height: 568 },
  { id: "galaxy-s25-ultra",  label: "Galaxy S25 Ultra",  width: 412, height: 824 },
  { id: "galaxy-s25",        label: "Galaxy S25",        width: 360, height: 780 },
  { id: "galaxy-s24",        label: "Galaxy S24",        width: 360, height: 780 },
] as const;

type MobileDeviceId = (typeof MOBILE_DEVICES)[number]["id"];

interface Props {
  projectId: string;
}

export default function ProjectIDE({ projectId }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<"mobile" | "desktop">("desktop");
  const [mobileDevice, setMobileDevice] = useState<MobileDeviceId>("iphone-16-pro");
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
          <IconButton size="small" onClick={() => { handleClose(); router.push("/"); }} sx={{ color: "text.secondary" }}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Typography variant="body2" fontWeight={600} sx={{ color: "text.primary", flex: 1 }}>
          {projectName ?? "Loading..."}
        </Typography>

        <Tooltip title="Refresh preview">
          <IconButton
            size="small"
            onClick={() => setIframeKey((k: number) => k + 1)}
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
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
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

          {/* Device picker — visible only in mobile mode */}
          {viewMode === "mobile" && (
            <Select
              size="small"
              value={mobileDevice}
              onChange={(e) => setMobileDevice(e.target.value as MobileDeviceId)}
              sx={{
                fontSize: "0.68rem",
                height: 26,
                "& .MuiOutlinedInput-notchedOutline": { borderColor: "divider" },
                "& .MuiSelect-select": { py: 0, px: 1 },
              }}
            >
              {MOBILE_DEVICES.map((d) => (
                <MenuItem key={d.id} value={d.id} sx={{ fontSize: "0.72rem" }}>
                  {d.label} <Typography component="span" sx={{ color: "text.secondary", fontSize: "0.62rem", ml: 0.75 }}>{d.width}×{d.height}</Typography>
                </MenuItem>
              ))}
            </Select>
          )}
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
              <IframeFrame iframeRef={iframeRef} previewUrl={previewUrl} iframeKey={iframeKey} viewMode={viewMode} mobileDevice={mobileDevice} wide />
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
              <ContextModelBar
                contextInfo={contextInfo}
                compacting={compacting}
                loading={loading}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                onCompact={handleCompact}
                onClear={handleClearChat}
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
              <IframeFrame iframeRef={iframeRef} previewUrl={previewUrl} iframeKey={iframeKey} viewMode={viewMode} mobileDevice={mobileDevice} />

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
            <Box sx={{ bgcolor: "background.paper", borderTop: "1px solid", borderColor: "divider", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <Box sx={{ width: "40%" }}>
                <ChatInputBar
                  input={input}
                  setInput={setInput}
                  onSend={handleSend}
                  onAbort={handleAbort}
                  loading={loading}
                />
                <ContextModelBar
                  contextInfo={contextInfo}
                  compacting={compacting}
                  loading={loading}
                  selectedModel={selectedModel}
                  setSelectedModel={setSelectedModel}
                  onCompact={handleCompact}
                  onClear={handleClearChat}
                />
              </Box>
            </Box>
          </Box>
        )}
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

function IframeFrame({
  iframeRef,
  previewUrl,
  iframeKey,
  viewMode,
  mobileDevice,
  wide = false,
}: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  previewUrl: string | null;
  iframeKey: number;
  viewMode: "mobile" | "desktop";
  mobileDevice?: MobileDeviceId;
  wide?: boolean;
}) {
  const device = viewMode === "mobile"
    ? MOBILE_DEVICES.find((d) => d.id === mobileDevice) || MOBILE_DEVICES[0]
    : null;
  const frameWidth = device ? device.width : "100%";
  const frameMaxWidth = device ? device.width : "100%";
  const frameMaxHeight = device ? device.height : "100%";

  return (
    <Box
      sx={{
        width: frameWidth,
        maxWidth: frameMaxWidth,
        height: "100%",
        maxHeight: frameMaxHeight,
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

function ContextModelBar({
  contextInfo,
  compacting,
  loading,
  selectedModel,
  setSelectedModel,
  onCompact,
  onClear,
}: {
  contextInfo: { tokens: number; limit: number } | null;
  compacting: boolean;
  loading: boolean;
  selectedModel: string;
  setSelectedModel: (v: string) => void;
  onCompact: () => void;
  onClear: () => void;
}) {
  const [showCustom, setShowCustom] = useState(false);
  const ratio = contextInfo ? contextInfo.tokens / contextInfo.limit : 0;

  // Check if current model matches a preset
  const activePreset = MODEL_PRESETS.find((p) => p.id === selectedModel);

  return (
    <Box sx={{ px: 3, pb: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {contextInfo && (
          <>
            <Box sx={{ width: 60, height: 4, bgcolor: "rgba(0,0,0,0.08)", borderRadius: 2, overflow: "hidden" }}>
              <Box
                sx={{
                  width: `${Math.min(ratio * 100, 100)}%`,
                  height: "100%",
                  borderRadius: 2,
                  bgcolor: ratio > 0.8 ? "#EF4444" : ratio > 0.5 ? "#F59E0B" : "#22C55E",
                  transition: "width 0.3s ease",
                }}
              />
            </Box>
            <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.65rem" }}>
              {Math.round(contextInfo.tokens / 1000)}k / {Math.round(contextInfo.limit / 1000)}k tokens
            </Typography>
          </>
        )}
        <Tooltip title="Compact context">
          <IconButton
            size="small"
            onClick={onCompact}
            disabled={loading || compacting}
            sx={{ width: 20, height: 20, color: "text.secondary" }}
          >
            {compacting ? (
              <CircularProgress size={10} thickness={5} />
            ) : (
              <CompressIcon sx={{ fontSize: 13 }} />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title="Clear chat">
          <IconButton
            size="small"
            onClick={onClear}
            disabled={loading || compacting}
            sx={{ width: 20, height: 20, color: "text.secondary" }}
          >
            <DeleteOutlineIcon sx={{ fontSize: 13 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Mode selector: lite / pro / max presets + custom dropdown */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        {/* Preset toggle group */}
        <Box
          sx={{
            display: "flex",
            bgcolor: "#F4F4F5",
            borderRadius: 1.5,
            p: 0.3,
            gap: 0.25,
          }}
        >
          {MODEL_PRESETS.map((preset) => {
            const isActive = selectedModel === preset.id && !showCustom;
            return (
              <Tooltip key={preset.id} title={preset.desc}>
                <Box
                  onClick={() => {
                    if (!loading) {
                      setSelectedModel(preset.id);
                      setShowCustom(false);
                    }
                  }}
                  sx={{
                    px: 1.25,
                    py: 0.35,
                    borderRadius: 1,
                    cursor: loading ? "default" : "pointer",
                    fontSize: "0.68rem",
                    fontWeight: 600,
                    letterSpacing: 0.3,
                    textTransform: "uppercase",
                    color: isActive ? "primary.main" : "text.secondary",
                    bgcolor: isActive ? "background.paper" : "transparent",
                    boxShadow: isActive ? "0 1px 3px rgb(0 0 0 / 0.1)" : "none",
                    transition: "all 0.12s",
                    userSelect: "none",
                    "&:hover": loading ? {} : { color: isActive ? "primary.main" : "text.primary" },
                  }}
                >
                  {preset.name}
                </Box>
              </Tooltip>
            );
          })}
        </Box>

        {/* Custom model dropdown */}
        <Select
          size="small"
          value={showCustom || !activePreset ? selectedModel : ""}
          displayEmpty
          onChange={(e) => {
            const val = e.target.value;
            if (val) {
              setSelectedModel(val);
              setShowCustom(true);
            }
          }}
          disabled={loading}
          renderValue={(value) => {
            if (!value) return <span style={{ opacity: 0.5 }}>custom</span>;
            const m = CUSTOM_MODELS.find((c) => c.id === value);
            return m ? m.label : value;
          }}
          sx={{
            fontSize: "0.68rem",
            height: 24,
            minWidth: 70,
            "& .MuiOutlinedInput-notchedOutline": { borderColor: "divider" },
            "& .MuiSelect-select": { py: 0, px: 1 },
          }}
        >
          {CUSTOM_MODELS.map((m) => (
            <MenuItem key={m.id} value={m.id} sx={{ fontSize: "0.72rem", display: "flex", justifyContent: "space-between", gap: 2 }}>
              <span>{m.label}</span>
              <Typography component="span" sx={{ color: "text.secondary", fontSize: "0.62rem" }}>{m.desc}</Typography>
            </MenuItem>
          ))}
        </Select>
      </Box>
    </Box>
  );
}
