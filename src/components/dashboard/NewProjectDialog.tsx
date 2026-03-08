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
  const [template, setTemplate] = useState("blank");

  function handleCreate() {
    if (!name.trim()) return;
    onCreate(name.trim(), template);
    setName("");
    setTemplate("blank");
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
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          sx={{
            mt: 0.5,
            mb: 2.5,
            "& .MuiOutlinedInput-root": {
              borderRadius: 2,
            },
          }}
        />

        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 500 }}>
          Start from
        </Typography>
        <Box sx={{ display: "flex", gap: 1.5, mt: 0.75 }}>
          {TEMPLATES.map((t) => (
            <Box
              key={t.id}
              onClick={() => setTemplate(t.id)}
              sx={{
                flex: 1,
                border: "1.5px solid",
                borderColor: template === t.id ? "primary.main" : "divider",
                borderRadius: 2,
                px: 2,
                py: 1.5,
                cursor: "pointer",
                bgcolor: template === t.id ? "rgba(99,102,241,0.04)" : "transparent",
                transition: "all 0.12s",
                "&:hover": {
                  borderColor: "primary.light",
                },
              }}
            >
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{ color: template === t.id ? "primary.main" : "text.primary" }}
              >
                {t.label}
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {t.description}
              </Typography>
            </Box>
          ))}
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
          Create Project →
        </Button>
      </DialogActions>
    </Dialog>
  );
}
