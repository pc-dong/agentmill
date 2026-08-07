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

export type RunResult = {
  status: "ok" | "error";
  summary: string;
  artifacts: ArtifactHint[];
};

export interface AgentDriver {
  readonly id: string;
  readonly displayName: string;
  oneshot(input: RunInput): Promise<RunResult>;
}
