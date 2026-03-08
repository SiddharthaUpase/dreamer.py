"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import AddIcon from "@mui/icons-material/Add";
import ProjectCard from "./ProjectCard";
import NewProjectDialog from "./NewProjectDialog";

interface Project {
  id: string;
  name: string;
  createdAt: string;
  previewUrl: string | null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function Dashboard() {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetch("http://localhost:3001/api/projects")
      .then((r) => r.json())
      .then((data) => setProjects(data.projects || []))
      .catch(() => {});
  }, []);

  async function handleCreate(name: string, template: string) {
    const id = `proj_${Date.now()}`;
    await fetch("http://localhost:3001/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, template }),
    });
    router.push(`/projects/${id}`);
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "background.default",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Navbar */}
      <Box
        sx={{
          height: 56,
          px: 4,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography
          variant="subtitle1"
          fontWeight={600}
          sx={{ color: "text.primary", letterSpacing: "-0.01em" }}
        >
          agent-vas
        </Typography>
        <Button
          variant="contained"
          disableElevation
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setDialogOpen(true)}
          sx={{ borderRadius: 2, px: 2 }}
        >
          New Project
        </Button>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, px: 5, py: 5, maxWidth: 1200, mx: "auto", width: "100%" }}>
        <Typography
          variant="h6"
          fontWeight={600}
          sx={{ mb: 3, color: "text.primary" }}
        >
          My Projects
        </Typography>

        <Grid container spacing={2.5}>
          {/* New project card */}
          <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
            <Box
              onClick={() => setDialogOpen(true)}
              sx={{
                height: 200,
                border: "1.5px dashed",
                borderColor: "divider",
                borderRadius: 3,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                cursor: "pointer",
                color: "text.secondary",
                transition: "all 0.15s",
                "&:hover": {
                  borderColor: "primary.main",
                  color: "primary.main",
                  bgcolor: "rgba(99,102,241,0.03)",
                },
              }}
            >
              <AddIcon sx={{ fontSize: 28 }} />
              <Typography variant="body2" fontWeight={500}>
                New Project
              </Typography>
            </Box>
          </Grid>

          {/* Project cards */}
          {projects.map((project) => (
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={project.id}>
              <ProjectCard
                project={{ ...project, lastEdited: timeAgo(project.createdAt) }}
                onClick={() => router.push(`/projects/${project.id}`)}
              />
            </Grid>
          ))}
        </Grid>
      </Box>

      <NewProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={handleCreate}
      />
    </Box>
  );
}
