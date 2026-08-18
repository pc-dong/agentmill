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
  /** dsh executable override (AM_DSH_BIN); defaults to "dsh" on PATH. */
  dshBin?: string;
  /** DeepSeek API key; AM_DSH_API_KEY wins, then DEEPSEEK_API_KEY. */
  dshApiKey?: string;
  /** Optional DeepSeek base URL override. */
  dshBaseURL?: string;
  /** dsh run timeout ms; 0 disables. Defaults to 30 minutes. */
  dshTimeoutMs: number;
};

const DSH_DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function parseBoardIds(env: NodeJS.ProcessEnv): string[] {
  const ids = new Set<string>();
  const single = env.AM_BOARD_ID?.trim() ?? env.AIW_BOARD_ID?.trim();
  if (single) ids.add(single);
  const list = env.AM_BOARD_IDS ?? env.AIW_BOARD_IDS ?? "";
  for (const part of list.split(",")) {
    const v = part.trim();
    if (v) ids.add(v);
  }
  if (ids.has(ALL_BOARDS)) return [ALL_BOARDS];
  // Default: serve every board (multi-workspace reuse).
  return ids.size > 0 ? [...ids] : [ALL_BOARDS];
}

/** Read an AM_* env var with legacy AIW_* fallback. */
function env2(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[name] ?? env[name.replace(/^AM_/, "AIW_")];
}

export function loadConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const driverRaw = env2(env, "AM_DRIVER");
  const drivers: WorkerDriver[] = ["mock", "cursor", "dsh"];
  const driver = (driverRaw ?? "mock") as WorkerDriver;
  if (!drivers.includes(driver)) {
    throw new Error(`Invalid AM_DRIVER: ${driverRaw}`);
  }

  const pollIntervalRaw = env2(env, "AM_POLL_INTERVAL_MS");
  const pollIntervalMs = pollIntervalRaw ? Number(pollIntervalRaw) : 5000;

  const defaultModel =
    driver === "dsh" ? "deepseek-v4-flash" : "composer-2.5";

  const dshTimeoutRaw = env2(env, "AM_DSH_TIMEOUT_MS");
  const dshTimeoutMs = dshTimeoutRaw
    ? Number(dshTimeoutRaw)
    : DSH_DEFAULT_TIMEOUT_MS;

  return {
    apiBase: env2(env, "AM_API_BASE") ?? "http://127.0.0.1:8787",
    boardIds: parseBoardIds(env),
    workerId: env2(env, "AM_WORKER_ID") ?? `${os.hostname()}-${process.pid}`,
    driver,
    pollIntervalMs,
    cursorApiKey: env.CURSOR_API_KEY,
    modelId: env2(env, "AM_MODEL_ID") ?? defaultModel,
    dshBin: env2(env, "AM_DSH_BIN"),
    dshApiKey: env2(env, "AM_DSH_API_KEY") ?? env.DEEPSEEK_API_KEY,
    dshBaseURL: env2(env, "AM_DSH_BASE_URL"),
    dshTimeoutMs,
  };
}
