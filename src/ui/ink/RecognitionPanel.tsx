import React from "react";
import { Text, Box } from "ink";
import { resolveTheme, type ThemeName } from "./theme.js";

export interface RecognitionPanelProps {
  text: string;
  theme?: ThemeName;
}

/**
 * 识别文本面板
 * 显示语音识别结果
 */
export function RecognitionPanel({ text, theme = "default" }: RecognitionPanelProps) {
  if (!text) return null;
  const t = resolveTheme(theme);

  return (
    <Box borderStyle="round" borderColor={t.border as any} paddingX={1}>
      <Text color={t.recognition as any}>🎤 {text}</Text>
    </Box>
  );
}