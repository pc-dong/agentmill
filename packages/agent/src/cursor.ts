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
import {
  normalizeWorkspaceRoot,
  WORKSPACE_BOUNDARY_RULES,
} from "./workspacePath.js";

function assistantTextFromMessage(message: SDKAssistantMessage): string {
  return message.message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

const PROGRESS_INTERVAL_MS = 2000;
const PROGRESS_CHARS = 200;
const PROGRESS_TAIL = 160;

function reportProgress(
  onProgress: ((message: string) => void) | undefined,
  message: string,
): void {
  if (!onProgress) return;
  try {
    onProgress(message);
  } catch {
    // Progress is best-effort; never fail the run.
  }
}

function progressFromTail(fullText: string): string {
  const trimmed = fullText.trim();
  if (!trimmed) return "执行中…";
  if (trimmed.length <= PROGRESS_TAIL) return `执行中：${trimmed}`;
  return `执行中：…${trimmed.slice(-PROGRESS_TAIL)}`;
}

function localAgentOptions(workspacePath: string) {
  const cwd = normalizeWorkspaceRoot(workspacePath);
  return {
    cwd,
    dirs: [cwd],
    sandboxOptions: { enabled: true },
  };
}

export function withWorkspaceBoundary(
  prompt: string,
  workspaceRoot: string,
): string {
  return [
    WORKSPACE_BOUNDARY_RULES,
    `Workspace root (absolute): ${workspaceRoot}`,
    "",
    prompt,
  ].join("\n");
}

export function composeChatPrompt(input: ChatInput): string {
  const roleLine =
    ROLE_PROMPTS[input.role] ??
    "You are an AI employee assisting on a kanban card.";
  const lines = [
    roleLine,
    "",
    WORKSPACE_BOUNDARY_RULES,
  ];
  if (input.workspacePath) {
    try {
      lines.push(
        `Workspace root (absolute): ${normalizeWorkspaceRoot(input.workspacePath)}`,
      );
    } catch {
      lines.push(`Workspace root: ${input.workspacePath}`);
    }
  }
  lines.push(
    "",
    `Card ${input.cardId} on board ${input.boardId}.`,
    "",
    "Conversation history:",
  );
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
    let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;

    try {
      reportProgress(input.onProgress, "执行中：调用 Cursor Agent…");
      const local = localAgentOptions(input.workspacePath);
      agent = await Agent.create({
        apiKey: this.opts.apiKey,
        model: { id: this.opts.modelId },
        local,
      });

      reportProgress(input.onProgress, "执行中：已创建 Agent，发送任务…");
      const run = await agent.send(
        withWorkspaceBoundary(input.prompt, local.cwd),
      );
      let fullText = "";
      let lastReportAt = 0;
      let charsSinceReport = 0;

      const maybeReport = (force = false) => {
        const now = Date.now();
        if (
          !force &&
          now - lastReportAt < PROGRESS_INTERVAL_MS &&
          charsSinceReport < PROGRESS_CHARS
        ) {
          return;
        }
        lastReportAt = now;
        charsSinceReport = 0;
        reportProgress(input.onProgress, progressFromTail(fullText));
      };

      for await (const event of run.stream()) {
        if (event.type !== "assistant") continue;
        const text = assistantTextFromMessage(event);
        if (!text) continue;
        fullText += text;
        charsSinceReport += text.length;
        maybeReport();
      }
      maybeReport(true);

      const summary = fullText.trim();
      if (!summary) {
        return {
          status: "error",
          summary: "Cursor Agent returned empty output",
          artifacts: [],
        };
      }
      return {
        status: "ok",
        summary,
        artifacts: parseArtifactHints(summary),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { status: "error", summary: message, artifacts: [] };
    } finally {
      if (agent) {
        await agent[Symbol.asyncDispose]();
      }
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

      const local = localAgentOptions(input.workspacePath);
      agent = await Agent.create({
        apiKey: this.opts.apiKey,
        model: { id: this.opts.modelId },
        local,
      });

      const composedPrompt = composeChatPrompt({
        ...input,
        workspacePath: local.cwd,
      });
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
