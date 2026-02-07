export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
}

const MAX_ENTRIES = 2000;

export const logState = $state<{ entries: LogEntry[] }>({
  entries: [],
});

export function addLog(level: LogEntry['level'], source: string, message: string): void {
  if (logState.entries.length >= MAX_ENTRIES) {
    logState.entries.splice(0, logState.entries.length - MAX_ENTRIES + 1);
  }
  logState.entries.push({ timestamp: Date.now(), level, source, message });
}

export function clearLog(): void {
  logState.entries.length = 0;
}
