import { buildPrompt, type AgentDriver } from "@ai-workforce/agent";
import type { BoardClient } from "./boardClient.js";

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
    const prompt = buildPrompt(employee.role, {
      title: card.title,
      description: card.description,
      column: card.column,
    });
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
    await client.completeJob(job.id, {
      summary: result.summary,
      artifacts: result.artifacts.map((a) => ({
        kind: a.kind,
        href: a.href,
        label: a.label ?? "",
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await client.failJob(job.id, message);
  }
}
