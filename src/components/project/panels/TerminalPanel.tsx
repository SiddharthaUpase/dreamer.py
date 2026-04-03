"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { createClient } from "@/lib/supabase/client";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface Props {
  terminalUrl: string | null;
  panelId?: string;
  projectId?: string;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const openRouterKey = typeof window !== "undefined" ? localStorage.getItem("openrouter_key") : null;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(openRouterKey ? { "X-OpenRouter-Key": openRouterKey } : {}),
  };
}

export default function TerminalPanel({ terminalUrl, panelId, projectId }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadDone, setUploadDone] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragCountRef = useRef(0);

  const sessionId = panelId || "default";

  const sessionUrl = useMemo(() => {
    if (!terminalUrl) return null;
    const separator = terminalUrl.includes("?") ? "&" : "?";
    return `${terminalUrl}${separator}sessionId=${encodeURIComponent(sessionId)}`;
  }, [terminalUrl, sessionId]);

  // Listen for drag events at the window level to detect files being dragged
  // over the terminal area (since the iframe eats drag events)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleDragEnter(e: DragEvent) {
      if (!e.dataTransfer?.types.includes("Files")) return;
      dragCountRef.current++;
      // Check if mouse is over our container
      const rect = container!.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        setDragOver(true);
      }
    }

    function handleDragOver(e: DragEvent) {
      if (!e.dataTransfer?.types.includes("Files")) return;
      const rect = container!.getBoundingClientRect();
      const isOver = e.clientX >= rect.left && e.clientX <= rect.right &&
                     e.clientY >= rect.top && e.clientY <= rect.bottom;
      setDragOver(isOver);
      if (isOver) e.preventDefault();
    }

    function handleDragLeave() {
      dragCountRef.current--;
      if (dragCountRef.current <= 0) {
        dragCountRef.current = 0;
        setDragOver(false);
      }
    }

    function handleDrop(e: DragEvent) {
      dragCountRef.current = 0;
      setDragOver(false);
    }

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  const handleFileDrop = useCallback(async (file: File) => {
    if (!projectId) return;
    setUploading(true);
    setUploadDone(null);

    try {
      // 1. Upload file to sandbox
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const formData = new FormData();
      formData.append("file", file);

      const uploadHeaders: Record<string, string> = {};
      if (token) uploadHeaders["Authorization"] = `Bearer ${token}`;

      const uploadRes = await fetch(`${API}/api/projects/${projectId}/upload`, {
        method: "POST",
        headers: uploadHeaders,
        body: formData,
      });

      if (!uploadRes.ok) throw new Error("Upload failed");
      const { path } = await uploadRes.json();

      // 2. Paste the path into the terminal session
      const headers = await getAuthHeaders();
      await fetch(`${API}/api/projects/${projectId}/terminal-paste`, {
        method: "POST",
        headers,
        body: JSON.stringify({ sessionId, text: path + " " }),
      });

      setUploadDone(path);
      setTimeout(() => setUploadDone(null), 2000);
    } catch (err: any) {
      console.error("[terminal] file drop failed:", err.message);
    } finally {
      setUploading(false);
    }
  }, [projectId, sessionId]);

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
    <Box ref={containerRef} sx={{ height: "100%", bgcolor: "#000", position: "relative" }}>
      <iframe
        src={sessionUrl}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          pointerEvents: dragOver || uploading ? "none" : "auto",
        }}
        title="Terminal"
      />

      {/* Drop overlay — shown when file is dragged over this terminal */}
      {(dragOver || uploading) && (
        <Box
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFileDrop(file);
          }}
          sx={{
            position: "absolute",
            inset: 0,
            bgcolor: "rgba(0, 0, 0, 0.8)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1.5,
            zIndex: 20,
            border: uploading ? "none" : "2px dashed rgba(99, 102, 241, 0.6)",
            borderRadius: 1,
          }}
        >
          {uploading ? (
            <>
              <CircularProgress size={24} sx={{ color: "#888" }} />
              <Typography variant="caption" sx={{ color: "#aaa" }}>Uploading...</Typography>
            </>
          ) : (
            <>
              <UploadFileIcon sx={{ fontSize: 32, color: "#6366f1" }} />
              <Typography variant="body2" sx={{ color: "#ccc", fontWeight: 500 }}>
                Drop file to upload to sandbox
              </Typography>
              <Typography variant="caption" sx={{ color: "#888" }}>
                File path will be pasted in the terminal
              </Typography>
            </>
          )}
        </Box>
      )}

      {/* Upload success toast */}
      {uploadDone && (
        <Box
          sx={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            bgcolor: "rgba(34, 197, 94, 0.9)",
            color: "#fff",
            px: 2,
            py: 0.75,
            borderRadius: 2,
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            zIndex: 30,
          }}
        >
          <CheckCircleIcon sx={{ fontSize: 16 }} />
          <Typography variant="caption" sx={{ fontSize: "0.75rem" }}>
            {uploadDone}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
