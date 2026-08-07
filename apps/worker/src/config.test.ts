import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("requires AIW_BOARD_ID", () => {
    expect(() =>
      loadConfig({ AIW_API_BASE: "http://127.0.0.1:8787" }),
    ).toThrow(/AIW_BOARD_ID/);
  });

  it("defaults driver to mock", () => {
    const c = loadConfig({
      AIW_BOARD_ID: "b1",
      AIW_API_BASE: "http://127.0.0.1:8787",
    });
    expect(c.driver).toBe("mock");
    expect(c.workerId).toBeTruthy();
  });

  it("applies defaults for apiBase, pollIntervalMs, and modelId", () => {
    const c = loadConfig({ AIW_BOARD_ID: "b1" });
    expect(c.apiBase).toBe("http://127.0.0.1:8787");
    expect(c.pollIntervalMs).toBe(5000);
    expect(c.modelId).toBe("composer-2.5");
  });

  it("reads cursor driver and optional env vars", () => {
    const c = loadConfig({
      AIW_BOARD_ID: "b1",
      AIW_DRIVER: "cursor",
      AIW_WORKER_ID: "w-1",
      AIW_POLL_INTERVAL_MS: "3000",
      CURSOR_API_KEY: "key-abc",
      AIW_MODEL_ID: "gpt-4",
    });
    expect(c.driver).toBe("cursor");
    expect(c.workerId).toBe("w-1");
    expect(c.pollIntervalMs).toBe(3000);
    expect(c.cursorApiKey).toBe("key-abc");
    expect(c.modelId).toBe("gpt-4");
  });
});
