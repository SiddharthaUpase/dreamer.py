"use client";

import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import theme from "@/theme";
import Canvas from "@/components/Canvas";

export default function CanvasPage() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Canvas />
    </ThemeProvider>
  );
}
