/**
 * Debug Logger
 *
 * Provides debug logging functionality for drizzle-solid
 */

export class DebugLogger {
  private enabled: boolean;
  private prefix: string;

  constructor(enabled: boolean = false, prefix: string = '[drizzle-solid]') {
    this.enabled = enabled;
    this.prefix = prefix;
  }

  log(message: string, ...args: any[]) {
    if (this.enabled) {
      console.log(`${this.prefix} ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.enabled) {
      console.warn(`${this.prefix} ⚠️  ${message}`, ...args);
    }
  }

  error(message: string, ...args: any[]) {
    if (this.enabled) {
      console.error(`${this.prefix} ❌ ${message}`, ...args);
    }
  }

  group(label: string) {
    if (this.enabled) {
      console.group(`${this.prefix} ${label}`);
    }
  }

  groupEnd() {
    if (this.enabled) {
      console.groupEnd();
    }
  }

  table(data: any) {
    if (this.enabled) {
      console.table(data);
    }
  }
}

// Global debug logger instance
let globalDebugLogger: DebugLogger | null = null;

export function setGlobalDebugLogger(logger: DebugLogger) {
  globalDebugLogger = logger;
}

export function getGlobalDebugLogger(): DebugLogger {
  if (!globalDebugLogger) {
    globalDebugLogger = new DebugLogger(false);
  }
  return globalDebugLogger;
}
