"use client";

import { useState, useRef, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Collapse from "@mui/material/Collapse";
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
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, ToolActivity, ContextInfo, StreamSegment } from "@/hooks/useProject";
import { MODEL_PRESETS, CUSTOM_MODELS } from "@/hooks/useProject";

// Friendly labels + contextual descriptions for non-tech users
const TOOL_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  bash:         { icon: <TerminalIcon    sx={{ fontSize: 13 }} />, label: "Running command",    color: "#16A34A" },
  read:         { icon: <DescriptionIcon sx={{ fontSize: 13 }} />, label: "Reading file",       color: "#2563EB" },
  write:        { icon: <EditNoteIcon    sx={{ fontSize: 13 }} />, label: "Creating file",      color: "#D97706" },
  edit:         { icon: <EditNoteIcon    sx={{ fontSize: 13 }} />, label: "Editing file",       color: "#EA580C" },
  grep:         { icon: <SearchIcon      sx={{ fontSize: 13 }} />, label: "Searching code",     color: "#7C3AED" },
  glob:         { icon: <SearchIcon      sx={{ fontSize: 13 }} />, label: "Finding files",      color: "#6D28D9" },
  preview_url:  { icon: <LanguageIcon    sx={{ fontSize: 13 }} />, label: "Opening preview",    color: "#0891B2" },
  start_server: { icon: <TerminalIcon    sx={{ fontSize: 13 }} />, label: "Starting server",    color: "#16A34A" },
  run_sql:      { icon: <BuildIcon       sx={{ fontSize: 13 }} />, label: "Querying database",  color: "#0891B2" },
  web_search:   { icon: <SearchIcon      sx={{ fontSize: 13 }} />, label: "Searching the web",  color: "#7C3AED" },
  url_fetch:    { icon: <LanguageIcon    sx={{ fontSize: 13 }} />, label: "Fetching page",      color: "#0891B2" },
};

function getToolMeta(name: string) {
  return TOOL_META[name] || { icon: <BuildIcon sx={{ fontSize: 13 }} />, label: name, color: "#71717A" };
}

/** Build a specific, human-readable description of what the tool is doing */
function describeToolAction(tool: string, args?: Record<string, unknown>): string {
  if (!args) return "";
  if (tool === "bash" && args.command) {
    const cmd = String(args.command);
    return cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd;
  }
  if (tool === "read" && args.file_path) {
    const p = String(args.file_path);
    return p.split("/").pop() || p;
  }
  if (tool === "write" && args.file_path) {
    const p = String(args.file_path);
    return p.split("/").pop() || p;
  }
  if (tool === "edit" && args.file_path) {
    const p = String(args.file_path);
    return p.split("/").pop() || p;
  }
  if (tool === "grep" && args.pattern) {
    return `"${args.pattern}"` + (args.path ? ` in ${String(args.path).split("/").pop()}` : "");
  }
  if (tool === "glob" && args.pattern) return String(args.pattern);
  if (tool === "run_sql" && args.query) {
    const q = String(args.query);
    return q.length > 50 ? q.slice(0, 47) + "..." : q;
  }
  if (tool === "web_search" && args.query) return String(args.query);
  if (tool === "url_fetch" && args.url) {
    const u = String(args.url);
    return u.length > 50 ? u.slice(0, 47) + "..." : u;
  }
  const first = Object.values(args).find((v) => typeof v === "string");
  return first ? String(first).slice(0, 60) : "";
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
  onSendWithFiles?: (files: File[]) => void;
  onAbort: () => void;
  onClear: () => void;
  onCompact: () => void;
  onFileUpload: (file: File) => void;
}

