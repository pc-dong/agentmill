import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockDriver } from "@agentmill/agent";
import type { AgentDriver } from "@agentmill/agent";
import { executeClaimedJob } from "./executor.js";
import * as outcomes from "./outcomes.js";

const templatesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/agent/templates/ba",
);

/** Test doubles: vitest Mock parameter types are not assignable under strictFunctionTypes. */
type TestFn = (...args: any[]) => any;

function fakeClient(overrides: {
  completeJob?: TestFn;
  failJob?: TestFn;
  setJobProgress?: TestFn;
  listComments?: TestFn;
  listCards?: TestFn;
  moveCard?: TestFn;
  createCard?: TestFn;
  postComment?: TestFn;
  postTestResult?: TestFn;
  baSettle?: TestFn;
  getBoard?: TestFn;
  getCard?: TestFn;
  getEmployee?: TestFn;
} = {}): {
  completeJob: TestFn;
  failJob: TestFn;
  setJobProgress: TestFn;
  listComments: TestFn;
  listCards: TestFn;
  moveCard: TestFn;
  createCard: TestFn;
  postComment: TestFn;
  postTestResult: TestFn;
  baSettle: TestFn;
  getBoard: TestFn;
  getCard: TestFn;
  getEmployee: TestFn;
} {
  return {
    getBoard:
      overrides.getBoard ??
      (async () => ({ workspacePath: "/tmp/ws" })),
    getCard:
      overrides.getCard ??
      (async () => ({
        id: "c1",
        boardId: "b1",
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
    setJobProgress: overrides.setJobProgress ?? vi.fn(async () => {}),
    listComments: overrides.listComments ?? vi.fn(async () => []),
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

  it("wires oneshot onProgress to setJobProgress and writes phases", async () => {
    const setJobProgress = vi.fn(async (_jobId: string, _text: string) => {});
    const oneshot = vi.fn(async (input: { onProgress?: (m: string) => void }) => {
      input.onProgress?.("执行中：stream…");
      return {
        status: "ok" as const,
        summary: "ok\nARTIFACT file docs/x.md X",
        artifacts: [{ kind: "file" as const, href: "docs/x.md", label: "X" }],
      };
    });
    const driver: AgentDriver = {
      id: "spy",
      displayName: "Spy",
      oneshot,
      chatStream: async function* () {},
    };
    await executeClaimedJob(
      fakeClient({ setJobProgress }) as never,
      driver,
      job,
    );
    expect(setJobProgress.mock.calls.map((c) => c[1])).toEqual(
      expect.arrayContaining([
        "调用 Cursor，准备执行",
        "执行中：stream…",
        "写回结果…",
      ]),
    );
  });

  it("mention trigger injects user message and optional filtered history", async () => {
    const listComments = vi.fn(async () => [
      { id: "c0", author: "human", body: "先做登录" },
      {
        id: "c1",
        author: "Dev Bot",
        body: `${"x".repeat(300)}\nSUMMARY: done login`,
      },
      { id: "c2", author: "human", body: "@Dev Bot 当前分支是什么" },
    ]);
    const oneshot = vi.fn(async (_input: { prompt: string }) => ({
      status: "ok" as const,
      summary: "当前在 feat/foo",
      artifacts: [] as Array<{ kind: "file"; href: string; label?: string }>,
    }));
    const driver: AgentDriver = {
      id: "spy",
      displayName: "Spy",
      oneshot,
      chatStream: async function* () {},
    };
    await executeClaimedJob(
      fakeClient({ listComments }) as never,
      driver,
      {
        ...job,
        trigger: "mention",
        payload: JSON.stringify({
          mentionBody: "@Dev Bot 当前分支是什么",
          includeCommentHistory: true,
          triggerCommentId: "c2",
        }),
      },
    );
    expect(listComments).toHaveBeenCalledWith("c1");
    const prompt = oneshot.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain("Human mention (priority)");
    expect(prompt).toContain("@Dev Bot 当前分支是什么");
    expect(prompt).toContain("human: 先做登录");
    expect(prompt).toMatch(/SUMMARY: done login/);
  });

  it("fails the job when card belongs to a different board (workspace isolation)", async () => {
    const failJob = vi.fn(async (_jobId: string, _message?: string) => {});
    const completeJob = vi.fn(async () => {});
    const oneshot = vi.fn(async () => ({
      status: "ok" as const,
      summary: "should not run",
      artifacts: [],
    }));
    const client = fakeClient({
      failJob,
      completeJob,
      getCard: vi.fn(async () => ({
        id: "c1",
        boardId: "b-other",
        type: "task",
        title: "T",
        description: "",
        column: "dev",
        epicId: null,
        frozen: false,
        artifacts: [],
      })),
    });
    await executeClaimedJob(
      client as never,
      { id: "mock", displayName: "Mock", oneshot, chatStream: async function* () {} },
      job,
    );
    expect(failJob).toHaveBeenCalledOnce();
    expect(failJob.mock.calls[0]![1]).toMatch(/board mismatch/);
    expect(completeJob).not.toHaveBeenCalled();
    expect(oneshot).not.toHaveBeenCalled();
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

  it("calls applyRoleOutcome before completeJob for split role", async () => {
    const createCard = vi.fn(async () => ({}));
    const moveCard = vi.fn(async () => ({}));
    const completeJob = vi.fn(async () => {});
    const client = fakeClient({ createCard, moveCard, completeJob });
    client.getCard = async () => ({
      id: "design1",
      boardId: "b1",
      type: "design",
      title: "Design round",
      description: "",
      column: "design",
      epicId: "epic1",
      frozen: false,
      artifacts: [],
      requirementIds: ["r1"],
    });
    client.getEmployee = async () => ({
      id: "e-split",
      role: "split",
      displayName: "Split Bot",
    });
    client.listCards = async () => [
      {
        id: "design1",
        type: "design",
        epicId: "epic1",
        title: "Design round",
        requirementIds: ["r1"],
      },
      { id: "r1", type: "requirement", epicId: "epic1", title: "Req A" },
    ];

    const driver: AgentDriver = {
      id: "split",
      displayName: "Split",
      oneshot: async () => ({
        status: "ok",
        summary:
          "ARTIFACT file docs/superpowers/plans/p.md Plan\nTASK A | do a | plan:docs/superpowers/plans/p.md",
        artifacts: [
          { kind: "file", href: "docs/superpowers/plans/p.md", label: "Plan" },
        ],
      }),
      chatStream: async function* () {},
    };

    await executeClaimedJob(client as never, driver, job);
    expect(completeJob).toHaveBeenCalledOnce();
    expect(createCard).toHaveBeenCalledOnce();
    expect(moveCard).not.toHaveBeenCalled();
    expect(createCard.mock.invocationCallOrder[0]!).toBeLessThan(
      completeJob.mock.invocationCallOrder[0]!,
    );
  });

  it("calls failJob when applyRoleOutcome throws before completeJob", async () => {
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

    expect(completeJob).not.toHaveBeenCalled();
    expect(failJob).toHaveBeenCalledOnce();
    expect(failJob).toHaveBeenCalledWith("j1", "outcome boom");
  });

  describe("ba settle / deep_dive", () => {
    const prevTemplates = process.env.AM_BA_TEMPLATES;
    let workspacePath = "";

    afterEach(() => {
      if (prevTemplates === undefined) delete process.env.AM_BA_TEMPLATES;
      else process.env.AM_BA_TEMPLATES = prevTemplates;
      vi.restoreAllMocks();
    });

    it("settle writes docs, calls baSettle, completes without oneshot", async () => {
      workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-ba-exec-"));
      process.env.AM_BA_TEMPLATES = templatesDir;

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
          boardId: "b1",
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
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              href: "docs/epics/E-DEMO-001-login/EPIC.md",
            }),
            expect.objectContaining({
              href: "docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md",
            }),
          ]),
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
      const oneshot = vi.fn(async (input: { role: string; prompt: string }) => ({
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
          boardId: "b1",
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

      const transcript = "user: need SSO\n\nba: which IdP?";
      await executeClaimedJob(
        client as never,
        { id: "mock", displayName: "Mock", oneshot, chatStream: async function* () {} },
        {
          ...job,
          cardId: "req1",
          employeeId: "e-ba",
          trigger: "deep_dive",
          payload: transcript,
        },
      );

      expect(oneshot).toHaveBeenCalledOnce();
      expect(oneshot.mock.calls[0]![0].role).toBe("baDeepDive");
      expect(oneshot.mock.calls[0]![0].prompt).toContain(transcript);
      expect(baSettle).not.toHaveBeenCalled();
      expect(completeJob).toHaveBeenCalledOnce();
      expect(postComment).toHaveBeenCalledWith(
        "req1",
        "bot",
        expect.stringContaining("deep dive"),
      );
    });

    it("design deep_dive oneshots with design role not baDeepDive", async () => {
      const baSettle = vi.fn(async () => ({}));
      const completeJob = vi.fn(async () => {});
      const postComment = vi.fn(async () => {});
      const oneshot = vi.fn(async (input: { role: string; prompt: string }) => ({
        status: "ok" as const,
        summary: `design dive\nARTIFACT file docs/aiw/d.md D`,
        artifacts: [{ kind: "file" as const, href: "docs/aiw/d.md", label: "D" }],
      }));

      const client = fakeClient({
        baSettle,
        completeJob,
        postComment,
        getCard: vi.fn(async () => ({
          id: "design1",
          boardId: "b1",
          type: "design",
          title: "Design round",
          description: "",
          column: "design",
          epicId: "epic1",
          frozen: false,
          artifacts: [],
        })),
        getEmployee: vi.fn(async () => ({
          id: "e-design",
          role: "design",
          displayName: "Design Bot",
        })),
      });

      await executeClaimedJob(
        client as never,
        { id: "mock", displayName: "Mock", oneshot, chatStream: async function* () {} },
        {
          ...job,
          cardId: "design1",
          employeeId: "e-design",
          trigger: "deep_dive",
          payload: "user: need API design",
        },
      );

      expect(oneshot).toHaveBeenCalledOnce();
      expect(oneshot.mock.calls[0]![0].role).toBe("design");
      expect(oneshot.mock.calls[0]![0].prompt).toContain("user: need API design");
      expect(baSettle).not.toHaveBeenCalled();
      expect(completeJob).toHaveBeenCalledOnce();
      // design path is not BA — should not only postComment and skip outcomes
      // design outcome is no-op; postComment not required for design deep_dive
    });

    it("settle force-link fails when protocol epicId mismatches linked epic", async () => {
      workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-ba-exec-"));
      process.env.AM_BA_TEMPLATES = templatesDir;

      const baSettle = vi.fn(async () => ({}));
      const completeJob = vi.fn(async () => {});
      const failJob = vi.fn(async (_jobId: string, _message?: string) => {});
      const oneshot = vi.fn(async () => ({
        status: "ok" as const,
        summary: "should not run",
        artifacts: [],
      }));

      const payload = [
        "EPIC_MODE create",
        "EPIC_ID E-WRONG-999",
        "EPIC_SLUG wrong",
        "EPIC_TITLE Wrong theme",
        "PRD_ID P-999-01",
        "PRD_SLUG x",
        "PRD_TITLE X",
        "ARTIFACT file docs/epics/E-WRONG-999-wrong/EPIC.md Epic",
        "ARTIFACT file docs/epics/E-WRONG-999-wrong/shared-context.md Shared",
        "ARTIFACT file docs/epics/E-WRONG-999-wrong/prds/P-999-01-x.md PRD",
      ].join("\n");

      const getCard = vi.fn(async (_boardId: string, id: string) => {
        if (id === "epic1") {
          return {
            id: "epic1",
            boardId: "b1",
            type: "epic",
            title: "Login",
            description: "epic_id: E-DEMO-001\n",
            column: "requirements",
            epicId: null,
            frozen: false,
            artifacts: [],
          };
        }
        return {
          id: "req1",
          boardId: "b1",
          type: "requirement",
          title: "SSO",
          description: "",
          column: "requirements",
          epicId: "epic1",
          frozen: false,
          artifacts: [],
        };
      });

      const client = fakeClient({
        baSettle,
        completeJob,
        failJob,
        getCard,
        getBoard: vi.fn(async () => ({ workspacePath })),
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

      expect(failJob).toHaveBeenCalledOnce();
      expect(failJob.mock.calls[0]![1]).toMatch(/epicKey mismatch/);
      expect(baSettle).not.toHaveBeenCalled();
      expect(completeJob).not.toHaveBeenCalled();
      expect(oneshot).not.toHaveBeenCalled();
      expect(
        fs.existsSync(
          path.join(workspacePath, "docs/epics/E-WRONG-999-wrong/EPIC.md"),
        ),
      ).toBe(false);
    });
  });
});
