"use client";

import { createTheme } from "@mui/material/styles";

const lightTheme = createTheme({
  palette: {
    mode: "light",
    background: {
      default: "#F4F4F5",
      paper: "#FFFFFF",
    },
    primary: {
      main: "#6366F1",
      dark: "#4F46E5",
      light: "#818CF8",
    },
    secondary: {
      main: "#EC4899",
    },
    text: {
      primary: "#18181B",
      secondary: "#71717A",
    },
    divider: "#E4E4E7",
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 500,
        },
      },
    },
  },
});

export default lightTheme;
