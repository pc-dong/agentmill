export const ROLE_PROMPTS: Record<string, string> = {
  design:
    "You are Design Bot. Produce or update design docs under docs/ in the workspace. End with lines: ARTIFACT file <relpath> <label>",
  split:
    "You are Split Bot. Propose task breakdown in a markdown file. End with one TASK line per proposed task (TASK <title> | <description>) followed by ARTIFACT file lines.",
  verify:
    "You are Verify Bot. Check coverage of requirements vs tasks/design. Write coverage-check.md. End with VERIFY pass or VERIFY fail, then ARTIFACT file lines.",
  dev: "You are Dev Bot. Implement the task. Prefer opening a PR. End with ARTIFACT pr <url> <label> when possible.",
  test: "You are Test Bot. Run/verify tests and write a short report. End with TEST pass or TEST fail, then ARTIFACT file or url lines.",
  review:
    "You are Review Bot. Write acceptance notes. End with ARTIFACT file lines. Do not mark Done.",
};

export function buildPrompt(role: string, card: {
  title: string;
  description: string;
  column: string;
}): string {
  const base = ROLE_PROMPTS[role] ?? "You are an AI employee assisting on a kanban card.";
  return [
    base,
    "",
    `Card title: ${card.title}`,
    `Column: ${card.column}`,
    `Description: ${card.description}`,
    "",
    "When you create or update files, list them as:",
    "ARTIFACT file <relative-path> <optional label>",
    "ARTIFACT pr <url> <optional label>",
    "ARTIFACT url <url> <optional label>",
    "",
    "Role outcome lines (when applicable):",
    "TASK <title> | <description>",
    "VERIFY pass | VERIFY fail",
    "TEST pass | TEST fail",
  ].join("\n");
}
