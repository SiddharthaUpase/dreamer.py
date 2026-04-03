"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ShareIcon from "@mui/icons-material/Share";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
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
  onShare?: (id: string, email: string) => Promise<string>;
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
        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        "&:hover": {
          borderColor: "primary.light",
          boxShadow:
            "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 10px 15px -3px rgba(0, 0, 0, 0.08)",
          transform: "translateY(-2px)",
          "& .card-menu-btn": {
            opacity: 1,
          },
        },
      }}
    >
      {/* Thumbnail */}
      <Box
        sx={{
          height: 130,
          background: getGradient(project.name),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative pattern */}
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            opacity: 0.1,
            background:
              "radial-gradient(circle at 30% 50%, rgba(255,255,255,0.4) 0%, transparent 60%), radial-gradient(circle at 70% 80%, rgba(255,255,255,0.3) 0%, transparent 50%)",
          }}
        />
        <Typography
          sx={{
            color: "rgba(255,255,255,0.9)",
            fontWeight: 800,
            fontSize: "2.2rem",
            textTransform: "uppercase",
            userSelect: "none",
            zIndex: 1,
            textShadow: "0 2px 4px rgba(0,0,0,0.1)",
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
            sx={{ color: "text.primary", lineHeight: 1.4, fontSize: "0.85rem" }}
          >
            {project.name}
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", fontSize: "0.7rem" }}
          >
            Edited {project.lastEdited}
          </Typography>
          {project.shared && (
            <Chip label="shared" size="small" sx={{ height: 18, fontSize: "0.6rem", bgcolor: "rgba(99,102,241,0.15)", color: "primary.main" }} />
          )}
        </Box>
        <IconButton
          className="card-menu-btn"
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            setAnchorEl(e.currentTarget);
          }}
          sx={{
            color: "text.secondary",
            ml: 0.5,
            opacity: { xs: 1, md: 0 },
            transition: "opacity 0.15s ease",
            "&:hover": { color: "text.primary", bgcolor: "action.hover" },
          }}
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
          slotProps={{
            paper: {
              sx: {
                minWidth: 160,
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
                boxShadow:
                  "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 10px 15px -3px rgba(0, 0, 0, 0.08)",
              },
            },
          }}
        >
          <MenuItem
            onClick={(e) => {
              e.stopPropagation();
              setAnchorEl(null);
              onClick();
            }}
          >
            <ListItemIcon>
              <OpenInNewIcon fontSize="small" sx={{ color: "text.secondary" }} />
            </ListItemIcon>
            <ListItemText>Open</ListItemText>
          </MenuItem>
          {onShare && (
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
          )}
          <Divider sx={{ my: 0.5 }} />
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
            <ListItemIcon>
              <DeleteOutlineIcon
                fontSize="small"
                sx={{ color: "error.main" }}
              />
            </ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </MenuItem>
        </Menu>
      </Box>
    </Box>
  );
}
