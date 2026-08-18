#!/usr/bin/env node
// Stub `dsh --profile headless` used by DshDriver unit tests.
// Behaviors (driven by env passed through by the driver):
//   DSH_STUB_MODE=ok        → print DSH_STUB_OUT + "\n", exit 0
//   DSH_STUB_MODE=fail      → print "boom" to stderr, exit 1
//   DSH_STUB_MODE=empty     → print nothing, exit 0
//   DSH_STUB_MODE=hang      → never exit (tests timeout/abort kills)
// Also dumps received argv/cwd into stdout on ok mode for assertions.
const fs = require("node:fs");
const mode = process.env.DSH_STUB_MODE ?? "ok";
const idx = process.argv.indexOf("--profile");
const task = process.argv[process.argv.length - 1] ?? "";

if (mode === "hang") {
  setInterval(() => {}, 1000);
  process.stdout.write("");
} else if (mode === "fail") {
  process.stderr.write("dsh: EFAKE: stub failure");
  process.exit(1);
} else if (mode === "empty") {
  process.exit(0);
} else {
  const patchIdx = process.argv.indexOf("--patch");
  const info = JSON.stringify({
    profile: idx >= 0 ? process.argv[idx + 1] : null,
    patch: patchIdx >= 0 ? fs.readFileSync(process.argv[patchIdx + 1], "utf8") : null,
    task,
    cwd: process.cwd(),
    hasKey: Boolean(process.env.DEEPSEEK_API_KEY),
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? null,
  });
  process.stdout.write((process.env.DSH_STUB_OUT ?? "stub reply") + "\n" + info + "\n");
  process.exit(0);
}
