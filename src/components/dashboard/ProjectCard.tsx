"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ShareIcon from "@mui/icons-material/Share";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Chip from "@mui/material/Chip";

interface Project {
  id: string;
  name: string;
  lastEdited: string;
  shared?: boolean;
}

interface Props {
  project: Project;
  onClick: () => void;
  onDelete: (id: string) => void;
  onShare: (id: string, email: string) => Promise<string>;
}

const GRADIENTS = [
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
  "linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)",
  "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)",
];

function getGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

export default function ProjectCard({ project, onClick, onDelete, onShare }: Props) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  return (
    <Box
      onClick={onClick}
      sx={{
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 3,
        overflow: "hidden",
        cursor: "pointer",
        transition: "all 0.2s ease",
        "&:hover": {
          borderColor: "primary.main",
          boxShadow: "0 8px 24px 0 rgba(0,0,0,0.3)",
          transform: "translateY(-2px)",
        },
      }}
    >
      {/* Thumbnail */}
      <Box
        sx={{
          height: 120,
          background: getGradient(project.name),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <Typography
          sx={{
            color: "rgba(255,255,255,0.85)",
            fontWeight: 700,
            fontSize: "2rem",
            textTransform: "uppercase",
            userSelect: "none",
          }}
        >
          {project.name.charAt(0)}
        </Typography>
      </Box>

      {/* Footer */}
      <Box
        sx={{
          px: 2,
          py: 1.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="body2"
            fontWeight={600}
            noWrap
            sx={{ color: "text.primary", lineHeight: 1.4 }}
          >
            {project.name}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem" }}>
              {project.lastEdited}
            </Typography>
            {project.shared && (
              <Chip label="shared" size="small" sx={{ height: 18, fontSize: "0.6rem", bgcolor: "rgba(99,102,241,0.15)", color: "primary.main" }} />
            )}
          </Box>
        </Box>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            setAnchorEl(e.currentTarget);
          }}
          sx={{ color: "text.secondary", ml: 0.5, "&:hover": { color: "text.primary" } }}
        >
          <MoreHorizIcon fontSize="small" />
        </IconButton>
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={(e: any) => {
            e?.stopPropagation?.();
            setAnchorEl(null);
          }}
          onClick={(e) => e.stopPropagation()}
          slotProps={{ paper: { sx: { minWidth: 140, borderRadius: 2 } } }}
        >
          <MenuItem
            onClick={(e) => {
              e.stopPropagation();
              setAnchorEl(null);
              const email = prompt("Share with (email):");
              if (email) {
                onShare(project.id, email).then((err) => {
                  if (err) alert(err);
                  else alert("Shared successfully");
                });
              }
            }}
          >
            <ListItemIcon><ShareIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Share</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={(e) => {
              e.stopPropagation();
              setAnchorEl(null);
              if (confirm(`Delete "${project.name}"? This cannot be undone.`)) {
                onDelete(project.id);
              }
            }}
            sx={{ color: "error.main" }}
          >
            <ListItemIcon><DeleteOutlineIcon fontSize="small" sx={{ color: "error.main" }} /></ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </MenuItem>
        </Menu>
      </Box>
    </Box>
  );
}
