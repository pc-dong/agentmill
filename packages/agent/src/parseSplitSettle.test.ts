import { describe, expect, it } from "vitest";
import { parseSplitSettle } from "./parseSplitSettle.js";

describe("parseSplitSettle", () => {
  it("parses TASK create", () => {
    const ops = parseSplitSettle(
      "TASK create | Login API | implement oauth | plan:docs/superpowers/plans/x.md",
    );
    expect(ops).toEqual([
      {
        kind: "create",
        title: "Login API",
        description: "implement oauth",
        planPath: "docs/superpowers/plans/x.md",
      },
    ]);
  });

  it("parses TASK create without plan", () => {
    const ops = parseSplitSettle("TASK create | UI | build forms");
    expect(ops).toEqual([
      { kind: "create", title: "UI", description: "build forms" },
    ]);
  });

  it("parses TASK update", () => {
    const ops = parseSplitSettle(
      "TASK update | card-1 | Login API | revised scope | plan:docs/plan.md",
    );
    expect(ops).toEqual([
      {
        kind: "update",
        cardId: "card-1",
        title: "Login API",
        description: "revised scope",
        planPath: "docs/plan.md",
      },
    ]);
  });

  it("parses TASK delete", () => {
    const ops = parseSplitSettle("TASK delete | card-2");
    expect(ops).toEqual([{ kind: "delete", cardId: "card-2" }]);
  });

  it("parses SPLIT note", () => {
    const ops = parseSplitSettle("SPLIT note | merged duplicate tasks");
    expect(ops).toEqual([{ kind: "note", text: "merged duplicate tasks" }]);
  });

  it("ignores junk and old oneshot TASK lines", () => {
    const ops = parseSplitSettle(`
Some narrative here.
TASK Login API | old oneshot format
ARTIFACT file docs/x.md Plan
TASK create | New task | do work
SPLIT note | kept one task
`);
    expect(ops).toEqual([
      { kind: "create", title: "New task", description: "do work" },
      { kind: "note", text: "kept one task" },
    ]);
  });
});
