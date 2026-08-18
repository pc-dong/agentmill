import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BaSettleProtocol } from "@agentmill/agent";
import { writeBaDocuments } from "./baWrite.js";

const templatesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/agent/templates/ba",
);

function protocol(
  overrides: Partial<BaSettleProtocol> = {},
): BaSettleProtocol {
  return {
    mode: "create",
    epicId: "E-DEMO-001",
    epicSlug: "login",
    epicTitle: "Login theme",
    prdId: "P-001-01",
    prdSlug: "oauth",
    prdTitle: "OAuth login",
    artifacts: [
      {
        kind: "file",
        href: "docs/epics/E-DEMO-001-login/EPIC.md",
        label: "Epic",
      },
      {
        kind: "file",
        href: "docs/epics/E-DEMO-001-login/shared-context.md",
        label: "Shared",
      },
      {
        kind: "file",
        href: "docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md",
        label: "PRD",
      },
    ],
    ...overrides,
  };
}

describe("writeBaDocuments", () => {
  it("create mode writes EPIC, shared-context, and PRD", async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-ba-"));
    const result = await writeBaDocuments({
      workspacePath,
      protocol: protocol({ mode: "create" }),
      summaryMarkdown: "Discussed OAuth flow.",
      templatesDir,
    });

    const epic = path.join(
      workspacePath,
      "docs/epics/E-DEMO-001-login/EPIC.md",
    );
    const shared = path.join(
      workspacePath,
      "docs/epics/E-DEMO-001-login/shared-context.md",
    );
    const prd = path.join(
      workspacePath,
      "docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md",
    );

    expect(fs.existsSync(epic)).toBe(true);
    expect(fs.existsSync(shared)).toBe(true);
    expect(fs.existsSync(prd)).toBe(true);
    expect(fs.readFileSync(epic, "utf8")).toContain("Login theme");
    expect(fs.readFileSync(epic, "utf8")).toContain("E-DEMO-001");
    expect(fs.readFileSync(epic, "utf8")).toContain("Discussed OAuth flow.");
    expect(fs.readFileSync(epic, "utf8")).toContain("P-001-01");
    expect(fs.readFileSync(prd, "utf8")).toContain("OAuth login");
    expect(result.written).toEqual(
      expect.arrayContaining([
        "docs/epics/E-DEMO-001-login/EPIC.md",
        "docs/epics/E-DEMO-001-login/shared-context.md",
        "docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md",
      ]),
    );
    expect(result.written).toHaveLength(3);
    expect(result.overwritten).toEqual([]);
  });

  it("link mode writes only PRD and appends EPIC.md index row when present", async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-ba-"));
    const epicDir = path.join(workspacePath, "docs/epics/E-DEMO-001-login");
    fs.mkdirSync(epicDir, { recursive: true });
    const epicPath = path.join(epicDir, "EPIC.md");
    fs.writeFileSync(
      epicPath,
      [
        "# Login theme",
        "",
        "## PRD Index",
        "",
        "| PRD ID | Title | Status |",
        "|--------|-------|--------|",
        "| P-001-00 | Seed | draft |",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await writeBaDocuments({
      workspacePath,
      protocol: protocol({
        mode: "link",
        prdId: "P-001-02",
        prdSlug: "sso",
        prdTitle: "SSO login",
        artifacts: [
          {
            kind: "file",
            href: "docs/epics/E-DEMO-001-login/prds/P-001-02-sso.md",
            label: "PRD",
          },
        ],
      }),
      summaryMarkdown: "SSO follow-up.",
      templatesDir,
    });

    const prd = path.join(epicDir, "prds/P-001-02-sso.md");
    expect(fs.existsSync(prd)).toBe(true);
    expect(
      fs.existsSync(path.join(epicDir, "shared-context.md")),
    ).toBe(false);
    const epicBody = fs.readFileSync(epicPath, "utf8");
    expect(epicBody).toMatch(/\|\s*P-001-02\s*\|\s*SSO login\s*\|/i);
    expect(result.written).toContain(
      "docs/epics/E-DEMO-001-login/prds/P-001-02-sso.md",
    );
    expect(result.written).not.toContain(
      "docs/epics/E-DEMO-001-login/EPIC.md",
    );
  });

  it("link mode skips index patch when EPIC.md is missing", async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-ba-"));
    const result = await writeBaDocuments({
      workspacePath,
      protocol: protocol({
        mode: "link",
        artifacts: [
          {
            kind: "file",
            href: "docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md",
            label: "PRD",
          },
        ],
      }),
      summaryMarkdown: "No epic yet.",
      templatesDir,
    });

    expect(fs.existsSync(
      path.join(
        workspacePath,
        "docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md",
      ),
    )).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspacePath, "docs/epics/E-DEMO-001-login/EPIC.md"),
      ),
    ).toBe(false);
    expect(result.written).toHaveLength(1);
  });
});
