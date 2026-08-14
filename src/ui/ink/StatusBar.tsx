import React from "react";
import { Text, Box } from "ink";

export interface StatusBarProps {
  status: string;
}

/**
 * 状态栏组件
 * 显示当前状态：就绪、录音中、加载中等
 */
export function StatusBar({ status }: StatusBarProps) {
  const statusColor = status.includes("就绪")
    ? "green"
    : status.includes("录音")
      ? "yellow"
      : status.includes("错误")
        ? "red"
        : "cyan";

  return (
    <Box>
      <Text color={statusColor} bold>
        {status}
      </Text>
    </Box>
  );
}