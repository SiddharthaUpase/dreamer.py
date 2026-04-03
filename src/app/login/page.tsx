"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
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

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

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
              Welcome
            </Typography>
            <Typography
              sx={{
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: "1.05rem",
                color: "#7A6B55",
                mb: 4,
              }}
            >
              Sign in to continue crafting your vision
            </Typography>

            {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

            <Button
              fullWidth
              variant="outlined"
              onClick={handleGoogle}
              startIcon={
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              }
              sx={{
                py: 1.4,
                borderRadius: 2,
                borderColor: "#D4C9B5",
                color: "#2C2416",
                fontFamily: '"Inter", sans-serif',
                fontSize: "0.95rem",
                fontWeight: 500,
                textTransform: "none",
                "&:hover": { borderColor: "#8B6914", bgcolor: "rgba(139, 105, 20, 0.04)" },
              }}
            >
              Continue with Google
            </Button>
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
