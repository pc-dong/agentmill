import { describe, expect, it, vi } from "vitest";
import { MockDriver } from "@ai-workforce/agent";
import type { AgentDriver } from "@ai-workforce/agent";
import { executeClaimedJob } from "./executor.js";

function fakeClient(overrides: {
  completeJob?: ReturnType<typeof vi.fn>;
  failJob?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    getBoard: async () => ({ workspacePath: "/tmp/ws" }),
    getCard: async () => ({
      id: "c1",
      title: "T",
      description: "D",
      column: "design",
      frozen: false,
      artifacts: [],
    }),
    getEmployee: async () => ({
      id: "e1",
      role: "design",
      displayName: "Design Bot",
    }),
    completeJob: overrides.completeJob ?? vi.fn(async () => {}),
    failJob: overrides.failJob ?? vi.fn(async () => {}),
  };
}

const job = {
  id: "j1",
  cardId: "c1",
  employeeId: "e1",
  boardId: "b1",
};

describe("executeClaimedJob", () => {
  it("completes with artifacts from mock driver", async () => {
    const completeJob = vi.fn(async (_jobId: string, _body: { artifacts: unknown[] }) => {});
    const client = fakeClient({ completeJob });
    await executeClaimedJob(client as never, new MockDriver(), job);
    expect(completeJob).toHaveBeenCalledOnce();
    const body = completeJob.mock.calls[0]![1];
    expect(body.artifacts.length).toBeGreaterThan(0);
  });

  it("calls failJob when driver returns error status", async () => {
    const failJob = vi.fn(async () => {});
    const driver: AgentDriver = {
      id: "err",
      displayName: "Error Driver",
      oneshot: async () => ({
        status: "error",
        summary: "agent failed",
        artifacts: [],
      }),
      chatStream: async function* () {},
    };
    await executeClaimedJob(fakeClient({ failJob }) as never, driver, job);
    expect(failJob).toHaveBeenCalledOnce();
    expect(failJob).toHaveBeenCalledWith("j1", "agent failed");
  });
});
