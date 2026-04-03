"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Avatar from "@mui/material/Avatar";
import AddIcon from "@mui/icons-material/Add";
import LogoutIcon from "@mui/icons-material/Logout";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import ProjectCard from "./ProjectCard";
import NewProjectDialog from "./NewProjectDialog";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://dreamer-py.onrender.com";

interface Project {
  id: string;
  name: string;
  created_at: string;
  preview_url: string | null;
  shared?: boolean;
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const SIDEBAR_WIDTH = 240;

export default function Dashboard() {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) setUserEmail(user.email);

      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${BACKEND_URL}/api/projects`, { headers });
        const data = await res.json();
        setProjects(data.projects || []);
      } catch { /* ignore */ }
    }
    load();
  }, []);

  async function handleDelete(id: string) {
    try {
      const headers = await getAuthHeaders();
      await fetch(`${BACKEND_URL}/api/projects/${id}`, {
        method: "DELETE",
        headers,
      });
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch { /* ignore */ }
  }

  async function handleShare(id: string, email: string): Promise<string> {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BACKEND_URL}/api/projects/${id}/share`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) return data.error || "Share failed";
      if (data.status === "already_shared") return `${data.email} already has access`;
      return "";
    } catch (err: any) {
      return err.message;
    }
  }

  async function handleCreate(name: string, template: string) {
    const sanitized = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!sanitized) return;
    if (projects.some((p) => p.name === sanitized)) return;
    const id = `proj_${Date.now()}`;
    const headers = await getAuthHeaders();
    await fetch(`${BACKEND_URL}/api/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id, name: sanitized, template }),
    });
    router.push(`/projects/${id}`);
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const initials = userEmail ? userEmail.charAt(0).toUpperCase() : "?";

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", bgcolor: "background.default" }}>
      {/* Sidebar */}
      <Box
        sx={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          borderRight: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Logo */}
        <Box sx={{ height: 56, px: 2.5, display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: 1.5,
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Typography sx={{ color: "#fff", fontWeight: 800, fontSize: "0.75rem" }}>A</Typography>
          </Box>
          <Typography variant="subtitle1" fontWeight={700} sx={{ color: "text.primary", letterSpacing: "-0.02em" }}>
            Dreamer
          </Typography>
        </Box>

        {/* Nav items */}
        <Box sx={{ flex: 1, py: 1, px: 1.5 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              px: 1.5,
              py: 1,
              borderRadius: 2,
              bgcolor: "rgba(167, 139, 250, 0.1)",
              color: "primary.main",
              cursor: "pointer",
            }}
          >
            <FolderOpenIcon sx={{ fontSize: 18 }} />
            <Typography variant="body2" fontWeight={600} sx={{ fontSize: "0.84rem" }}>
              Projects
            </Typography>
          </Box>
        </Box>

        {/* User section */}
        <Box
          sx={{
            px: 1.5,
            py: 2,
            borderTop: "1px solid",
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            gap: 1.5,
          }}
        >
          <Avatar
            sx={{
              width: 32,
              height: 32,
              bgcolor: "primary.dark",
              fontSize: "0.8rem",
              fontWeight: 600,
            }}
          >
            {initials}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="caption"
              noWrap
              sx={{
                color: "text.secondary",
                fontSize: "0.75rem",
                display: "block",
              }}
            >
              {userEmail || "Loading..."}
            </Typography>
          </Box>
          <Tooltip title="Sign out">
            <IconButton
              size="small"
              onClick={handleLogout}
              sx={{ color: "text.secondary", "&:hover": { color: "error.main" } }}
            >
              <LogoutIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Main content */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
        {/* Top bar */}
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
          <Typography variant="h6" fontWeight={600} sx={{ color: "text.primary", fontSize: "1rem" }}>
            My Projects
          </Typography>
          <Button
            variant="contained"
            disableElevation
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setDialogOpen(true)}
            sx={{ borderRadius: 2, px: 2.5, textTransform: "none", fontWeight: 600 }}
          >
            New Project
          </Button>
        </Box>

        {/* Project grid */}
        <Box sx={{ flex: 1, px: 4, py: 3.5 }}>
          {projects.length === 0 ? (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                py: 12,
                color: "text.secondary",
              }}
            >
              <FolderOpenIcon sx={{ fontSize: 48, mb: 2, opacity: 0.4 }} />
              <Typography variant="body1" fontWeight={500} sx={{ mb: 1 }}>
                No projects yet
              </Typography>
              <Typography variant="body2" sx={{ mb: 3, opacity: 0.7 }}>
                Create your first project to get started
              </Typography>
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => setDialogOpen(true)}
                sx={{ borderRadius: 2, textTransform: "none" }}
              >
                New Project
              </Button>
            </Box>
          ) : (
            <Grid container spacing={2.5} sx={{ maxWidth: 1200 }}>
              {projects.map((project) => (
                <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={project.id}>
                  <ProjectCard
                    project={{ ...project, lastEdited: timeAgo(project.created_at), shared: project.shared }}
                    onClick={() => router.push(`/projects/${project.id}`)}
                    onDelete={handleDelete}
                    onShare={handleShare}
                  />
                </Grid>
              ))}
            </Grid>
          )}
        </Box>
      </Box>

      <NewProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={handleCreate}
      />
    </Box>
  );
}
