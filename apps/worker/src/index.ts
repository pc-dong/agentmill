import { CursorDriver, MockDriver } from "@ai-workforce/agent";
import { loadConfig, type WorkerConfig } from "./config.js";
import { BoardClient } from "./boardClient.js";
import { tick } from "./loop.js";
import { runWsClient } from "./wsClient.js";

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

async function pollLoop() {
  for (;;) {
    const r = await tick(client, driver, {
      createPollJobs: true,
      boardIds: config.boardIds,
    });
    if (r.claimed || r.pollCreated) {
      console.log(r);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

async function main() {
  console.log(
    `worker ${config.workerId} boards=${config.boardIds.join(",")} driver=${config.driver}`,
  );
  await Promise.all([
    pollLoop(),
    runWsClient({ config, client, driver }),
  ]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
