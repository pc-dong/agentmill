import { MockDriver } from "@ai-workforce/agent";
import { loadConfig } from "./config.js";
import { BoardClient } from "./boardClient.js";
import { tick } from "./loop.js";
// CursorDriver imported dynamically when driver===cursor (Task 5)

const config = loadConfig(process.env);
const client = new BoardClient(config);
const driver = new MockDriver(); // Task 5 replaces selection

async function main() {
  console.log(
    `worker ${config.workerId} board=${config.boardId} driver=${config.driver}`,
  );
  for (;;) {
    const r = await tick(client, driver, { createPollJobs: true });
    if (r.claimed || r.pollCreated) {
      console.log(r);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
