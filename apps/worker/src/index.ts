import { CursorDriver, MockDriver } from "@ai-workforce/agent";
import { loadConfig, type WorkerConfig } from "./config.js";
import { BoardClient } from "./boardClient.js";
import { tick } from "./loop.js";

function createDriver(config: WorkerConfig) {
  if (config.driver === "cursor") {
    if (!config.cursorApiKey) {
      throw new Error("CURSOR_API_KEY required when AIW_DRIVER=cursor");
    }
    return new CursorDriver({
      apiKey: config.cursorApiKey,
      modelId: config.modelId,
    });
  }
  return new MockDriver();
}

const config = loadConfig(process.env);
const client = new BoardClient(config);
const driver = createDriver(config);

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
