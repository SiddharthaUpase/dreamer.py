"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import CircularProgress from "@mui/material/CircularProgress";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import SendIcon from "@mui/icons-material/Send";
import CloseIcon from "@mui/icons-material/Close";
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
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import DownloadIcon from "@mui/icons-material/Download";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import type { AgentChatState } from "../hooks/useAgentChat";

const MODELS = [
  { id: "claude-sonnet", label: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "minimax", label: "MiniMax M2.5", provider: "minimax" },
  { id: "kimi", label: "Kimi K2.5", provider: "moonshot" },
];

export interface AgentNodeData {
  id: string;
  name: string;
  x: number;
  y: number;
  savedMessages?: { role: "user" | "assistant"; content: string }[];
  savedModel?: string;
  previewUrl?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ToolActivity {
  tool: string;
  args?: Record<string, unknown>;
  status: "running" | "done";
}

const TOOL_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  bash:  { icon: <TerminalIcon sx={{ fontSize: 12 }} />, label: "Bash", color: "#34d399" },
  read:  { icon: <DescriptionIcon sx={{ fontSize: 12 }} />, label: "Read", color: "#60a5fa" },
  write: { icon: <EditNoteIcon sx={{ fontSize: 12 }} />, label: "Write", color: "#fbbf24" },
  edit:  { icon: <EditNoteIcon sx={{ fontSize: 12 }} />, label: "Edit", color: "#fb923c" },
  grep:  { icon: <SearchIcon sx={{ fontSize: 12 }} />, label: "Grep", color: "#c084fc" },
  glob:  { icon: <SearchIcon sx={{ fontSize: 12 }} />, label: "Glob", color: "#a78bfa" },
};

function getToolMeta(name: string) {
  return TOOL_META[name] || { icon: <BuildIcon sx={{ fontSize: 12 }} />, label: name, color: "#a5a3c9" };
}

interface AgentNodeProps {
  node: AgentNodeData;
  chat: AgentChatState;
  onMove: (id: string, dx: number, dy: number) => void;
  onDelete: (id: string) => void;
  onExpand: () => void;
}

const MIN_CHAT_HEIGHT = 100;
const MAX_CHAT_HEIGHT = 500;

