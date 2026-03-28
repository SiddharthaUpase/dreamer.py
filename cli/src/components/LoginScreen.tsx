import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

interface Props {
  backendUrl: string;
  appUrl: string;
  onLogin: (apiKey: string) => void;
}

export function LoginScreen({ backendUrl, appUrl, onLogin }: Props) {
  const [status, setStatus] = useState<"starting" | "polling" | "error">("starting");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        // Start device code flow
        const res = await fetch(`${backendUrl}/api/auth/cli/start`, { method: "POST" });
        if (!res.ok) throw new Error("Failed to start auth flow. Is the backend running?");
        const { code } = (await res.json()) as { code: string };

        const authUrl = `${appUrl}/auth/cli?cli_code=${code}`;

        // Open browser
        const { exec } = await import("child_process");
        const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${openCmd} "${authUrl}"`);

        setStatus("polling");

        // Poll for approval
        const deadline = Date.now() + 15 * 60 * 1000;
        while (!cancelled && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          if (cancelled) return;

          const pollRes = await fetch(`${backendUrl}/api/auth/cli/poll/${code}`);
          const result = (await pollRes.json()) as { status: string; apiKey?: string };

          if (result.status === "approved" && result.apiKey) {
            onLogin(result.apiKey);
            return;
          }
          if (result.status === "expired") {
            throw new Error("Auth code expired. Try again.");
          }
        }
        if (!cancelled) throw new Error("Login timed out.");
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message);
          setStatus("error");
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, []);

  if (status === "error") {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ {error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {status === "starting" && <Text dimColor>Starting authentication...</Text>}
      {status === "polling" && (
        <Text>
          <Text color="green"><Spinner type="dots" /></Text>
          {" "}Waiting for login in browser...
        </Text>
      )}
    </Box>
  );
}
