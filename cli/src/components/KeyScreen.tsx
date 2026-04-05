import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";

interface Props {
  onSubmit: (code: string) => void;
  error?: string;
  validating?: boolean;
}

export function KeyScreen({ onSubmit, error, validating }: Props) {
  const [code, setCode] = useState("");

  useInput((ch, k) => {
    if (validating) return;
    if (k.return) {
      const trimmed = code.trim();
      if (trimmed) onSubmit(trimmed);
      return;
    }
    if (k.backspace || k.delete) {
      setCode((prev) => prev.slice(0, -1));
      return;
    }
    if (k.escape || k.ctrl || k.meta || k.tab) return;
    if (ch) setCode((prev) => prev + ch.toUpperCase());
  });

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
        <Text bold>Starter Code</Text>
        <Text> </Text>
        <Text>Enter the starter code you received to activate</Text>
        <Text>your account and start building.</Text>
        <Text> </Text>
        {validating ? (
          <Box>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text color="yellow">  Validating code...</Text>
          </Box>
        ) : (
          <Box>
            <Text bold color="yellow">{"Code › "}</Text>
            <Text>{code}</Text>
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
