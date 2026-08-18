import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DshDriver, DSH_DEFAULT_MODEL } from "./dsh.js";

const STUB = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../test-fixtures/dsh-stub.cjs",
);

const workspaces: string[] = [];

function tempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-dsh-ws-"));
  workspaces.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env.DSH_STUB_MODE;
  delete process.env.DSH_STUB_OUT;
  for (const d of workspaces) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  workspaces.length = 0;
});

/** Extract the stub's JSON info line from a summary. */
function stubInfo(summary: string): Record<string, unknown> {
  const line = summary.split("\n").find((l) => l.startsWith("{"));
  if (!line) throw new Error(`stub info line missing in: ${summary}`);
  return JSON.parse(line) as Record<string, unknown>;
}

describe("DshDriver", () => {
  it("oneshot returns stdout as summary and parses artifact hints", async () => {
    const ws = tempWorkspace();
    process.env.DSH_STUB_MODE = "ok";
    process.env.DSH_STUB_OUT = "Mock dsh reply\nARTIFACT file docs/x.md X";
    const d = new DshDriver({ dshBin: STUB, timeoutMs: 30_000 });
    const r = await d.oneshot({
      workspacePath: ws,
      prompt: "do the thing",
      role: "dev",
      cardId: "c1",
      boardId: "b1",
    });
    expect(r.status).toBe("ok");
    expect(r.summary).toContain("Mock dsh reply");
    expect(r.artifacts).toEqual([
      { kind: "file", href: "docs/x.md", label: "X" },
    ]);
  });

  it("oneshot invokes --profile headless with the prompt as positional arg, cwd = workspace", async () => {
    const ws = tempWorkspace();
    process.env.DSH_STUB_MODE = "ok";
    const d = new DshDriver({ dshBin: STUB, timeoutMs: 30_000 });
    const r = await d.oneshot({
      workspacePath: ws,
      prompt: "PROMPT-MARKER",
      role: "dev",
      cardId: "c1",
      boardId: "b1",
    });
    expect(r.status).toBe("ok");
    const info = stubInfo(r.summary) as {
      profile: string;
      task: string;
      cwd: string;
    };
    expect(info.profile).toBe("headless");
    expect(info.task).toContain("PROMPT-MARKER");
    expect(info.cwd).toBe(fs.realpathSync(ws));
    // Workspace boundary rules prefix the prompt.
    expect(info.task).toMatch(/Workspace root \(absolute\)/);
  });

  it("default model omits --patch; custom model writes an agent-default-model overlay", async () => {
    const ws = tempWorkspace();
    process.env.DSH_STUB_MODE = "ok";

    const noPatch = new DshDriver({
      dshBin: STUB,
      modelId: DSH_DEFAULT_MODEL,
      timeoutMs: 30_000,
    });
    const r1 = await noPatch.oneshot({
      workspacePath: ws,
      prompt: "p",
      role: "dev",
      cardId: "c1",
      boardId: "b1",
    });
    expect(stubInfo(r1.summary).patch).toBeNull();

    const withPatch = new DshDriver({
      dshBin: STUB,
      modelId: "deepseek-v4-pro",
      timeoutMs: 30_000,
    });
    const r2 = await withPatch.oneshot({
      workspacePath: ws,
      prompt: "p",
      role: "dev",
      cardId: "c1",
      boardId: "b1",
    });
    const patch = stubInfo(r2.summary).patch as string;
    expect(patch).toContain("id: agent-default-model");
    expect(patch).toContain("model: deepseek-v4-pro");
    expect(patch).toContain("provider: deepseek-official");
  });

  it("'provider/model' syntax selects another provider route", async () => {
    const ws = tempWorkspace();
    process.env.DSH_STUB_MODE = "ok";
    const d = new DshDriver({
      dshBin: STUB,
      modelId: "openai/gpt-5",
      timeoutMs: 30_000,
    });
    const r = await d.oneshot({
      workspacePath: ws,
      prompt: "p",
      role: "dev",
      cardId: "c1",
      boardId: "b1",
    });
    expect(r.status).toBe("ok");
    const patch = stubInfo(r.summary).patch as string;
    expect(patch).toContain("provider: openai");
    expect(patch).toContain("model: gpt-5");
  });

  it("oneshot maps non-zero exit to error status with stderr detail", async () => {
    const ws = tempWorkspace();
    process.env.DSH_STUB_MODE = "fail";
    const d = new DshDriver({ dshBin: STUB, timeoutMs: 30_000 });
    const r = await d.oneshot({
      workspacePath: ws,
      prompt: "p",
      role: "dev",
      cardId: "c1",
      boardId: "b1",
    });
    expect(r.status).toBe("error");
    expect(r.summary).toMatch(/code 1/);
    expect(r.summary).toMatch(/stub failure/);
  });

  it("oneshot treats empty stdout as error", async () => {
    const ws = tempWorkspace();
    process.env.DSH_STUB_MODE = "empty";
    const d = new DshDriver({ dshBin: STUB, timeoutMs: 30_000 });
    const r = await d.oneshot({
      workspacePath: ws,
      prompt: "p",
      role: "dev",
      cardId: "c1",
      boardId: "b1",
    });
    expect(r.status).toBe("error");
    expect(r.summary).toMatch(/empty/i);
  });

  it("oneshot kills the process on timeout", async () => {
    const ws = tempWorkspace();
    process.env.DSH_STUB_MODE = "hang";
    const d = new DshDriver({ dshBin: STUB, timeoutMs: 300 });
    const r = await d.oneshot({
      workspacePath: ws,
      prompt: "p",
      role: "dev",
      cardId: "c1",
      boardId: "b1",
    });
    expect(r.status).toBe("error");
    expect(r.summary).toMatch(/timed out/i);
  }, 10_000);

  it("chatStream emits one delta then done with the full text", async () => {
    const ws = tempWorkspace();
    process.env.DSH_STUB_MODE = "ok";
    process.env.DSH_STUB_OUT = "chat reply body";
    const d = new DshDriver({ dshBin: STUB, timeoutMs: 30_000 });
    const events: unknown[] = [];
    for await (const ev of d.chatStream({
      workspacePath: ws,
      role: "ba",
      cardId: "c1",
      boardId: "b1",
      history: [{ role: "user", content: "earlier" }],
      message: "hello there",
    })) {
      events.push(ev);
    }
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toEqual(["text_delta", "done"]);
    const info = stubInfo((events[1] as { summary: string }).summary) as {
      task: string;
    };
    // Chat prompt composes role + history + message.
    expect(info.task).toContain("hello there");
    expect(info.task).toContain("earlier");
  });

  it("chatStream aborts the child and reports interrupted", async () => {
    const ws = tempWorkspace();
    process.env.DSH_STUB_MODE = "hang";
    const d = new DshDriver({ dshBin: STUB, timeoutMs: 0 });
    const controller = new AbortController();
    const events: unknown[] = [];
    const stream = d.chatStream({
      workspacePath: ws,
      role: "ba",
      cardId: "c1",
      boardId: "b1",
      history: [],
      message: "hello",
      signal: controller.signal,
    });
    const consuming = (async () => {
      for await (const ev of stream) events.push(ev);
    })();
    await new Promise((r) => setTimeout(r, 200));
    controller.abort();
    await consuming;
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toEqual(["done"]);
    expect((events[0] as { summary: string }).summary).toBe("*(已打断)*");
  }, 10_000);

  it("chatStream surfaces non-zero exit as error", async () => {
    const ws = tempWorkspace();
    process.env.DSH_STUB_MODE = "fail";
    const d = new DshDriver({ dshBin: STUB, timeoutMs: 30_000 });
    const events: unknown[] = [];
    for await (const ev of d.chatStream({
      workspacePath: ws,
      role: "ba",
      cardId: "c1",
      boardId: "b1",
      history: [],
      message: "hello",
    })) {
      events.push(ev);
    }
    expect((events[0] as { type: string }).type).toBe("error");
    expect((events[0] as { message: string }).message).toMatch(/code 1/);
  });
});
