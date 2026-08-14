import React from "react";
import { Text, Box } from "ink";

export interface OutputPanelProps {
  lines: string[];
}

/**
 * Agent 输出面板
 * 显示 assistant 响应和工具调用
 */
export function OutputPanel({ lines }: OutputPanelProps) {
  if (lines.length === 0) return null;

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Box key={index}>
          <Text dimColor={line.startsWith("└")}>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}