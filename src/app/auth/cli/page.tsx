"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import TerminalIcon from "@mui/icons-material/Terminal";
import lightTheme from "@/theme-light";
import { createClient } from "@/lib/supabase/client";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://dreamer-py.onrender.com";

function CliAuthHandler() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const [status, setStatus] = useState<"checking" | "login" | "confirm" | "approving" | "done" | "error">("checking");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");

  const supabase = createClient();

  useEffect(() => {
    if (!code) {
      setStatus("error");
      setError("No authorization code provided.");
      return;
    }

    // Check if user is logged in
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setEmail(data.user.email || "");
        setStatus("confirm");
      } else {
        setStatus("login");
      }
    });
  }, [code]);

  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/cli?code=${code}` },
    });
    if (error) {
      setError(error.message);
      setStatus("error");
    }
  };

  const handleApprove = async () => {
    setStatus("approving");

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError("Session expired. Please log in again.");
      setStatus("error");
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/cli/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to approve");
      }

      setStatus("done");
    } catch (err: any) {
      setError(err.message);
      setStatus("error");
    }
  };

  return (
    <ThemeProvider theme={lightTheme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "background.default",
          p: 2,
        }}
      >
        <Paper
          sx={{
            width: "100%",
            maxWidth: 420,
            p: 4,
            borderRadius: 3,
            boxShadow: "0 4px 24px rgb(0 0 0 / 0.08)",
            textAlign: "center",
          }}
        >
          <TerminalIcon sx={{ fontSize: 48, color: "primary.main", mb: 2 }} />
          <Typography variant="h5" fontWeight={700} mb={1}>
            Authorize CLI
          </Typography>

          {status === "checking" && (
            <Box sx={{ py: 4 }}>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary" mt={2}>
                Checking authentication...
              </Typography>
            </Box>
          )}

          {status === "login" && (
            <>
              <Typography variant="body2" color="text.secondary" mb={1}>
                Code: <strong>{code}</strong>
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={3}>
                Sign in to authorize the CLI on your account.
              </Typography>
              <Button
                fullWidth
                variant="contained"
                onClick={handleLogin}
                sx={{ py: 1.2 }}
              >
                Sign in with Google
              </Button>
            </>
          )}

          {status === "confirm" && (
            <>
              <Typography variant="body2" color="text.secondary" mb={1}>
                Code: <strong>{code}</strong>
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={3}>
                The Agent VAS CLI is requesting access to your account
                {email ? ` (${email})` : ""}.
              </Typography>
              <Button
                fullWidth
                variant="contained"
                color="primary"
                onClick={handleApprove}
                sx={{ py: 1.2, mb: 1.5 }}
              >
                Allow Access
              </Button>
              <Typography variant="caption" color="text.secondary">
                This will generate an API key for CLI access.
              </Typography>
            </>
          )}

          {status === "approving" && (
            <Box sx={{ py: 4 }}>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary" mt={2}>
                Authorizing...
              </Typography>
            </Box>
          )}

          {status === "done" && (
            <Box sx={{ py: 2 }}>
              <CheckCircleOutlineIcon sx={{ fontSize: 48, color: "success.main", mb: 1 }} />
              <Typography variant="h6" fontWeight={600} color="success.main" mb={1}>
                CLI Authorized
              </Typography>
              <Typography variant="body2" color="text.secondary">
                You can close this window and return to your terminal.
              </Typography>
            </Box>
          )}

          {status === "error" && (
            <Box sx={{ py: 2 }}>
              <ErrorOutlineIcon sx={{ fontSize: 48, color: "error.main", mb: 1 }} />
              <Typography variant="body2" color="error.main" mb={2}>
                {error}
              </Typography>
              <Button
                variant="outlined"
                onClick={() => window.location.reload()}
              >
                Try Again
              </Button>
            </Box>
          )}
        </Paper>
      </Box>
    </ThemeProvider>
  );
}

export default function CliAuthPage() {
  return (
    <Suspense
      fallback={
        <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <CircularProgress />
        </Box>
      }
    >
      <CliAuthHandler />
    </Suspense>
  );
}
