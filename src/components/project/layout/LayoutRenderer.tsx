"use client";

import { useRef, useEffect, useCallback } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { LayoutNode, PanelType } from "./types";
import type { LayoutAction, DropPosition } from "./layoutReducer";
import { useDrag } from "./DragContext";
import ChatPanel from "../panels/ChatPanel";
import TerminalPanel from "../panels/TerminalPanel";
import BrowserPanel from "../panels/BrowserPanel";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CloseIcon from "@mui/icons-material/Close";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ChatIcon from "@mui/icons-material/Chat";
import CodeIcon from "@mui/icons-material/Code";
import LanguageIcon from "@mui/icons-material/Language";
import type { ChatMessage, ToolActivity, ContextInfo } from "@/hooks/useProject";

const PANEL_ICONS: Record<PanelType, React.ReactNode> = {
  chat: <ChatIcon sx={{ fontSize: 13 }} />,
  terminal: <CodeIcon sx={{ fontSize: 13 }} />,
  browser: <LanguageIcon sx={{ fontSize: 13 }} />,
};

const PANEL_LABELS: Record<PanelType, string> = {
  chat: "Chat",
  terminal: "Terminal",
  browser: "Browser",
};

export interface PanelProps {
  projectId: string;
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
  previewUrl: string | null;
  iframeKey: number;
  setIframeKey: (fn: (k: number) => number) => void;
  terminalUrl: string | null;
}

interface Props {
  node: LayoutNode;
  dispatch: React.Dispatch<LayoutAction>;
  panelProps: PanelProps;
  canClose: boolean;
}

// Determine drop position from mouse position relative to element bounds
function getDropPosition(rect: DOMRect, clientX: number, clientY: number): DropPosition {
  const relX = (clientX - rect.left) / rect.width;
  const relY = (clientY - rect.top) / rect.height;

  // Edge zones (outer 25%)
  if (relX < 0.25) return "left";
  if (relX > 0.75) return "right";
  if (relY < 0.25) return "top";
  if (relY > 0.75) return "bottom";
  return "center";
}

// Drop zone overlay highlight
const DROP_ZONE_STYLES: Record<DropPosition, React.CSSProperties> = {
  left:   { left: 0, top: 0, width: "50%", height: "100%" },
  right:  { right: 0, top: 0, width: "50%", height: "100%" },
  top:    { left: 0, top: 0, width: "100%", height: "50%" },
  bottom: { left: 0, bottom: 0, width: "100%", height: "50%" },
  center: { left: 0, top: 0, width: "100%", height: "100%" },
};

