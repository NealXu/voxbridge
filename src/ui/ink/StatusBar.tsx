import React from "react";
import { Text, Box } from "ink";
import { resolveTheme, statusColor, type ThemeName } from "./theme.js";

export interface StatusBarProps {
  status: string;
  theme?: ThemeName;
}

/**
 * 状态栏组件
 * 显示当前状态：就绪、录音中、加载中等
 * 颜色由 theme 决定
 */
export function StatusBar({ status, theme = "default" }: StatusBarProps) {
  const t = resolveTheme(theme);
  const color = statusColor(t, status);

  return (
    <Box>
      <Text color={color as any} bold>
        {status}
      </Text>
    </Box>
  );
}