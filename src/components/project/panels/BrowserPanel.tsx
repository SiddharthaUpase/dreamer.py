"use client";

import { useRef } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import RefreshIcon from "@mui/icons-material/Refresh";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

interface Props {
  previewUrl: string | null;
  iframeKey: number;
  setIframeKey: (fn: (k: number) => number) => void;
}

export default function BrowserPanel({ previewUrl, iframeKey, setIframeKey }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "#FAFAFA" }}>
      {/* Browser chrome */}
      <Box
        sx={{
          height: 32,
          px: 1.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "#F8F8FA",
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexShrink: 0,
        }}
      >
        {["#FF5F57", "#FFBD2E", "#28C840"].map((color) => (
          <Box key={color} sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color }} />
        ))}
        <Box
          sx={{
            flex: 1, mx: 1, height: 18, bgcolor: "#EFEFEF",
            borderRadius: 0.75, display: "flex", alignItems: "center", px: 1,
          }}
        >
          <Typography variant="caption" sx={{ color: "#888", fontSize: "0.6rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {previewUrl || "localhost:3000"}
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
          <Box sx={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Typography variant="caption" sx={{ color: "#B0B0B8", fontSize: "0.7rem" }}>
              Waiting for dev server...
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
