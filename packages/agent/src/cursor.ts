import { Agent } from "@cursor/sdk";
import { parseArtifactHints } from "./parse.js";
import type { AgentDriver, RunInput, RunResult } from "./types.js";

function summaryFromPromptResult(
  result: Awaited<ReturnType<typeof Agent.prompt>>,
): string {
  if (typeof result.result === "string") {
    return result.result;
  }
  return JSON.stringify(result.result ?? result);
}

export class CursorDriver implements AgentDriver {
  readonly id = "cursor";
  readonly displayName = "Cursor";

  constructor(
    private readonly opts: { apiKey: string; modelId: string },
  ) {}

  async oneshot(input: RunInput): Promise<RunResult> {
    try {
      const result = await Agent.prompt(input.prompt, {
        apiKey: this.opts.apiKey,
        model: { id: this.opts.modelId },
        local: { cwd: input.workspacePath },
      });

      if (result.status !== "finished") {
        const message =
          result.error?.message ??
          (typeof result.result === "string" ? result.result : `Run ${result.status}`);
        return { status: "error", summary: message, artifacts: [] };
      }

      const summary = summaryFromPromptResult(result);
      return {
        status: "ok",
        summary,
        artifacts: parseArtifactHints(summary),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { status: "error", summary: message, artifacts: [] };
    }
  }
}
