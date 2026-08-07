import { MockDriver } from "@ai-workforce/agent";
import { loadConfig } from "./config.js";
import { BoardClient } from "./boardClient.js";
import { tick } from "./loop.js";

const config = loadConfig(process.env);
const r = await tick(new BoardClient(config), new MockDriver(), {
  createPollJobs: true,
});
console.log(JSON.stringify(r));
if (r.claimed < 1 && r.pollCreated < 1) {
  // still ok if mention job claimed
}