export default function ChatPanel({
  messages, input, setInput, loading, toolActivities,
  contextInfo, compacting, selectedModel, setSelectedModel,
  messagesEndRef, onSend, onSendWithFiles, onAbort, onClear, onCompact, onFileUpload,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});

  // Generate image previews for staged files
  useEffect(() => {
    const newPreviews: Record<string, string> = {};
    const urls: string[] = [];
    for (const file of stagedFiles) {
      if (file.type.startsWith("image/")) {
        const url = URL.createObjectURL(file);
        newPreviews[file.name + file.size] = url;
        urls.push(url);
      }
    }
    setFilePreviews(newPreviews);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [stagedFiles]);

  const addFiles = (files: FileList | File[]) => {
    setStagedFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const removeFile = (index: number) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSendWithStagedFiles = () => {
    if (stagedFiles.length > 0 && onSendWithFiles) {
      onSendWithFiles(stagedFiles);
      setStagedFiles([]);
    } else {
      onSend();
    }
  };

  // When loading starts, scroll to bottom to create clean workspace
  useEffect(() => {
    if (loading && scrollContainerRef.current) {
      const el = scrollContainerRef.current;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [loading]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    addFiles(files);
  };

  return (
    <Box
      sx={{ height: "100%", display: "flex", flexDirection: "column", position: "relative" }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
      onDragLeave={(e) => {
        // Only hide overlay if leaving the container entirely
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      {/* Full-panel drop overlay */}
      {dragOver && (
        <Box
          sx={{
            position: "absolute", inset: 0, zIndex: 20,
            bgcolor: "rgba(139, 105, 20, 0.08)",
            border: "2px dashed",
            borderColor: "primary.main",
            borderRadius: 2,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <Box sx={{ textAlign: "center" }}>
            <AttachFileIcon sx={{ fontSize: 32, color: "primary.main", mb: 0.5 }} />
            <Typography sx={{ color: "primary.main", fontWeight: 600, fontSize: "0.95rem" }}>
              Drop files here
            </Typography>
          </Box>
        </Box>
      )}

      {/* Messages */}
      <Box ref={scrollContainerRef} sx={{ flex: 1, overflowY: "auto", px: 2, py: 2 }}>
        {messages.length === 0 && !loading && (
          <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", mt: 4 }}>
            What do you want to build?
          </Typography>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} isStreaming={loading && i === messages.length - 1} />
        ))}
        {/* Show thinking indicator when loading but no assistant message yet */}
        {loading && (messages.length === 0 || messages[messages.length - 1]?.role === "user") && (
          <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 0.6, py: 0.5 }}>
            <CircularProgress size={12} thickness={5} sx={{ color: "#71717A" }} />
            <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.85rem" }}>Thinking...</Typography>
          </Box>
        )}
        {/* Spacer to push content up when loading */}
        {loading && <Box sx={{ minHeight: "30vh" }} />}
        <div ref={messagesEndRef} />
      </Box>

      {/* Input */}
      <Box sx={{ px: 2, pt: 1, pb: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
        {/* Staged file previews */}
        {stagedFiles.length > 0 && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
            {stagedFiles.map((file, i) => {
              const key = file.name + file.size;
              const preview = filePreviews[key];
              const isImage = file.type.startsWith("image/");
              return (
                <Box
                  key={key + i}
                  sx={{
                    position: "relative",
                    borderRadius: 2,
                    overflow: "hidden",
                    border: "1px solid rgba(0,0,0,0.1)",
                    bgcolor: "#F4F4F6",
                    ...(isImage
                      ? { width: 72, height: 72 }
                      : { display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5 }),
                  }}
                >
                  {isImage && preview ? (
                    <img src={preview} alt={file.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <>
                      <AttachFileIcon sx={{ fontSize: 12, color: "text.secondary" }} />
                      <Box sx={{ overflow: "hidden" }}>
                        <Typography sx={{ fontSize: "0.72rem", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 100 }}>
                          {file.name}
                        </Typography>
                        <Typography sx={{ fontSize: "0.65rem", color: "text.secondary" }}>
                          {file.size < 1024 ? `${file.size}B` : file.size < 1048576 ? `${(file.size / 1024).toFixed(1)}KB` : `${(file.size / 1048576).toFixed(1)}MB`}
                        </Typography>
                      </Box>
                    </>
                  )}
                  {/* Remove button */}
                  <IconButton
                    size="small"
                    onClick={() => removeFile(i)}
                    sx={{
                      position: "absolute", top: 2, right: 2,
                      width: 18, height: 18,
                      bgcolor: "rgba(0,0,0,0.55)", color: "#fff",
                      "&:hover": { bgcolor: "rgba(0,0,0,0.75)" },
                    }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 11 }} />
                  </IconButton>
                </Box>
              );
            })}
          </Box>
        )}

        <input
          type="file"
          ref={fileRef}
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) addFiles(files);
            e.target.value = "";
          }}
        />
        <TextField
          fullWidth
          size="small"
          multiline
          maxRows={4}
          placeholder={loading ? "Working..." : "Ask anything..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSendWithStagedFiles();
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
                    onClick={handleSendWithStagedFiles}
                    disabled={!input.trim() && stagedFiles.length === 0}
                    sx={{
                      bgcolor: (input.trim() || stagedFiles.length > 0) ? "primary.main" : "transparent",
                      color: (input.trim() || stagedFiles.length > 0) ? "#fff" : "text.secondary",
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
        <ModelSelector selectedModel={selectedModel} setSelectedModel={setSelectedModel} disabled={loading} />
      </Box>
    </Box>
  );
}

function ModelSelector({ selectedModel, setSelectedModel, disabled }: { selectedModel: string; setSelectedModel: (v: string) => void; disabled: boolean }) {
  const activePreset = MODEL_PRESETS.find((p) => p.id === selectedModel);

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <Box
        sx={{
          display: "flex",
          borderRadius: 1,
          border: "1px solid",
          borderColor: "divider",
          overflow: "hidden",
        }}
      >
        {MODEL_PRESETS.map((preset) => (
          <Box
            key={preset.id}
            onClick={() => { if (!disabled) setSelectedModel(preset.id); }}
            sx={{
              px: 1,
              py: 0.25,
              cursor: disabled ? "default" : "pointer",
              fontSize: "0.78rem",
              fontWeight: selectedModel === preset.id ? 700 : 400,
              bgcolor: selectedModel === preset.id ? "primary.main" : "transparent",
              color: selectedModel === preset.id ? "#fff" : "text.secondary",
              transition: "all 0.15s",
              userSelect: "none",
              "&:hover": disabled ? {} : {
                bgcolor: selectedModel === preset.id ? "primary.main" : "rgba(0,0,0,0.04)",
              },
            }}
          >
            {preset.name}
          </Box>
        ))}
      </Box>

      <Select
        size="small"
        value={activePreset ? "" : selectedModel}
        displayEmpty
        onChange={(e) => {
          if (e.target.value) setSelectedModel(e.target.value);
        }}
        disabled={disabled}
        renderValue={(value) => {
          if (!value) return <Typography sx={{ fontSize: "0.75rem", color: "text.secondary" }}>...</Typography>;
          const model = CUSTOM_MODELS.find((m) => m.id === value);
          return <Typography sx={{ fontSize: "0.75rem" }}>{model?.label || value}</Typography>;
        }}
        sx={{
          fontSize: "0.75rem",
          height: 22,
          minWidth: 28,
          "& .MuiSelect-select": { py: 0, px: 0.5 },
        }}
      >
        {CUSTOM_MODELS.map((m) => (
          <MenuItem key={m.id} value={m.id} sx={{ fontSize: "0.82rem" }}>
            <Box>
              <Typography sx={{ fontSize: "0.82rem", fontWeight: 500 }}>{m.label}</Typography>
              <Typography sx={{ fontSize: "0.72rem", color: "text.secondary" }}>{m.desc}</Typography>
            </Box>
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
}

// ===== Message rendering =====

const mdStyles = {
  "& p": { m: 0, fontSize: "0.95rem", lineHeight: 1.55, "&:last-child": { mb: 0 } },
  "& code": { fontFamily: 'var(--font-geist-mono), monospace', fontSize: "0.9rem", bgcolor: "rgba(0,0,0,0.07)", px: 0.5, borderRadius: 0.5 },
  "& pre": { bgcolor: "rgba(0,0,0,0.06)", borderRadius: 1, p: 1, overflowX: "auto", "& code": { bgcolor: "transparent", px: 0, fontSize: "0.88rem" } },
  "& a": { color: "primary.main" },
  "& ul, & ol": { pl: 2, mb: 0.5 },
  "& li": { fontSize: "0.95rem" },
};

function MessageBubble({ msg, isStreaming }: { msg: ChatMessage; isStreaming?: boolean }) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <Box sx={{ mb: 1.5, display: "flex", justifyContent: "flex-end" }}>
        <Box
          sx={{
            maxWidth: "90%", px: 1.5, py: 1,
            borderRadius: "12px 12px 3px 12px",
            bgcolor: "primary.main", color: "#fff",
            "& p": { m: 0, fontSize: "0.95rem", lineHeight: 1.55 },
            "& code": { fontFamily: 'var(--font-geist-mono), monospace', fontSize: "0.9rem", bgcolor: "rgba(255,255,255,0.18)", px: 0.5, borderRadius: 0.5 },
          }}
        >
          <Typography variant="body2" sx={{ fontSize: "0.95rem", lineHeight: 1.55 }}>{msg.content}</Typography>
        </Box>
      </Box>
    );
  }

  // Assistant message — render segments in order if available
  if (msg.segments && msg.segments.length > 0) {
    return (
      <Box sx={{ mb: 1.5 }}>
        {msg.segments.map((seg, i) => {
          if (seg.type === "text") {
            return (
              <Box key={i} sx={{ maxWidth: "90%", px: 1.5, py: 1, mb: 0.5, borderRadius: "12px 12px 12px 3px", bgcolor: "#F4F4F6", ...mdStyles }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.content}</ReactMarkdown>
              </Box>
            );
          }
          // Tool segment
          return <ToolCallItem key={i} activity={seg} isLive={!!isStreaming} />;
        })}
        {/* Show working indicator if last segment is a running tool */}
        {isStreaming && msg.segments.length > 0 && msg.segments[msg.segments.length - 1].type === "tool" && (msg.segments[msg.segments.length - 1] as any).status === "running" && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, pl: 1, py: 0.3, mt: 0.2 }}>
            <CircularProgress size={10} thickness={5} sx={{ color: "#71717A" }} />
            <Typography sx={{ color: "text.secondary", fontSize: "0.8rem" }}>working...</Typography>
          </Box>
        )}
      </Box>
    );
  }

  // Fallback: plain assistant message with no segments
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ maxWidth: "90%", px: 1.5, py: 1, borderRadius: "12px 12px 12px 3px", bgcolor: "#F4F4F6", ...mdStyles }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
      </Box>
    </Box>
  );
}

