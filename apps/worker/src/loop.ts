import type { AgentDriver } from "@ai-workforce/agent";
import { ALL_BOARDS } from "./config.js";
import type { BoardClient } from "./boardClient.js";
import { executeClaimedJob } from "./executor.js";

export type TickOptions = {
  createPollJobs: boolean;
};

export type TickResult = {
  claimed: number;
  pollCreated: number;
  schedulesEnqueued: number;
  boards: string[];
};

/**
 * Resolve the concrete board list for this tick. Wildcard (`*`) boards are
 * re-discovered every tick so newly created boards are picked up live.
 */
export async function resolveBoardIds(
  client: BoardClient,
  boardIds: string[],
): Promise<string[]> {
  if (!boardIds.includes(ALL_BOARDS)) return boardIds;
  try {
    const boards = await client.listBoards();
    return boards.map((b) => b.id);
  } catch (e) {
    console.error(
      "listBoards failed:",
      e instanceof Error ? e.message : String(e),
    );
    return [];
  }
}

export async function tick(
  client: BoardClient,
  driver: AgentDriver,
  opts: TickOptions & { boardIds: string[] },
): Promise<TickResult> {
  const result: TickResult = {
    claimed: 0,
    pollCreated: 0,
    schedulesEnqueued: 0,
    boards: [],
  };
  const boards = await resolveBoardIds(client, opts.boardIds);
  result.boards = boards;

  for (const boardId of boards) {
    // One board failing (e.g. deleted mid-run) must not stall the others.
    try {
      const due = await client.processDueSchedules(boardId);
      result.schedulesEnqueued += due.enqueued?.length ?? 0;
    } catch (e) {
      console.error(
        `processDueSchedules failed for board ${boardId}:`,
        e instanceof Error ? e.message : String(e),
      );
    }

    if (opts.createPollJobs) {
      try {
        const r = await client.createPollJobs(boardId);
        result.pollCreated += r.created;
      } catch (e) {
        console.error(
          `createPollJobs failed for board ${boardId}:`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    let jobs: Awaited<ReturnType<typeof client.listClaimableJobs>> = [];
    try {
      jobs = await client.listClaimableJobs(boardId);
    } catch (e) {
      console.error(
        `listClaimableJobs failed for board ${boardId}:`,
        e instanceof Error ? e.message : String(e),
      );
      continue;
    }

    for (const job of jobs) {
      const claimedJob = await client.claimJob(job.id).catch(() => null);
      if (!claimedJob) continue;
      // Defense in depth: never execute a job that escaped its board listing.
      if (claimedJob.boardId !== boardId) {
        await client
          .failJob(
            claimedJob.id,
            `board mismatch: claimed from ${boardId} but job belongs to ${claimedJob.boardId}`,
          )
          .catch(() => undefined);
        continue;
      }
      result.claimed++;
      try {
        await executeClaimedJob(client, driver, {
          id: claimedJob.id,
          cardId: claimedJob.cardId,
          employeeId: claimedJob.employeeId,
          boardId: claimedJob.boardId,
          trigger: claimedJob.trigger,
          payload: claimedJob.payload ?? null,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(
          `executeClaimedJob failed for job ${claimedJob.id}:`,
          message,
        );
        try {
          await client.failJob(claimedJob.id, message);
        } catch (failErr) {
          console.error(
            `failJob also failed for job ${claimedJob.id}:`,
            failErr instanceof Error ? failErr.message : String(failErr),
          );
        }
      }
    }
  }

  return result;
}
