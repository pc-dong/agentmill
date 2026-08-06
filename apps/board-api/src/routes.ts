import { Hono } from "hono";
import { z } from "zod";
import {
  applyHumanDecision,
  applyTestFailure,
  planMove,
  type ColumnId,
  type CardType,
  type HumanDecision,
} from "@ai-workforce/domain";
import type { BoardRepo } from "./repo.js";

const mentionRe = /@(Design|Split|Verify|Dev|Test|Review)\s*Bot/i;

export function createApp(repo: BoardRepo) {
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

  app.get("/boards/:boardId/cards", (c) => {
    return c.json(repo.listCards(c.req.param("boardId")));
  });

  app.post("/boards/:boardId/cards", async (c) => {
    const boardId = c.req.param("boardId");
    if (!repo.getBoard(boardId)) return c.json({ error: "not found" }, 404);
    const body = z
      .object({
        type: z.enum(["epic", "requirement", "task"]),
        title: z.string().min(1),
        description: z.string().default(""),
        column: z.enum([
          "requirements",
          "design",
          "split",
          "verify",
          "dev",
          "test",
          "accept",
          "done",
        ]),
        epicId: z.string().nullable().optional(),
      })
      .parse(await c.req.json());
    const card = repo.createCard({
      boardId,
      type: body.type as CardType,
      title: body.title,
      description: body.description,
      column: body.column as ColumnId,
      epicId: body.epicId,
    });
    return c.json(card, 201);
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

  return app;
}
