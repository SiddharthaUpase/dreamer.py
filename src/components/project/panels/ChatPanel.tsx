"use client";

import { useState, useRef } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import SendIcon from "@mui/icons-material/Send";
import StopIcon from "@mui/icons-material/Stop";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CompressIcon from "@mui/icons-material/Compress";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import TerminalIcon from "@mui/icons-material/Terminal";
import DescriptionIcon from "@mui/icons-material/Description";
import EditNoteIcon from "@mui/icons-material/EditNote";
import SearchIcon from "@mui/icons-material/Search";
import BuildIcon from "@mui/icons-material/Build";
import LanguageIcon from "@mui/icons-material/Language";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, ToolActivity, ContextInfo } from "@/hooks/useProject";
import { MODEL_OPTIONS } from "@/hooks/useProject";

const TOOL_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  bash:         { icon: <TerminalIcon    sx={{ fontSize: 11 }} />, label: "Bash",        color: "#16A34A" },
  read:         { icon: <DescriptionIcon sx={{ fontSize: 11 }} />, label: "Read",        color: "#2563EB" },
  write:        { icon: <EditNoteIcon    sx={{ fontSize: 11 }} />, label: "Write",       color: "#D97706" },
  edit:         { icon: <EditNoteIcon    sx={{ fontSize: 11 }} />, label: "Edit",        color: "#EA580C" },
  grep:         { icon: <SearchIcon      sx={{ fontSize: 11 }} />, label: "Grep",        color: "#7C3AED" },
  glob:         { icon: <SearchIcon      sx={{ fontSize: 11 }} />, label: "Glob",        color: "#6D28D9" },
  preview_url:  { icon: <LanguageIcon    sx={{ fontSize: 11 }} />, label: "Preview URL", color: "#0891B2" },
  start_server: { icon: <TerminalIcon    sx={{ fontSize: 11 }} />, label: "Start Server",color: "#16A34A" },
};

function getToolMeta(name: string) {
  return TOOL_META[name] || { icon: <BuildIcon sx={{ fontSize: 11 }} />, label: name, color: "#71717A" };
}

