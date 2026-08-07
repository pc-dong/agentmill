import type { AgentDriver } from "@ai-workforce/agent";
import type { BoardClient } from "./boardClient.js";
import { executeClaimedJob } from "./executor.js";

export async function tick(
  client: BoardClient,
  driver: AgentDriver,
  opts: { createPollJobs: boolean },
): Promise<{ claimed: number; pollCreated: number }> {
  let pollCreated = 0;
  if (opts.createPollJobs) {
    const r = await client.createPollJobs();
    pollCreated = r.created;
  }

  const jobs = await client.listClaimableJobs();
  let claimed = 0;

  for (const job of jobs) {
    const claimedJob = await client.claimJob(job.id);
    if (!claimedJob) continue;
    claimed++;
    await executeClaimedJob(client, driver, {
      id: claimedJob.id,
      cardId: claimedJob.cardId,
      employeeId: claimedJob.employeeId,
      boardId: claimedJob.boardId,
    });
  }

  return { claimed, pollCreated };
}
