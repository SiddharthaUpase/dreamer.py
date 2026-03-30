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
  const [authUrl, setAuthUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const res = await fetch(`${backendUrl}/api/auth/cli/start`, { method: "POST" });
        if (!res.ok) throw new Error("Could not reach Dreamer. Check your connection and try again.");
        const { code } = (await res.json()) as { code: string };

        const url = `${appUrl}/auth/cli?cli_code=${code}`;
        setAuthUrl(url);

        const { exec } = await import("child_process");
        const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${openCmd} "${url}"`);

        setStatus("polling");

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
            throw new Error("Session expired. Please restart Dreamer to try again.");
          }
        }
        if (!cancelled) throw new Error("Session timed out. Please restart Dreamer to try again.");
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

  // OSC 8 clickable link
  const link = authUrl
    ? `\x1b]8;;${authUrl}\x07${authUrl}\x1b]8;;\x07`
    : "";

  if (status === "error") {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Box borderStyle="round" borderColor="red" paddingX={2} paddingY={1} flexDirection="column">
          <Text bold color="red">  Something went wrong</Text>
          <Text> </Text>
          <Text color="white">  {error}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {status === "starting" && (
        <Box>
          <Text>  </Text>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text> Preparing your login...</Text>
        </Box>
      )}
      {status === "polling" && (
        <Box borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1} flexDirection="column">
          <Text bold color="white">  Welcome to Dreamer</Text>
          <Text> </Text>
          <Text>  We opened your browser to sign in.</Text>
          <Text>  Complete the sign-in there, and you'll be</Text>
          <Text>  connected here automatically.</Text>
          <Text> </Text>
          <Box>
            <Text>  </Text>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text color="white"> Waiting for you to sign in...</Text>
          </Box>
          <Text> </Text>
          <Text dimColor>  Browser didn't open? Visit this link:</Text>
          <Text color="cyan">  {link}</Text>
        </Box>
      )}
    </Box>
  );
}
