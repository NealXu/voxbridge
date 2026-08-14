/**
 * ink 模块类型声明
 * 当 ink 未安装时，TypeScript 使用这些声明避免编译错误
 */

declare module "ink" {
  import { ComponentType, ReactNode } from "react";

  export interface BoxProps {
    children?: ReactNode;
    flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
    padding?: number;
    paddingX?: number;
    paddingY?: number;
    borderStyle?: "single" | "double" | "round" | "bold";
    borderColor?: string;
  }

  export const Box: ComponentType<BoxProps>;

  export interface TextProps {
    children?: ReactNode;
    color?: string;
    bold?: boolean;
    dimColor?: boolean;
  }

  export const Text: ComponentType<TextProps>;

  export function render(node: ReactNode): void;
}

// React 类型由 @types/react 提供，这里不需要重新声明