/**
 * node-pty 类型声明（本地 shim）
 *
 * node-pty 的发布包未携带其 TypeScript 声明文件（`typings/` 在 tarball 中缺失），
 * 此处提供本项目实际使用的最小声明面，与 src/types/react.d.ts、ink.d.ts 的处理一致。
 * 若上游包后续补上类型声明，本文件会被真实类型覆盖，可安全删除。
 */

declare module "node-pty" {
  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
    encoding?: string;
    handleFlowControl?: boolean;
    flowControlPause?: string;
    flowControlResume?: string;
  }

  export interface IPtyExitEvent {
    exitCode: number;
    signal?: number;
  }

  export interface IDisposable {
    dispose(): void;
  }

  export interface IPty {
    readonly pid: number;
    readonly process: string;
    write(data: string): void;
    kill(signal?: string): void;
    resize(cols: number, rows: number): void;
    onData(callback: (data: string) => void): IDisposable;
    onExit(callback: (event: IPtyExitEvent) => void): IDisposable;
  }

  export function spawn(file: string, args: string[], options?: IPtyForkOptions): IPty;
  export function spawn(file: string, args: string, options?: IPtyForkOptions): IPty;
}