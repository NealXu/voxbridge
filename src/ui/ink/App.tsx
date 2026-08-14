import React, { useState, useEffect } from "react";
import { Box } from "ink";
import { StatusBar } from "./StatusBar.js";
import { RecognitionPanel } from "./RecognitionPanel.js";
import { OutputPanel } from "./OutputPanel.js";

export interface AppProps {
  initialStatus?: string;
}

/**
 * ink 主应用组件
 * 整合所有 UI 组件
 *
 * 注意：这是一个简化实现，主要展示组件架构
 * 完整实现需要状态管理和事件处理
 */
export function App({ initialStatus = "初始化中…" }: AppProps) {
  const [status, setStatus] = useState(initialStatus);
  const [recognition, setRecognition] = useState("");
  const [outputLines, setOutputLines] = useState<string[]>([]);

  // 示例：模拟状态更新
  useEffect(() => {
    const timer = setTimeout(() => {
      setStatus("就绪，按 F9 说话");
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  // 导出状态更新函数（供外部调用）
  // 注意：实际实现需要通过 context 或 ref 暴露这些方法
  const _updateStatus = setStatus;
  const _updateRecognition = setRecognition;
  const _addOutputLine = (line: string) => {
    setOutputLines((prev: string[]) => [...prev, line]);
  };

  // 避免未使用警告
  void _updateStatus;
  void _updateRecognition;
  void _addOutputLine;

  return (
    <Box flexDirection="column" padding={1}>
      <StatusBar status={status} />
      {recognition && <RecognitionPanel text={recognition} />}
      {outputLines.length > 0 && <OutputPanel lines={outputLines} />}
    </Box>
  );
}