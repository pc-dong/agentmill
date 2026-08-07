import { buildPrompt, type AgentDriver } from "@ai-workforce/agent";
import type { BoardClient } from "./boardClient.js";
import { applyRoleOutcome } from "./outcomes.js";

function enrichSplitPrompt(
  base: string,
  requirements: Array<{ title: string }>,
): string {
  if (requirements.length === 0) return base;
  const lines = requirements.map((r) => `- ${r.title}`).join("\n");
  return `${base}\n\nSibling requirements for this epic:\n${lines}`;
}

export async function executeClaimedJob(
  client: BoardClient,
  driver: AgentDriver,
  job: {
    id: string;
    cardId: string;
    employeeId: string;
    boardId: string;
  },
): Promise<void> {
  try {
    const board = await client.getBoard();
    const card = await client.getCard(job.cardId);
    const employee = await client.getEmployee(job.employeeId);
    let prompt = buildPrompt(employee.role, {
      title: card.title,
      description: card.description,
      column: card.column,
    });
    if (employee.role === "split" && card.type === "epic") {
      const siblings = (await client.listCards()).filter(
        (c) => c.type === "requirement" && c.epicId === card.id,
      );
      prompt = enrichSplitPrompt(prompt, siblings);
    }
    const result = await driver.oneshot({
      workspacePath: board.workspacePath,
      prompt,
      role: employee.role,
      cardId: job.cardId,
      boardId: job.boardId,
    });
    if (result.status === "error") {
      await client.failJob(job.id, result.summary);
      return;
    }
    const artifacts = result.artifacts.map((a) => ({
      kind: a.kind,
      href: a.href,
      label: a.label ?? "",
    }));
    await client.completeJob(job.id, {
      summary: result.summary,
      artifacts,
    });
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
    await client.failJob(job.id, message);
  }
}
