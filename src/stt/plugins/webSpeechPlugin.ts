import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { SttPlugin, PluginConfig } from "../pluginTypes.js";
import type { SttResult } from "../types.js";
import { spawn } from "node:child_process";

/** Web Speech API 插件配置。 */
export interface WebSpeechConfig extends PluginConfig {
  /** HTTP 服务器端口。 */
  port?: number;
  /** 是否自动打开浏览器。 */
  openBrowser?: boolean;
}

/** Chrome Web Speech API STT 插件。
 *
 * 通过本地 HTTP 服务器 + WebSocket 与浏览器通信：
 * 1. Node 端启动 HTTP 服务器，提供含 Web Speech API 的 HTML 页面
 * 2. 浏览器打开页面，用户授权麦克风
 * 3. 浏览器通过 WebSocket 将识别结果发回 Node
 */
export class WebSpeechPlugin implements SttPlugin {
  private server: Server | null = null;
  private wsServer: WebSocketServer | null = null;
  private wsClient: WebSocket | null = null;
  private config: Required<WebSpeechConfig>;
  private pendingResolve: ((result: SttResult) => void) | null = null;
  private pendingReject: ((error: Error) => void) | null = null;
  private isRecording = false;
  private browserOpened = false;

  constructor(config: WebSpeechConfig) {
    this.config = {
      language: config.language || "zh-CN",
      port: config.port || 18765,
      openBrowser: config.openBrowser ?? true,
    };
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      // 创建 HTTP 服务器
      this.server = createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });

      // 创建 WebSocket 服务器
      this.wsServer = new WebSocketServer({ server: this.server });

      this.wsServer.on("connection", (ws) => {
        this.wsClient = ws;
        // 首次 WebSocket 连接时打开浏览器（而非服务器启动时）
        if (!this.browserOpened && this.config.openBrowser) {
          this.browserOpened = true;
          this.openBrowser(`http://localhost:${this.config.port}`);
        }
        ws.on("message", (data) => {
          this.handleWsMessage(data.toString());
        });
        ws.on("close", () => {
          this.wsClient = null;
        });
      });

      this.server.listen(this.config.port, () => {
        resolve();
      });

      this.server.on("error", reject);
    });
  }

  startRecording(): void {
    if (!this.wsClient) {
      throw new Error("WebSocket client not connected");
    }
    this.isRecording = true;
    this.wsClient.send(JSON.stringify({ type: "start" }));
  }

  stopRecording(): Promise<SttResult> {
    if (!this.wsClient) {
      return Promise.resolve({ kind: "error", message: "WebSocket client not connected" });
    }
    if (!this.isRecording) {
      return Promise.resolve({ kind: "error", message: "Not recording" });
    }

    this.wsClient.send(JSON.stringify({ type: "stop" }));
    this.isRecording = false;

    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      // 超时保护
      setTimeout(() => {
        if (this.pendingResolve) {
          this.pendingResolve = null;
          this.pendingReject = null;
          reject(new Error("Recognition timeout"));
        }
      }, 30000);
    });
  }

  async dispose(): Promise<void> {
    this.pendingResolve = null;
    this.pendingReject = null;
    this.browserOpened = false;

    // 先终止所有 WebSocket 客户端，否则 wsServer.close() 会一直等待
    if (this.wsClient) {
      try { this.wsClient.terminate(); } catch { /* 已断开则忽略 */ }
      this.wsClient = null;
    }

    if (this.wsServer) {
      // 强制终止所有连接
      for (const client of this.wsServer.clients) {
        try { client.terminate(); } catch { /* 忽略 */ }
      }
      await Promise.race([
        new Promise<void>((resolve) => this.wsServer!.close(() => resolve())),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      this.wsServer = null;
    }

    if (this.server) {
      await Promise.race([
        new Promise<void>((resolve) => this.server!.close(() => resolve())),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      this.server = null;
    }
  }

  private handleHttpRequest(_req: IncomingMessage, res: ServerResponse): void {
    const html = this.generateHtml();
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
    });
    res.end(html);
  }

  private handleWsMessage(data: string): void {
    try {
      const msg = JSON.parse(data);

      if (msg.type === "result" && this.pendingResolve) {
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        this.pendingReject = null;
        resolve({ kind: "text", text: msg.text });
      } else if (msg.type === "noise" && this.pendingResolve) {
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        this.pendingReject = null;
        resolve({ kind: "noise" });
      } else if (msg.type === "error" && this.pendingReject) {
        const reject = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        reject(new Error(msg.message));
      }
    } catch {
      // 忽略解析错误
    }
  }

  private generateHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>VoxCode Speech Recognition</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #f5f5f5;
    }
    .container {
      text-align: center;
      padding: 2rem;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 { margin: 0 0 1rem; }
    p { margin: 0.5rem 0; color: #666; }
    #status { font-weight: bold; color: #333; }
    #result { margin-top: 1rem; padding: 1rem; background: #e8f5e9; border-radius: 4px; min-height: 2rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>VoxCode Speech Recognition</h1>
    <p id="status">Connecting...</p>
    <div id="result"></div>
  </div>
  <script>
    const statusEl = document.getElementById('status');
    const resultEl = document.getElementById('result');

    // WebSocket 连接
    const ws = new WebSocket('ws://' + location.host);

    ws.onopen = () => {
      statusEl.textContent = 'Ready - Waiting for voice input';
    };

    ws.onclose = () => {
      statusEl.textContent = 'Disconnected';
    };

    ws.onerror = (err) => {
      statusEl.textContent = 'Error: ' + err;
    };

    // Web Speech API
    const recognition = new webkitSpeechRecognition();
    recognition.lang = '${this.config.language}';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      statusEl.textContent = 'Listening...';
    };

    recognition.onend = () => {
      statusEl.textContent = 'Ready - Waiting for voice input';
    };

    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      if (result.isFinal) {
        const text = result[0].transcript;
        resultEl.textContent = text;
        ws.send(JSON.stringify({ type: 'result', text }));
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech') {
        ws.send(JSON.stringify({ type: 'noise' }));
      } else {
        ws.send(JSON.stringify({ type: 'error', message: event.error }));
      }
    };

    // 接收 WebSocket 指令
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'start') {
        recognition.start();
      } else if (msg.type === 'stop') {
        recognition.stop();
      }
    };
  </script>
</body>
</html>`;
  }

  private openBrowser(url: string): void {
    const platform = process.platform;
    let cmd: string;
    let args: string[];

    if (platform === "win32") {
      cmd = process.env.COMSPEC || "cmd.exe";
      args = ["/c", "start", "", url];
    } else if (platform === "darwin") {
      cmd = "open";
      args = [url];
    } else {
      cmd = "xdg-open";
      args = [url];
    }

    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  }
}