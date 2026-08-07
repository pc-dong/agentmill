import { describe, expect, it, vi } from "vitest";
import { MockDriver } from "@ai-workforce/agent";
import type { AgentDriver } from "@ai-workforce/agent";
import { executeClaimedJob } from "./executor.js";

function fakeClient(overrides: {
  completeJob?: ReturnType<typeof vi.fn>;
  failJob?: ReturnType<typeof vi.fn>;
  listCards?: ReturnType<typeof vi.fn>;
  moveCard?: ReturnType<typeof vi.fn>;
  createCard?: ReturnType<typeof vi.fn>;
  postComment?: ReturnType<typeof vi.fn>;
  postTestResult?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    getBoard: async () => ({ workspacePath: "/tmp/ws" }),
    getCard: async () => ({
      id: "c1",
      type: "epic",
      title: "T",
      description: "D",
      column: "design",
      epicId: null,
      frozen: false,
      artifacts: [],
    }),
    getEmployee: async () => ({
      id: "e1",
      role: "design",
      displayName: "Design Bot",
    }),
    listCards: overrides.listCards ?? vi.fn(async () => []),
    moveCard: overrides.moveCard ?? vi.fn(async () => ({})),
    createCard: overrides.createCard ?? vi.fn(async () => ({})),
    postComment: overrides.postComment ?? vi.fn(async () => {}),
    postTestResult: overrides.postTestResult ?? vi.fn(async () => {}),
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

  it("calls applyRoleOutcome after completeJob for split role", async () => {
    const createCard = vi.fn(async () => ({}));
    const moveCard = vi.fn(async () => ({}));
    const completeJob = vi.fn(async () => {});
    const client = fakeClient({ createCard, moveCard, completeJob });
    client.getCard = async () => ({
      id: "epic1",
      type: "epic",
      title: "Epic",
      description: "",
      column: "split",
      epicId: null,
      frozen: false,
      artifacts: [],
    });
    client.getEmployee = async () => ({
      id: "e-split",
      role: "split",
      displayName: "Split Bot",
    });
    client.listCards = async () => [
      { id: "r1", type: "requirement", epicId: "epic1", title: "Req A" },
    ];

    const driver: AgentDriver = {
      id: "split",
      displayName: "Split",
      oneshot: async () => ({
        status: "ok",
        summary: "TASK A | do a\nARTIFACT file x.md X",
        artifacts: [{ kind: "file", href: "x.md", label: "X" }],
      }),
      chatStream: async function* () {},
    };

    await executeClaimedJob(client as never, driver, job);
    expect(completeJob).toHaveBeenCalledOnce();
    expect(createCard).toHaveBeenCalledOnce();
    expect(moveCard).toHaveBeenCalledWith("epic1", "verify", "bot");
  });
});
