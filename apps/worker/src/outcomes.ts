import { parseArtifactHints, parseOutcome } from "@ai-workforce/agent";

export type OutcomeContext = {
  cardId: string;
  cardType: string;
  cardColumn: string;
  epicId: string | null;
  artifacts: Array<{ kind: string; href: string; label?: string }>;
};

export type OutcomeBoardClient = {
  createCard(input: {
    type: "epic" | "requirement" | "design" | "task";
    title: string;
    description: string;
    column: string;
    epicId: string | null;
    designId?: string | null;
    frozen?: boolean;
    artifacts?: Array<{ kind: string; href: string; label?: string }>;
  }): Promise<{ id: string } | unknown>;
  moveCard(
    cardId: string,
    to: string,
    actor: "bot" | "human",
  ): Promise<unknown>;
  updateCard?(
    cardId: string,
    patch: {
      frozen?: boolean;
      artifacts?: Array<{ kind: string; href: string; label?: string }>;
      description?: string;
    },
  ): Promise<unknown>;
  listCards?(): Promise<
    Array<{
      id: string;
      type: string;
      designId?: string | null;
      column: string;
      frozen: boolean;
    }>
  >;
  postTestResult(cardId: string, passed: boolean): Promise<unknown>;
  postComment(cardId: string, author: string, body: string): Promise<unknown>;
  markDesignSplitVerified?(designId: string): Promise<unknown>;
  markDesignSplitDirty?(designId: string): Promise<unknown>;
};

function planArtifactsFromSummary(
  summary: string,
  ctxArtifacts: OutcomeContext["artifacts"],
): Array<{ kind: string; href: string; label?: string }> {
  const fromSummary = parseArtifactHints(summary).filter(
    (a) =>
      a.kind === "file" &&
      (/\/plans\//i.test(a.href) || /writing-plans|plan/i.test(a.label ?? "")),
  );
  if (fromSummary.length) return fromSummary;
  return ctxArtifacts.filter(
    (a) => a.kind === "file" && /\/plans\//i.test(a.href),
  );
}

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

    case "ba":
      return;

    case "split": {
      if (ctx.cardType !== "design" || ctx.cardColumn !== "design") {
        await client.postComment(
          ctx.cardId,
          "bot",
          "Warning: split outcomes require design card in design column",
        );
        return;
      }
      const plans = planArtifactsFromSummary(summary, ctx.artifacts);
      const defaultPlan = plans[0]?.href;
      const themeEpicId = ctx.epicId;
      for (const task of outcome.tasks) {
        const planPath = task.planPath || defaultPlan;
        const descParts = [task.description];
        if (planPath) descParts.push(`plan: ${planPath}`);
        const artifacts = planPath
          ? [{ kind: "file" as const, href: planPath, label: "Plan" }]
          : plans.map((p) => ({
              kind: p.kind,
              href: p.href,
              label: p.label ?? "Plan",
            }));
        await client.createCard({
          type: "task",
          title: task.title,
          description: descParts.filter(Boolean).join("\n"),
          column: "design",
          epicId: themeEpicId,
          designId: ctx.cardId,
          frozen: true,
          artifacts,
        });
      }
      if (outcome.tasks.length > 0 && client.markDesignSplitDirty) {
        await client.markDesignSplitDirty(ctx.cardId);
      }
      await client.postComment(
        ctx.cardId,
        "bot",
        `Split created ${outcome.tasks.length} task(s)` +
          (defaultPlan ? `; plan: ${defaultPlan}` : "") +
          ". Tasks are frozen until Verify passes.",
      );
      return;
    }

    case "verify": {
      if (ctx.cardType !== "design") {
        await client.postComment(
          ctx.cardId,
          "bot",
          "Warning: verify outcomes require a design card",
        );
        return;
      }
      if (outcome.verify === "pass") {
        await client.postComment(ctx.cardId, "bot", "VERIFY pass — coverage ok");
        if (client.listCards && client.updateCard) {
          const cards = await client.listCards();
          for (const t of cards) {
            if (
              t.type === "task" &&
              t.designId === ctx.cardId &&
              t.frozen &&
              t.column === "design"
            ) {
              await client.updateCard(t.id, { frozen: false });
            }
          }
          await client.postComment(
            ctx.cardId,
            "bot",
            "Unfroze related task cards; they remain in design until moved to dev.",
          );
        }
        if (client.markDesignSplitVerified) {
          await client.markDesignSplitVerified(ctx.cardId);
        }
      } else if (outcome.verify === "fail") {
        await client.postComment(
          ctx.cardId,
          "bot",
          `VERIFY fail — ${summary.slice(0, 1500)}`,
        );
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
      const line =
        outcome.summaryLine ??
        summary.match(/^SUMMARY:\s*(.+)$/im)?.[1]?.trim();
      if (!line?.trim()) {
        await client.postComment(
          ctx.cardId,
          "bot",
          "Warning: missing SUMMARY: line; not moving to test",
        );
        return;
      }
      await client.postComment(
        ctx.cardId,
        "bot",
        `实现总结\n${line.trim()}`,
      );
      try {
        await client.moveCard(ctx.cardId, "test", "bot");
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await client.postComment(
          ctx.cardId,
          "bot",
          `Failed to move task to test: ${message}`,
        );
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
