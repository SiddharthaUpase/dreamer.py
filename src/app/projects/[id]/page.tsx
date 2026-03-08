"use client";

import { use } from "react";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import lightTheme from "@/theme-light";
import ProjectIDE from "@/components/project/ProjectIDE";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <ThemeProvider theme={lightTheme}>
      <CssBaseline />
      <ProjectIDE projectId={id} />
    </ThemeProvider>
  );
}
