/**
 * 轻量 pub/sub 状态存储
 * ink UI 组件和 createInkUI() 返回的 UI 方法共享此 store
 */

import type { ThemeName } from "./theme.js";

type Listener = () => void;
const listeners = new Set<Listener>();

export interface StoreState {
  status: string;
  recognition: string;
  outputLines: string[];
  /** 历史记录：最近的识别 + 响应摘要。 */
  history: Array<{ prompt: string; response?: string; timestamp: number }>;
  theme: ThemeName;
}

const state: StoreState = {
  status: "",
  recognition: "",
  outputLines: [],
  history: [],
  theme: "default",
};

/** 历史记录最大条数。 */
const MAX_HISTORY = 50;

export function getState<T = unknown>(key: keyof StoreState): T {
  return state[key] as unknown as T;
}

export function setState<K extends keyof StoreState>(key: K, value: StoreState[K]): void {
  state[key] = value;
  for (const fn of listeners) fn();
}

export function appendOutputLine(line: string): void {
  state.outputLines = [...state.outputLines, line];
  for (const fn of listeners) fn();
}

/**
 * 追加一条历史记录。超过 MAX_HISTORY 时丢弃最旧的。
 */
export function appendHistory(entry: { prompt: string; response?: string }): void {
  state.history = [...state.history, { ...entry, timestamp: Date.now() }].slice(-MAX_HISTORY);
  for (const fn of listeners) fn();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 重置 store（用于测试）。 */
export function resetStore(): void {
  state.status = "";
  state.recognition = "";
  state.outputLines = [];
  state.history = [];
  state.theme = "default";
  for (const fn of listeners) fn();
}
