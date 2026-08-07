import { parseArtifactHints } from "./parse.js";
import type { AgentDriver, RunInput, RunResult } from "./types.js";

export class MockDriver implements AgentDriver {
  readonly id = "mock";
  readonly displayName = "Mock Driver";

  async oneshot(input: RunInput): Promise<RunResult> {
    let summary: string;

    if (input.role === "split") {
      summary = [
        `Mock ${input.role} completed for card ${input.cardId}.`,
        "TASK A | do a",
        "TASK B | do b",
        "ARTIFACT file docs/aiw/breakdown.md Breakdown",
      ].join("\n");
    } else if (input.role === "verify") {
      summary = [
        `Mock ${input.role} completed for card ${input.cardId}.`,
        "VERIFY pass",
        "ARTIFACT file docs/aiw/coverage.md Coverage",
      ].join("\n");
    } else if (input.role === "dev") {
      summary = [
        `Mock ${input.role} completed for card ${input.cardId}.`,
        "ARTIFACT pr https://example.com/pr/1 PR",
      ].join("\n");
    } else if (input.role === "test") {
      summary = [
        `Mock ${input.role} completed for card ${input.cardId}.`,
        "TEST pass",
        "ARTIFACT file docs/aiw/test.md Test",
      ].join("\n");
    } else {
      summary = [
        `Mock ${input.role} completed for card ${input.cardId}.`,
        `ARTIFACT file docs/aiw/${input.role}-${input.cardId}.md Mock output`,
      ].join("\n");
    }

    return {
      status: "ok",
      summary,
      artifacts: parseArtifactHints(summary),
    };
  }
}
