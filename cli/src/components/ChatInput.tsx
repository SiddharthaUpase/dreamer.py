import React, { useState } from "react";
import { Box, Text, useStdout, useInput } from "ink";

interface Props {
  projectName: string;
  onSubmit: (text: string) => void;
  isActive: boolean;
}

export function ChatInput({ projectName, onSubmit, isActive }: Props) {
  const { stdout } = useStdout();
  const rows = stdout?.rows || 24;
  const cols = stdout?.columns || 80;
  const inputHeight = Math.max(5, Math.floor(rows * 0.3));

  const [text, setText] = useState("");
  const [cursorPos, setCursorPos] = useState(0);

  useInput((input, key) => {
    if (!isActive) return;

    // Submit on Enter (no shift)
    if (key.return && !key.shift) {
      if (text.trim()) {
        onSubmit(text);
        setText("");
        setCursorPos(0);
      }
      return;
    }

    // Newline on Shift+Enter
    if (key.return && key.shift) {
      const before = text.slice(0, cursorPos);
      const after = text.slice(cursorPos);
      setText(before + "\n" + after);
      setCursorPos(cursorPos + 1);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setText(text.slice(0, cursorPos - 1) + text.slice(cursorPos));
        setCursorPos(cursorPos - 1);
      }
      return;
    }

    // Arrow keys
    if (key.leftArrow) {
      setCursorPos(Math.max(0, cursorPos - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorPos(Math.min(text.length, cursorPos + 1));
      return;
    }
    if (key.upArrow) {
      // Move cursor up one line
      const lines = text.slice(0, cursorPos).split("\n");
      if (lines.length > 1) {
        const currentLineLen = lines[lines.length - 1].length;
        const prevLine = lines[lines.length - 2];
        const newCol = Math.min(currentLineLen, prevLine.length);
        const newPos = text.slice(0, cursorPos).lastIndexOf("\n");
        const prevNewline = text.slice(0, newPos).lastIndexOf("\n");
        setCursorPos((prevNewline === -1 ? 0 : prevNewline + 1) + newCol);
      }
      return;
    }
    if (key.downArrow) {
      // Move cursor down one line
      const beforeCursor = text.slice(0, cursorPos);
      const afterCursor = text.slice(cursorPos);
      const currentLineStart = beforeCursor.lastIndexOf("\n") + 1;
      const currentCol = cursorPos - currentLineStart;
      const nextNewline = afterCursor.indexOf("\n");
      if (nextNewline !== -1) {
        const nextLineStart = cursorPos + nextNewline + 1;
        const nextLineEnd = text.indexOf("\n", nextLineStart);
        const nextLineLen = (nextLineEnd === -1 ? text.length : nextLineEnd) - nextLineStart;
        setCursorPos(nextLineStart + Math.min(currentCol, nextLineLen));
      }
      return;
    }

    // Escape — ignore (handled by parent)
    if (key.escape) return;

    // Tab
    if (key.tab) {
      const before = text.slice(0, cursorPos);
      const after = text.slice(cursorPos);
      setText(before + "  " + after);
      setCursorPos(cursorPos + 2);
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      const before = text.slice(0, cursorPos);
      const after = text.slice(cursorPos);
      setText(before + input + after);
      setCursorPos(cursorPos + input.length);
    }
  }, { isActive });

  // Render the text with cursor
  const contentWidth = cols - 4; // border + padding
  const lines = text.split("\n");

  // Build display lines with word wrapping
  const displayLines: string[] = [];
  let cursorLine = 0;
  let cursorCol = 0;
  let charCount = 0;

  for (const line of lines) {
    if (line.length === 0) {
      if (charCount === cursorPos) {
        cursorLine = displayLines.length;
        cursorCol = 0;
      }
      displayLines.push("");
      charCount++; // for the \n
    } else {
      // Wrap long lines
      for (let i = 0; i < line.length; i += contentWidth) {
        const chunk = line.slice(i, i + contentWidth);
        const lineIdx = displayLines.length;
        for (let j = 0; j < chunk.length; j++) {
          if (charCount + j === cursorPos) {
            cursorLine = lineIdx;
            cursorCol = j;
          }
        }
        displayLines.push(chunk);
      }
      charCount += line.length + 1; // +1 for \n
    }
  }

  // Handle cursor at end of text
  if (cursorPos === text.length) {
    cursorLine = displayLines.length - 1;
    cursorCol = (displayLines[displayLines.length - 1] || "").length;
  }

  // Viewport scrolling — show lines around cursor
  const viewportHeight = inputHeight - 3; // border top/bottom + prompt line
  let scrollOffset = 0;
  if (displayLines.length > viewportHeight) {
    scrollOffset = Math.max(0, cursorLine - Math.floor(viewportHeight / 2));
    scrollOffset = Math.min(scrollOffset, displayLines.length - viewportHeight);
  }
  const visibleLines = displayLines.slice(scrollOffset, scrollOffset + viewportHeight);

  // Pad to fill height
  while (visibleLines.length < viewportHeight) {
    visibleLines.push("");
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={isActive ? "cyan" : "gray"}
      height={inputHeight}
      width={cols}
    >
      {/* Prompt label */}
      <Box>
        <Text bold color="cyan">{`(${projectName}) `}</Text>
        <Text dimColor>Enter to send · Shift+Enter for newline</Text>
      </Box>

      {/* Text content */}
      {visibleLines.map((line, i) => {
        const actualLineIdx = i + scrollOffset;
        if (isActive && actualLineIdx === cursorLine) {
          // Render line with cursor
          const before = line.slice(0, cursorCol);
          const cursorChar = line[cursorCol] || " ";
          const after = line.slice(cursorCol + 1);
          return (
            <Text key={i}>
              {before}
              <Text backgroundColor="white" color="black">{cursorChar}</Text>
              {after}
            </Text>
          );
        }
        return <Text key={i}>{line || " "}</Text>;
      })}
    </Box>
  );
}
