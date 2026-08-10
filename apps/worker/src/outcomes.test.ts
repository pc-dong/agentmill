import { describe, expect, it, vi } from "vitest";
import { applyRoleOutcome, type OutcomeBoardClient } from "./outcomes.js";

function fakeClient(
  overrides: Partial<OutcomeBoardClient> = {},
): OutcomeBoardClient & {
  createCard: ReturnType<typeof vi.fn>;
  moveCard: ReturnType<typeof vi.fn>;
  updateCard: ReturnType<typeof vi.fn>;
  listCards: ReturnType<typeof vi.fn>;
  postTestResult: ReturnType<typeof vi.fn>;
  postComment: ReturnType<typeof vi.fn>;
} {
  return {
    createCard: overrides.createCard ?? vi.fn(async () => ({ id: "new" })),
    moveCard: overrides.moveCard ?? vi.fn(async () => ({ id: "moved" })),
    updateCard: overrides.updateCard ?? vi.fn(async () => ({})),
    listCards: overrides.listCards ?? vi.fn(async () => []),
    postTestResult: overrides.postTestResult ?? vi.fn(async () => {}),
    postComment: overrides.postComment ?? vi.fn(async () => {}),
  };
}

const designCtx = {
  cardId: "design1",
  cardType: "design",
  cardColumn: "design",
  epicId: "epic1",
  artifacts: [] as Array<{ kind: string; href: string; label?: string }>,
};

const taskCtx = {
  cardId: "task1",
  cardType: "task",
  cardColumn: "dev",
  epicId: "epic1",
  artifacts: [] as Array<{ kind: string; href: string; label?: string }>,
};

describe("applyRoleOutcome", () => {
  it("design does nothing", async () => {
    const client = fakeClient();
    await applyRoleOutcome("design", "ARTIFACT file x.md X", designCtx, client);
    expect(client.createCard).not.toHaveBeenCalled();
    expect(client.moveCard).not.toHaveBeenCalled();
  });

  describe("split", () => {
    it("creates frozen task cards linked to design and plan", async () => {
      const client = fakeClient();
      await applyRoleOutcome(
        "split",
        [
          "ARTIFACT file docs/superpowers/plans/2026-08-07-login.md Plan",
          "TASK Login API | oauth | plan:docs/superpowers/plans/2026-08-07-login.md",
          "TASK UI | forms",
        ].join("\n"),
        designCtx,
        client,
      );
      expect(client.createCard).toHaveBeenCalledTimes(2);
      expect(client.createCard).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "task",
          title: "Login API",
          column: "dev",
          epicId: "epic1",
          designId: "design1",
          frozen: true,
        }),
      );
      expect(client.moveCard).not.toHaveBeenCalled();
      expect(client.postComment).toHaveBeenCalledWith(
        "design1",
        "bot",
        expect.stringMatching(/Split created 2/),
      );
    });

    it("warns when design not in design column", async () => {
      const client = fakeClient();
      await applyRoleOutcome(
        "split",
        "TASK A | a",
        { ...designCtx, cardColumn: "done" },
        client,
      );
      expect(client.createCard).not.toHaveBeenCalled();
      expect(client.postComment).toHaveBeenCalledWith(
        "design1",
        "bot",
        expect.stringMatching(/design column/i),
      );
    });
  });

  describe("verify", () => {
    it("unfreezes related tasks on pass", async () => {
      const client = fakeClient({
        listCards: vi.fn(async () => [
          {
            id: "t1",
            type: "task",
            designId: "design1",
            column: "dev",
            frozen: true,
          },
          {
            id: "t2",
            type: "task",
            designId: "other",
            column: "dev",
            frozen: true,
          },
        ]),
      });
      await applyRoleOutcome("verify", "VERIFY pass", designCtx, client);
      expect(client.updateCard).toHaveBeenCalledWith("t1", { frozen: false });
      expect(client.updateCard).not.toHaveBeenCalledWith("t2", expect.anything());
    });

    it("comments on fail without unfreeze", async () => {
      const client = fakeClient();
      await applyRoleOutcome("verify", "VERIFY fail\ngap: auth", designCtx, client);
      expect(client.updateCard).not.toHaveBeenCalled();
      expect(client.postComment).toHaveBeenCalledWith(
        "design1",
        "bot",
        expect.stringMatching(/VERIFY fail/),
      );
    });
  });

  describe("dev", () => {
    it("moves to test when summary present", async () => {
      const client = fakeClient();
      await applyRoleOutcome("dev", "done", taskCtx, client);
      expect(client.moveCard).toHaveBeenCalledWith("task1", "test", "bot");
    });
  });

  describe("test", () => {
    it("posts pass", async () => {
      const client = fakeClient();
      await applyRoleOutcome("test", "TEST pass", taskCtx, client);
      expect(client.postTestResult).toHaveBeenCalledWith("task1", true);
    });
  });

  describe("review", () => {
    it("comments complete", async () => {
      const client = fakeClient();
      await applyRoleOutcome("review", "ok", taskCtx, client);
      expect(client.postComment).toHaveBeenCalledWith(
        "task1",
        "bot",
        "Review complete",
      );
    });
  });
});
