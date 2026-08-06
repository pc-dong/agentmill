export type ColumnId =
  | "requirements"
  | "design"
  | "split"
  | "verify"
  | "dev"
  | "test"
  | "accept"
  | "done";

export type CardType = "epic" | "requirement" | "task";

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
