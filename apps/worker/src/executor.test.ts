import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockDriver } from "@ai-workforce/agent";
import type { AgentDriver } from "@ai-workforce/agent";
import { executeClaimedJob } from "./executor.js";
import * as outcomes from "./outcomes.js";

const templatesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/agent/templates/ba",
);

function fakeClient(overrides: {
  completeJob?: ReturnType<typeof vi.fn>;
  failJob?: ReturnType<typeof vi.fn>;
  listCards?: ReturnType<typeof vi.fn>;
  moveCard?: ReturnType<typeof vi.fn>;
  createCard?: ReturnType<typeof vi.fn>;
  postComment?: ReturnType<typeof vi.fn>;
  postTestResult?: ReturnType<typeof vi.fn>;
  baSettle?: ReturnType<typeof vi.fn>;
  getBoard?: ReturnType<typeof vi.fn>;
  getCard?: ReturnType<typeof vi.fn>;
  getEmployee?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    getBoard:
      overrides.getBoard ??
      (async () => ({ workspacePath: "/tmp/ws" })),
    getCard:
      overrides.getCard ??
      (async () => ({
        id: "c1",
        type: "epic",
        title: "T",
        description: "D",
        column: "design",
        epicId: null,
        frozen: false,
        artifacts: [],
      })),
    getEmployee:
      overrides.getEmployee ??
      (async () => ({
        id: "e1",
        role: "design",
        displayName: "Design Bot",
      })),
    listCards: overrides.listCards ?? vi.fn(async () => []),
    moveCard: overrides.moveCard ?? vi.fn(async () => ({})),
    createCard: overrides.createCard ?? vi.fn(async () => ({})),
    postComment: overrides.postComment ?? vi.fn(async () => {}),
    postTestResult: overrides.postTestResult ?? vi.fn(async () => {}),
    completeJob: overrides.completeJob ?? vi.fn(async () => {}),
    failJob: overrides.failJob ?? vi.fn(async () => {}),
    baSettle: overrides.baSettle ?? vi.fn(async () => ({})),
  };
}

const job = {
  id: "j1",
  cardId: "c1",
  employeeId: "e1",
  boardId: "b1",
  trigger: "poll",
  payload: null as string | null,
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

  it("does not failJob when applyRoleOutcome throws after completeJob", async () => {
    const completeJob = vi.fn(async () => {});
    const failJob = vi.fn(async () => {});
    const postComment = vi.fn(async () => {});
    vi.spyOn(outcomes, "applyRoleOutcome").mockRejectedValueOnce(
      new Error("outcome boom"),
    );

    await executeClaimedJob(
      fakeClient({ completeJob, failJob, postComment }) as never,
      new MockDriver(),
      job,
    );

    expect(completeJob).toHaveBeenCalledOnce();
    expect(failJob).not.toHaveBeenCalled();
    expect(postComment).toHaveBeenCalledWith(
      "c1",
      "bot",
      "Warning: role outcome failed after job completed: outcome boom",
    );
  });

  describe("ba settle / deep_dive", () => {
    const prevTemplates = process.env.AIW_BA_TEMPLATES;
    let workspacePath = "";

    afterEach(() => {
      if (prevTemplates === undefined) delete process.env.AIW_BA_TEMPLATES;
      else process.env.AIW_BA_TEMPLATES = prevTemplates;
      vi.restoreAllMocks();
    });

    it("settle writes docs, calls baSettle, completes without oneshot", async () => {
      workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-ba-exec-"));
      process.env.AIW_BA_TEMPLATES = templatesDir;

      const baSettle = vi.fn(async () => ({}));
      const completeJob = vi.fn(async () => {});
      const failJob = vi.fn(async () => {});
      const oneshot = vi.fn(async () => ({
        status: "ok" as const,
        summary: "should not run",
        artifacts: [],
      }));

      const payload = [
        "Conversation residue about OAuth.",
        "EPIC_MODE create",
        "EPIC_ID E-DEMO-001",
        "EPIC_SLUG login",
        "EPIC_TITLE Login theme",
        "PRD_ID P-001-01",
        "PRD_SLUG oauth",
        "PRD_TITLE OAuth login",
        "ARTIFACT file docs/epics/E-DEMO-001-login/EPIC.md Epic",
        "ARTIFACT file docs/epics/E-DEMO-001-login/shared-context.md Shared",
        "ARTIFACT file docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md PRD",
      ].join("\n");

      const client = fakeClient({
        baSettle,
        completeJob,
        failJob,
        getBoard: vi.fn(async () => ({ workspacePath })),
        getCard: vi.fn(async () => ({
          id: "req1",
          type: "requirement",
          title: "OAuth",
          description: "",
          column: "requirements",
          epicId: null,
          frozen: false,
          artifacts: [],
        })),
        getEmployee: vi.fn(async () => ({
          id: "e-ba",
          role: "ba",
          displayName: "BA Bot",
        })),
      });

      await executeClaimedJob(
        client as never,
        { id: "mock", displayName: "Mock", oneshot, chatStream: async function* () {} },
        {
          ...job,
          cardId: "req1",
          employeeId: "e-ba",
          trigger: "settle",
          payload,
        },
      );

      expect(oneshot).not.toHaveBeenCalled();
      expect(baSettle).toHaveBeenCalledOnce();
      expect(baSettle).toHaveBeenCalledWith(
        "req1",
        expect.objectContaining({
          mode: "create",
          epicKey: "E-DEMO-001",
          epicTitle: "Login theme",
          epicSlug: "login",
        }),
      );
      expect(completeJob).toHaveBeenCalledOnce();
      expect(failJob).not.toHaveBeenCalled();
      expect(
        fs.existsSync(
          path.join(workspacePath, "docs/epics/E-DEMO-001-login/EPIC.md"),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(
            workspacePath,
            "docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md",
          ),
        ),
      ).toBe(true);
    });

    it("deep_dive oneshots with baDeepDive and does not baSettle", async () => {
      const baSettle = vi.fn(async () => ({}));
      const completeJob = vi.fn(async () => {});
      const postComment = vi.fn(async () => {});
      const oneshot = vi.fn(async (input: { role: string }) => ({
        status: "ok" as const,
        summary: `Mock ${input.role} deep dive\nARTIFACT file docs/aiw/x.md X`,
        artifacts: [{ kind: "file" as const, href: "docs/aiw/x.md", label: "X" }],
      }));

      const client = fakeClient({
        baSettle,
        completeJob,
        postComment,
        getCard: vi.fn(async () => ({
          id: "req1",
          type: "requirement",
          title: "OAuth",
          description: "",
          column: "requirements",
          epicId: null,
          frozen: false,
          artifacts: [],
        })),
        getEmployee: vi.fn(async () => ({
          id: "e-ba",
          role: "ba",
          displayName: "BA Bot",
        })),
      });

      await executeClaimedJob(
        client as never,
        { id: "mock", displayName: "Mock", oneshot, chatStream: async function* () {} },
        {
          ...job,
          cardId: "req1",
          employeeId: "e-ba",
          trigger: "deep_dive",
          payload: "please deep dive",
        },
      );

      expect(oneshot).toHaveBeenCalledOnce();
      expect(oneshot.mock.calls[0]![0].role).toBe("baDeepDive");
      expect(baSettle).not.toHaveBeenCalled();
      expect(completeJob).toHaveBeenCalledOnce();
      expect(postComment).toHaveBeenCalledWith(
        "req1",
        "bot",
        expect.stringContaining("deep dive"),
      );
    });
  });
});
