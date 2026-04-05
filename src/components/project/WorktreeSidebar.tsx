"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import AddIcon from "@mui/icons-material/Add";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

export interface Worktree {
  id: string;
  name: string;
}

interface Props {
  worktrees: Worktree[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

const SIDEBAR_WIDTH = 48;

export default function WorktreeSidebar({ worktrees, activeId, onSelect, onCreate }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <Box
        sx={{
          width: 20,
          flexShrink: 0,
          borderRight: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 0.5,
        }}
      >
        <IconButton
          size="small"
          onClick={() => setCollapsed(false)}
          sx={{ width: 16, height: 16, color: "text.secondary" }}
        >
          <ChevronRightIcon sx={{ fontSize: 12 }} />
        </IconButton>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        borderRight: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        py: 0.75,
        gap: 0.5,
      }}
    >
      {/* Collapse button */}
      <IconButton
        size="small"
        onClick={() => setCollapsed(true)}
        sx={{ width: 18, height: 18, color: "text.secondary", mb: 0.25 }}
      >
        <ChevronLeftIcon sx={{ fontSize: 13 }} />
      </IconButton>

      {/* Worktree boxes */}
      {worktrees.map((wt) => {
        const isActive = wt.id === activeId;
        return (
          <Tooltip key={wt.id} title={wt.name} placement="right">
            <Box
              onClick={() => onSelect(wt.id)}
              sx={{
                width: 32,
                height: 32,
                borderRadius: 1.5,
                border: "2px solid",
                borderColor: isActive ? "primary.main" : "rgba(0,0,0,0.12)",
                bgcolor: isActive ? "rgba(139, 105, 20, 0.1)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all 0.15s",
                "&:hover": {
                  borderColor: isActive ? "primary.main" : "rgba(0,0,0,0.25)",
                  bgcolor: isActive ? "rgba(139, 105, 20, 0.1)" : "rgba(0,0,0,0.03)",
                },
              }}
            >
              <Typography
                sx={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: isActive ? "primary.main" : "text.secondary",
                  userSelect: "none",
                }}
              >
                {wt.name.charAt(0).toUpperCase()}
              </Typography>
            </Box>
          </Tooltip>
        );
      })}

      {/* Add worktree button */}
      <Tooltip title="New worktree" placement="right">
        <Box
          onClick={onCreate}
          sx={{
            width: 32,
            height: 32,
            borderRadius: 1.5,
            border: "2px dashed",
            borderColor: "rgba(0,0,0,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "all 0.15s",
            "&:hover": {
              borderColor: "primary.main",
              bgcolor: "rgba(139, 105, 20, 0.05)",
            },
          }}
        >
          <AddIcon sx={{ fontSize: 14, color: "text.secondary" }} />
        </Box>
      </Tooltip>
    </Box>
  );
}
