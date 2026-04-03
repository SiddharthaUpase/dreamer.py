"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { createClient } from "@/lib/supabase/client";

const renaissanceTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#8B6914", light: "#B8941F", dark: "#6B4F0E" },
    background: { default: "#F5F0E8", paper: "#FFFDF7" },
    text: { primary: "#2C2416", secondary: "#7A6B55" },
    divider: "#D4C9B5",
  },
  typography: {
    fontFamily: '"Cormorant Garamond", "Georgia", serif',
  },
  shape: { borderRadius: 8 },
});

export default function SetupPage() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push("/login");
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
      if (!res.ok) throw new Error("Invalid API key. Please check and try again.");
      localStorage.setItem("openrouter_key", key);
      router.push("/");
    } catch (err: any) {
      setError(err.message || "Validation failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemeProvider theme={renaissanceTheme}>
      <CssBaseline />
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&display=swap" rel="stylesheet" />

      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "#F5F0E8",
          px: 3,
        }}
      >
        <Box sx={{ width: "100%", maxWidth: 440 }}>
          {/* Header */}
          <Typography
            sx={{
              fontFamily: '"Cormorant Garamond", serif',
              fontSize: "2rem",
              fontWeight: 700,
              color: "#2C2416",
              letterSpacing: "-0.02em",
              mb: 0.5,
            }}
          >
            One last thing
          </Typography>
          <Typography
            sx={{
              fontFamily: '"Cormorant Garamond", serif',
              fontSize: "1rem",
              color: "#7A6B55",
              fontStyle: "italic",
              mb: 4,
            }}
          >
            Connect your AI models to begin creating
          </Typography>

          {/* Card */}
          <Box
            sx={{
              bgcolor: "#FFFDF7",
              border: "1px solid #D4C9B5",
              borderRadius: 3,
              p: 4,
            }}
          >
            <Typography
              sx={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: "1.3rem",
                fontWeight: 600,
                color: "#2C2416",
                mb: 2,
              }}
            >
              OpenRouter API Key
            </Typography>

            <Typography
              sx={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: "0.92rem",
                color: "#7A6B55",
                lineHeight: 1.7,
                mb: 3,
              }}
            >
              Dreamer uses OpenRouter to connect to AI models. You&apos;ll need an API key to continue.
            </Typography>

            {/* Steps */}
            <Box sx={{ mb: 3, pl: 1 }}>
              {[
                <>Visit <Box component="a" href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" sx={{ color: "#8B6914", fontWeight: 600, textDecoration: "none", "&:hover": { textDecoration: "underline" } }}>openrouter.ai/keys</Box></>,
                "Create a new API key",
                "Paste it below",
              ].map((step, i) => (
                <Box key={i} sx={{ display: "flex", gap: 1.5, mb: 1.25, alignItems: "flex-start" }}>
                  <Box
                    sx={{
                      width: 22, height: 22, borderRadius: "50%",
                      border: "1.5px solid #D4C9B5",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, mt: 0.15,
                    }}
                  >
                    <Typography sx={{ fontFamily: '"Cormorant Garamond", serif', fontSize: "0.75rem", fontWeight: 600, color: "#8B6914" }}>
                      {i + 1}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontFamily: '"Cormorant Garamond", serif', fontSize: "0.9rem", color: "#7A6B55" }}>
                    {step}
                  </Typography>
                </Box>
              ))}
            </Box>

            {error && (
              <Typography sx={{ color: "#C53030", fontSize: "0.85rem", fontFamily: '"Inter", sans-serif', mb: 2 }}>
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
                sx={{
                  mb: 2.5,
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 2,
                    bgcolor: "#FFFDF7",
                    fontFamily: '"Inter", sans-serif',
                    fontSize: "0.9rem",
                  },
                  "& .MuiInputLabel-root": {
                    fontFamily: '"Inter", sans-serif',
                    fontSize: "0.85rem",
                  },
                }}
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                disabled={loading || !key.trim()}
                sx={{
                  py: 1.3,
                  borderRadius: 2,
                  fontFamily: '"Cormorant Garamond", serif',
                  fontSize: "1rem",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "none",
                  bgcolor: "#2C2416",
                  "&:hover": { bgcolor: "#3D3220" },
                }}
              >
                {loading ? <CircularProgress size={22} color="inherit" /> : "Continue"}
              </Button>
            </form>
          </Box>

          {/* Footer */}
          <Typography
            sx={{
              fontFamily: '"Cormorant Garamond", serif',
              fontSize: "0.8rem",
              color: "#B5A898",
              textAlign: "center",
              mt: 3,
              fontStyle: "italic",
            }}
          >
            Your key is stored locally and never shared
          </Typography>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
