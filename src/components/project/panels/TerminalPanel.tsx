"use client";

import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

interface Props {
  terminalUrl: string | null;
  panelId?: string;
  projectId?: string;
}

export default function TerminalPanel({ terminalUrl, panelId }: Props) {
  const sessionId = panelId || "default";

  const sessionUrl = useMemo(() => {
    if (!terminalUrl) return null;
    const separator = terminalUrl.includes("?") ? "&" : "?";
    return `${terminalUrl}${separator}sessionId=${encodeURIComponent(sessionId)}`;
  }, [terminalUrl, sessionId]);

  if (!sessionUrl) {
    return (
      <Box sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "#000" }}>
        <Typography variant="caption" sx={{ color: "#666" }}>
          Terminal not available
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: "100%", bgcolor: "#000" }}>
      <iframe
        src={sessionUrl}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
        }}
        title="Terminal"
      />
    </Box>
  );
}
