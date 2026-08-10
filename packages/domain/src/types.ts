export type ColumnId =
  | "requirements"
  | "design"
  | "split"
  | "verify"
  | "dev"
  | "test"
  | "accept"
  | "done";

export type CardType = "epic" | "requirement" | "design" | "task";

/** Coarse status for requirement cards (other types ignore). */
export type RequirementStatus = "open" | "in_progress" | "done";

export type Actor = "human" | "bot";

export type ArtifactRef = {
  kind: "file" | "url" | "pr";
  href: string;
  label?: string;
};

export type CardState = {
  id: string;
  type: CardType;
  column: ColumnId;
  reworkCount: number;
  frozen: boolean;
  epicId?: string | null;
};
