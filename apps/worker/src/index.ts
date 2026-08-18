import { CursorDriver, DshDriver, MockDriver } from "@agentmill/agent";
import { loadConfig, type WorkerConfig } from "./config.js";
import { BoardClient } from "./boardClient.js";
import { tick } from "./loop.js";
import { runWsClient } from "./wsClient.js";

function createDriver(config: WorkerConfig) {
  if (config.driver === "cursor") {
    if (!config.cursorApiKey) {
      throw new Error("CURSOR_API_KEY required when AM_DRIVER=cursor");
    }
    return new CursorDriver({
      apiKey: config.cursorApiKey,
      modelId: config.modelId,
    });
  }
  if (config.driver === "dsh") {
    if (!config.dshApiKey) {
      throw new Error(
        "AM_DSH_API_KEY (or DEEPSEEK_API_KEY) required when AM_DRIVER=dsh",
      );
    }
    return new DshDriver({
      dshBin: config.dshBin,
      modelId: config.modelId,
      apiKey: config.dshApiKey,
      baseURL: config.dshBaseURL,
      timeoutMs: config.dshTimeoutMs,
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
