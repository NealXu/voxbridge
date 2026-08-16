/**
 * Directory-driven session manager for persistent CC process pool.
 *
 * @module session/directorySessionManager
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ExecutorRegistry } from "../executor/registry.js";
import type { RegistryEntry } from "../executor/registry.js";
import type { Config } from "../config.js";

export interface SwitchResult {
  ok: boolean;
  error?: string;
  entry?: RegistryEntry;
}

export class DirectorySessionManager {
  private registry: ExecutorRegistry;
  private _activeCwd: string;
  private knownProjects: Set<string> = new Set();

  constructor(config: Config) {
    this.registry = new ExecutorRegistry({
      idleTimeoutMs: config.executor?.idleTimeoutMs,
      maxConcurrent: config.executor?.maxConcurrent,
    });
    this._activeCwd = process.cwd();
  }

  getActiveCwd(): string {
    return this._activeCwd;
  }

  isKnownProject(cwd: string): boolean {
    return this.knownProjects.has(this.generateChatId(cwd));
  }

  generateChatId(cwd: string): string {
    return resolve(cwd).replace(/\\/g, '/').toLowerCase();
  }

  async acquire(): Promise<RegistryEntry> {
    const chatId = this.generateChatId(this._activeCwd);
    return this.registry.acquire(chatId, { cwd: this._activeCwd });
  }

  async release(reason: string): Promise<void> {
    const chatId = this.generateChatId(this._activeCwd);
    await this.registry.release(chatId, reason);
  }

  async switchDirectory(newCwd: string): Promise<SwitchResult> {
    const normalizedCwd = resolve(newCwd);
    if (!existsSync(normalizedCwd)) {
      return { ok: false, error: "directory_not_found" };
    }
    await this.release("switching directory");
    this._activeCwd = normalizedCwd;
    this.knownProjects.add(this.generateChatId(normalizedCwd));
    const chatId = this.generateChatId(normalizedCwd);
    const entry = await this.registry.acquire(chatId, { cwd: normalizedCwd });
    return { ok: true, entry };
  }

  async shutdown(): Promise<void> {
    await this.registry.shutdownAll("shutdown");
  }
}