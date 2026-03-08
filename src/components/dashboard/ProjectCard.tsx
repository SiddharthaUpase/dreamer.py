"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import IconButton from "@mui/material/IconButton";

interface Project {
  id: string;
  name: string;
  lastEdited: string;
  previewUrl: string | null;
}

interface Props {
  project: Project;
  onClick: () => void;
}

export default function ProjectCard({ project, onClick }: Props) {
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
        transition: "all 0.15s",
        "&:hover": {
          borderColor: "primary.light",
          boxShadow: "0 4px 16px 0 rgb(0 0 0 / 0.08)",
          transform: "translateY(-1px)",
        },
      }}
    >
      {/* Thumbnail */}
      <Box
        sx={{
          height: 140,
          bgcolor: "#F4F4F5",
          borderBottom: "1px solid",
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {project.previewUrl ? (
          <iframe
            src={project.previewUrl}
            style={{ width: "100%", height: "100%", border: "none", pointerEvents: "none" }}
            title={project.name}
          />
        ) : (
          <Box
            sx={{
              width: "100%",
              height: "100%",
              background: "linear-gradient(135deg, #F0F0FF 0%, #E8E8F8 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Placeholder skeleton lines */}
            <Box sx={{ width: "60%", display: "flex", flexDirection: "column", gap: 1 }}>
              <Box sx={{ height: 8, bgcolor: "rgba(99,102,241,0.15)", borderRadius: 1 }} />
              <Box sx={{ height: 6, bgcolor: "rgba(99,102,241,0.1)", borderRadius: 1, width: "80%" }} />
              <Box sx={{ height: 6, bgcolor: "rgba(99,102,241,0.08)", borderRadius: 1, width: "60%" }} />
            </Box>
          </Box>
        )}
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
        <Box>
          <Typography
            variant="body2"
            fontWeight={600}
            sx={{ color: "text.primary", lineHeight: 1.3 }}
          >
            {project.name}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {project.lastEdited}
          </Typography>
        </Box>
        <IconButton
          size="small"
          onClick={(e) => e.stopPropagation()}
          sx={{ color: "text.secondary", "&:hover": { color: "text.primary" } }}
        >
          <MoreHorizIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}
