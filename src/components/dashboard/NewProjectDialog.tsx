"use client";

import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import CloseIcon from "@mui/icons-material/Close";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import TerminalRoundedIcon from "@mui/icons-material/TerminalRounded";

const TEMPLATES = [
  {
    id: "nextjs",
    label: "Web App",
    description: "Full-stack Next.js starter with React, Tailwind CSS, and a database — perfect for most projects",
    icon: LanguageRoundedIcon,
    recommended: true,
  },
  {
    id: "blank",
    label: "Empty Project",
    description: "A clean sandbox with Node.js, Python, and Git — set up everything yourself",
    icon: TerminalRoundedIcon,
    recommended: false,
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, template: string) => void;
}

export default function NewProjectDialog({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("nextjs");
  const [error, setError] = useState("");

  function handleCreate() {
    const sanitized = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!sanitized) {
      setError("Name must contain letters or numbers");
      return;
    }
    setError("");
    onCreate(sanitized, template);
    setName("");
    setTemplate("nextjs");
    onClose();
  }

  function handleClose() {
    setName("");
    setTemplate("nextjs");
    setError("");
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          border: "1px solid",
          borderColor: "divider",
          boxShadow: "0 8px 32px 0 rgb(0 0 0 / 0.1)",
        },
      }}
    >
      <DialogTitle
        sx={{
          pb: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontWeight: 600,
          fontSize: "1rem",
        }}
      >
        New Project
        <IconButton size="small" onClick={handleClose} sx={{ color: "text.secondary" }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 1, pb: 2 }}>
        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 500 }}>
          Project name
        </Typography>
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder="My Portfolio"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={!!error}
          helperText={error || "Lowercase letters, numbers, and hyphens only"}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          sx={{
            mt: 0.5,
            mb: 2.5,
            "& .MuiOutlinedInput-root": {
              borderRadius: 2,
            },
          }}
        />

        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 500, display: "block", mb: 1 }}>
          Project type
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {TEMPLATES.map((t) => {
            const Icon = t.icon;
            const selected = template === t.id;
            return (
              <Box
                key={t.id}
                onClick={() => setTemplate(t.id)}
                sx={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 1.5,
                  p: 1.5,
                  borderRadius: 2,
                  border: "2px solid",
                  borderColor: selected ? "primary.main" : "divider",
                  bgcolor: selected ? "rgba(99, 102, 241, 0.04)" : "transparent",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  "&:hover": {
                    borderColor: selected ? "primary.main" : "text.secondary",
                    bgcolor: selected ? "rgba(99, 102, 241, 0.04)" : "action.hover",
                  },
                }}
              >
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: 1.5,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: selected ? "primary.main" : "action.hover",
                    color: selected ? "#fff" : "text.secondary",
                    flexShrink: 0,
                    mt: 0.25,
                  }}
                >
                  <Icon sx={{ fontSize: 20 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      sx={{ color: "text.primary", fontSize: "0.85rem" }}
                    >
                      {t.label}
                    </Typography>
                    {t.recommended && (
                      <Chip
                        label="Recommended"
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: "0.6rem",
                          fontWeight: 700,
                          bgcolor: "primary.main",
                          color: "#fff",
                          "& .MuiChip-label": { px: 0.75 },
                        }}
                      />
                    )}
                  </Box>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      lineHeight: 1.4,
                      display: "block",
                      mt: 0.25,
                    }}
                  >
                    {t.description}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button
          fullWidth
          variant="contained"
          disableElevation
          disabled={!name.trim()}
          onClick={handleCreate}
          sx={{ borderRadius: 2, py: 1, fontWeight: 600 }}
        >
          Create Project
        </Button>
      </DialogActions>
    </Dialog>
  );
}
