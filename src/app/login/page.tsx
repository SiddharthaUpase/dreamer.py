"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import { createClient } from "@/lib/supabase/client";

// Renaissance-inspired warm theme
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

type Mode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSuccess("Check your email for a confirmation link.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/");
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  };

  return (
    <ThemeProvider theme={renaissanceTheme}>
      <CssBaseline />
      {/* Google Font */}
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&display=swap" rel="stylesheet" />

      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          bgcolor: "#F5F0E8",
        }}
      >
        {/* Left side — Renaissance sculpture panel */}
        <Box
          sx={{
            flex: "0 0 55%",
            display: { xs: "none", md: "flex" },
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            overflow: "hidden",
            backgroundImage: 'url("https://images.unsplash.com/photo-1561214115-f2f134cc4912?w=1200&q=80")',
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {/* Dark overlay */}
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              background: "rgba(20, 16, 10, 0.6)",
            }}
          />
          {/* Centered quote */}
          <Box sx={{ position: "relative", zIndex: 1, px: 8, textAlign: "center", maxWidth: 560 }}>
            <Typography
              sx={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: "2.8rem",
                fontWeight: 300,
                fontStyle: "italic",
                color: "#F5F0E8",
                lineHeight: 1.35,
                mb: 3,
              }}
            >
              &ldquo;Every block of stone has a statue inside it, and it is the task of the sculptor to discover it.&rdquo;
            </Typography>
            <Box sx={{ width: 60, height: 1, bgcolor: "rgba(245, 240, 232, 0.3)", mx: "auto", mb: 2.5 }} />
            <Typography
              sx={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: "1.1rem",
                color: "rgba(245, 240, 232, 0.6)",
                fontWeight: 500,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
              }}
            >
              Michelangelo
            </Typography>
          </Box>
        </Box>

        {/* Right side — Login form */}
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            px: { xs: 3, sm: 6 },
            py: 4,
          }}
        >
          <Box sx={{ width: "100%", maxWidth: 380 }}>
            {/* Logo */}
            <Box sx={{ mb: 5 }}>
              <Typography
                sx={{
                  fontFamily: '"Cormorant Garamond", serif',
                  fontSize: "2.8rem",
                  fontWeight: 700,
                  color: "#2C2416",
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                }}
              >
                Dreamer
              </Typography>
              <Typography
                sx={{
                  fontFamily: '"Cormorant Garamond", serif',
                  fontSize: "1.1rem",
                  color: "#7A6B55",
                  mt: 1,
                  fontStyle: "italic",
                  fontWeight: 400,
                }}
              >
                Where ideas become reality
              </Typography>
            </Box>

            {/* Heading */}
            <Typography
              sx={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: "1.8rem",
                fontWeight: 600,
                color: "#2C2416",
                mb: 0.5,
              }}
            >
              {mode === "login" ? "Welcome back" : "Begin your journey"}
            </Typography>
            <Typography
              sx={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: "1.05rem",
                color: "#7A6B55",
                mb: 3,
              }}
            >
              {mode === "login"
                ? "Sign in to continue crafting your vision"
                : "Create an account to start building"
              }
            </Typography>

            {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }}>{success}</Alert>}

            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                size="small"
                sx={{
                  mb: 2,
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
              <TextField
                fullWidth
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                size="small"
                sx={{
                  mb: 3,
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
                inputProps={{ minLength: 6 }}
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                disabled={loading}
                sx={{
                  py: 1.3,
                  mb: 2,
                  borderRadius: 2,
                  fontFamily: '"Cormorant Garamond", serif',
                  fontSize: "1.1rem",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "none",
                  bgcolor: "#2C2416",
                  "&:hover": { bgcolor: "#3D3220" },
                }}
              >
                {loading ? (
                  <CircularProgress size={22} color="inherit" />
                ) : mode === "login" ? (
                  "Sign In"
                ) : (
                  "Create Account"
                )}
              </Button>
            </form>

            <Divider sx={{ my: 2.5, color: "#B5A898", fontSize: "0.8rem", fontFamily: '"Cormorant Garamond", serif' }}>
              or
            </Divider>

            <Button
              fullWidth
              variant="outlined"
              onClick={handleGoogle}
              sx={{
                py: 1.2,
                mb: 3,
                borderRadius: 2,
                borderColor: "#D4C9B5",
                color: "#2C2416",
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: "1.05rem",
                fontWeight: 500,
                textTransform: "none",
                "&:hover": { borderColor: "#8B6914", bgcolor: "rgba(139, 105, 20, 0.04)" },
              }}
            >
              Continue with Google
            </Button>

            <Typography
              sx={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: "1rem",
                color: "#7A6B55",
                textAlign: "center",
              }}
            >
              {mode === "login" ? "New to Dreamer?" : "Already have an account?"}{" "}
              <Box
                component="span"
                sx={{
                  color: "#8B6914",
                  cursor: "pointer",
                  fontWeight: 600,
                  "&:hover": { textDecoration: "underline" },
                }}
                onClick={() => {
                  setMode(mode === "login" ? "signup" : "login");
                  setError(null);
                  setSuccess(null);
                }}
              >
                {mode === "login" ? "Begin your journey" : "Welcome back"}
              </Box>
            </Typography>
          </Box>

          {/* Footer */}
          <Typography
            sx={{
              position: "absolute",
              bottom: 24,
              fontFamily: '"Cormorant Garamond", serif',
              fontSize: "0.75rem",
              color: "#B5A898",
              fontStyle: "italic",
            }}
          >
            Built for dreamers, by dreamers
          </Typography>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
