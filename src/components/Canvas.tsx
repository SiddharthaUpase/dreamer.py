"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Box from "@mui/material/Box";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import AgentNode, { AgentNodeData } from "./AgentNode";
import ExpandedAgentView from "./ExpandedAgentView";
import { useAgentChat } from "../hooks/useAgentChat";

const DOT_GAP = 32;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;

const AGENT_NAMES = [
  "Scout", "Warrior", "Wizard", "Healer", "Archer",
  "Builder", "Miner", "Dragon", "Golem", "Valkyrie",
  "Phoenix", "Titan", "Sparky", "Sentinel", "Oracle",
  "Nomad", "Rogue", "Sage", "Reaper", "Bolt",
];

let nameCounter = 0;
function getNextName() {
  const name = AGENT_NAMES[nameCounter % AGENT_NAMES.length];
  nameCounter++;
  return `${name}-${nameCounter}`;
}

const API = "http://localhost:3001";

// Wrapper component so each node gets its own useAgentChat hook instance
function AgentNodeWithChat({
  node,
  onMove,
  onDelete,
  onMessagesChange,
  onModelChange,
  onPreviewUrlChange,
  isExpanded,
  onExpand,
  onCollapse,
}: {
  node: AgentNodeData;
  onMove: (id: string, dx: number, dy: number) => void;
  onDelete: (id: string) => void;
  onMessagesChange: (id: string, messages: { role: "user" | "assistant"; content: string }[]) => void;
  onModelChange: (id: string, model: string) => void;
  onPreviewUrlChange: (id: string, url: string) => void;
  isExpanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const chat = useAgentChat({
    nodeId: node.id,
    savedMessages: node.savedMessages,
    savedModel: node.savedModel,
    savedPreviewUrl: node.previewUrl,
    onMessagesChange,
    onModelChange,
    onPreviewUrlChange,
  });

  return (
    <>
      <AgentNode
        node={node}
        chat={chat}
        onMove={onMove}
        onDelete={onDelete}
        onExpand={onExpand}
      />
      {isExpanded &&
        createPortal(
          <ExpandedAgentView node={node} chat={chat} onCollapse={onCollapse} />,
          document.body
        )}
    </>
  );
}

export default function Canvas() {
  const [nodes, setNodes] = useState<AgentNodeData[]>([]);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, camX: 0, camY: 0 });
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const spawnPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/agents`)
      .then((r) => r.json())
      .then((data) => {
        if (data.agents?.length) {
          setNodes(
            data.agents.map((a: any) => ({
              id: a.id,
              name: a.name,
              x: a.x,
              y: a.y,
              savedMessages: a.messages || [],
              savedModel: a.model || "claude-sonnet",
              previewUrl: a.previewUrl || undefined,
            }))
          );
          nameCounter = data.agents.length;
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const screenToWorld = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - camera.x) / camera.zoom,
      y: (sy - camera.y) / camera.zoom,
    }),
    [camera]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.target as HTMLElement)) return;

      if (
        e.button === 1 ||
        (e.button === 0 && !(e.target as HTMLElement).closest("[data-agent-node]"))
      ) {
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY, camX: camera.x, camY: camera.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    },
    [camera]
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setCamera((c) => ({ ...c, x: panStart.current.camX + dx, y: panStart.current.camY + dy }));
  }, []);

  const handlePointerUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-agent-node]")) return;
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        const delta = -e.deltaY * 0.005;
        setCamera((c) => {
          const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * (1 + delta)));
          const ratio = newZoom / c.zoom;
          return {
            x: e.clientX - (e.clientX - c.x) * ratio,
            y: e.clientY - (e.clientY - c.y) * ratio,
            zoom: newZoom,
          };
        });
      } else {
        setCamera((c) => ({
          ...c,
          x: c.x - e.deltaX,
          y: c.y - e.deltaY,
        }));
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-agent-node]")) return;
      e.preventDefault();
      spawnPos.current = screenToWorld(e.clientX, e.clientY);
      setMenuPos({ x: e.clientX, y: e.clientY });
    },
    [screenToWorld]
  );

  const handleDeploy = useCallback(() => {
    setMenuPos(null);
    const newNode: AgentNodeData = {
      id: crypto.randomUUID(),
      name: getNextName(),
      x: spawnPos.current.x - 150,
      y: spawnPos.current.y - 40,
    };
    setNodes((prev) => [...prev, newNode]);
    fetch(`${API}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newNode),
    }).catch(() => {});
  }, []);

  const moveTimers = useRef<Record<string, NodeJS.Timeout>>({});

  const handleMoveNode = useCallback(
    (id: string, dx: number, dy: number) => {
      setNodes((prev) => {
        const updated = prev.map((n) =>
          n.id === id ? { ...n, x: n.x + dx / camera.zoom, y: n.y + dy / camera.zoom } : n
        );
        clearTimeout(moveTimers.current[id]);
        const node = updated.find((n) => n.id === id);
        if (node) {
          moveTimers.current[id] = setTimeout(() => {
            fetch(`${API}/api/agents/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ x: node.x, y: node.y }),
            }).catch(() => {});
          }, 300);
        }
        return updated;
      });
    },
    [camera.zoom]
  );

  const handleDeleteNode = useCallback((id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setExpandedNodeId((prev) => (prev === id ? null : prev));
    fetch(`${API}/api/agents/${id}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const handleMessagesChange = useCallback((id: string, messages: { role: "user" | "assistant"; content: string }[]) => {
    fetch(`${API}/api/agents/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    }).catch(() => {});
  }, []);

  const handleModelChange = useCallback((id: string, model: string) => {
    fetch(`${API}/api/agents/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    }).catch(() => {});
  }, []);

  const handlePreviewUrlChange = useCallback((id: string, url: string) => {
    fetch(`${API}/api/agents/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previewUrl: url }),
    }).catch(() => {});
  }, []);

  const gridOffsetX = camera.x % (DOT_GAP * camera.zoom);
  const gridOffsetY = camera.y % (DOT_GAP * camera.zoom);
  const scaledGap = DOT_GAP * camera.zoom;
  const dotSize = Math.max(0.8, camera.zoom * 1.2);

  return (
    <Box
      ref={canvasRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={handleContextMenu}
      sx={{
        width: "100vw",
        height: "100vh",
        bgcolor: "background.default",
        position: "relative",
        overflow: "hidden",
        backgroundImage: `radial-gradient(circle, rgba(167,139,250,0.07) ${dotSize}px, transparent ${dotSize}px)`,
        backgroundSize: `${scaledGap}px ${scaledGap}px`,
        backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
      }}
    >
      {/* Brand */}
      <Box
        sx={{
          position: "absolute",
          top: 16,
          left: 20,
          display: "flex",
          alignItems: "center",
          gap: 1,
          zIndex: 10,
          userSelect: "none",
          pointerEvents: "none",
        }}
      >
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            bgcolor: "primary.main",
            boxShadow: "0 0 10px rgba(167,139,250,0.6)",
            animation: "pulse 2s ease-in-out infinite",
            "@keyframes pulse": {
              "0%,100%": { opacity: 1 },
              "50%": { opacity: 0.4 },
            },
          }}
        />
        <Typography
          variant="body2"
          sx={{ color: "primary.light", fontWeight: 700, letterSpacing: 1, fontSize: 13 }}
        >
          Agent VAS
        </Typography>
      </Box>

      {/* Troop counter */}
      <Box
        sx={{
          position: "absolute",
          top: 14,
          right: 20,
          display: "flex",
          alignItems: "center",
          gap: 1,
          zIndex: 10,
          userSelect: "none",
          pointerEvents: "none",
          bgcolor: "rgba(26,26,46,0.8)",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          px: 1.5,
          py: 0.5,
        }}
      >
        <SmartToyIcon sx={{ fontSize: 16, color: "primary.main" }} />
        <Typography variant="caption" sx={{ color: "primary.light", fontWeight: 700, fontSize: 12 }}>
          {nodes.length} deployed
        </Typography>
      </Box>

      {/* Zoom */}
      <Typography
        variant="caption"
        sx={{
          position: "absolute",
          bottom: 16,
          right: 20,
          color: "text.secondary",
          opacity: 0.4,
          zIndex: 10,
          userSelect: "none",
          pointerEvents: "none",
          fontSize: 11,
        }}
      >
        {Math.round(camera.zoom * 100)}%
      </Typography>

      {/* Empty state */}
      {nodes.length === 0 && (
        <Box
          sx={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          <RocketLaunchIcon sx={{ fontSize: 56, color: "rgba(167,139,250,0.12)", mb: 2 }} />
          <Typography variant="h6" sx={{ color: "text.secondary", fontWeight: 600, opacity: 0.4 }}>
            Right-click to deploy an agent
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", opacity: 0.3 }}>
            Each agent gets its own sandbox environment
          </Typography>
        </Box>
      )}

      {/* World-space transform layer */}
      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          transformOrigin: "0 0",
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
          pointerEvents: "none",
        }}
      >
        {nodes.map((node) => (
          <div key={node.id} data-agent-node style={{ pointerEvents: "auto" }}>
            <AgentNodeWithChat
              node={node}
              onMove={handleMoveNode}
              onDelete={handleDeleteNode}
              onMessagesChange={handleMessagesChange}
              onModelChange={handleModelChange}
              onPreviewUrlChange={handlePreviewUrlChange}
              isExpanded={expandedNodeId === node.id}
              onExpand={() => setExpandedNodeId(node.id)}
              onCollapse={() => setExpandedNodeId(null)}
            />
          </div>
        ))}
      </Box>

      {/* Context menu */}
      <Menu
        open={!!menuPos}
        onClose={() => setMenuPos(null)}
        anchorReference="anchorPosition"
        anchorPosition={menuPos ? { top: menuPos.y, left: menuPos.x } : undefined}
        slotProps={{
          paper: {
            sx: {
              bgcolor: "rgba(26,26,46,0.95)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(167,139,250,0.2)",
              borderRadius: 2,
              minWidth: 200,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            },
          },
        }}
      >
        <MenuItem
          onClick={handleDeploy}
          sx={{
            py: 1.2,
            "&:hover": { bgcolor: "rgba(167,139,250,0.1)" },
          }}
        >
          <ListItemIcon>
            <RocketLaunchIcon sx={{ color: "#a78bfa" }} />
          </ListItemIcon>
          <ListItemText
            primary="Deploy Agent"
            secondary="Spawns with sandbox"
            slotProps={{
              primary: { sx: { fontWeight: 700, color: "#e2e0ff", fontSize: 14 } },
              secondary: { sx: { color: "#a5a3c9", fontSize: 11 } },
            }}
          />
        </MenuItem>
      </Menu>
    </Box>
  );
}
