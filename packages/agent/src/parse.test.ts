import { describe, expect, it } from "vitest";
import { parseArtifactHints } from "./parse.js";

describe("parseArtifactHints", () => {
  it("extracts ARTIFACT lines", () => {
    const text = [
      "Did the design.",
      "ARTIFACT file docs/design/auth.md Design doc",
      "ARTIFACT pr https://github.com/acme/app/pull/1 Login PR",
      "done",
    ].join("\n");
    expect(parseArtifactHints(text)).toEqual([
      { kind: "file", href: "docs/design/auth.md", label: "Design doc" },
      { kind: "pr", href: "https://github.com/acme/app/pull/1", label: "Login PR" },
    ]);
  });

  it("returns empty when none", () => {
    expect(parseArtifactHints("no artifacts here")).toEqual([]);
  });
});
