import { parseArtifactHints } from "./parse.js";
import type { AgentDriver, AgentEvent, ChatInput, RunInput, RunResult } from "./types.js";

function slugify(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "item";
}

function titleFromPrompt(prompt: string): string | undefined {
  const m = prompt.match(/^Card title:\s*(.+)$/m);
  return m?.[1]?.trim() || undefined;
}

function mockBaCreateProtocol(cardId: string, title: string): string {
  const slug = slugify(title);
  const epicId = "E-MOCK-001";
  const prdId = "P-001-01";
  return [
    `Mock ba completed for card ${cardId}.`,
    "EPIC_MODE create",
    `EPIC_ID ${epicId}`,
    `EPIC_SLUG ${slug}`,
    `EPIC_TITLE ${title}`,
    `PRD_ID ${prdId}`,
    `PRD_SLUG ${slug}`,
    `PRD_TITLE ${title}`,
    `ARTIFACT file docs/epics/${epicId}-${slug}/EPIC.md Epic`,
    `ARTIFACT file docs/epics/${epicId}-${slug}/shared-context.md Shared`,
    `ARTIFACT file docs/epics/${epicId}-${slug}/prds/${prdId}-${slug}.md PRD`,
  ].join("\n");
}

export class MockDriver implements AgentDriver {
  readonly id = "mock";
  readonly displayName = "Mock Driver";

  async oneshot(input: RunInput): Promise<RunResult> {
    let summary: string;

    if (input.role === "ba" || input.role === "baDeepDive") {
      const title = titleFromPrompt(input.prompt) ?? input.cardId;
      summary = mockBaCreateProtocol(input.cardId, title);
    } else if (input.role === "split") {
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

  async *chatStream(input: ChatInput): AsyncIterable<AgentEvent> {
    const chunks = ["Mock ", "chat ", "for ", `card ${input.cardId}.`];
    for (const text of chunks) {
      yield { type: "text_delta", text };
    }

    let summary: string;
    if (input.role === "ba") {
      summary = mockBaCreateProtocol(input.cardId, `Card ${input.cardId}`);
    } else {
      summary = [
        `Mock chat completed for card ${input.cardId}.`,
        "ARTIFACT file docs/aiw/chat-mock.md Mock chat",
      ].join("\n");
    }
    yield { type: "done", summary };
  }
}
