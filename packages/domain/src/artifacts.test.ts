import { describe, expect, it } from "vitest";
import { dedupeArtifacts } from "./artifacts.js";

describe("dedupeArtifacts", () => {
  it("keeps unique kind+href pairs in order of first appearance key then last write", () => {
    const out = dedupeArtifacts([
      { kind: "file", href: "docs/a.md", label: "A" },
      { kind: "file", href: "docs/b.md", label: "B" },
      { kind: "file", href: "docs/a.md", label: "A2" },
      { kind: "url", href: "docs/a.md", label: "url" },
    ]);
    expect(out).toEqual([
      { kind: "file", href: "docs/a.md", label: "A2" },
      { kind: "file", href: "docs/b.md", label: "B" },
      { kind: "url", href: "docs/a.md", label: "url" },
    ]);
  });

  it("prefers labeled entry over unlabeled duplicate", () => {
    expect(
      dedupeArtifacts([
        { kind: "file", href: "x.md", label: "X" },
        { kind: "file", href: "x.md" },
      ]),
    ).toEqual([{ kind: "file", href: "x.md", label: "X" }]);
  });

  it("trims href and drops empty", () => {
    expect(
      dedupeArtifacts([
        { kind: "file", href: "  a.md  ", label: "A" },
        { kind: "file", href: "a.md", label: "A2" },
        { kind: "file", href: "   " },
      ]),
    ).toEqual([{ kind: "file", href: "a.md", label: "A2" }]);
  });
});