export default function AgentNode({ node, chat, onMove, onDelete, onExpand }: AgentNodeProps) {
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const [spawning, setSpawning] = useState(true);
  const [chatHeight, setChatHeight] = useState(500);
  const resizeStart = useRef<{ y: number; h: number } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSpawning(false), 600);
    return () => clearTimeout(t);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!(e.target as HTMLElement).closest("[data-drag-handle]")) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!lastPos.current) return;
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      onMove(node.id, dx, dy);
    },
    [node.id, onMove]
  );

  const handlePointerUp = useCallback(() => {
    lastPos.current = null;
  }, []);

  const handleResizeDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeStart.current = { y: e.clientY, h: chatHeight };
  }, [chatHeight]);

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizeStart.current) return;
    const dy = e.clientY - resizeStart.current.y;
    setChatHeight(Math.min(MAX_CHAT_HEIGHT, Math.max(MIN_CHAT_HEIGHT, resizeStart.current.h + dy)));
  }, []);

  const handleResizeUp = useCallback(() => {
    resizeStart.current = null;
  }, []);

  return (
    <Paper
      elevation={6}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={(e) => e.stopPropagation()}
      sx={{
        position: "absolute",
        left: node.x,
        top: node.y,
        width: 380,
        display: "flex",
        flexDirection: "column",
        userSelect: "text",
        overflow: "hidden",
        border: "2px solid",
        borderColor: spawning ? "primary.main" : "divider",
        borderRadius: 3,
        transition: "box-shadow 0.2s, border-color 0.4s, transform 0.4s, opacity 0.4s",
        transform: spawning ? "scale(0.8)" : "scale(1)",
        opacity: spawning ? 0 : 1,
        boxShadow: spawning
          ? "0 0 40px rgba(167,139,250,0.5)"
          : "0 4px 20px rgba(0,0,0,0.3)",
        "&:hover": {
          borderColor: "primary.dark",
          boxShadow: "0 4px 24px rgba(167,139,250,0.2)",
        },
      }}
    >
      {/* Header */}
      <Box
        data-drag-handle
        sx={{
          background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #a78bfa 100%)",
          px: 1.5,
          py: 1,
          display: "flex",
          alignItems: "center",
          gap: 1,
          cursor: "grab",
          "&:active": { cursor: "grabbing" },
          borderBottom: "2px solid rgba(167,139,250,0.3)",
        }}
      >
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            bgcolor: "rgba(0,0,0,0.3)",
            border: "2px solid rgba(255,255,255,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <SmartToyIcon sx={{ fontSize: 16, color: "#fff" }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography
            variant="subtitle2"
            sx={{ color: "#fff", fontWeight: 800, fontSize: 13, lineHeight: 1.2, letterSpacing: 0.5 }}
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
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: 600 }}>
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
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          sx={{
            color: "rgba(255,255,255,0.4)",
            "&:hover": { color: "#a78bfa", bgcolor: "rgba(167,139,250,0.1)" },
          }}
        >
          <OpenInFullIcon sx={{ fontSize: 14 }} />
        </IconButton>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.id);
          }}
          sx={{
            color: "rgba(255,255,255,0.4)",
            "&:hover": { color: "#f87171", bgcolor: "rgba(248,113,113,0.1)" },
          }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>

      {/* Model selector */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1.5,
          py: 0.4,
          bgcolor: "#0a0a12",
          borderBottom: "1px solid rgba(167,139,250,0.08)",
        }}
      >
        <Typography variant="caption" sx={{ color: "rgba(165,163,201,0.5)", fontSize: 9, mr: 0.8, fontWeight: 600 }}>
          MODEL
        </Typography>
        <Select
          value={chat.selectedModel}
          onChange={(e) => chat.changeModel(e.target.value)}
          size="small"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          variant="standard"
          disableUnderline
          sx={{
            fontSize: 10,
            fontWeight: 700,
            color: "#c4b5fd",
            flex: 1,
            "& .MuiSelect-select": { py: 0, px: 0.5 },
            "& .MuiSvgIcon-root": { color: "rgba(167,139,250,0.4)", fontSize: 14 },
          }}
          MenuProps={{
            slotProps: {
              paper: {
                sx: {
                  bgcolor: "rgba(26,26,46,0.95)",
                  backdropFilter: "blur(12px)",
                  border: "1px solid rgba(167,139,250,0.2)",
                  "& .MuiMenuItem-root": {
                    fontSize: 11,
                    py: 0.6,
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

      {/* Preview iframe */}
      {chat.previewUrl && (
        <Box
          sx={{
            position: "relative",
            borderBottom: "1px solid rgba(167,139,250,0.15)",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              px: 1,
              py: 0.3,
              bgcolor: "#0a0a12",
              borderBottom: "1px solid rgba(167,139,250,0.08)",
              gap: 0.5,
            }}
          >
            <LanguageIcon sx={{ fontSize: 11, color: "#34d399" }} />
            <Typography
              variant="caption"
              sx={{
                flex: 1,
                fontSize: 9,
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
              onClick={(e) => {
                e.stopPropagation();
                chat.setIframeKey((k) => k + 1);
              }}
              sx={{ p: 0.3, color: "#a5a3c9", "&:hover": { color: "#c4b5fd" } }}
            >
              <RefreshIcon sx={{ fontSize: 12 }} />
            </IconButton>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                window.open(chat.previewUrl!, "_blank");
              }}
              sx={{ p: 0.3, color: "#a5a3c9", "&:hover": { color: "#c4b5fd" } }}
            >
              <OpenInNewIcon sx={{ fontSize: 12 }} />
            </IconButton>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                chat.setPreviewUrl(null);
              }}
              sx={{ p: 0.3, color: "#a5a3c9", "&:hover": { color: "#f87171" } }}
            >
              <CloseIcon sx={{ fontSize: 12 }} />
            </IconButton>
          </Box>
          <Box
            key={chat.iframeKey}
            component="iframe"
            src={chat.previewUrl}
            sx={{
              width: "100%",
              height: 250,
              border: "none",
              bgcolor: "#fff",
              display: "block",
            }}
          />
        </Box>
      )}

      {/* Chat area */}
      <Box
        sx={{
          height: chatHeight,
          overflowY: "auto",
          px: 1.5,
          py: 1,
          display: "flex",
          flexDirection: "column",
          gap: 0.6,
          bgcolor: "#0c0c14",
          "&::-webkit-scrollbar": { width: 3 },
          "&::-webkit-scrollbar-thumb": { bgcolor: "rgba(167,139,250,0.15)", borderRadius: 2 },
        }}
      >
        {chat.messages.length === 0 && !chat.loading && (
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", opacity: 0.35, textAlign: "center", mt: 3, fontSize: 11 }}
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
              px: 1.2,
              py: 0.5,
              borderRadius: msg.role === "user" ? "8px 8px 2px 8px" : "8px 8px 8px 2px",
              bgcolor: msg.role === "user" ? "rgba(124,58,237,0.4)" : "rgba(26,26,46,0.8)",
              border: "1px solid",
              borderColor: msg.role === "user" ? "rgba(167,139,250,0.3)" : "rgba(167,139,250,0.08)",
            }}
          >
            <Typography
              variant="caption"
              sx={{
                color: msg.role === "user" ? "#e2e0ff" : "#c4b5fd",
                fontSize: 11.5,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {msg.content}
            </Typography>
          </Box>
        ))}
        {chat.loading && chat.toolActivities.length === 0 && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, py: 0.5 }}>
            <CircularProgress size={12} thickness={5} sx={{ color: "#a78bfa" }} />
            <Typography variant="caption" sx={{ color: "#a5a3c9", fontSize: 10, fontWeight: 600 }}>
              Agent thinking...
            </Typography>
          </Box>
        )}
        {chat.loading && chat.toolActivities.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4, py: 0.3 }}>
            {chat.toolActivities.map((activity, i) => {
              const meta = getToolMeta(activity.tool);
              const isRunning = activity.status === "running";
              const argSummary = activity.args
                ? Object.entries(activity.args)
                    .map(([k, v]) => {
                      const val = typeof v === "string" ? v : JSON.stringify(v);
                      return val.length > 30 ? val.slice(0, 30) + "\u2026" : val;
                    })
                    .join(" ")
                    .slice(0, 50)
                : "";
              return (
                <Box
                  key={i}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.6,
                    px: 0.8,
                    py: 0.3,
                    borderRadius: 1,
                    bgcolor: isRunning ? "rgba(167,139,250,0.08)" : "rgba(52,211,153,0.06)",
                    border: "1px solid",
                    borderColor: isRunning ? "rgba(167,139,250,0.15)" : "rgba(52,211,153,0.1)",
                    transition: "all 0.3s",
                    opacity: isRunning ? 1 : 0.5,
                  }}
                >
                  {isRunning ? (
                    <CircularProgress size={10} thickness={5} sx={{ color: meta.color }} />
                  ) : (
                    <Box sx={{ color: meta.color, display: "flex", alignItems: "center" }}>
                      {meta.icon}
                    </Box>
                  )}
                  <Typography
                    variant="caption"
                    sx={{
                      color: meta.color,
                      fontSize: 10,
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
                        fontSize: 9,
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

      {/* Output files bar */}
      {chat.outputFiles.length > 0 && (
        <Box
          sx={{
            px: 1.2,
            py: 0.6,
            bgcolor: "rgba(52,211,153,0.06)",
            borderTop: "1px solid rgba(52,211,153,0.15)",
            display: "flex",
            flexDirection: "column",
            gap: 0.4,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Typography variant="caption" sx={{ color: "#34d399", fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>
              Output Files
            </Typography>
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); chat.setOutputFiles([]); }}
              sx={{ p: 0.2, color: "rgba(165,163,201,0.5)", "&:hover": { color: "#f87171" } }}
            >
              <CloseIcon sx={{ fontSize: 10 }} />
            </IconButton>
          </Box>
          {chat.outputFiles.map((file, i) => (
            <Box
              key={i}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.6,
                px: 0.6,
                py: 0.3,
                borderRadius: 1,
                bgcolor: "rgba(26,26,46,0.6)",
                border: "1px solid rgba(52,211,153,0.1)",
              }}
            >
              <InsertDriveFileIcon sx={{ fontSize: 12, color: "#60a5fa" }} />
              <Typography
                variant="caption"
                sx={{ flex: 1, color: "#e2e0ff", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {file.name}
              </Typography>
              <Typography variant="caption" sx={{ color: "rgba(165,163,201,0.5)", fontSize: 9 }}>
                {file.size < 1024 ? `${file.size}B` : file.size < 1048576 ? `${(file.size / 1024).toFixed(1)}KB` : `${(file.size / 1048576).toFixed(1)}MB`}
              </Typography>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
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
                sx={{ p: 0.2, color: "#34d399", "&:hover": { color: "#6ee7b7", bgcolor: "rgba(52,211,153,0.1)" } }}
              >
                <DownloadIcon sx={{ fontSize: 12 }} />
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
          px: 1,
          py: 0.4,
          borderTop: "1px solid rgba(167,139,250,0.1)",
          bgcolor: "#111120",
        }}
      >
        <InputBase
          placeholder="Type a command..."
          value={chat.input}
          onChange={(e) => chat.setInput(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              chat.handleSend();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          sx={{
            flex: 1,
            fontSize: 12,
            color: "text.primary",
            px: 0.8,
            "& input::placeholder": { color: "text.secondary", opacity: 0.4 },
          }}
        />
        {chat.loading ? (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              chat.handleAbort();
            }}
            sx={{
              color: "#f87171",
              "&:hover": { bgcolor: "rgba(248,113,113,0.1)" },
            }}
          >
            <StopCircleIcon sx={{ fontSize: 18 }} />
          </IconButton>
        ) : (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              chat.handleSend();
            }}
            disabled={!chat.input.trim()}
            sx={{
              color: "primary.main",
              "&:hover": { bgcolor: "rgba(167,139,250,0.1)" },
            }}
          >
            <SendIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Box>

      {/* Resize handle */}
      <Box
        onPointerDown={handleResizeDown}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeUp}
        sx={{
          height: 6,
          cursor: "ns-resize",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "#111120",
          opacity: 0.4,
          "&:hover": { opacity: 1, bgcolor: "rgba(167,139,250,0.15)" },
          transition: "opacity 0.2s, background-color 0.2s",
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 2,
            borderRadius: 1,
            bgcolor: "primary.main",
          }}
        />
      </Box>
    </Paper>
  );
}
