import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("defaults to all boards (wildcard) when no board env is set", () => {
    const c = loadConfig({ AM_API_BASE: "http://127.0.0.1:8787" });
    expect(c.boardIds).toEqual(["*"]);
  });

  it("accepts a single board via AM_BOARD_ID", () => {
    const c = loadConfig({ AM_BOARD_ID: "b1" });
    expect(c.boardIds).toEqual(["b1"]);
  });

  it("still honors legacy AIW_* env vars", () => {
    const c = loadConfig({
      AIW_DRIVER: "dsh",
      AIW_BOARD_ID: "legacy-b",
      AIW_DSH_BIN: "/old/dsh",
      AIW_MODEL_ID: "deepseek-v4-pro",
    });
    expect(c.driver).toBe("dsh");
    expect(c.boardIds).toEqual(["legacy-b"]);
    expect(c.dshBin).toBe("/old/dsh");
    expect(c.modelId).toBe("deepseek-v4-pro");
  });

  it("accepts a comma-separated allowlist via AM_BOARD_IDS", () => {
    const c = loadConfig({ AM_BOARD_IDS: "b1, b2 ,,b3" });
    expect(c.boardIds).toEqual(["b1", "b2", "b3"]);
  });

  it("unions AM_BOARD_ID and AM_BOARD_IDS and honors wildcard", () => {
    const c = loadConfig({ AM_BOARD_ID: "b1", AM_BOARD_IDS: "b2,b1" });
    expect(c.boardIds).toEqual(["b1", "b2"]);

    const all = loadConfig({ AM_BOARD_ID: "b1", AM_BOARD_IDS: "*" });
    expect(all.boardIds).toEqual(["*"]);
  });

  it("defaults driver to mock", () => {
    const c = loadConfig({
      AM_BOARD_ID: "b1",
      AM_API_BASE: "http://127.0.0.1:8787",
    });
    expect(c.driver).toBe("mock");
    expect(c.workerId).toBeTruthy();
  });

  it("applies defaults for apiBase, pollIntervalMs, and modelId", () => {
    const c = loadConfig({ AM_BOARD_ID: "b1" });
    expect(c.apiBase).toBe("http://127.0.0.1:8787");
    expect(c.pollIntervalMs).toBe(5000);
    expect(c.modelId).toBe("composer-2.5");
  });

  it("accepts AM_DRIVER=dsh with dsh env vars and per-driver model default", () => {
    const c = loadConfig({
      AM_DRIVER: "dsh",
      AM_DSH_BIN: "/opt/dsh/bin/dsh",
      AM_DSH_API_KEY: "sk-dsh",
      AM_DSH_BASE_URL: "https://api.deepseek.com",
      AM_DSH_TIMEOUT_MS: "60000",
    });
    expect(c.driver).toBe("dsh");
    expect(c.modelId).toBe("deepseek-v4-flash");
    expect(c.dshBin).toBe("/opt/dsh/bin/dsh");
    expect(c.dshApiKey).toBe("sk-dsh");
    expect(c.dshBaseURL).toBe("https://api.deepseek.com");
    expect(c.dshTimeoutMs).toBe(60000);
  });

  it("dsh falls back to DEEPSEEK_API_KEY and honors AM_MODEL_ID override", () => {
    const c = loadConfig({
      AM_DRIVER: "dsh",
      DEEPSEEK_API_KEY: "sk-env",
      AM_MODEL_ID: "deepseek-v4-pro",
    });
    expect(c.dshApiKey).toBe("sk-env");
    expect(c.modelId).toBe("deepseek-v4-pro");
  });

  it("dsh timeout defaults to 30 minutes", () => {
    const c = loadConfig({ AM_DRIVER: "dsh" });
    expect(c.dshTimeoutMs).toBe(30 * 60 * 1000);
  });

  it("rejects unknown driver values", () => {
    expect(() => loadConfig({ AM_DRIVER: "warp" })).toThrow(/Invalid AM_DRIVER/);
  });

  it("reads cursor driver and optional env vars", () => {
    const c = loadConfig({
      AM_BOARD_ID: "b1",
      AM_DRIVER: "cursor",
      AM_WORKER_ID: "w-1",
      AM_POLL_INTERVAL_MS: "3000",
      CURSOR_API_KEY: "key-abc",
      AM_MODEL_ID: "gpt-4",
    });
    expect(c.driver).toBe("cursor");
    expect(c.workerId).toBe("w-1");
    expect(c.pollIntervalMs).toBe(3000);
    expect(c.cursorApiKey).toBe("key-abc");
    expect(c.modelId).toBe("gpt-4");
  });
});
