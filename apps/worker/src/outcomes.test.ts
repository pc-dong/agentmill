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
  markDesignSplitVerified: ReturnType<typeof vi.fn>;
  markDesignSplitDirty: ReturnType<typeof vi.fn>;
} {
  return {
    createCard: overrides.createCard ?? vi.fn(async () => ({ id: "new" })),
    moveCard: overrides.moveCard ?? vi.fn(async () => ({ id: "moved" })),
    updateCard: overrides.updateCard ?? vi.fn(async () => ({})),
    listCards: overrides.listCards ?? vi.fn(async () => []),
    postTestResult: overrides.postTestResult ?? vi.fn(async () => {}),
    postComment: overrides.postComment ?? vi.fn(async () => {}),
    markDesignSplitVerified:
      overrides.markDesignSplitVerified ?? vi.fn(async () => {}),
    markDesignSplitDirty:
      overrides.markDesignSplitDirty ?? vi.fn(async () => {}),
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
          column: "design",
          epicId: "epic1",
          designId: "design1",
          frozen: true,
        }),
      );
      expect(client.moveCard).not.toHaveBeenCalled();
      expect(client.markDesignSplitDirty).toHaveBeenCalledWith("design1");
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
    it("verify pass unfreezes design-column tasks and marks verified", async () => {
      const updateCard = vi.fn(async () => ({}));
      const client = fakeClient({
        listCards: vi.fn(async () => [
          {
            id: "t1",
            type: "task",
            designId: "design1",
            frozen: true,
            column: "design",
          },
          {
            id: "t2",
            type: "task",
            designId: "design1",
            frozen: true,
            column: "dev",
          },
        ]),
        updateCard,
        markDesignSplitVerified: vi.fn(async () => {}),
      });
      await applyRoleOutcome("verify", "VERIFY pass", designCtx, client);
      expect(updateCard).toHaveBeenCalledWith("t1", { frozen: false });
      expect(updateCard).not.toHaveBeenCalledWith("t2", expect.anything());
      expect(client.markDesignSplitVerified).toHaveBeenCalledWith("design1");
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

    it("verify pass marks verified even without listCards/updateCard", async () => {
      const markDesignSplitVerified = vi.fn(async () => {});
      const client = fakeClient({
        listCards: undefined,
        updateCard: undefined,
        markDesignSplitVerified,
      });
      await applyRoleOutcome("verify", "VERIFY pass", designCtx, client);
      expect(markDesignSplitVerified).toHaveBeenCalledWith("design1");
    });
  });

  describe("re-split", () => {
    it("second split appends tasks and marks dirty again without wiping prior creates", async () => {
      const client = fakeClient();
      const firstSplit = [
        "TASK Login API | oauth",
        "TASK UI | forms",
      ].join("\n");
      await applyRoleOutcome("split", firstSplit, designCtx, client);
      expect(client.createCard).toHaveBeenCalledTimes(2);
      expect(client.markDesignSplitDirty).toHaveBeenCalledTimes(1);

      await applyRoleOutcome("verify", "VERIFY pass", designCtx, client);
      expect(client.markDesignSplitVerified).toHaveBeenCalledWith("design1");

      client.markDesignSplitDirty.mockClear();

      const secondSplit = "TASK Auth refresh | token rotation";
      await applyRoleOutcome("split", secondSplit, designCtx, client);
      expect(client.createCard).toHaveBeenCalledTimes(3);
      expect(client.markDesignSplitDirty).toHaveBeenCalledTimes(1);
      expect(client.markDesignSplitDirty).toHaveBeenCalledWith("design1");
    });
  });

  describe("dev", () => {
    it("moves to test and posts 实现总结 when SUMMARY present", async () => {
      const client = fakeClient();
      await applyRoleOutcome(
        "dev",
        "SUMMARY: implemented oauth\nARTIFACT pr https://example.com/pr/1",
        taskCtx,
        client,
      );
      expect(client.postComment).toHaveBeenCalledWith(
        "task1",
        "bot",
        "实现总结\nimplemented oauth",
      );
      expect(client.moveCard).toHaveBeenCalledWith("task1", "test", "bot");
    });

    it("warns, throws, and does not move without SUMMARY", async () => {
      const client = fakeClient();
      await expect(
        applyRoleOutcome("dev", "done", taskCtx, client),
      ).rejects.toThrow(/missing SUMMARY/i);
      expect(client.postComment).toHaveBeenCalledWith(
        "task1",
        "bot",
        "Warning: missing SUMMARY: line; not moving to test",
      );
      expect(client.moveCard).not.toHaveBeenCalled();
    });

    it("does not move with PR alone without SUMMARY", async () => {
      const client = fakeClient();
      await expect(
        applyRoleOutcome(
          "dev",
          "ARTIFACT pr https://example.com/pr/1 PR",
          {
            ...taskCtx,
            artifacts: [{ kind: "pr", href: "https://example.com/pr/1" }],
          },
          client,
        ),
      ).rejects.toThrow(/missing SUMMARY/i);
      expect(client.postComment).toHaveBeenCalledWith(
        "task1",
        "bot",
        "Warning: missing SUMMARY: line; not moving to test",
      );
      expect(client.moveCard).not.toHaveBeenCalled();
    });

    it("does not move when card is already past dev (Q&A / mention follow-up)", async () => {
      const client = fakeClient();
      await applyRoleOutcome(
        "dev",
        "SUMMARY: answered question about oauth\nHere is the explanation…",
        { ...taskCtx, cardColumn: "accept" },
        client,
      );
      expect(client.moveCard).not.toHaveBeenCalled();
      expect(client.postComment).not.toHaveBeenCalled();
    });

    it("allows Q&A without SUMMARY when card is not in dev", async () => {
      const client = fakeClient();
      await applyRoleOutcome(
        "dev",
        "The handler uses JWT from the Authorization header.",
        { ...taskCtx, cardColumn: "done" },
        client,
      );
      expect(client.moveCard).not.toHaveBeenCalled();
      expect(client.postComment).not.toHaveBeenCalled();
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

  describe("scanner", () => {
    it("writes report and creates frozen defect tasks with dedupe", async () => {
      const fs = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-scan-"));
      const client = fakeClient({
        listCards: vi.fn(async () => [
          {
            id: "old",
            type: "task",
            title: "[scan] Dup",
            description: "path: src/dup.ts\nscan_run: x",
            column: "design",
            frozen: true,
            createdAt: new Date().toISOString(),
          },
        ]),
      });
      const summary = [
        "REPORT path docs/scans/t.md",
        "DEFECT title=Dup severity=med path=src/dup.ts summary=already",
        "DEFECT title=NewBug severity=high path=src/new.ts summary=fresh",
        "SUMMARY: 2 findings",
      ].join("\n");
      await applyRoleOutcome(
        "scanner",
        summary,
        {
          ...designCtx,
          cardTitle: "Nightly",
          workspacePath: dir,
          scheduleConfig: { maxDefects: 10, autoCreateTasks: true },
        },
        client,
      );
      expect(fs.existsSync(path.join(dir, "docs/scans/t.md"))).toBe(true);
      expect(client.createCard).toHaveBeenCalledTimes(1);
      expect(client.createCard).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "task",
          frozen: true,
          column: "design",
          title: expect.stringContaining("NewBug"),
        }),
      );
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
