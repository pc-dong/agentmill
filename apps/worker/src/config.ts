import os from "node:os";

export const ALL_BOARDS = "*";

export type WorkerConfig = {
  apiBase: string;
  /**
   * Boards this worker serves. `[ALL_BOARDS]` ("*") means every board,
   * auto-discovered via GET /boards on each tick.
   */
  boardIds: string[];
  workerId: string;
  driver: "mock" | "cursor";
  pollIntervalMs: number;
  cursorApiKey?: string;
  modelId: string;
};

function parseBoardIds(env: NodeJS.ProcessEnv): string[] {
  const ids = new Set<string>();
  const single = env.AIW_BOARD_ID?.trim();
  if (single) ids.add(single);
  for (const part of (env.AIW_BOARD_IDS ?? "").split(",")) {
    const v = part.trim();
    if (v) ids.add(v);
  }
  if (ids.has(ALL_BOARDS)) return [ALL_BOARDS];
  // Default: serve every board (multi-workspace reuse).
  return ids.size > 0 ? [...ids] : [ALL_BOARDS];
}

export function loadConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const driver = env.AIW_DRIVER;
  if (driver && driver !== "mock" && driver !== "cursor") {
    throw new Error(`Invalid AIW_DRIVER: ${driver}`);
  }

  const pollIntervalMs = env.AIW_POLL_INTERVAL_MS
    ? Number(env.AIW_POLL_INTERVAL_MS)
    : 5000;

  return {
    apiBase: env.AIW_API_BASE ?? "http://127.0.0.1:8787",
    boardIds: parseBoardIds(env),
    workerId: env.AIW_WORKER_ID ?? `${os.hostname()}-${process.pid}`,
    driver: (driver as "mock" | "cursor" | undefined) ?? "mock",
    pollIntervalMs,
    cursorApiKey: env.CURSOR_API_KEY,
    modelId: env.AIW_MODEL_ID ?? "composer-2.5",
  };
}
