"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import lightTheme from "@/theme-light";
import Dashboard from "@/components/dashboard/Dashboard";

export default function Home() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const hasKey = typeof window !== "undefined" && !!localStorage.getItem("openrouter_key");
    if (!hasKey) {
      router.replace("/setup");
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) {
    return (
      <ThemeProvider theme={lightTheme}>
        <CssBaseline />
        <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <CircularProgress size={28} />
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={lightTheme}>
      <CssBaseline />
      <Dashboard />
    </ThemeProvider>
  );
}
