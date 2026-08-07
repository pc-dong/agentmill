import { describe, expect, it } from "vitest";
import { parseArtifactHints } from "./parse.js";
import { parseOutcome } from "./parseOutcome.js";
import { MockDriver } from "./mock.js";
import type { AgentEvent } from "./types.js";

async function collectEvents(
  stream: AsyncIterable<AgentEvent>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("MockDriver", () => {
  it("returns canned summary and parsed artifacts", async () => {
    const d = new MockDriver();
    const result = await d.oneshot({
      workspacePath: "/tmp/ws",
      prompt: "design please",
      role: "design",
      cardId: "c1",
      boardId: "b1",
    });
    expect(result.status).toBe("ok");
    expect(result.artifacts.some((a) => a.kind === "file")).toBe(true);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("returns role-aware outcome lines for split/verify/test", async () => {
    const d = new MockDriver();
    const split = await d.oneshot({
      workspacePath: "/tmp/ws",
      prompt: "split",
      role: "split",
      cardId: "e1",
      boardId: "b1",
    });
    expect(parseOutcome(split.summary).tasks).toHaveLength(2);

    const verify = await d.oneshot({
      workspacePath: "/tmp/ws",
      prompt: "verify",
      role: "verify",
      cardId: "e1",
      boardId: "b1",
    });
    expect(parseOutcome(verify.summary).verify).toBe("pass");

    const test = await d.oneshot({
      workspacePath: "/tmp/ws",
      prompt: "test",
      role: "test",
      cardId: "t1",
      boardId: "b1",
    });
    expect(parseOutcome(test.summary).test).toBe("pass");
  });

  it("chatStream yields text_delta chunks then done with artifact", async () => {
    const d = new MockDriver();
    const events = await collectEvents(
      d.chatStream({
        workspacePath: "/tmp/ws",
        role: "design",
        cardId: "c1",
        boardId: "b1",
        history: [{ role: "user", content: "hi" }],
        message: "tell me more",
      }),
    );

    expect(events.filter((e) => e.type === "text_delta").length).toBeGreaterThan(
      0,
    );
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done?.type === "done" && done.summary).toContain(
      "ARTIFACT file docs/aiw/chat-mock.md",
    );
    expect(
      parseArtifactHints(
        done?.type === "done" ? done.summary : "",
      ).some((a) => a.href === "docs/aiw/chat-mock.md"),
    ).toBe(true);
  });
});
