import os from "node:os";

export type WorkerConfig = {
  apiBase: string;
  boardId: string;
  workerId: string;
  driver: "mock" | "cursor";
  pollIntervalMs: number;
  cursorApiKey?: string;
  modelId: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const boardId = env.AIW_BOARD_ID;
  if (!boardId) {
    throw new Error("AIW_BOARD_ID is required");
  }

  const driver = env.AIW_DRIVER;
  if (driver && driver !== "mock" && driver !== "cursor") {
    throw new Error(`Invalid AIW_DRIVER: ${driver}`);
  }

  const pollIntervalMs = env.AIW_POLL_INTERVAL_MS
    ? Number(env.AIW_POLL_INTERVAL_MS)
    : 5000;

  return {
    apiBase: env.AIW_API_BASE ?? "http://127.0.0.1:8787",
    boardId,
    workerId: env.AIW_WORKER_ID ?? `${os.hostname()}-${process.pid}`,
    driver: (driver as "mock" | "cursor" | undefined) ?? "mock",
    pollIntervalMs,
    cursorApiKey: env.CURSOR_API_KEY,
    modelId: env.AIW_MODEL_ID ?? "composer-2.5",
  };
}
