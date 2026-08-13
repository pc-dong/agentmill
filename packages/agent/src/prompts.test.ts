import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompts.js";

describe("buildPrompt", () => {
  it("omits oneshot TASK footer for splitAlign role", () => {
    const prompt = buildPrompt("splitAlign", {
      title: "Design",
      column: "design",
      description: "desc",
    });
    expect(prompt).toContain("TASK create |");
    expect(prompt).not.toContain("TASK <title> | <description>");
    expect(prompt).not.toMatch(/Role outcome lines/);
  });

  it("keeps oneshot TASK footer for split role", () => {
    const prompt = buildPrompt("split", {
      title: "Design",
      column: "design",
      description: "desc",
    });
    expect(prompt).toContain("TASK <title> | <description>");
    expect(prompt).toContain("WORKSPACE BOUNDARY");
  });

  it("includes absolute workspace root when provided", () => {
    const prompt = buildPrompt(
      "dev",
      { title: "T", column: "dev", description: "" },
      { workspacePath: "/tmp/my-ws" },
    );
    expect(prompt).toContain("Workspace root (absolute): /tmp/my-ws");
    expect(prompt).toContain("sibling/parent clones");
  });
});
