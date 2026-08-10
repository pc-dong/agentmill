import { Agent } from "@cursor/sdk";
import type { SDKAssistantMessage } from "@cursor/sdk";
import { ROLE_PROMPTS } from "./prompts.js";
import { parseArtifactHints } from "./parse.js";
import type {
  AgentDriver,
  AgentEvent,
  ChatInput,
  RunInput,
  RunResult,
} from "./types.js";

function summaryFromPromptResult(
  result: Awaited<ReturnType<typeof Agent.prompt>>,
): string {
  if (typeof result.result === "string") {
    return result.result;
  }
  return JSON.stringify(result.result ?? result);
}

function assistantTextFromMessage(message: SDKAssistantMessage): string {
  return message.message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export function composeChatPrompt(input: ChatInput): string {
  const roleLine =
    ROLE_PROMPTS[input.role] ??
    "You are an AI employee assisting on a kanban card.";
  const lines = [
    roleLine,
    "",
    `Card ${input.cardId} on board ${input.boardId}.`,
    "",
    "Conversation history:",
  ];
  for (const turn of input.history) {
    const speaker = turn.role === "user" ? "User" : "Assistant";
    lines.push(`${speaker}: ${turn.content}`);
  }
  lines.push("", `User: ${input.message}`);
  return lines.join("\n");
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

  async *chatStream(input: ChatInput): AsyncIterable<AgentEvent> {
    let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
    let run: Awaited<ReturnType<NonNullable<typeof agent>["send"]>> | undefined;

    const onAbort = () => {
      if (run) {
        void run.cancel().catch(() => undefined);
      }
    };
    input.signal?.addEventListener("abort", onAbort);

    try {
      if (input.signal?.aborted) {
        yield { type: "done", summary: "*(已打断)*" };
        return;
      }

      agent = await Agent.create({
        apiKey: this.opts.apiKey,
        model: { id: this.opts.modelId },
        local: { cwd: input.workspacePath },
      });

      const composedPrompt = composeChatPrompt(input);
      run = await agent.send(composedPrompt);
      let fullText = "";

      for await (const event of run.stream()) {
        if (input.signal?.aborted) {
          const summary = fullText.trim()
            ? `${fullText.trim()}\n\n*(已打断)*`
            : "*(已打断)*";
          yield { type: "done", summary };
          return;
        }
        if (event.type !== "assistant") continue;
        const text = assistantTextFromMessage(event);
        if (!text) continue;
        fullText += text;
        yield { type: "text_delta", text };
      }

      if (input.signal?.aborted) {
        const summary = fullText.trim()
          ? `${fullText.trim()}\n\n*(已打断)*`
          : "*(已打断)*";
        yield { type: "done", summary };
        return;
      }

      yield { type: "done", summary: fullText };
    } catch (e) {
      if (input.signal?.aborted) {
        yield { type: "done", summary: "*(已打断)*" };
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      yield { type: "error", message };
    } finally {
      input.signal?.removeEventListener("abort", onAbort);
      if (agent) {
        await agent[Symbol.asyncDispose]();
      }
    }
  }
}