// ===== Tool call rendering =====

function ToolCallItem({ activity, isLive }: { activity: StreamSegment & { type: "tool" } | ToolActivity; isLive: boolean }) {
  const isRunning = activity.status === "running";
  // Expanded while running (live), collapsed once done
  const [expanded, setExpanded] = useState(isRunning && isLive);
  const hasDetails = !!(activity.args || activity.output);
  const meta = getToolMeta(activity.tool);
  const description = describeToolAction(activity.tool, activity.args);

  // Auto-expand when tool starts running during live stream
  useEffect(() => {
    if (isRunning && isLive) {
      setExpanded(true);
    }
  }, [isRunning, isLive]);

  // Auto-collapse all tools when the entire run completes (isLive goes false)
  useEffect(() => {
    if (!isLive && !isRunning) {
      setExpanded(false);
    }
  }, [isLive, isRunning]);

  return (
    <Box
      sx={{
        maxWidth: "90%",
        borderRadius: 2,
        overflow: "hidden",
        mb: 0.5,
        bgcolor: isRunning ? `${meta.color}08` : "#FAFAFA",
        border: "1px solid",
        borderColor: isRunning ? `${meta.color}30` : "rgba(0,0,0,0.06)",
        transition: "all 0.2s ease",
        fontFamily: 'var(--font-geist-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Header row */}
      <Box
        onClick={() => hasDetails && setExpanded((v) => !v)}
        sx={{
          display: "flex", alignItems: "center", gap: 0.75,
          px: 1.25, py: 0.6,
          cursor: hasDetails ? "pointer" : "default",
          "&:hover": hasDetails ? { bgcolor: "rgba(0,0,0,0.02)" } : {},
        }}
      >
        {/* Status indicator */}
        {isRunning ? (
          <CircularProgress size={11} thickness={5} sx={{ color: meta.color, flexShrink: 0 }} />
        ) : (
          <CheckCircleIcon sx={{ fontSize: 13, color: "#22C55E", flexShrink: 0 }} />
        )}

        {/* Tool icon */}
        <Box sx={{ color: meta.color, display: "flex", flexShrink: 0 }}>{meta.icon}</Box>

        {/* Friendly label + specific description */}
        <Typography sx={{ fontSize: "0.88rem", fontWeight: 600, color: "#2C2416", flexShrink: 0 }}>
          {meta.label}
        </Typography>
        {description && (
          <Typography
            sx={{
              fontSize: "0.84rem", color: "#6B6055", fontWeight: 400,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              flex: 1, minWidth: 0,
            }}
          >
            {description}
          </Typography>
        )}

        {/* Expand chevron */}
        {hasDetails && (
          <Box sx={{ flexShrink: 0, color: "#AAA", display: "flex" }}>
            {expanded ? <ExpandLessIcon sx={{ fontSize: 15 }} /> : <ExpandMoreIcon sx={{ fontSize: 15 }} />}
          </Box>
        )}
      </Box>

      {/* Expanded details */}
      <Collapse in={expanded}>
        <Box sx={{ borderTop: "1px solid", borderColor: "rgba(0,0,0,0.05)", px: 1.25, py: 0.75, bgcolor: "rgba(0,0,0,0.015)" }}>
          {/* Args / Input */}
          {activity.args && Object.keys(activity.args).length > 0 && (
            <Box sx={{ mb: activity.output ? 0.75 : 0 }}>
              <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, color: "#8A8078", textTransform: "uppercase", letterSpacing: "0.04em", mb: 0.3 }}>
                Input
              </Typography>
              <Box
                sx={{
                  bgcolor: "rgba(0,0,0,0.03)", borderRadius: 1, px: 1, py: 0.5,
                  maxHeight: 120, overflowY: "auto",
                }}
              >
                {Object.entries(activity.args).map(([k, v]) => (
                  <Box key={k} sx={{ mb: 0.2 }}>
                    <Typography component="span" sx={{ fontSize: "0.8rem", fontFamily: 'var(--font-geist-mono), monospace', color: meta.color, fontWeight: 600 }}>
                      {k}
                    </Typography>
                    <Typography component="span" sx={{ fontSize: "0.8rem", color: "#8A8078" }}>{": "}</Typography>
                    <Typography component="span" sx={{ fontSize: "0.8rem", fontFamily: 'var(--font-geist-mono), monospace', color: "#3D3220", wordBreak: "break-all" }}>
                      {typeof v === "string" ? v : JSON.stringify(v)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
          {/* Output */}
          {activity.output && (
            <Box>
              <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, color: "#8A8078", textTransform: "uppercase", letterSpacing: "0.04em", mb: 0.3 }}>
                Output
              </Typography>
              <Box
                sx={{
                  bgcolor: "rgba(0,0,0,0.03)", borderRadius: 1, px: 1, py: 0.5,
                  fontFamily: 'var(--font-geist-mono), monospace', fontSize: "0.8rem", color: "#3D3220",
                  whiteSpace: "pre-wrap", wordBreak: "break-all",
                  maxHeight: 100, overflowY: "auto", lineHeight: 1.5,
                }}
              >
                {activity.output}
              </Box>
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
