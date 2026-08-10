export type ArtifactHint = {
  kind: "file" | "url" | "pr";
  href: string;
  label?: string;
};

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "artifact_hint"; kind: ArtifactHint["kind"]; href: string; label?: string }
  | { type: "done"; summary: string }
  | { type: "error"; message: string };

export type RunInput = {
  workspacePath: string;
  prompt: string;
  role: string;
  cardId: string;
  boardId: string;
};

export type ChatInput = {
  workspacePath: string;
  role: string;
  cardId: string;
  boardId: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  /** When aborted, drivers should stop streaming and yield a partial done/error. */
  signal?: AbortSignal;
};

export type RunResult = {
  status: "ok" | "error";
  summary: string;
  artifacts: ArtifactHint[];
};

export interface AgentDriver {
  readonly id: string;
  readonly displayName: string;
  oneshot(input: RunInput): Promise<RunResult>;
  chatStream(input: ChatInput): AsyncIterable<AgentEvent>;
}
