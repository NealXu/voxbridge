import React, { useState, useEffect } from "react";
import { Box } from "ink";
import { StatusBar } from "./StatusBar.js";
import { RecognitionPanel } from "./RecognitionPanel.js";
import { OutputPanel } from "./OutputPanel.js";
import { subscribe, getState } from "./store.js";

/**
 * ink 主应用组件
 * 订阅 store 变化，驱动 UI 重新渲染
 */
export function App() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  const status = getState<string>("status");
  const recognition = getState<string>("recognition");
  const outputLines = getState<string[]>("outputLines");

  return (
    <Box flexDirection="column" paddingX={0}>
      <StatusBar status={status} />
      {recognition && <RecognitionPanel text={recognition} />}
      {outputLines.length > 0 && <OutputPanel lines={outputLines} />}
    </Box>
  );
}
