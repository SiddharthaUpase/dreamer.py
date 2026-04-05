"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import lightTheme from "@/theme-light";
import Dashboard from "@/components/dashboard/Dashboard";
import { createClient } from "@/lib/supabase/client";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "https://dreamer-py.onrender.com";

export default function Home() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function checkAccess() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      try {
        const res = await fetch(`${BACKEND_URL}/api/auth/access-status`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        const data = await res.json();
        if (!data.hasAccess) {
          router.replace("/setup");
          return;
        }
        setReady(true);
      } catch {
        // If backend is unreachable, redirect to setup as a safe fallback
        router.replace("/setup");
      }
    }

    checkAccess();
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
