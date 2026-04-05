"use client";

import { useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import RefreshIcon from "@mui/icons-material/Refresh";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

interface Props {
  previewUrl: string | null;
  previewPort: number;
  projectTemplate: string;
  changePreviewPort: (port: number) => Promise<string | null>;
  iframeKey: number;
  setIframeKey: (fn: (k: number) => number) => void;
}

export default function BrowserPanel({ previewUrl, previewPort, projectTemplate, changePreviewPort, iframeKey, setIframeKey }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [portInput, setPortInput] = useState(String(previewPort));
  const [loadingPort, setLoadingPort] = useState(false);
  const [portError, setPortError] = useState<string | null>(null);
  const isBlank = projectTemplate !== "nextjs";

  const handlePortSubmit = async () => {
    const port = parseInt(portInput, 10);
    if (!port || port < 1 || port > 65535) return;
    if (port === previewPort && previewUrl) return;
    setPortError(null);
    setLoadingPort(true);
    const error = await changePreviewPort(port);
    if (error) setPortError(error);
    setLoadingPort(false);
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "#FAFAFA" }}>
      {/* Browser chrome */}
      <Box
        sx={{
          height: 36,
          px: 1.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "#F8F8FA",
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          flexShrink: 0,
        }}
      >
        {["#FF5F57", "#FFBD2E", "#28C840"].map((color) => (
          <Box key={color} sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color }} />
        ))}

        {/* Port selector */}
        <Tooltip title="Preview port">
          <TextField
            size="small"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value.replace(/\D/g, "").slice(0, 5))}
            onKeyDown={(e) => {
              if (e.key === "Enter") handlePortSubmit();
            }}
            onBlur={handlePortSubmit}
            disabled={loadingPort}
            sx={{
              width: 62,
              "& .MuiOutlinedInput-root": {
                height: 22, fontSize: "0.78rem",
                fontFamily: 'var(--font-geist-mono), monospace',
                bgcolor: "#fff",
                "& fieldset": { borderColor: "rgba(0,0,0,0.1)" },
              },
              "& .MuiOutlinedInput-input": { px: 0.75, py: 0, textAlign: "center" },
            }}
          />
        </Tooltip>

        {loadingPort && <CircularProgress size={12} thickness={5} sx={{ color: "text.secondary" }} />}

        {/* URL bar */}
        <Box
          sx={{
            flex: 1, height: 22, bgcolor: "#EFEFEF",
            borderRadius: 0.75, display: "flex", alignItems: "center", px: 1,
          }}
        >
          <Typography variant="caption" sx={{ color: "#888", fontSize: "0.78rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {previewUrl || (isBlank ? "Enter a port to preview" : "localhost:3000")}
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => setIframeKey((k) => k + 1)} sx={{ width: 20, height: 20, color: "text.secondary" }}>
            <RefreshIcon sx={{ fontSize: 13 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Open in new tab">
          <IconButton
            size="small"
            disabled={!previewUrl}
            onClick={() => previewUrl && window.open(previewUrl, "_blank")}
            sx={{ width: 20, height: 20, color: "text.secondary" }}
          >
            <OpenInNewIcon sx={{ fontSize: 13 }} />
          </IconButton>
        </Tooltip>
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
          <Box sx={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 1 }}>
            {portError ? (
              <Typography sx={{ color: "#C53030", fontSize: "0.85rem", textAlign: "center", px: 3 }}>
                {portError}
              </Typography>
            ) : (
              <Typography sx={{ color: "#B0B0B8", fontSize: "0.88rem" }}>
                {isBlank
                  ? "Start a server in the terminal, then enter its port above"
                  : "Waiting for dev server..."
                }
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
