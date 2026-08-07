import { parseOutcome } from "@ai-workforce/agent";

export type OutcomeContext = {
  cardId: string;
  cardType: string;
  cardColumn: string;
  epicId: string | null;
  artifacts: Array<{ kind: string; href: string; label?: string }>;
};

export type OutcomeBoardClient = {
  createCard(input: {
    type: "epic" | "requirement" | "task";
    title: string;
    description: string;
    column: string;
    epicId: string | null;
  }): Promise<unknown>;
  moveCard(
    cardId: string,
    to: string,
    actor: "bot" | "human",
  ): Promise<unknown>;
  postTestResult(cardId: string, passed: boolean): Promise<unknown>;
  postComment(cardId: string, author: string, body: string): Promise<unknown>;
};

export async function applyRoleOutcome(
  role: string,
  summary: string,
  ctx: OutcomeContext,
  client: OutcomeBoardClient,
): Promise<void> {
  const outcome = parseOutcome(summary);

  switch (role) {
    case "design":
      return;

    case "split": {
      for (const task of outcome.tasks) {
        await client.createCard({
          type: "task",
          title: task.title,
          description: task.description,
          column: "dev",
          epicId: ctx.cardId,
        });
      }
      try {
        await client.moveCard(ctx.cardId, "verify", "bot");
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await client.postComment(
          ctx.cardId,
          "bot",
          `Failed to move epic to verify: ${message}`,
        );
      }
      return;
    }

    case "verify": {
      if (outcome.verify === "pass") {
        await client.postComment(ctx.cardId, "bot", "coverage ok");
      } else if (outcome.verify === "fail") {
        await client.moveCard(ctx.cardId, "split", "bot");
        await client.postComment(ctx.cardId, "bot", "VERIFY fail — returned to split");
      } else {
        await client.postComment(
          ctx.cardId,
          "bot",
          "Warning: missing VERIFY pass|fail line in summary",
        );
      }
      return;
    }

    case "dev": {
      const hasPr = ctx.artifacts.some((a) => a.kind === "pr");
      if (hasPr || summary.trim().length > 0) {
        await client.moveCard(ctx.cardId, "test", "bot");
      }
      return;
    }

    case "test": {
      if (outcome.test === "pass") {
        await client.postTestResult(ctx.cardId, true);
      } else if (outcome.test === "fail") {
        await client.postTestResult(ctx.cardId, false);
      } else {
        await client.postComment(
          ctx.cardId,
          "bot",
          "Warning: missing TEST pass|fail line in summary",
        );
      }
      return;
    }

    case "review":
      await client.postComment(ctx.cardId, "bot", "Review complete");
      return;
  }
}
