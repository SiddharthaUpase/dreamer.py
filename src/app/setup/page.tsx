"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import theme from "@/theme";
import { createClient } from "@/lib/supabase/client";

export default function SetupPage() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push("/login");
      }
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });

      if (!res.ok) {
        throw new Error("Invalid API key. Please check and try again.");
      }

      localStorage.setItem("openrouter_key", key);
      router.push("/");
    } catch (err: any) {
      setError(err.message || "Validation failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemeProvider theme={theme}>
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
          }}
        >
          <Typography variant="h5" fontWeight={700} textAlign="center" mb={0.5}>
            OpenRouter API Key
          </Typography>
          <Typography variant="body2" color="text.secondary" textAlign="center" mb={3}>
            Dreamer uses OpenRouter to connect to AI models. You need an API key to continue.
          </Typography>

          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              1. Go to{" "}
              <Box
                component="a"
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                sx={{ color: "primary.main", fontWeight: 600, textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
              >
                openrouter.ai/keys
              </Box>
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              2. Create an API key
            </Typography>
            <Typography variant="body2" color="text.secondary">
              3. Paste it below
            </Typography>
          </Box>

          {error && (
            <Typography variant="body2" color="error" sx={{ mb: 2 }}>
              {error}
            </Typography>
          )}

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="API Key"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              size="small"
              sx={{ mb: 2.5 }}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              disabled={loading}
              sx={{ py: 1.2 }}
            >
              {loading ? (
                <CircularProgress size={22} color="inherit" />
              ) : (
                "Continue →"
              )}
            </Button>
          </form>
        </Paper>
      </Box>
    </ThemeProvider>
  );
}
