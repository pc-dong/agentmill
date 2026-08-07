import { parseArtifactHints } from "./parse.js";
import type { AgentDriver, RunInput, RunResult } from "./types.js";

export class MockDriver implements AgentDriver {
  readonly id = "mock";
  readonly displayName = "Mock Driver";

  async oneshot(input: RunInput): Promise<RunResult> {
    const summary = [
      `Mock ${input.role} completed for card ${input.cardId}.`,
      `ARTIFACT file docs/aiw/${input.role}-${input.cardId}.md Mock output`,
    ].join("\n");
    return {
      status: "ok",
      summary,
      artifacts: parseArtifactHints(summary),
    };
  }
}
