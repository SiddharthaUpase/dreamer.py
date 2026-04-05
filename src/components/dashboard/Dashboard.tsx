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
import InputBase from "@mui/material/InputBase";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import AddIcon from "@mui/icons-material/Add";
import LogoutIcon from "@mui/icons-material/Logout";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import SearchIcon from "@mui/icons-material/Search";
import GridViewRoundedIcon from "@mui/icons-material/GridViewRounded";
import SortRoundedIcon from "@mui/icons-material/SortRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import ProjectCard from "./ProjectCard";
import NewProjectDialog from "./NewProjectDialog";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "https://dreamer-py.onrender.com";

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
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const SIDEBAR_WIDTH = 260;

export default function Dashboard() {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.email) setUserEmail(user.email);

      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${BACKEND_URL}/api/projects`, { headers });
        const data = await res.json();
        setProjects(data.projects || []);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
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
    } catch {
      /* ignore */
    }
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
  const displayName = userEmail ? userEmail.split("@")[0] : "Loading...";
  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Box
      sx={{ minHeight: "100vh", display: "flex", bgcolor: "background.default" }}
    >
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
        <Box
          sx={{
            height: 64,
            px: 2.5,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
          }}
        >
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: 2,
              background:
                "linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #A855F7 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 8px rgba(99, 102, 241, 0.3)",
            }}
          >
            <Typography
              sx={{ color: "#fff", fontWeight: 800, fontSize: "0.85rem" }}
            >
              D
            </Typography>
          </Box>
          <Box>
            <Typography
              variant="subtitle1"
              fontWeight={700}
              sx={{
                color: "text.primary",
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
              }}
            >
              Dreamer
            </Typography>
            <Typography
              sx={{ color: "text.secondary", fontSize: "0.65rem", lineHeight: 1 }}
            >
              Workspace
            </Typography>
          </Box>
        </Box>

        {/* Nav items */}
        <Box sx={{ flex: 1, py: 1, px: 1.5 }}>
          <Typography
            variant="overline"
            sx={{
              px: 1.5,
              mb: 0.5,
              display: "block",
              color: "text.secondary",
              fontSize: "0.65rem",
              fontWeight: 600,
              letterSpacing: "0.08em",
            }}
          >
            Menu
          </Typography>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              px: 1.5,
              py: 1,
              borderRadius: 2,
              bgcolor: "primary.main",
              color: "#fff",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <FolderOpenIcon sx={{ fontSize: 18 }} />
            <Typography
              variant="body2"
              fontWeight={600}
              sx={{ fontSize: "0.84rem" }}
            >
              Projects
            </Typography>
            <Chip
              label={projects.length}
              size="small"
              sx={{
                ml: "auto",
                height: 20,
                fontSize: "0.7rem",
                fontWeight: 700,
                bgcolor: "rgba(255,255,255,0.2)",
                color: "#fff",
                "& .MuiChip-label": { px: 1 },
              }}
            />
          </Box>
        </Box>

        {/* User section */}
        <Box
          sx={{
            px: 1.5,
            py: 2,
            borderTop: "1px solid",
            borderColor: "divider",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              px: 1,
              py: 1,
              borderRadius: 2,
              transition: "all 0.15s ease",
              "&:hover": {
                bgcolor: "action.hover",
              },
            }}
          >
            <Avatar
              sx={{
                width: 34,
                height: 34,
                bgcolor: "primary.main",
                fontSize: "0.85rem",
                fontWeight: 700,
              }}
            >
              {initials}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                variant="body2"
                fontWeight={600}
                noWrap
                sx={{
                  color: "text.primary",
                  fontSize: "0.82rem",
                  lineHeight: 1.3,
                }}
              >
                {displayName}
              </Typography>
              <Typography
                variant="caption"
                noWrap
                sx={{
                  color: "text.secondary",
                  fontSize: "0.7rem",
                  display: "block",
                }}
              >
                {userEmail || "Loading..."}
              </Typography>
            </Box>
            <Tooltip title="Sign out" arrow>
              <IconButton
                size="small"
                onClick={() => setLogoutDialogOpen(true)}
                sx={{
                  color: "text.secondary",
                  "&:hover": { color: "error.main", bgcolor: "error.light" },
                  transition: "all 0.15s ease",
                }}
              >
                <LogoutIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Box>

      {/* Main content */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
        {/* Top bar */}
        <Box
          sx={{
            height: 64,
            px: 4,
            borderBottom: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 3,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Typography
              variant="h6"
              fontWeight={700}
              sx={{ color: "text.primary", fontSize: "1.1rem" }}
            >
              My Projects
            </Typography>
            {!loading && (
              <Chip
                label={`${filteredProjects.length} project${filteredProjects.length !== 1 ? "s" : ""}`}
                size="small"
                variant="outlined"
                sx={{
                  height: 24,
                  fontSize: "0.72rem",
                  fontWeight: 500,
                  borderColor: "divider",
                  color: "text.secondary",
                }}
              />
            )}
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            {/* Search */}
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 1.5,
                py: 0.6,
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "background.default",
                transition: "all 0.15s ease",
                "&:focus-within": {
                  borderColor: "primary.main",
                  boxShadow: "0 0 0 3px rgba(99, 102, 241, 0.1)",
                },
                minWidth: 220,
              }}
            >
              <SearchIcon sx={{ fontSize: 18, color: "text.secondary" }} />
              <InputBase
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                sx={{
                  flex: 1,
                  fontSize: "0.84rem",
                  "& input::placeholder": { opacity: 0.6 },
                }}
              />
            </Box>

            <Tooltip title="Sort" arrow>
              <IconButton
                size="small"
                sx={{
                  color: "text.secondary",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  width: 34,
                  height: 34,
                }}
              >
                <SortRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>

            <Tooltip title="Grid view" arrow>
              <IconButton
                size="small"
                sx={{
                  color: "text.secondary",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  width: 34,
                  height: 34,
                }}
              >
                <GridViewRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>

            <Button
              variant="contained"
              disableElevation
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setDialogOpen(true)}
              sx={{
                borderRadius: 2,
                px: 2.5,
                py: 0.8,
                textTransform: "none",
                fontWeight: 600,
                fontSize: "0.84rem",
                boxShadow: "0 1px 3px rgba(99, 102, 241, 0.3)",
                "&:hover": {
                  boxShadow: "0 4px 12px rgba(99, 102, 241, 0.4)",
                },
              }}
            >
              New Project
            </Button>
          </Box>
        </Box>

        {/* Project grid */}
        <Box sx={{ flex: 1, px: 4, py: 3.5 }}>
          {loading ? (
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
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                Loading projects...
              </Typography>
            </Box>
          ) : filteredProjects.length === 0 && searchQuery ? (
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
              <SearchIcon sx={{ fontSize: 48, mb: 2, opacity: 0.3 }} />
              <Typography variant="body1" fontWeight={500} sx={{ mb: 0.5 }}>
                No results found
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                No projects match &ldquo;{searchQuery}&rdquo;
              </Typography>
            </Box>
          ) : projects.length === 0 ? (
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
              <Box
                sx={{
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  bgcolor: "action.hover",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  mb: 2.5,
                }}
              >
                <FolderOpenIcon sx={{ fontSize: 36, opacity: 0.4 }} />
              </Box>
              <Typography
                variant="h6"
                fontWeight={600}
                sx={{ mb: 0.5, color: "text.primary" }}
              >
                No projects yet
              </Typography>
              <Typography
                variant="body2"
                sx={{ mb: 3, opacity: 0.7, maxWidth: 300, textAlign: "center" }}
              >
                Get started by creating your first project. Choose a template or
                start from scratch.
              </Typography>
              <Button
                variant="contained"
                disableElevation
                startIcon={<AddIcon />}
                onClick={() => setDialogOpen(true)}
                sx={{
                  borderRadius: 2,
                  textTransform: "none",
                  fontWeight: 600,
                  px: 3,
                  py: 1,
                  boxShadow: "0 1px 3px rgba(99, 102, 241, 0.3)",
                }}
              >
                Create Your First Project
              </Button>
            </Box>
          ) : (
            <Grid container spacing={2.5} sx={{ maxWidth: 1400 }}>
              {filteredProjects.map((project) => (
                <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={project.id}>
                  <ProjectCard
                    project={{
                      ...project,
                      lastEdited: timeAgo(project.created_at),
                      shared: project.shared,
                    }}
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

      {/* New Project Dialog */}
      <NewProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={handleCreate}
      />

      {/* Logout Confirmation Dialog */}
      <Dialog
        open={logoutDialogOpen}
        onClose={() => setLogoutDialogOpen(false)}
        maxWidth="xs"
        PaperProps={{
          sx: {
            borderRadius: 3,
            border: "1px solid",
            borderColor: "divider",
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.15)",
            minWidth: 360,
          },
        }}
      >
        <DialogTitle
          sx={{
            pb: 0,
            pt: 3,
            px: 3,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              bgcolor: "error.light",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              mb: 2,
            }}
          >
            <WarningAmberRoundedIcon
              sx={{ fontSize: 24, color: "error.main" }}
            />
          </Box>
          <Typography variant="h6" fontWeight={700} sx={{ fontSize: "1.05rem" }}>
            Sign out of Dreamer?
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ textAlign: "center", pt: 1, pb: 0.5, px: 3 }}>
          <Typography
            variant="body2"
            sx={{ color: "text.secondary", lineHeight: 1.6 }}
          >
            You will be signed out of your account and redirected to the login
            page. Any unsaved work may be lost.
          </Typography>
        </DialogContent>
        <DialogActions
          sx={{
            px: 3,
            pb: 3,
            pt: 2,
            gap: 1.5,
            flexDirection: "column",
          }}
        >
          <Button
            fullWidth
            variant="contained"
            disableElevation
            onClick={() => {
              setLogoutDialogOpen(false);
              handleLogout();
            }}
            sx={{
              borderRadius: 2,
              py: 1.1,
              fontWeight: 600,
              bgcolor: "error.main",
              "&:hover": { bgcolor: "error.dark" },
            }}
          >
            Sign Out
          </Button>
          <Button
            fullWidth
            variant="outlined"
            onClick={() => setLogoutDialogOpen(false)}
            sx={{
              borderRadius: 2,
              py: 1.1,
              fontWeight: 600,
              color: "text.primary",
              borderColor: "divider",
              "&:hover": { bgcolor: "action.hover", borderColor: "divider" },
            }}
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
