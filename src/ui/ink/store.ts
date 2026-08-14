/**
 * 轻量 pub/sub 状态存储
 * ink UI 组件和 createInkUI() 返回的 UI 方法共享此 store
 */

type Listener = () => void;
const listeners = new Set<Listener>();
const state: Record<string, unknown> = {
  status: "",
  recognition: "",
  outputLines: [] as string[],
};

export function getState<T = unknown>(key: string): T {
  return state[key] as T;
}

export function setState(key: string, value: unknown): void {
  state[key] = value;
  for (const fn of listeners) fn();
}

export function appendOutputLine(line: string): void {
  const lines = state.outputLines as string[];
  state.outputLines = [...lines, line];
  for (const fn of listeners) fn();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
