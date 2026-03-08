"use client";

import { useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import CircularProgress from "@mui/material/CircularProgress";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import SendIcon from "@mui/icons-material/Send";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import TerminalIcon from "@mui/icons-material/Terminal";
import DescriptionIcon from "@mui/icons-material/Description";
import EditNoteIcon from "@mui/icons-material/EditNote";
import SearchIcon from "@mui/icons-material/Search";
import BuildIcon from "@mui/icons-material/Build";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import LanguageIcon from "@mui/icons-material/Language";
import RefreshIcon from "@mui/icons-material/Refresh";
import CloseIcon from "@mui/icons-material/Close";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import DownloadIcon from "@mui/icons-material/Download";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import type { AgentNodeData } from "./AgentNode";
import type { AgentChatState } from "../hooks/useAgentChat";

const MODELS = [
  { id: "claude-sonnet", label: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "minimax", label: "MiniMax M2.5", provider: "minimax" },
  { id: "kimi", label: "Kimi K2.5", provider: "moonshot" },
];

const TOOL_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  bash:  { icon: <TerminalIcon sx={{ fontSize: 14 }} />, label: "Bash", color: "#34d399" },
  read:  { icon: <DescriptionIcon sx={{ fontSize: 14 }} />, label: "Read", color: "#60a5fa" },
  write: { icon: <EditNoteIcon sx={{ fontSize: 14 }} />, label: "Write", color: "#fbbf24" },
  edit:  { icon: <EditNoteIcon sx={{ fontSize: 14 }} />, label: "Edit", color: "#fb923c" },
  grep:  { icon: <SearchIcon sx={{ fontSize: 14 }} />, label: "Grep", color: "#c084fc" },
  glob:  { icon: <SearchIcon sx={{ fontSize: 14 }} />, label: "Glob", color: "#a78bfa" },
};

function getToolMeta(name: string) {
  return TOOL_META[name] || { icon: <BuildIcon sx={{ fontSize: 14 }} />, label: name, color: "#a5a3c9" };
}

interface ExpandedAgentViewProps {
  node: AgentNodeData;
  chat: AgentChatState;
  onCollapse: () => void;
}

