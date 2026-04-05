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

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "https://dreamer-py.onrender.com";

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
  const [code, setCode] = useState("");
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
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
        return;
      }

      const res = await fetch(`${BACKEND_URL}/api/auth/redeem-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Invalid starter code. Please check and try again.");
      }

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
            Enter your starter code to begin creating
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
              Starter Code
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
              Paste the starter code you received to activate your account and start building.
            </Typography>

            {error && (
              <Typography sx={{ color: "#C53030", fontSize: "0.85rem", fontFamily: '"Inter", sans-serif', mb: 2 }}>
                {error}
              </Typography>
            )}

            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                label="Starter Code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                required
                size="small"
                placeholder="e.g. DREAM-A7X9-KP2M"
                sx={{
                  mb: 2.5,
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 2,
                    bgcolor: "#FFFDF7",
                    fontFamily: '"Inter", sans-serif',
                    fontSize: "0.9rem",
                    letterSpacing: "0.1em",
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
                disabled={loading || !code.trim()}
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
                {loading ? <CircularProgress size={22} color="inherit" /> : "Activate"}
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
            Don&apos;t have a code? Contact your administrator.
          </Typography>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
