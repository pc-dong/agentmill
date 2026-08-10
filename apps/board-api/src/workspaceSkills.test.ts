import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanWorkspaceSkills } from "./workspaceSkills.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  dirs.length = 0;
});

function tempWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-skills-"));
  dirs.push(dir);
  return dir;
}

describe("scanWorkspaceSkills", () => {
  it("finds agents skills and cursor commands", () => {
    const ws = tempWs();
    const skillDir = path.join(ws, ".agents/skills/grilling");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      ["---", "name: grilling", "description: Ask hard questions", "---", "", "# Grill"].join(
        "\n",
      ),
    );
    const nested = path.join(ws, ".agents/skills/parent/child");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, "SKILL.md"),
      ["---", "name: child-skill", "description: Nested", "---", ""].join("\n"),
    );

    fs.mkdirSync(path.join(ws, ".cursor/commands"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, ".cursor/commands/review.md"),
      "# Code review\n\nDo a review.",
    );

    const list = scanWorkspaceSkills(ws);
    expect(list.some((s) => s.name === "grilling" && s.kind === "skill")).toBe(
      true,
    );
    expect(list.some((s) => s.name === "child-skill")).toBe(true);
    const cmd = list.find((s) => s.name === "review");
    expect(cmd?.kind).toBe("command");
    expect(cmd?.description).toMatch(/Code review|Do a review/);
  });

  it("returns empty for missing roots", () => {
    const ws = tempWs();
    expect(scanWorkspaceSkills(ws)).toEqual([]);
  });
});