interface Props {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  loading: boolean;
  toolActivities: ToolActivity[];
  contextInfo: ContextInfo | null;
  compacting: boolean;
  selectedModel: string;
  setSelectedModel: (v: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onSend: () => void;
  onAbort: () => void;
  onClear: () => void;
  onCompact: () => void;
  onFileUpload: (file: File) => void;
}

export default function ChatPanel({
  messages, input, setInput, loading, toolActivities,
  contextInfo, compacting, selectedModel, setSelectedModel,
  messagesEndRef, onSend, onAbort, onClear, onCompact, onFileUpload,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Messages */}
      <Box sx={{ flex: 1, overflowY: "auto", px: 2, py: 2 }}>
        {messages.length === 0 && (
          <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", mt: 4 }}>
            What do you want to build?
          </Typography>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} tools={msg.tools} />
        ))}
        {loading && <ToolActivityList activities={toolActivities} />}
        <div ref={messagesEndRef} />
      </Box>

      {/* Input */}
      <Box
        sx={{ px: 2, pt: 1, pb: 1.5, borderTop: "1px solid", borderColor: "divider" }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFileUpload(file);
        }}
      >
        <input
          type="file"
          ref={fileRef}
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileUpload(file);
            e.target.value = "";
          }}
        />
        <TextField
          fullWidth
          size="small"
          multiline
          maxRows={4}
          placeholder={dragOver ? "Drop file here..." : loading ? "Working..." : "Ask anything..."}
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
            startAdornment: (
              <InputAdornment position="start">
                <IconButton
                  size="small"
                  onClick={() => fileRef.current?.click()}
                  disabled={loading}
                  sx={{ width: 26, height: 26, color: "text.secondary" }}
                >
                  <AttachFileIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                {loading ? (
                  <IconButton size="small" onClick={onAbort} sx={{ width: 26, height: 26, color: "error.main" }}>
                    <StopIcon sx={{ fontSize: 13 }} />
                  </IconButton>
                ) : (
                  <IconButton
                    size="small"
                    onClick={onSend}
                    disabled={!input.trim()}
                    sx={{
                      bgcolor: input.trim() ? "primary.main" : "transparent",
                      color: input.trim() ? "#fff" : "text.secondary",
                      width: 26, height: 26,
                      "&:hover": { bgcolor: input.trim() ? "primary.dark" : "transparent" },
                    }}
                  >
                    <SendIcon sx={{ fontSize: 13 }} />
                  </IconButton>
                )}
              </InputAdornment>
            ),
          }}
          sx={{
            "& .MuiOutlinedInput-root": {
              borderRadius: 2, bgcolor: "#F8F8FA", fontSize: "0.95rem",
            },
          }}
        />
      </Box>

      {/* Context bar */}
      <Box sx={{ px: 2, pb: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          {contextInfo && (
            <>
              <Box sx={{ width: 50, height: 3, bgcolor: "rgba(0,0,0,0.08)", borderRadius: 2, overflow: "hidden" }}>
                <Box
                  sx={{
                    width: `${Math.min((contextInfo.tokens / contextInfo.limit) * 100, 100)}%`,
                    height: "100%",
                    borderRadius: 2,
                    bgcolor: contextInfo.tokens / contextInfo.limit > 0.8 ? "#EF4444" : "#22C55E",
                  }}
                />
              </Box>
              <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.78rem" }}>
                {Math.round(contextInfo.tokens / 1000)}k
              </Typography>
            </>
          )}
          <Tooltip title="Compact">
            <IconButton size="small" onClick={onCompact} disabled={loading || compacting} sx={{ width: 18, height: 18, color: "text.secondary" }}>
              {compacting ? <CircularProgress size={9} /> : <CompressIcon sx={{ fontSize: 12 }} />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Clear">
            <IconButton size="small" onClick={onClear} disabled={loading} sx={{ width: 18, height: 18, color: "text.secondary" }}>
              <DeleteOutlineIcon sx={{ fontSize: 12 }} />
            </IconButton>
          </Tooltip>
        </Box>
        <Select
          size="small"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={loading}
          sx={{ fontSize: "0.95rem", height: 22, "& .MuiSelect-select": { py: 0, px: 0.75 } }}
        >
          {MODEL_OPTIONS.map((m) => (
            <MenuItem key={m.id} value={m.id} sx={{ fontSize: "0.88rem" }}>{m.label}</MenuItem>
          ))}
        </Select>
      </Box>
    </Box>
  );
}

function MessageBubble({ role, content, tools }: { role: string; content: string; tools?: ToolActivity[] }) {
  const isUser = role === "user";
  const [toolsOpen, setToolsOpen] = useState(false);

  return (
    <Box sx={{ mb: 1.5, display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
      {!isUser && tools && tools.length > 0 && (
        <Box onClick={() => setToolsOpen((v) => !v)} sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.4, cursor: "pointer", color: "text.secondary", "&:hover": { color: "text.primary" } }}>
          <Typography variant="caption" sx={{ fontSize: "0.95rem", fontWeight: 500 }}>
            {toolsOpen ? "▾" : "▸"} {tools.length} tool{tools.length !== 1 ? "s" : ""}
          </Typography>
        </Box>
      )}
      {!isUser && toolsOpen && tools && (
        <Box sx={{ mb: 0.5, width: "100%", maxWidth: "90%" }}>
          <ToolActivityList activities={tools} />
        </Box>
      )}
      <Box
        sx={{
          maxWidth: "90%", px: 1.5, py: 1,
          borderRadius: isUser ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
          bgcolor: isUser ? "primary.main" : "#F4F4F6",
          color: isUser ? "#fff" : "text.primary",
          "& p": { m: 0, fontSize: "0.95rem", lineHeight: 1.55, "&:last-child": { mb: 0 } },
          "& code": { fontFamily: "monospace", fontSize: "0.9rem", bgcolor: isUser ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.07)", px: 0.5, borderRadius: 0.5 },
          "& pre": { bgcolor: isUser ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)", borderRadius: 1, p: 1, overflowX: "auto", "& code": { bgcolor: "transparent", px: 0, fontSize: "0.88rem" } },
          "& a": { color: isUser ? "#fff" : "primary.main" },
          "& ul, & ol": { pl: 2, mb: 0.5 },
          "& li": { fontSize: "0.95rem" },
        }}
      >
        {isUser ? (
          <Typography variant="body2" sx={{ fontSize: "0.95rem", lineHeight: 1.55 }}>{content}</Typography>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        )}
      </Box>
    </Box>
  );
}

function ToolActivityList({ activities }: { activities: ToolActivity[] }) {
  if (activities.length === 0) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.6, py: 0.4 }}>
        <CircularProgress size={10} thickness={5} sx={{ color: "#71717A" }} />
        <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.85rem" }}>Thinking...</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.3 }}>
      {activities.map((a, i) => {
        const meta = getToolMeta(a.tool);
        const isRunning = a.status === "running";
        return (
          <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 0.75, py: 0.3, borderRadius: 1, bgcolor: `${meta.color}10`, opacity: isRunning ? 1 : 0.5 }}>
            {isRunning ? <CircularProgress size={9} thickness={5} sx={{ color: meta.color }} /> : <Box sx={{ color: meta.color, display: "flex" }}>{meta.icon}</Box>}
            <Typography variant="caption" sx={{ color: meta.color, fontSize: "0.95rem", fontWeight: 700, textTransform: "uppercase" }}>{meta.label}</Typography>
          </Box>
        );
      })}
      {activities.some((a) => a.status === "running") && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 0.75, py: 0.3 }}>
          <CircularProgress size={9} thickness={5} sx={{ color: "#71717A" }} />
          <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.95rem" }}>working...</Typography>
        </Box>
      )}
    </Box>
  );
}
