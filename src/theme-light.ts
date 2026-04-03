"use client";

import { createTheme } from "@mui/material/styles";

const lightTheme = createTheme({
  palette: {
    mode: "light",
    background: {
      default: "#F5F0E8",
      paper: "#FFFDF7",
    },
    primary: {
      main: "#8B6914",
      dark: "#6B4F0E",
      light: "#B8941F",
    },
    secondary: {
      main: "#A0522D",
    },
    error: {
      main: "#C53030",
      dark: "#9B2C2C",
      light: "#FED7D7",
    },
    text: {
      primary: "#2C2416",
      secondary: "#7A6B55",
    },
    divider: "#D4C9B5",
    action: {
      hover: "rgba(139, 105, 20, 0.06)",
    },
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily: '"Cormorant Garamond", "Georgia", serif',
    fontSize: 16,
    h6: { fontSize: "1.4rem", fontWeight: 700 },
    subtitle1: { fontSize: "1.1rem", fontWeight: 600 },
    body1: { fontSize: "1.05rem", fontWeight: 500 },
    body2: { fontSize: "0.95rem", fontWeight: 500 },
    caption: { fontSize: "0.85rem", fontWeight: 500 },
    button: { fontSize: "1rem", fontWeight: 600 },
    overline: { fontSize: "0.8rem", fontWeight: 600 },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          boxShadow:
            "0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        root: {
          "& .MuiBackdrop-root": {
            backgroundColor: "rgba(44, 36, 22, 0.4)",
            backdropFilter: "blur(4px)",
          },
        },
      },
    },
  },
});

export default lightTheme;
