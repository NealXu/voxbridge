import React from "react";
import { Text, Box } from "ink";

export interface RecognitionPanelProps {
  text: string;
}

/**
 * 识别文本面板
 * 显示语音识别结果
 */
export function RecognitionPanel({ text }: RecognitionPanelProps) {
  if (!text) return null;

  return (
    <Box borderStyle="round" borderColor="green" paddingX={1}>
      <Text color="green">🎤 {text}</Text>
    </Box>
  );
}