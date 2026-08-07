import { describe, expect, it, vi } from "vitest";
import { applyRoleOutcome, type OutcomeBoardClient } from "./outcomes.js";

function fakeClient(
  overrides: Partial<OutcomeBoardClient> = {},
): OutcomeBoardClient & {
  createCard: ReturnType<typeof vi.fn>;
  moveCard: ReturnType<typeof vi.fn>;
  postTestResult: ReturnType<typeof vi.fn>;
  postComment: ReturnType<typeof vi.fn>;
} {
  return {
    createCard: overrides.createCard ?? vi.fn(async () => ({ id: "new" })),
    moveCard: overrides.moveCard ?? vi.fn(async () => ({ id: "moved" })),
    postTestResult: overrides.postTestResult ?? vi.fn(async () => {}),
    postComment: overrides.postComment ?? vi.fn(async () => {}),
  };
}

const epicCtx = {
  cardId: "epic1",
  cardType: "epic",
  cardColumn: "split",
  epicId: null,
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
    await applyRoleOutcome("design", "ARTIFACT file x.md X", epicCtx, client);
    expect(client.createCard).not.toHaveBeenCalled();
    expect(client.moveCard).not.toHaveBeenCalled();
    expect(client.postComment).not.toHaveBeenCalled();
  });

  describe("split", () => {
    it("creates task cards in dev and moves epic to verify", async () => {
      const client = fakeClient();
      await applyRoleOutcome(
        "split",
        "TASK Login API | oauth\nTASK UI | forms",
        epicCtx,
        client,
      );
      expect(client.createCard).toHaveBeenCalledTimes(2);
      expect(client.createCard).toHaveBeenCalledWith({
        type: "task",
        title: "Login API",
        description: "oauth",
        column: "dev",
        epicId: "epic1",
      });
      expect(client.createCard).toHaveBeenCalledWith({
        type: "task",
        title: "UI",
        description: "forms",
        column: "dev",
        epicId: "epic1",
      });
      expect(client.moveCard).toHaveBeenCalledWith("epic1", "verify", "bot");
    });

    it("comments error when move to verify fails", async () => {
      const client = fakeClient({
        moveCard: vi.fn(async () => {
          throw new Error("gate blocked");
        }),
      });
      await applyRoleOutcome("split", "TASK A | a", epicCtx, client);
      expect(client.postComment).toHaveBeenCalledWith(
        "epic1",
        "bot",
        expect.stringMatching(/move epic to verify/i),
      );
    });

    it("skips task creation and move when epic not in split column", async () => {
      const client = fakeClient();
      await applyRoleOutcome(
        "split",
        "TASK A | a",
        { ...epicCtx, cardColumn: "verify" },
        client,
      );
      expect(client.createCard).not.toHaveBeenCalled();
      expect(client.moveCard).not.toHaveBeenCalled();
      expect(client.postComment).toHaveBeenCalledWith(
        "epic1",
        "bot",
        expect.stringMatching(/epic in split column/i),
      );
    });
  });

  describe("verify", () => {
    it("comments coverage ok on pass", async () => {
      const client = fakeClient();
      await applyRoleOutcome("verify", "VERIFY pass", epicCtx, client);
      expect(client.postComment).toHaveBeenCalledWith(
        "epic1",
        "bot",
        "coverage ok",
      );
      expect(client.moveCard).not.toHaveBeenCalled();
    });

    it("moves epic to split on fail", async () => {
      const client = fakeClient();
      await applyRoleOutcome("verify", "VERIFY fail", epicCtx, client);
      expect(client.moveCard).toHaveBeenCalledWith("epic1", "split", "bot");
      expect(client.postComment).toHaveBeenCalledWith(
        "epic1",
        "bot",
        expect.stringMatching(/verify fail/i),
      );
    });

    it("warns when VERIFY line missing", async () => {
      const client = fakeClient();
      await applyRoleOutcome("verify", "no outcome line", epicCtx, client);
      expect(client.postComment).toHaveBeenCalledWith(
        "epic1",
        "bot",
        expect.stringMatching(/missing VERIFY/i),
      );
      expect(client.moveCard).not.toHaveBeenCalled();
    });
  });

  describe("dev", () => {
    it("moves task to test when pr artifact present", async () => {
      const client = fakeClient();
      await applyRoleOutcome(
        "dev",
        "done",
        {
          ...taskCtx,
          artifacts: [{ kind: "pr", href: "https://example.com/pr/1" }],
        },
        client,
      );
      expect(client.moveCard).toHaveBeenCalledWith("task1", "test", "bot");
    });

    it("moves task to test on successful summary without pr", async () => {
      const client = fakeClient();
      await applyRoleOutcome("dev", "implementation complete", taskCtx, client);
      expect(client.moveCard).toHaveBeenCalledWith("task1", "test", "bot");
    });

    it("does not move when summary empty and no pr artifact", async () => {
      const client = fakeClient();
      await applyRoleOutcome("dev", "   ", taskCtx, client);
      expect(client.moveCard).not.toHaveBeenCalled();
      expect(client.postComment).not.toHaveBeenCalled();
    });
  });

  describe("test", () => {
    it("posts pass result", async () => {
      const client = fakeClient();
      await applyRoleOutcome(
        "test",
        "TEST pass",
        { ...taskCtx, cardColumn: "test" },
        client,
      );
      expect(client.postTestResult).toHaveBeenCalledWith("task1", true);
    });

    it("posts fail result", async () => {
      const client = fakeClient();
      await applyRoleOutcome(
        "test",
        "TEST fail",
        { ...taskCtx, cardColumn: "test" },
        client,
      );
      expect(client.postTestResult).toHaveBeenCalledWith("task1", false);
    });

    it("warns when TEST line missing", async () => {
      const client = fakeClient();
      await applyRoleOutcome(
        "test",
        "ran tests",
        { ...taskCtx, cardColumn: "test" },
        client,
      );
      expect(client.postTestResult).not.toHaveBeenCalled();
      expect(client.postComment).toHaveBeenCalledWith(
        "task1",
        "bot",
        expect.stringMatching(/missing TEST/i),
      );
    });
  });

  describe("review", () => {
    it("comments only, never moves", async () => {
      const client = fakeClient();
      await applyRoleOutcome(
        "review",
        "looks good",
        { ...taskCtx, cardColumn: "accept" },
        client,
      );
      expect(client.moveCard).not.toHaveBeenCalled();
      expect(client.postTestResult).not.toHaveBeenCalled();
      expect(client.postComment).toHaveBeenCalledWith(
        "task1",
        "bot",
        expect.stringMatching(/review/i),
      );
    });
  });
});
