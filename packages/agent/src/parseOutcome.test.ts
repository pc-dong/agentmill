import { describe, expect, it } from "vitest";
import { parseOutcome } from "./parseOutcome.js";

describe("parseOutcome", () => {
  it("parses TASK lines", () => {
    const o = parseOutcome("TASK Login API | implement oauth\nTASK UI | forms");
    expect(o.tasks).toEqual([
      { title: "Login API", description: "implement oauth" },
      { title: "UI", description: "forms" },
    ]);
  });

  it("parses VERIFY and TEST", () => {
    expect(parseOutcome("VERIFY pass").verify).toBe("pass");
    expect(parseOutcome("TEST fail").test).toBe("fail");
  });

  it("parses TASK with empty description", () => {
    const o = parseOutcome("TASK Solo |");
    expect(o.tasks).toEqual([{ title: "Solo", description: "" }]);
  });

  it("ignores non-outcome lines", () => {
    const o = parseOutcome(
      "Some narrative\nTASK A | do a\nARTIFACT file docs/x.md label\nVERIFY fail",
    );
    expect(o.tasks).toEqual([{ title: "A", description: "do a" }]);
    expect(o.verify).toBe("fail");
    expect(o.test).toBeUndefined();
  });
});
