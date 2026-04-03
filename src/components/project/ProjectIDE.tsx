"use client";

import { useReducer, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import ChatIcon from "@mui/icons-material/Chat";
import CodeIcon from "@mui/icons-material/Code";
import LanguageIcon from "@mui/icons-material/Language";
import { useRouter } from "next/navigation";
import { useProject } from "@/hooks/useProject";
import LayoutRenderer from "./layout/LayoutRenderer";
import { DragProvider } from "./layout/DragContext";
import { layoutReducer, DEFAULT_LAYOUT, countPanels } from "./layout/layoutReducer";
import type { PanelType } from "./layout/types";

interface Props {
  projectId: string;
}

export default function ProjectIDE({ projectId }: Props) {
  const router = useRouter();
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);

  const {
    messages, projectName, input, setInput, loading, toolActivities,
    previewUrl, iframeKey, setIframeKey, sandboxStatus, sandboxError,
    selectedModel, setSelectedModel, contextInfo, compacting,
    messagesEndRef, handleSend, handleAbort, handleClose,
    handleClearChat, handleCompact, handleDeploy, handleUploadFile,
    deploying, terminalUrl, savedLayout, saveLayout,
  } = useProject(projectId);

  const [layout, dispatch] = useReducer(layoutReducer, DEFAULT_LAYOUT);
  const layoutInitialized = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore saved layout from server once sandbox is ready
  useEffect(() => {
    if (sandboxStatus !== "ready") return;
    if (layoutInitialized.current) return;
    layoutInitialized.current = true;
    if (savedLayout) {
      console.log("[layout] restoring saved layout");
      dispatch({ type: "SET_LAYOUT", layout: savedLayout });
    } else {
      console.log("[layout] no saved layout, using default");
    }
  }, [sandboxStatus, savedLayout]);

  // Debounced save on layout changes (500ms)
  useEffect(() => {
    if (!layoutInitialized.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      console.log("[layout] saving layout to server...", JSON.stringify(layout).slice(0, 200));
      saveLayout(layout);
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [layout, saveLayout]);

  // ESC to abort streaming
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && loading) handleAbort();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, handleAbort]);

  if (sandboxStatus === "loading") {
    return (
      <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, bgcolor: "background.default" }}>
        <CircularProgress size={28} thickness={3} />
        <Typography variant="body2" sx={{ color: "text.secondary" }}>Starting your sandbox...</Typography>
      </Box>
    );
  }

  if (sandboxStatus === "error") {
    return (
      <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, bgcolor: "background.default" }}>
        <Typography variant="body2" sx={{ color: "error.main" }}>Failed to start sandbox: {sandboxError}</Typography>
      </Box>
    );
  }

  const handleAddPanel = (panelType: PanelType) => {
    // Find the first panel to add next to
    const findFirstPanel = (node: typeof layout.root): string | null => {
      if (node.type === "panel") return node.id;
      for (const child of node.children) {
        const id = findFirstPanel(child);
        if (id) return id;
      }
      return null;
    };
    const targetId = findFirstPanel(layout.root);
    if (targetId) {
      dispatch({ type: "ADD_PANEL", targetId, panelType, position: "right" });
    }
    setAddMenuAnchor(null);
  };

  const panelProps = {
    projectId,
    messages, input, setInput, loading, toolActivities,
    contextInfo, compacting, selectedModel, setSelectedModel,
    messagesEndRef, onSend: handleSend, onAbort: handleAbort,
    onClear: handleClearChat, onCompact: handleCompact,
    onFileUpload: async (file: File) => {
      const path = await handleUploadFile(file);
      if (path) setInput((prev: string) => prev + (prev ? " " : "") + `[uploaded: ${path}]`);
    },
    previewUrl, iframeKey, setIframeKey,
    terminalUrl,
  };

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
      {/* Top bar */}
      <Box
        sx={{
          height: 44,
          px: 1.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexShrink: 0,
        }}
      >
        <Tooltip title="Back to projects">
          <IconButton size="small" onClick={() => { handleClose(); router.push("/"); }} sx={{ color: "text.secondary" }}>
            <ArrowBackIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>

        <Typography variant="body2" fontWeight={600} sx={{ color: "text.primary", flex: 1, fontSize: "0.85rem" }}>
          {projectName ?? "Loading..."}
        </Typography>

        <Tooltip title="Add panel">
          <IconButton
            size="small"
            onClick={(e) => setAddMenuAnchor(e.currentTarget)}
            sx={{ color: "text.secondary" }}
          >
            <AddIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>

        <Menu
          anchorEl={addMenuAnchor}
          open={!!addMenuAnchor}
          onClose={() => setAddMenuAnchor(null)}
          slotProps={{ paper: { sx: { minWidth: 160, borderRadius: 2 } } }}
        >
          <MenuItem
            onClick={() => handleAddPanel("chat")}
            disabled={countPanels(layout.root, "chat") >= 1}
          >
            <ListItemIcon><ChatIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Chat</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleAddPanel("terminal")}>
            <ListItemIcon><CodeIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Terminal</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleAddPanel("browser")}>
            <ListItemIcon><LanguageIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Browser</ListItemText>
          </MenuItem>
        </Menu>

        <Tooltip title="Deploy to Vercel">
          <IconButton
            size="small"
            disabled={deploying || loading}
            onClick={handleDeploy}
            sx={{ color: deploying ? "primary.main" : "text.secondary" }}
          >
            {deploying ? <CircularProgress size={16} thickness={3} /> : <RocketLaunchIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        </Tooltip>
      </Box>

      {/* Layout area */}
      <DragProvider>
        <Box sx={{ flex: 1, overflow: "hidden" }}>
          <LayoutRenderer
            node={layout.root}
            dispatch={dispatch}
            panelProps={panelProps}
            canClose={true}
          />
        </Box>
      </DragProvider>
    </Box>
  );
}
