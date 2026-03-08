"use client";

import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "dark",
    background: {
      default: "#0f0f17",
      paper: "#1a1a2e",
    },
    primary: {
      main: "#a78bfa",
      dark: "#7c3aed",
      light: "#c4b5fd",
    },
    secondary: {
      main: "#ec4899",
    },
    text: {
      primary: "#e2e0ff",
      secondary: "#a5a3c9",
    },
    divider: "rgba(167, 139, 250, 0.12)",
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
  },
});

export default theme;
