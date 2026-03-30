import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";

interface Props {
  onSubmit: (key: string) => void;
  error?: string;
  validating?: boolean;
}

export function KeyScreen({ onSubmit, error, validating }: Props) {
  const [key, setKey] = useState("");

  useInput((ch, k) => {
    if (validating) return;
    if (k.return) {
      const trimmed = key.trim();
      if (trimmed) onSubmit(trimmed);
      return;
    }
    if (k.backspace || k.delete) {
      setKey((prev) => prev.slice(0, -1));
      return;
    }
    if (k.escape || k.ctrl || k.meta || k.tab) return;
    if (ch) setKey((prev) => prev + ch);
  });

  // Mask the key: show first 4 chars + dots
  const masked = key.length > 4
    ? key.slice(0, 4) + "•".repeat(Math.min(key.length - 4, 30))
    : key;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
        <Text bold>OpenRouter API Key</Text>
        <Text> </Text>
        <Text>Dreamer uses OpenRouter to connect to AI models.</Text>
        <Text>You need an API key to continue.</Text>
        <Text> </Text>
        <Text dimColor>1. Go to <Text color="cyan">https://openrouter.ai/keys</Text></Text>
        <Text dimColor>2. Create an API key</Text>
        <Text dimColor>3. Paste it below</Text>
        <Text> </Text>
        {validating ? (
          <Box>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text color="yellow">  Validating key...</Text>
          </Box>
        ) : (
          <Box>
            <Text bold color="yellow">{"Key › "}</Text>
            <Text>{masked}</Text>
            <Text backgroundColor="white" color="black">{" "}</Text>
          </Box>
        )}
        {error && (
          <>
            <Text> </Text>
            <Text color="red">{error}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
