import { Hono } from "hono";
import { z } from "zod";
import {
  applyHumanDecision,
  applyTestFailure,
  isColumnAllowedForType,
  planMove,
  type ColumnId,
  type CardType,
  type HumanDecision,
} from "@ai-workforce/domain";
import type { BoardRepo } from "./repo.js";
import type { SessionRepo } from "./sessions.js";

const mentionRe = /@(Design|Split|Verify|Dev|Test|Review|BA)\s*Bot/i;

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
    if (!isColumnAllowedForType(body.type as CardType, body.column as ColumnId)) {
      return c.json(
        {
          error: `Type ${body.type} cannot occupy column ${body.column}`,
        },
        400,
      );
    }
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
    if (sessions.getOpenSessionForCard(cardId)) {
      return c.json({ error: "open session exists" }, 409);
    }
    const body = z
      .object({
        employeeRole: z.string().min(1).optional(),
      })
      .parse(await c.req.json().catch(() => ({})));
    const session = sessions.createSession({
      boardId,
      cardId,
      employeeRole: body.employeeRole ?? "design",
    });
    return c.json({ id: session.id }, 201);
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

  app.post("/sessions/:sessionId/close", (c) => {
    const closed = sessions.closeSession(c.req.param("sessionId"));
    if (!closed) return c.json({ error: "cannot close" }, 409);
    return c.json(closed);
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
      const epicUpdated = repo.updateCard(epic.id, {
        artifacts: mergeArtifacts(epic.artifacts, body.artifacts),
      });
      const reqUpdated = repo.updateCard(card.id, {
        artifacts: mergeArtifacts(card.artifacts, body.artifacts),
      });
      repo.addComment({
        cardId: card.id,
        author: "ba",
        body: `[audit] ba-settle link epic ${body.epicKey}`,
      });
      return c.json({
        mode: "link",
        epicKey: body.epicKey,
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

  return app;
}
