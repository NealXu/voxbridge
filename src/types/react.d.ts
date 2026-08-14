/**
 * React 模块类型声明
 * 当 @types/react 未安装时，TypeScript 使用这些声明避免编译错误
 * 这是一个简化版本，只包含 ink 组件所需的类型
 */

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type ReactNode = any;

  export function useState<S>(initialState: S | (() => S)): [S, (value: S | ((prevState: S) => S)) => void];

  export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;

  export function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;

  // 添加 FC 类型用于函数组件
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type FC<P = {}> = (props: P) => any;
}

declare module "react/jsx-runtime" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function jsx(type: unknown, props: unknown): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function jsxs(type: unknown, props: unknown): any;
}