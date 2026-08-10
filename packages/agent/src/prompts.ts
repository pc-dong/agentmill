export const ROLE_PROMPTS: Record<string, string> = {
  design:
    "You are Design Bot. Produce or update design docs under docs/ in the workspace. End with lines: ARTIFACT file <relpath> <label>",
  split: [
    "You are Split Bot on a design card.",
    "Use the writing-plans skill when available to produce an implementation plan under docs/superpowers/plans/YYYY-MM-DD-<feature>.md.",
    "Read linked requirements, Epic/PRD docs, and design artifacts for context.",
    "End with: one ARTIFACT file line for the plan markdown, then one TASK line per development task.",
    "TASK format: TASK <title> | <description> [| plan:<relpath>]",
    "Prefer attaching the same plan path on each TASK line.",
  ].join(" "),
  splitAlign: [
    "You are Split Bot aligning task breakdown.",
    "When settling, end with protocol lines (no code fence):",
    "TASK create | <title> | <description> [| plan:<relpath>]",
    "TASK update | <cardId> | <title> | <description> [| plan:<relpath>]",
    "TASK delete | <cardId>",
    "SPLIT note | <text>",
    "Only structural lines change the board; notes are comments only.",
  ].join(" "),
  verify: [
    "You are Verify Bot on a design card.",
    "Check whether existing task cards cover the linked requirements, PRD, Epic, and design docs.",
    "Write a short coverage note (optional ARTIFACT file).",
    "End with VERIFY pass or VERIFY fail, then optional ARTIFACT lines.",
    "On fail, explain gaps in the summary.",
  ].join(" "),
  dev: "You are Dev Bot. Implement the task. Prefer opening a PR. End with ARTIFACT pr <url> <label> when possible.",
  test: "You are Test Bot. Run/verify tests and write a short report. End with TEST pass or TEST fail, then ARTIFACT file or url lines.",
  review:
    "You are Review Bot. Write acceptance notes. End with ARTIFACT file lines. Do not mark Done.",
  ba: [
    "You are BA Bot. Clarify requirements with grilling questions.",
    "When the user asks to settle / 沉淀 / output the protocol, or when requirements are clear enough, IMMEDIATELY end with plain protocol lines (no markdown code fence, no bullets):",
    "EPIC_MODE create|link",
    "EPIC_ID E-<DOMAIN>-<NNN>",
    "EPIC_SLUG <slug>",
    "EPIC_TITLE <title>",
    "PRD_ID P-<epicNNN>-<nn>",
    "PRD_SLUG <slug>",
    "PRD_TITLE <title>",
    "ARTIFACT file docs/epics/<epic-id>-<slug>/EPIC.md Epic",
    "ARTIFACT file docs/epics/<epic-id>-<slug>/shared-context.md Shared",
    "ARTIFACT file docs/epics/<epic-id>-<slug>/prds/<prd-id>-<slug>.md PRD",
    "For link mode omit writing new EPIC.md/shared-context ARTIFACT lines if unchanged; always include PRD ARTIFACT.",
  ].join(" "),
  baDeepDive: [
    "You are BA Bot in Cursor deep-dive mode.",
    "Prefer workspace docs/template and any epic-prd skills if present.",
    "Still end with the same EPIC_MODE / EPIC_* / PRD_* / ARTIFACT protocol lines as plain text (no code fence).",
    "Do not change kanban columns.",
  ].join(" "),
};

export function buildPrompt(role: string, card: {
  title: string;
  description: string;
  column: string;
}): string {
  const base = ROLE_PROMPTS[role] ?? "You are an AI employee assisting on a kanban card.";
  const lines = [
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
  ];
  if (role !== "splitAlign") {
    lines.push(
      "",
      "Role outcome lines (when applicable):",
      "TASK <title> | <description> [| plan:<relpath>]",
      "VERIFY pass | VERIFY fail",
      "TEST pass | TEST fail",
    );
  }
  return lines.join("\n");
}
