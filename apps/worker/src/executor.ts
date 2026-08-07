import { buildPrompt, parseBaSettle, ROLE_PROMPTS, type AgentDriver } from "@ai-workforce/agent";
import type { BoardClient } from "./boardClient.js";
import { resolveBaTemplatesDir, writeBaDocuments } from "./baWrite.js";
import { applyRoleOutcome } from "./outcomes.js";

function enrichSplitPrompt(
  base: string,
  requirements: Array<{ title: string }>,
): string {
  if (requirements.length === 0) return base;
  const lines = requirements.map((r) => `- ${r.title}`).join("\n");
  return `${base}\n\nSibling requirements for this epic:\n${lines}`;
}

function residueSummary(payload: string): string {
  const protocolLine =
    /^(EPIC_MODE|EPIC_ID|EPIC_SLUG|EPIC_TITLE|PRD_ID|PRD_SLUG|PRD_TITLE|ARTIFACT)\b/i;
  return payload
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !protocolLine.test(l.trim()))
    .join("\n")
    .trim();
}

function mapArtifacts(
  artifacts: Array<{ kind: string; href: string; label?: string }>,
): Array<{ kind: string; href: string; label: string }> {
  return artifacts.map((a) => ({
    kind: a.kind,
    href: a.href,
    label: a.label ?? "",
  }));
}

export async function executeClaimedJob(
  client: BoardClient,
  driver: AgentDriver,
  job: {
    id: string;
    cardId: string;
    employeeId: string;
    boardId: string;
    trigger?: string;
    payload?: string | null;
  },
): Promise<void> {
  try {
    const board = await client.getBoard();
    const card = await client.getCard(job.cardId);
    const employee = await client.getEmployee(job.employeeId);
    const trigger = job.trigger ?? "poll";

    if (trigger === "settle") {
      const parsed = parseBaSettle(job.payload ?? "");
      if ("error" in parsed) {
        await client.failJob(job.id, parsed.error);
        return;
      }
      let protocol = parsed;
      if (card.epicId && protocol.mode === "create") {
        protocol = { ...protocol, mode: "link" };
      }
      const templatesDir = resolveBaTemplatesDir();
      const { written } = await writeBaDocuments({
        workspacePath: board.workspacePath,
        protocol,
        summaryMarkdown: residueSummary(job.payload ?? ""),
        templatesDir,
      });
      const artifacts = mapArtifacts(protocol.artifacts);
      await client.baSettle(card.id, {
        mode: protocol.mode,
        epicKey: protocol.epicId,
        epicTitle: protocol.epicTitle,
        epicSlug: protocol.epicSlug,
        artifacts,
        warning:
          card.epicId && parsed.mode === "create"
            ? "create requested but epicId set; forced link"
            : undefined,
      });
      await client.completeJob(job.id, {
        summary: `ba-settle wrote: ${written.join(", ")}`,
        artifacts,
      });
      return;
    }

    const isBaPath = trigger === "deep_dive" || employee.role === "ba";
    const roleKey = trigger === "deep_dive" ? "baDeepDive" : employee.role;
    const promptBase =
      roleKey === "baDeepDive"
        ? [
            ROLE_PROMPTS.baDeepDive,
            "",
            `Card title: ${card.title}`,
            `Column: ${card.column}`,
            `Description: ${card.description}`,
          ].join("\n")
        : buildPrompt(employee.role, {
            title: card.title,
            description: card.description,
            column: card.column,
          });

    let prompt = promptBase;
    if (employee.role === "split" && card.type === "epic") {
      const siblings = (await client.listCards()).filter(
        (c) => c.type === "requirement" && c.epicId === card.id,
      );
      prompt = enrichSplitPrompt(prompt, siblings);
    }

    const result = await driver.oneshot({
      workspacePath: board.workspacePath,
      prompt,
      role: roleKey,
      cardId: job.cardId,
      boardId: job.boardId,
    });
    if (result.status === "error") {
      await client.failJob(job.id, result.summary);
      return;
    }
    const artifacts = mapArtifacts(result.artifacts);
    await client.completeJob(job.id, {
      summary: result.summary,
      artifacts,
    });

    if (isBaPath) {
      await client.postComment(card.id, "bot", result.summary);
      return;
    }

    try {
      await applyRoleOutcome(
        employee.role,
        result.summary,
        {
          cardId: card.id,
          cardType: card.type,
          cardColumn: card.column,
          epicId: card.epicId,
          artifacts,
        },
        client,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await client.postComment(
        card.id,
        "bot",
        `Warning: role outcome failed after job completed: ${message}`,
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await client.failJob(job.id, message);
  }
}
