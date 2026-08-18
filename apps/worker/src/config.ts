import os from "node:os";

export const ALL_BOARDS = "*";

export type WorkerDriver = "mock" | "cursor" | "dsh";

export type WorkerConfig = {
  apiBase: string;
  /**
   * Boards this worker serves. `[ALL_BOARDS]` ("*") means every board,
   * auto-discovered via GET /boards on each tick.
   */
  boardIds: string[];
  workerId: string;
  driver: WorkerDriver;
  pollIntervalMs: number;
  cursorApiKey?: string;
  /** Per-driver default: cursor → composer-2.5, dsh → deepseek-v4-flash. */
  modelId: string;
  /** dsh executable override (AIW_DSH_BIN); defaults to "dsh" on PATH. */
  dshBin?: string;
  /** DeepSeek API key; AIW_DSH_API_KEY wins, then DEEPSEEK_API_KEY. */
  dshApiKey?: string;
  /** Optional DeepSeek base URL override. */
  dshBaseURL?: string;
  /** dsh run timeout ms; 0 disables. Defaults to 30 minutes. */
  dshTimeoutMs: number;
};

const DSH_DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

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
  const driverRaw = env.AIW_DRIVER;
  const drivers: WorkerDriver[] = ["mock", "cursor", "dsh"];
  const driver = (driverRaw ?? "mock") as WorkerDriver;
  if (!drivers.includes(driver)) {
    throw new Error(`Invalid AIW_DRIVER: ${driverRaw}`);
  }

  const pollIntervalMs = env.AIW_POLL_INTERVAL_MS
    ? Number(env.AIW_POLL_INTERVAL_MS)
    : 5000;

  const defaultModel =
    driver === "dsh" ? "deepseek-v4-flash" : "composer-2.5";

  const dshTimeoutRaw = env.AIW_DSH_TIMEOUT_MS
    ? Number(env.AIW_DSH_TIMEOUT_MS)
    : DSH_DEFAULT_TIMEOUT_MS;

  return {
    apiBase: env.AIW_API_BASE ?? "http://127.0.0.1:8787",
    boardIds: parseBoardIds(env),
    workerId: env.AIW_WORKER_ID ?? `${os.hostname()}-${process.pid}`,
    driver,
    pollIntervalMs,
    cursorApiKey: env.CURSOR_API_KEY,
    modelId: env.AIW_MODEL_ID ?? defaultModel,
    dshBin: env.AIW_DSH_BIN,
    dshApiKey: env.AIW_DSH_API_KEY ?? env.DEEPSEEK_API_KEY,
    dshBaseURL: env.AIW_DSH_BASE_URL,
    dshTimeoutMs: dshTimeoutRaw,
  };
}
