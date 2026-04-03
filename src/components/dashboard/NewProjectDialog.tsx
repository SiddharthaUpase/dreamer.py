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
import CloseIcon from "@mui/icons-material/Close";

const TEMPLATES = [
  { id: "blank", label: "Blank", description: "Empty sandbox" },
  { id: "nextjs", label: "Next.js", description: "App router starter" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, template: string) => void;
}

export default function NewProjectDialog({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [template] = useState("nextjs");
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
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
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
        <IconButton size="small" onClick={onClose} sx={{ color: "text.secondary" }}>
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
          Create Project →
        </Button>
      </DialogActions>
    </Dialog>
  );
}