export default function ExpandedAgentView({ node, chat, onCollapse }: ExpandedAgentViewProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCollapse();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCollapse]);

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1300,
        bgcolor: "#0f0f17",
        display: "flex",
        flexDirection: "column",
        animation: "fadeIn 0.2s ease-out",
        "@keyframes fadeIn": {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 },
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #a78bfa 100%)",
          px: 2,
          py: 1,
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          borderBottom: "2px solid rgba(167,139,250,0.3)",
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            bgcolor: "rgba(0,0,0,0.3)",
            border: "2px solid rgba(255,255,255,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <SmartToyIcon sx={{ fontSize: 18, color: "#fff" }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography
            variant="subtitle1"
            sx={{ color: "#fff", fontWeight: 800, fontSize: 15, lineHeight: 1.2, letterSpacing: 0.5 }}
          >
            {node.name}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <FiberManualRecordIcon
              sx={{
                fontSize: 8,
                color: chat.loading
                  ? chat.toolActivities.some((t) => t.status === "running")
                    ? "#fb923c"
                    : "#fbbf24"
                  : "#34d399",
                animation: chat.loading ? "blink 1s infinite" : "none",
                "@keyframes blink": {
                  "0%,100%": { opacity: 1 },
                  "50%": { opacity: 0.3 },
                },
              }}
            />
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 600 }}>
              {chat.loading
                ? chat.toolActivities.some((t) => t.status === "running")
                  ? `USING ${chat.toolActivities.filter((t) => t.status === "running").map((t) => getToolMeta(t.tool).label.toUpperCase()).join(", ")}`
                  : "THINKING"
                : "READY"}
            </Typography>
          </Box>
        </Box>
        <IconButton
          size="small"
          onClick={onCollapse}
          sx={{
            color: "rgba(255,255,255,0.6)",
            "&:hover": { color: "#fff", bgcolor: "rgba(255,255,255,0.1)" },
          }}
        >
          <CloseFullscreenIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>

      {/* Main content */}
      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* LEFT: Preview */}
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", bgcolor: "#0c0c14" }}>
          {chat.previewUrl ? (
            <>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  px: 1.5,
                  py: 0.5,
                  bgcolor: "#0a0a12",
                  borderBottom: "1px solid rgba(167,139,250,0.08)",
                  gap: 0.8,
                }}
              >
                <LanguageIcon sx={{ fontSize: 13, color: "#34d399" }} />
                <Typography
                  variant="caption"
                  sx={{
                    flex: 1,
                    fontSize: 11,
                    color: "#a5a3c9",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {chat.previewUrl}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => chat.setIframeKey((k) => k + 1)}
                  sx={{ p: 0.4, color: "#a5a3c9", "&:hover": { color: "#c4b5fd" } }}
                >
                  <RefreshIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => window.open(chat.previewUrl!, "_blank")}
                  sx={{ p: 0.4, color: "#a5a3c9", "&:hover": { color: "#c4b5fd" } }}
                >
                  <OpenInNewIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => chat.setPreviewUrl(null)}
                  sx={{ p: 0.4, color: "#a5a3c9", "&:hover": { color: "#f87171" } }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
              <Box
                key={chat.iframeKey}
                component="iframe"
                src={chat.previewUrl}
                sx={{ flex: 1, border: "none", bgcolor: "#fff", display: "block" }}
              />
            </>
          ) : (
            <Box
              sx={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
              }}
            >
              <LanguageIcon sx={{ fontSize: 64, color: "rgba(167,139,250,0.08)" }} />
              <Typography variant="body2" sx={{ color: "text.secondary", opacity: 0.3 }}>
                No preview available
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary", opacity: 0.2 }}>
                Start a server to see a live preview here
              </Typography>
            </Box>
          )}
        </Box>

        {/* RIGHT: Chat sidebar */}
        <Box
          sx={{
            width: 420,
            borderLeft: "1px solid rgba(167,139,250,0.12)",
            display: "flex",
            flexDirection: "column",
            bgcolor: "#1a1a2e",
          }}
        >
          {/* Model selector */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              px: 1.5,
              py: 0.5,
              bgcolor: "#0a0a12",
              borderBottom: "1px solid rgba(167,139,250,0.08)",
            }}
          >
            <Typography variant="caption" sx={{ color: "rgba(165,163,201,0.5)", fontSize: 10, mr: 1, fontWeight: 600 }}>
              MODEL
            </Typography>
            <Select
              value={chat.selectedModel}
              onChange={(e) => chat.changeModel(e.target.value)}
              size="small"
              variant="standard"
              disableUnderline
              sx={{
                fontSize: 11,
                fontWeight: 700,
                color: "#c4b5fd",
                flex: 1,
                "& .MuiSelect-select": { py: 0, px: 0.5 },
                "& .MuiSvgIcon-root": { color: "rgba(167,139,250,0.4)", fontSize: 16 },
              }}
              MenuProps={{
                slotProps: {
                  paper: {
                    sx: {
                      bgcolor: "rgba(26,26,46,0.95)",
                      backdropFilter: "blur(12px)",
                      border: "1px solid rgba(167,139,250,0.2)",
                      "& .MuiMenuItem-root": {
                        fontSize: 12,
                        py: 0.8,
                        color: "#e2e0ff",
                        "&:hover": { bgcolor: "rgba(167,139,250,0.1)" },
                        "&.Mui-selected": { bgcolor: "rgba(167,139,250,0.15)" },
                      },
                    },
                  },
                },
              }}
            >
              {MODELS.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.8 }}>
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        bgcolor: m.provider === "anthropic" ? "#c084fc" : "#34d399",
                      }}
                    />
                    {m.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </Box>

          {/* Chat messages */}
          <Box
            sx={{
              flex: 1,
              overflowY: "auto",
              px: 2,
              py: 1.5,
              display: "flex",
              flexDirection: "column",
              gap: 0.8,
              "&::-webkit-scrollbar": { width: 4 },
              "&::-webkit-scrollbar-thumb": { bgcolor: "rgba(167,139,250,0.15)", borderRadius: 2 },
            }}
          >
            {chat.messages.length === 0 && !chat.loading && (
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", opacity: 0.35, textAlign: "center", mt: 6, fontSize: 12 }}
              >
                Send a command to this agent
              </Typography>
            )}
            {chat.messages.map((msg, i) => (
              <Box
                key={i}
                sx={{
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  px: 1.5,
                  py: 0.8,
                  borderRadius: msg.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
                  bgcolor: msg.role === "user" ? "rgba(124,58,237,0.4)" : "rgba(26,26,46,0.8)",
                  border: "1px solid",
                  borderColor: msg.role === "user" ? "rgba(167,139,250,0.3)" : "rgba(167,139,250,0.08)",
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    color: msg.role === "user" ? "#e2e0ff" : "#c4b5fd",
                    fontSize: 13,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.content}
                </Typography>
              </Box>
            ))}
            {chat.loading && chat.toolActivities.length === 0 && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.8 }}>
                <CircularProgress size={14} thickness={5} sx={{ color: "#a78bfa" }} />
                <Typography variant="caption" sx={{ color: "#a5a3c9", fontSize: 11, fontWeight: 600 }}>
                  Agent thinking...
                </Typography>
              </Box>
            )}
            {chat.loading && chat.toolActivities.length > 0 && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, py: 0.4 }}>
                {chat.toolActivities.map((activity, i) => {
                  const meta = getToolMeta(activity.tool);
                  const isRunning = activity.status === "running";
                  const argSummary = activity.args
                    ? Object.entries(activity.args)
                        .map(([, v]) => {
                          const val = typeof v === "string" ? v : JSON.stringify(v);
                          return val.length > 40 ? val.slice(0, 40) + "\u2026" : val;
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
                        gap: 0.8,
                        px: 1,
                        py: 0.4,
                        borderRadius: 1,
                        bgcolor: isRunning ? "rgba(167,139,250,0.08)" : "rgba(52,211,153,0.06)",
                        border: "1px solid",
                        borderColor: isRunning ? "rgba(167,139,250,0.15)" : "rgba(52,211,153,0.1)",
                        transition: "all 0.3s",
                        opacity: isRunning ? 1 : 0.5,
                      }}
                    >
                      {isRunning ? (
                        <CircularProgress size={12} thickness={5} sx={{ color: meta.color }} />
                      ) : (
                        <Box sx={{ color: meta.color, display: "flex", alignItems: "center" }}>
                          {meta.icon}
                        </Box>
                      )}
                      <Typography
                        variant="caption"
                        sx={{
                          color: meta.color,
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: 0.5,
                          textTransform: "uppercase",
                        }}
                      >
                        {meta.label}
                      </Typography>
                      {argSummary && (
                        <Typography
                          variant="caption"
                          sx={{
                            color: "rgba(165,163,201,0.6)",
                            fontSize: 10,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                          }}
                        >
                          {argSummary}
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>
            )}
            <div ref={chat.messagesEndRef} />
          </Box>

          {/* Output files */}
          {chat.outputFiles.length > 0 && (
            <Box
              sx={{
                px: 1.5,
                py: 0.8,
                bgcolor: "rgba(52,211,153,0.06)",
                borderTop: "1px solid rgba(52,211,153,0.15)",
                display: "flex",
                flexDirection: "column",
                gap: 0.5,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Typography variant="caption" sx={{ color: "#34d399", fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  Output Files
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => chat.setOutputFiles([])}
                  sx={{ p: 0.3, color: "rgba(165,163,201,0.5)", "&:hover": { color: "#f87171" } }}
                >
                  <CloseIcon sx={{ fontSize: 12 }} />
                </IconButton>
              </Box>
              {chat.outputFiles.map((file, i) => (
                <Box
                  key={i}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.8,
                    px: 0.8,
                    py: 0.4,
                    borderRadius: 1,
                    bgcolor: "rgba(26,26,46,0.6)",
                    border: "1px solid rgba(52,211,153,0.1)",
                  }}
                >
                  <InsertDriveFileIcon sx={{ fontSize: 14, color: "#60a5fa" }} />
                  <Typography
                    variant="caption"
                    sx={{ flex: 1, color: "#e2e0ff", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {file.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "rgba(165,163,201,0.5)", fontSize: 10 }}>
                    {file.size < 1024 ? `${file.size}B` : file.size < 1048576 ? `${(file.size / 1024).toFixed(1)}KB` : `${(file.size / 1048576).toFixed(1)}MB`}
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => {
                      const byteChars = atob(file.content);
                      const byteArray = new Uint8Array(byteChars.length);
                      for (let j = 0; j < byteChars.length; j++) byteArray[j] = byteChars.charCodeAt(j);
                      const blob = new Blob([byteArray]);
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = file.name;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    sx={{ p: 0.3, color: "#34d399", "&:hover": { color: "#6ee7b7", bgcolor: "rgba(52,211,153,0.1)" } }}
                  >
                    <DownloadIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}

          {/* Input bar */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              px: 1.5,
              py: 0.8,
              borderTop: "1px solid rgba(167,139,250,0.1)",
              bgcolor: "#111120",
            }}
          >
            <InputBase
              placeholder="Type a command..."
              value={chat.input}
              onChange={(e) => chat.setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  chat.handleSend();
                }
              }}
              sx={{
                flex: 1,
                fontSize: 13,
                color: "text.primary",
                px: 1,
                "& input::placeholder": { color: "text.secondary", opacity: 0.4 },
              }}
            />
            {chat.loading ? (
              <IconButton
                size="small"
                onClick={chat.handleAbort}
                sx={{
                  color: "#f87171",
                  "&:hover": { bgcolor: "rgba(248,113,113,0.1)" },
                }}
              >
                <StopCircleIcon sx={{ fontSize: 20 }} />
              </IconButton>
            ) : (
              <IconButton
                size="small"
                onClick={chat.handleSend}
                disabled={!chat.input.trim()}
                sx={{
                  color: "primary.main",
                  "&:hover": { bgcolor: "rgba(167,139,250,0.1)" },
                }}
              >
                <SendIcon sx={{ fontSize: 18 }} />
              </IconButton>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
