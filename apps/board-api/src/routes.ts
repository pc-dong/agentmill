import { Hono } from "hono";
import { z } from "zod";
import {
  applyHumanDecision,
  applyTestFailure,
  isColumnAllowedForType,
  planMove,
  type ArtifactRef,
  type ColumnId,
  type CardType,
  type HumanDecision,
} from "@ai-workforce/domain";
import type { BoardRepo } from "./repo.js";
import type { SessionRepo } from "./sessions.js";
import { listWorkspaceTree, readWorkspaceFile, readWorkspaceRaw } from "./workspaceFiles.js";
import { scanWorkspaceSkills } from "./workspaceSkills.js";

const mentionRe = /@(Design|Split|Verify|Dev|Test|Review|BA)\s*Bot/i;

/** Parse `epic_id: E-...` from an epic card description. */
export function parseEpicIdFromDescription(description: string): string | null {
  const m = /^epic_id:\s*(\S+)/m.exec(description);
  return m?.[1] ?? null;
}

export function createApp(repo: BoardRepo, sessions: SessionRepo) {
  const app = new Hono();

  app.post("/boards", async (c) => {
    const body = z
      .object({ name: z.string().min(1), workspacePath: z.string().min(1) })
      .parse(await c.req.json());
    const board = repo.createBoard(body);
    return c.json(board, 201);
  });

  app.get("/boards/:boardId", (c) => {
    const board = repo.getBoard(c.req.param("boardId"));
    if (!board) return c.json({ error: "not found" }, 404);
    return c.json(board);
  });

  app.get("/boards/:boardId/workspace-file", (c) => {
    const board = repo.getBoard(c.req.param("boardId"));
    if (!board) return c.json({ error: "not found" }, 404);
    const rel = c.req.query("path") ?? "";
    const result = readWorkspaceFile(board.workspacePath, rel);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json({
      path: result.path,
      content: result.content,
      language: result.language,
    });
  });

  /**
   * Path-style raw serve so relative links in HTML resolve under the same prefix.
   * Example: /boards/:id/workspace-raw/docs/demo/index.html
   */
  app.get("/boards/:boardId/workspace-raw/*", (c) => {
    const boardId = c.req.param("boardId");
    const board = repo.getBoard(boardId);
    if (!board) return c.json({ error: "not found" }, 404);
    const prefix = `/boards/${boardId}/workspace-raw/`;
    const fullPath = new URL(c.req.url).pathname;
    const idx = fullPath.indexOf(prefix);
    if (idx < 0) return c.json({ error: "path is required" }, 400);
    const rel = decodeURIComponent(fullPath.slice(idx + prefix.length));
    const result = readWorkspaceRaw(board.workspacePath, rel);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return new Response(new Uint8Array(result.body), {
      status: 200,
      headers: {
        "content-type": result.contentType,
        "cache-control": "no-store",
      },
    });
  });

  app.get("/boards/:boardId/workspace-tree", (c) => {
    const board = repo.getBoard(c.req.param("boardId"));
    if (!board) return c.json({ error: "not found" }, 404);
    const root = c.req.query("root") ?? "";
    const depthRaw = c.req.query("depth");
    const depth = depthRaw ? Number(depthRaw) : 2;
    const result = listWorkspaceTree(
      board.workspacePath,
      root,
      Number.isFinite(depth) ? depth : 2,
    );
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json({ root: result.root, files: result.files });
  });

  app.get("/boards/:boardId/workspace-skills", (c) => {
    const board = repo.getBoard(c.req.param("boardId"));
    if (!board) return c.json({ error: "not found" }, 404);
    const skills = scanWorkspaceSkills(board.workspacePath);
    return c.json({ skills });
  });

  app.get("/boards/:boardId/cards", (c) => {
    return c.json(repo.listCards(c.req.param("boardId")));
  });

  app.post("/boards/:boardId/cards", async (c) => {
    const boardId = c.req.param("boardId");
    if (!repo.getBoard(boardId)) return c.json({ error: "not found" }, 404);
    const body = z
      .object({
        type: z.enum(["epic", "requirement", "design", "task"]),
        title: z.string().min(1),
        description: z.string().default(""),
        column: z.enum([
          "requirements",
          "design",
          "dev",
          "test",
          "accept",
          "done",
        ]),
        epicId: z.string().nullable().optional(),
        designId: z.string().nullable().optional(),
        status: z.enum(["open", "in_progress", "done"]).optional(),
        requirementIds: z.array(z.string()).optional(),
        frozen: z.boolean().optional(),
        artifacts: z
          .array(
            z.object({
              kind: z.enum(["file", "url", "pr"]),
              href: z.string().min(1),
              label: z.string().optional(),
            }),
          )
          .optional(),
      })
      .parse(await c.req.json());
    if (!isColumnAllowedForType(body.type as CardType, body.column as ColumnId)) {
      return c.json(
        {
          error: `Type ${body.type} cannot occupy column ${body.column}`,
        },
        400,
      );
    }
    if (body.type === "design" && !body.epicId) {
      return c.json({ error: "design card requires epicId" }, 400);
    }
    if (body.designId) {
      const design = repo.getCard(body.designId);
      if (!design || design.boardId !== boardId || design.type !== "design") {
        return c.json(
          { error: "designId must reference a design card on this board" },
          400,
        );
      }
    }
    if (body.epicId) {
      const epic = repo.getCard(body.epicId);
      if (!epic || epic.boardId !== boardId || epic.type !== "epic") {
        return c.json({ error: "epicId must reference an epic on this board" }, 400);
      }
    }
    const card = repo.createCard({
      boardId,
      type: body.type as CardType,
      title: body.title,
      description: body.description,
      column: body.column as ColumnId,
      epicId: body.epicId,
      designId: body.designId,
      status: body.type === "requirement" ? (body.status ?? "open") : null,
      frozen: body.frozen,
      artifacts: body.artifacts,
    });
    if (body.type === "design" && body.requirementIds?.length) {
      repo.linkDesignRequirements(card.id, body.requirementIds);
    }
    const out = repo.getCard(card.id)!;
    if (out.type === "design") {
      out.requirementIds = repo.listRequirementIdsForDesign(out.id);
    }
    return c.json(out, 201);
  });

  app.post("/boards/:boardId/design-rounds", async (c) => {
    const boardId = c.req.param("boardId");
    if (!repo.getBoard(boardId)) return c.json({ error: "not found" }, 404);
    const body = z
      .object({
        epicId: z.string().min(1),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        requirementIds: z.array(z.string()).min(1),
      })
      .parse(await c.req.json());
    const epic = repo.getCard(body.epicId);
    if (!epic || epic.boardId !== boardId || epic.type !== "epic") {
      return c.json({ error: "epicId must reference an epic on this board" }, 400);
    }
    for (const rid of body.requirementIds) {
      const req = repo.getCard(rid);
      if (!req || req.boardId !== boardId || req.type !== "requirement") {
        return c.json({ error: `invalid requirementId: ${rid}` }, 400);
      }
    }
    const title =
      body.title?.trim() ||
      `${epic.title} · 设计 ${new Date().toISOString().slice(0, 10)}`;
    const design = repo.createDesignRound({
      boardId,
      epicId: body.epicId,
      title,
      description: body.description ?? "",
      requirementIds: body.requirementIds,
    });
    return c.json(design, 201);
  });

  app.get("/cards/:cardId/design-links", (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card) return c.json({ error: "not found" }, 404);
    if (card.type === "design") {
      return c.json({
        requirementIds: repo.listRequirementIdsForDesign(card.id),
        designIds: [],
      });
    }
    if (card.type === "requirement") {
      return c.json({
        requirementIds: [],
        designIds: repo.listDesignIdsForRequirement(card.id),
      });
    }
    return c.json({ requirementIds: [], designIds: [] });
  });

  app.patch("/cards/:cardId", async (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card) return c.json({ error: "not found" }, 404);
    const body = z
      .object({
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        epicId: z.string().nullable().optional(),
        status: z.enum(["open", "in_progress", "done"]).optional(),
        frozen: z.boolean().optional(),
        artifacts: z
          .array(
            z.object({
              kind: z.enum(["file", "url", "pr"]),
              href: z.string().min(1),
              label: z.string().optional(),
            }),
          )
          .optional(),
      })
      .parse(await c.req.json());
    if (body.epicId) {
      const epic = repo.getCard(body.epicId);
      if (!epic || epic.boardId !== card.boardId || epic.type !== "epic") {
        return c.json({ error: "epicId must reference an epic on this board" }, 400);
      }
    }
    if (card.type === "epic" && body.epicId !== undefined) {
      return c.json({ error: "epic cannot link to another epic" }, 400);
    }
    if (body.status !== undefined && card.type !== "requirement") {
      return c.json({ error: "status only applies to requirement cards" }, 400);
    }
    const updated = repo.updateCard(card.id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.epicId !== undefined ? { epicId: body.epicId } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.frozen !== undefined ? { frozen: body.frozen } : {}),
      ...(body.artifacts !== undefined ? { artifacts: body.artifacts } : {}),
    });
    return c.json(updated);
  });

  app.delete("/cards/:cardId", (c) => {
    const cardId = c.req.param("cardId");
    const card = repo.getCard(cardId);
    if (!card) return c.json({ error: "not found" }, 404);
    const confirmDelete = c.req.query("confirmDelete") === "true";
    if (card.type === "task" && card.column !== "design" && !confirmDelete) {
      return c.json(
        { error: "in-flight task delete requires confirmDelete=true" },
        409,
      );
    }
    const designId = card.designId;
    if (!repo.deleteCard(cardId)) {
      return c.json({ error: "cannot delete" }, 409);
    }
    if (designId) repo.markDesignSplitDirty(designId);
    return c.json({ ok: true, id: cardId });
  });

  app.post("/cards/:cardId/split-verified", (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card || card.type !== "design") {
      return c.json({ error: "not found" }, 404);
    }
    repo.markDesignSplitVerified(card.id);
    return c.json(repo.getCard(card.id));
  });

  app.post("/cards/:cardId/split-dirty", (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card || card.type !== "design") {
      return c.json({ error: "not found" }, 404);
    }
    repo.markDesignSplitDirty(card.id);
    return c.json(repo.getCard(card.id));
  });

  app.post("/cards/:cardId/move", async (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card) return c.json({ error: "not found" }, 404);
    const body = z
      .object({
        to: z.enum([
          "requirements",
          "design",
          "split",
          "verify",
          "dev",
          "test",
          "accept",
          "done",
        ]),
        actor: z.enum(["human", "bot"]),
        humanApproved: z.boolean().optional(),
      })
      .parse(await c.req.json());

    const result = planMove(
      {
        id: card.id,
        type: card.type,
        column: card.column,
        reworkCount: card.reworkCount,
        frozen: card.frozen,
        epicId: card.epicId,
      },
      {
        to: body.to as ColumnId,
        actor: body.actor,
        humanApproved: body.humanApproved,
      },
    );
    if (!result.ok) return c.json({ error: result.reason }, 400);
    if (
      card.type === "task" &&
      card.column === "design" &&
      body.to === "dev" &&
      body.actor === "human"
    ) {
      if (card.frozen) {
        return c.json({ error: "任务仍冻结：请先通过「校验覆盖」" }, 400);
      }
      if (!card.designId) {
        return c.json({ error: "task missing designId" }, 400);
      }
      const design = repo.getCard(card.designId);
      if (!design?.splitVerifiedAt) {
        return c.json(
          {
            error: "拆分未校验或已变更：请重新「校验覆盖」后再拖入开发列",
          },
          400,
        );
      }
    }
    if (
      card.type === "design" &&
      body.to === "done" &&
      body.actor === "human"
    ) {
      if (!repo.designTasksAllDone(card.id)) {
        return c.json(
          {
            error:
              "设计卡相关任务尚未全部 Done，请先完成拆分出的任务卡后再移入 Done",
          },
          400,
        );
      }
    }
    const updated = repo.updateCard(card.id, {
      column: result.next.column,
      frozen: result.next.frozen,
      reworkCount: result.next.reworkCount,
    });
    repo.addComment({
      cardId: card.id,
      author: body.actor,
      body: `[audit] ${result.audit}`,
    });
    return c.json(updated);
  });

  app.post("/cards/:cardId/test-result", async (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card) return c.json({ error: "not found" }, 404);
    const body = z.object({ passed: z.boolean() }).parse(await c.req.json());
    if (body.passed) {
      const result = planMove(
        {
          id: card.id,
          type: card.type,
          column: card.column,
          reworkCount: card.reworkCount,
          frozen: card.frozen,
          epicId: card.epicId,
        },
        { to: "accept", actor: "bot" },
      );
      if (!result.ok) return c.json({ error: result.reason }, 400);
      const updated = repo.updateCard(card.id, { column: result.next.column });
      repo.addComment({
        cardId: card.id,
        author: "bot",
        body: `[audit] ${result.audit}`,
      });
      return c.json(updated);
    }
    if (card.type !== "task" || card.column !== "test") {
      return c.json(
        {
          error: "test-result only valid for task cards in test column",
        },
        400,
      );
    }
    const failure = applyTestFailure({
      id: card.id,
      type: card.type,
      column: card.column,
      reworkCount: card.reworkCount,
      frozen: card.frozen,
      epicId: card.epicId,
    });
    const updated = repo.updateCard(card.id, {
      column: failure.next.column,
      reworkCount: failure.next.reworkCount,
      frozen: failure.next.frozen,
    });
    repo.addComment({
      cardId: card.id,
      author: "bot",
      body: `[audit] ${failure.audit}`,
    });
    return c.json(updated);
  });

  app.post("/cards/:cardId/human-decision", async (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card) return c.json({ error: "not found" }, 404);
    const body = z
      .object({
        decision: z.enum(["return_dev", "force_accept", "close_done"]),
      })
      .parse(await c.req.json());
    const result = applyHumanDecision(
      {
        id: card.id,
        type: card.type,
        column: card.column,
        reworkCount: card.reworkCount,
        frozen: card.frozen,
        epicId: card.epicId,
      },
      body.decision as HumanDecision,
    );
    if (!result.ok) return c.json({ error: result.reason }, 400);
    const updated = repo.updateCard(card.id, {
      column: result.next.column,
      frozen: result.next.frozen,
      reworkCount: result.next.reworkCount,
    });
    repo.addComment({
      cardId: card.id,
      author: "human",
      body: `[audit] ${result.audit}`,
    });
    return c.json(updated);
  });

  app.post("/cards/:cardId/comments", async (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card) return c.json({ error: "not found" }, 404);
    const body = z
      .object({ author: z.string().min(1), body: z.string().min(1) })
      .parse(await c.req.json());
    const comment = repo.addComment({
      cardId: card.id,
      author: body.author,
      body: body.body,
    });
    const m = body.body.match(mentionRe);
    if (m) {
      const role = m[1]!.toLowerCase();
      const employees = repo.listEmployees(card.boardId);
      const emp = employees.find((e) => e.role === role);
      if (emp) {
        repo.createJob({
          boardId: card.boardId,
          cardId: card.id,
          employeeId: emp.id,
          trigger: "mention",
        });
      }
    }
    return c.json(comment, 201);
  });

  app.get("/cards/:cardId/comments", (c) => {
    return c.json(repo.listComments(c.req.param("cardId")));
  });

  app.get("/boards/:boardId/employees", (c) => {
    return c.json(repo.listEmployees(c.req.param("boardId")));
  });

  app.get("/boards/:boardId/jobs", (c) => {
    return c.json(repo.listOpenJobs(c.req.param("boardId")));
  });

  app.get("/boards/:boardId/jobs/claimable", (c) => {
    const boardId = c.req.param("boardId");
    if (!repo.getBoard(boardId)) return c.json({ error: "not found" }, 404);
    return c.json(repo.listClaimableJobs(boardId));
  });

  app.post("/boards/:boardId/poll-jobs", async (c) => {
    const boardId = c.req.param("boardId");
    if (!repo.getBoard(boardId)) return c.json({ error: "not found" }, 404);
    if (c.req.header("content-type")?.includes("application/json")) {
      await c.req.json().catch(() => undefined);
    }
    const created = repo.createPollJobs(boardId);
    return c.json({ created });
  });

  app.post("/jobs/:jobId/claim", async (c) => {
    const body = z
      .object({ workerId: z.string().min(1) })
      .parse(await c.req.json());
    const job = repo.claimJob(c.req.param("jobId"), body.workerId);
    if (!job) return c.json({ error: "cannot claim" }, 409);
    return c.json(job);
  });

  app.post("/jobs/:jobId/progress", async (c) => {
    const body = z
      .object({ text: z.string().min(1).max(500) })
      .parse(await c.req.json());
    const job = repo.setJobProgress(c.req.param("jobId"), body.text);
    if (!job) return c.json({ error: "cannot update progress" }, 409);
    return c.json(job);
  });

  app.post("/jobs/:jobId/complete", async (c) => {
    const body = z
      .object({
        summary: z.string().min(1),
        artifacts: z
          .array(
            z.object({
              kind: z.enum(["file", "url", "pr"]),
              href: z.string(),
              label: z.string().optional(),
            }),
          )
          .default([]),
      })
      .parse(await c.req.json());
    const job = repo.completeJob(c.req.param("jobId"), body);
    if (!job) return c.json({ error: "cannot complete" }, 409);
    return c.json(job);
  });

  app.post("/jobs/:jobId/fail", async (c) => {
    const body = z
      .object({ message: z.string().min(1) })
      .parse(await c.req.json());
    const job = repo.failJob(c.req.param("jobId"), body.message);
    if (!job) return c.json({ error: "cannot fail" }, 409);
    return c.json(job);
  });

  app.post("/boards/:boardId/cards/:cardId/sessions", async (c) => {
    const boardId = c.req.param("boardId");
    const cardId = c.req.param("cardId");
    if (!repo.getBoard(boardId)) return c.json({ error: "not found" }, 404);
    const card = repo.getCard(cardId);
    if (!card || card.boardId !== boardId) {
      return c.json({ error: "not found" }, 404);
    }
    const body = z
      .object({
        employeeRole: z.string().min(1).optional(),
      })
      .parse(await c.req.json().catch(() => ({})));
    const existing = sessions.getOpenSessionForCard(cardId);
    if (existing) {
      // Resume the open session (UI refresh / double-click "开始" should not 409).
      return c.json({ id: existing.id, resumed: true }, 200);
    }
    const session = sessions.createSession({
      boardId,
      cardId,
      employeeRole: body.employeeRole ?? "design",
    });
    return c.json({ id: session.id, resumed: false }, 201);
  });

  app.get("/boards/:boardId/cards/:cardId/sessions/open", (c) => {
    const boardId = c.req.param("boardId");
    const cardId = c.req.param("cardId");
    if (!repo.getBoard(boardId)) return c.json({ error: "not found" }, 404);
    const card = repo.getCard(cardId);
    if (!card || card.boardId !== boardId) {
      return c.json({ error: "not found" }, 404);
    }
    const open = sessions.getOpenSessionForCard(cardId);
    if (!open) return c.json({ error: "not found" }, 404);
    return c.json(open);
  });

  app.get("/boards/:boardId/cards/:cardId/sessions/latest", (c) => {
    const boardId = c.req.param("boardId");
    const cardId = c.req.param("cardId");
    if (!repo.getBoard(boardId)) return c.json({ error: "not found" }, 404);
    const card = repo.getCard(cardId);
    if (!card || card.boardId !== boardId) {
      return c.json({ error: "not found" }, 404);
    }
    const role = c.req.query("role") || undefined;
    const latest = sessions.getLatestSessionForCard(cardId, role);
    if (!latest) return c.json({ error: "not found" }, 404);
    let session = latest;
    let messages = sessions.listMessages(session.id);

    // Empty "new round" sessions should not hide prior clarification history.
    if (messages.length === 0) {
      const withMessages = sessions.getLatestSessionWithMessages(cardId, role);
      if (withMessages && withMessages.id !== session.id) {
        if (session.status === "open") {
          sessions.closeSession(session.id);
        }
        session = withMessages;
        messages = sessions.listMessages(session.id);
      }
    }

    return c.json({ session, messages });
  });

  app.get("/sessions/:sessionId", (c) => {
    const session = sessions.getSession(c.req.param("sessionId"));
    if (!session) return c.json({ error: "not found" }, 404);
    return c.json(session);
  });

  app.get("/sessions/:sessionId/messages", (c) => {
    const session = sessions.getSession(c.req.param("sessionId"));
    if (!session) return c.json({ error: "not found" }, 404);
    return c.json(sessions.listMessages(session.id));
  });

  app.post("/sessions/:sessionId/edit-last-user", async (c) => {
    const session = sessions.getSession(c.req.param("sessionId"));
    if (!session) return c.json({ error: "not found" }, 404);
    if (session.status !== "open") {
      return c.json({ error: "session not open" }, 409);
    }
    const body = z
      .object({ body: z.string().min(1) })
      .parse(await c.req.json());
    const messages = sessions.editLastUserMessage(session.id, body.body);
    if (!messages) {
      return c.json({ error: "no user message to edit" }, 409);
    }
    return c.json({ messages });
  });

  app.post("/sessions/:sessionId/close", (c) => {
    const closed = sessions.closeSession(c.req.param("sessionId"));
    if (!closed) return c.json({ error: "cannot close" }, 409);
    return c.json(closed);
  });

  app.post("/sessions/:sessionId/reopen", (c) => {
    const reopened = sessions.reopenSession(c.req.param("sessionId"));
    if (!reopened) {
      return c.json(
        { error: "cannot reopen (not closed, or another session is open)" },
        409,
      );
    }
    return c.json(reopened);
  });

  app.post("/sessions/:sessionId/settle", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = sessions.getSession(sessionId);
    if (!session) return c.json({ error: "not found" }, 404);
    if (session.status !== "open") {
      return c.json({ error: "session not open" }, 409);
    }

    const body = z
      .object({
        artifacts: z
          .array(
            z.object({
              kind: z.enum(["file", "url", "pr"]),
              href: z.string(),
              label: z.string().optional(),
            }),
          )
          .optional(),
        comment: z.string().optional(),
      })
      .parse(await c.req.json().catch(() => ({})));

    const card = repo.getCard(session.cardId);
    if (!card) return c.json({ error: "not found" }, 404);

    if (body.artifacts?.length) {
      repo.updateCard(card.id, {
        artifacts: [...card.artifacts, ...body.artifacts],
      });
    }
    if (body.comment) {
      repo.addComment({
        cardId: card.id,
        author: "human",
        body: body.comment,
      });
    }

    const closed = sessions.closeSession(sessionId);
    return c.json({ session: closed, card: repo.getCard(card.id) });
  });

  app.post("/cards/:cardId/ba-settle", async (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card || card.type !== "requirement") {
      return c.json({ error: "not found" }, 404);
    }

    const body = z
      .object({
        mode: z.enum(["create", "link"]),
        epicKey: z.string().min(1),
        epicTitle: z.string().min(1),
        epicSlug: z.string().min(1),
        artifacts: z
          .array(
            z.object({
              kind: z.enum(["file", "url", "pr"]),
              href: z.string(),
              label: z.string().optional(),
            }),
          )
          .default([]),
      })
      .parse(await c.req.json());

    let mode: "create" | "link" = body.mode;
    let warning: string | undefined;
    if (mode === "create" && card.epicId) {
      mode = "link";
      warning =
        "requirement already linked to an epic; treating create as link";
    }

    const mergeArtifacts = (
      existing: typeof card.artifacts,
      incoming: typeof body.artifacts,
    ) => {
      const seen = new Set(existing.map((a) => a.href));
      const merged = [...existing];
      for (const a of incoming) {
        if (seen.has(a.href)) continue;
        seen.add(a.href);
        merged.push(a);
      }
      return merged;
    };

    if (mode === "link") {
      if (!card.epicId) {
        return c.json({ error: "requirement has no epicId for link" }, 400);
      }
      const epic = repo.getCard(card.epicId);
      if (!epic || epic.type !== "epic") {
        return c.json({ error: "linked epic not found" }, 404);
      }
      const linkedEpicKey = parseEpicIdFromDescription(epic.description);
      if (linkedEpicKey && body.epicKey !== linkedEpicKey) {
        return c.json(
          {
            error: `epicKey mismatch: body has ${body.epicKey} but linked epic is ${linkedEpicKey}`,
          },
          400,
        );
      }
      const epicUpdated = repo.updateCard(epic.id, {
        artifacts: mergeArtifacts(epic.artifacts, body.artifacts),
      });
      const reqUpdated = repo.updateCard(card.id, {
        artifacts: mergeArtifacts(card.artifacts, body.artifacts),
      });
      repo.addComment({
        cardId: card.id,
        author: "ba",
        body: `[audit] ba-settle link epic ${linkedEpicKey ?? body.epicKey}`,
      });
      return c.json({
        mode: "link",
        epicKey: linkedEpicKey ?? body.epicKey,
        epicTitle: body.epicTitle,
        epicSlug: body.epicSlug,
        artifacts: body.artifacts,
        warning,
        requirement: reqUpdated,
        epic: epicUpdated,
      });
    }

    let epic = repo.findEpicCardByEpicId(card.boardId, body.epicKey);
    if (!epic) {
      epic = repo.createCard({
        boardId: card.boardId,
        type: "epic",
        title: body.epicTitle,
        description: `epic_id: ${body.epicKey}\n`,
        column: "requirements",
      });
      epic = repo.updateCard(epic.id, {
        artifacts: mergeArtifacts([], body.artifacts),
      });
    } else {
      epic = repo.updateCard(epic.id, {
        artifacts: mergeArtifacts(epic.artifacts, body.artifacts),
      });
    }

    const reqUpdated = repo.updateCard(card.id, {
      epicId: epic.id,
      artifacts: mergeArtifacts(card.artifacts, body.artifacts),
    });
    repo.addComment({
      cardId: card.id,
      author: "ba",
      body: `[audit] ba-settle create epic ${body.epicKey}`,
    });

    return c.json({
      mode: "create",
      epicKey: body.epicKey,
      epicTitle: body.epicTitle,
      epicSlug: body.epicSlug,
      artifacts: body.artifacts,
      warning,
      requirement: reqUpdated,
      epic,
    });
  });

  app.post("/cards/:cardId/ba-jobs", async (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card) return c.json({ error: "not found" }, 404);
    const body = z
      .object({
        kind: z.enum(["settle", "deep_dive"]),
        summary: z.string().min(1),
      })
      .parse(await c.req.json());

    const ba = repo.listEmployees(card.boardId).find((e) => e.role === "ba");
    if (!ba) return c.json({ error: "BA employee not found" }, 404);

    const job = repo.createJob({
      boardId: card.boardId,
      cardId: card.id,
      employeeId: ba.id,
      trigger: body.kind,
      payload: body.summary,
    });
    return c.json({ job });
  });

  app.post("/cards/:cardId/design-jobs", async (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card) return c.json({ error: "not found" }, 404);
    if (card.type !== "design") {
      return c.json({ error: "design-jobs only apply to design cards" }, 400);
    }
    if (card.column !== "design") {
      return c.json(
        { error: "split/verify/deep_dive require design card in design column" },
        400,
      );
    }
    const body = z
      .object({
        kind: z.enum(["deep_dive", "split", "verify"]),
        summary: z.string().min(1).optional(),
      })
      .parse(await c.req.json());

    if (body.kind === "split" || body.kind === "verify") {
      const openSplit = sessions.getOpenSessionForCard(card.id);
      if (openSplit?.employeeRole === "split") {
        return c.json(
          { error: "请先结束拆分对齐会话（settle）后再拆分/校验" },
          409,
        );
      }
    }

    const role =
      body.kind === "deep_dive"
        ? "design"
        : body.kind === "split"
          ? "split"
          : "verify";
    const emp = repo.listEmployees(card.boardId).find((e) => e.role === role);
    if (!emp) return c.json({ error: `${role} employee not found` }, 404);

    const defaultSummary =
      body.kind === "split"
        ? `Split design card "${card.title}" into implementation tasks using writing-plans skill.`
        : body.kind === "verify"
          ? `Verify task coverage for design card "${card.title}".`
          : `Deep dive design for: ${card.title}`;

    const job = repo.createJob({
      boardId: card.boardId,
      cardId: card.id,
      employeeId: emp.id,
      trigger: body.kind === "deep_dive" ? "deep_dive" : "mention",
      payload: body.summary?.trim() || defaultSummary,
    });
    return c.json({ job });
  });

  const splitSettleOpSchema = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("create"),
      title: z.string().min(1),
      description: z.string(),
      planPath: z.string().optional(),
    }),
    z.object({
      kind: z.literal("update"),
      cardId: z.string().min(1),
      title: z.string().min(1),
      description: z.string(),
      planPath: z.string().optional(),
    }),
    z.object({
      kind: z.literal("delete"),
      cardId: z.string().min(1),
      confirmDelete: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal("note"),
      text: z.string().min(1),
    }),
  ]);

  function taskDescription(description: string, planPath?: string): string {
    const parts = [description];
    if (planPath) parts.push(`plan: ${planPath}`);
    return parts.filter(Boolean).join("\n");
  }

  function taskPlanArtifacts(planPath?: string): ArtifactRef[] {
    return planPath
      ? [{ kind: "file", href: planPath, label: "Plan" }]
      : [];
  }

  app.post("/cards/:cardId/split-settle", async (c) => {
    const card = repo.getCard(c.req.param("cardId"));
    if (!card) return c.json({ error: "not found" }, 404);

    let designId: string | null = null;
    if (card.type === "design") {
      designId = card.id;
    } else if (card.type === "task" && card.designId) {
      designId = card.designId;
    } else {
      return c.json({ error: "not found" }, 404);
    }

    const design = repo.getCard(designId);
    if (!design || design.type !== "design") {
      return c.json({ error: "not found" }, 404);
    }

    const body = z
      .object({ ops: z.array(splitSettleOpSchema).default([]) })
      .parse(await c.req.json());

    type AppliedEntry =
      | { kind: "create"; cardId: string; title: string }
      | { kind: "update"; cardId: string; title: string }
      | { kind: "delete"; cardId: string }
      | { kind: "note"; text: string };
    type SkippedEntry = {
      kind: "create" | "update" | "delete" | "note";
      cardId?: string;
      reason: string;
    };

    const applied: AppliedEntry[] = [];
    const skipped: SkippedEntry[] = [];
    let structuralApplied = false;

    for (const op of body.ops) {
      if (op.kind === "create") {
        const created = repo.createCard({
          boardId: design.boardId,
          type: "task",
          title: op.title,
          description: taskDescription(op.description, op.planPath),
          column: "design",
          epicId: design.epicId,
          designId: design.id,
          frozen: true,
          artifacts: taskPlanArtifacts(op.planPath),
        });
        applied.push({ kind: "create", cardId: created.id, title: created.title });
        structuralApplied = true;
        continue;
      }

      if (op.kind === "note") {
        repo.addComment({
          cardId: card.id,
          author: "split",
          body: op.text,
        });
        applied.push({ kind: "note", text: op.text });
        continue;
      }

      const target = repo.getCard(op.cardId);
      if (
        !target ||
        target.type !== "task" ||
        target.designId !== designId ||
        target.boardId !== design.boardId
      ) {
        skipped.push({
          kind: op.kind,
          cardId: op.cardId,
          reason: "target task not found for this design",
        });
        continue;
      }

      if (op.kind === "update") {
        if (target.column !== "design") {
          repo.addComment({
            cardId: card.id,
            author: "split",
            body: `[split-settle] skipped update on ${target.id}: task left design column (${target.column})`,
          });
          skipped.push({
            kind: "update",
            cardId: target.id,
            reason: "task not in design column; in-flight updates are skipped",
          });
          continue;
        }
        const updated = repo.updateCard(target.id, {
          title: op.title,
          description: taskDescription(op.description, op.planPath),
          ...(op.planPath !== undefined
            ? { artifacts: taskPlanArtifacts(op.planPath) }
            : {}),
        });
        applied.push({
          kind: "update",
          cardId: updated.id,
          title: updated.title,
        });
        structuralApplied = true;
        continue;
      }

      if (op.kind === "delete") {
        if (target.column !== "design" && !op.confirmDelete) {
          repo.addComment({
            cardId: card.id,
            author: "split",
            body: `[split-settle] delete ${target.id} requires confirmDelete (task in ${target.column})`,
          });
          skipped.push({
            kind: "delete",
            cardId: target.id,
            reason: "in-flight delete requires confirmDelete",
          });
          continue;
        }
        if (!repo.deleteCard(target.id)) {
          skipped.push({
            kind: "delete",
            cardId: target.id,
            reason: "delete failed",
          });
          continue;
        }
        applied.push({ kind: "delete", cardId: target.id });
        structuralApplied = true;
      }
    }

    if (structuralApplied) {
      repo.markDesignSplitDirty(designId);
    }

    return c.json({
      applied,
      skipped,
      design: repo.getCard(designId),
    });
  });

  return app;
}