function PanelLeaf({
  node,
  dispatch,
  panelProps,
  canClose,
}: {
  node: LayoutNode & { type: "panel" };
  dispatch: React.Dispatch<LayoutAction>;
  panelProps: PanelProps;
  canClose: boolean;
}) {
  const { drag, dropTarget, startDrag, setDropTarget, endDrag } = useDrag();
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = drag?.panelId === node.id;
  const isDropTarget = dropTarget?.panelId === node.id && drag && drag.panelId !== node.id;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start drag from the header area
    e.preventDefault();
    startDrag(node.id, node.panelType);

    const handleMouseMove = (me: MouseEvent) => {
      // Find which panel element the mouse is over
      const els = document.elementsFromPoint(me.clientX, me.clientY);
      const panelEl = els.find((el) => el.getAttribute("data-panel-id") && el.getAttribute("data-panel-id") !== node.id);
      if (panelEl) {
        const rect = panelEl.getBoundingClientRect();
        const pos = getDropPosition(rect, me.clientX, me.clientY);
        setDropTarget({ panelId: panelEl.getAttribute("data-panel-id")!, position: pos });
      } else {
        setDropTarget(null);
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);

      // Get final drop target from state — need to read from DOM since state is stale in closure
      const els = document.elementsFromPoint(
        (window as any).__lastDragX ?? 0,
        (window as any).__lastDragY ?? 0
      );
      const panelEl = els.find((el) => el.getAttribute("data-panel-id") && el.getAttribute("data-panel-id") !== node.id);
      if (panelEl) {
        const rect = panelEl.getBoundingClientRect();
        const pos = getDropPosition(rect, (window as any).__lastDragX, (window as any).__lastDragY);
        dispatch({
          type: "MOVE_PANEL",
          panelId: node.id,
          targetId: panelEl.getAttribute("data-panel-id")!,
          position: pos,
        });
      }
      endDrag();
    };

    // Track last mouse position for mouseup
    const trackPos = (me: MouseEvent) => {
      (window as any).__lastDragX = me.clientX;
      (window as any).__lastDragY = me.clientY;
    };
    document.addEventListener("mousemove", trackPos);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", () => {
      document.removeEventListener("mousemove", trackPos);
      handleMouseUp();
    }, { once: true });
  }, [node.id, node.panelType, startDrag, setDropTarget, endDrag, dispatch]);

  return (
    <Box
      ref={containerRef}
      data-panel-id={node.id}
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
        opacity: isDragging ? 0.4 : 1,
        transition: "opacity 0.15s",
      }}
    >
      {/* Panel header — draggable */}
      <Box
        onMouseDown={handleMouseDown}
        sx={{
          height: 30,
          px: 1.5,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          flexShrink: 0,
          cursor: "grab",
          userSelect: "none",
          "&:active": { cursor: "grabbing" },
        }}
      >
        <DragIndicatorIcon sx={{ fontSize: 12, color: "text.disabled" }} />
        <Box sx={{ color: "text.secondary", display: "flex", alignItems: "center" }}>
          {PANEL_ICONS[node.panelType]}
        </Box>
        <Typography variant="caption" sx={{ fontSize: "0.7rem", fontWeight: 600, color: "text.secondary", flex: 1 }}>
          {PANEL_LABELS[node.panelType]}
        </Typography>
        {canClose && (
          <Tooltip title="Close panel">
            <IconButton
              size="small"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => dispatch({ type: "REMOVE_PANEL", panelId: node.id })}
              sx={{ width: 18, height: 18, color: "text.secondary", "&:hover": { color: "error.main" } }}
            >
              <CloseIcon sx={{ fontSize: 11 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Panel content */}
      <Box sx={{ flex: 1, overflow: "hidden", pointerEvents: drag ? "none" : "auto" }}>
        {node.panelType === "chat" && (
          <ChatPanel
            messages={panelProps.messages}
            input={panelProps.input}
            setInput={panelProps.setInput}
            loading={panelProps.loading}
            toolActivities={panelProps.toolActivities}
            contextInfo={panelProps.contextInfo}
            compacting={panelProps.compacting}
            selectedModel={panelProps.selectedModel}
            setSelectedModel={panelProps.setSelectedModel}
            messagesEndRef={panelProps.messagesEndRef}
            onSend={panelProps.onSend}
            onAbort={panelProps.onAbort}
            onClear={panelProps.onClear}
            onCompact={panelProps.onCompact}
            onFileUpload={panelProps.onFileUpload}
          />
        )}
        {node.panelType === "terminal" && (
          <TerminalPanel terminalUrl={panelProps.terminalUrl} panelId={node.id} projectId={panelProps.projectId} />
        )}
        {node.panelType === "browser" && (
          <BrowserPanel
            previewUrl={panelProps.previewUrl}
            iframeKey={panelProps.iframeKey}
            setIframeKey={panelProps.setIframeKey}
          />
        )}
      </Box>

      {/* Drop zone overlay */}
      {isDropTarget && (
        <Box
          sx={{
            position: "absolute",
            ...DROP_ZONE_STYLES[dropTarget!.position],
            bgcolor: "rgba(99, 102, 241, 0.15)",
            border: "2px dashed",
            borderColor: "primary.main",
            borderRadius: 1,
            zIndex: 100,
            pointerEvents: "none",
          }}
        />
      )}
    </Box>
  );
}

export default function LayoutRenderer({ node, dispatch, panelProps, canClose }: Props) {
  if (node.type === "panel") {
    return <PanelLeaf node={node} dispatch={dispatch} panelProps={panelProps} canClose={canClose} />;
  }

  // Split node
  const defaultLayout: Record<string, number> = {};
  node.children.forEach((child, i) => {
    defaultLayout[child.id] = node.sizes[i] ?? (100 / node.children.length);
  });

  return (
    <Group
      orientation={node.direction}
      id={node.id}
      defaultLayout={defaultLayout}
      onLayoutChanged={(layout: Record<string, number>) => {
        const sizes = node.children.map((child) => layout[child.id] ?? (100 / node.children.length));
        dispatch({ type: "UPDATE_SIZES", splitId: node.id, sizes });
      }}
      style={{ height: "100%", width: "100%" }}
    >
      {node.children.map((child, i) => (
        <LayoutPanelWithSeparator
          key={child.id}
          child={child}
          index={i}
          total={node.children.length}
          orientation={node.direction}
          dispatch={dispatch}
          panelProps={panelProps}
          canClose={canClose}
        />
      ))}
    </Group>
  );
}

function LayoutPanelWithSeparator({
  child,
  index,
  total,
  orientation,
  dispatch,
  panelProps,
  canClose,
}: {
  child: LayoutNode;
  index: number;
  total: number;
  orientation: "horizontal" | "vertical";
  dispatch: React.Dispatch<LayoutAction>;
  panelProps: PanelProps;
  canClose: boolean;
}) {
  const isHorizontal = orientation === "horizontal";
  return (
    <>
      <Panel id={child.id} minSize={10}>
        <LayoutRenderer node={child} dispatch={dispatch} panelProps={panelProps} canClose={canClose} />
      </Panel>
      {index < total - 1 && (
        <Separator
          style={{
            background: "transparent",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Box
            sx={{
              width: isHorizontal ? 5 : 32,
              height: isHorizontal ? 32 : 5,
              borderRadius: 3,
              bgcolor: "#ccc",
              transition: "all 0.15s",
              "[data-resize-handle]:hover &, [data-resize-handle][data-active] &": {
                bgcolor: "primary.main",
                ...(isHorizontal ? { height: 48 } : { width: 48 }),
              },
            }}
          />
        </Separator>
      )}
    </>
  );
}
