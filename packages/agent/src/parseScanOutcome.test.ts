import { describe, expect, it } from "vitest";
import {
  buildScanReportMarkdown,
  defectDedupeKey,
  parseScanOutcome,
} from "./parseScanOutcome.js";

describe("parseScanOutcome", () => {
  it("parses REPORT, DEFECT, SUMMARY lines", () => {
    const raw = `
REPORT path docs/scans/2026-08-12-abcd.md
DEFECT title=Null deref severity=high path=src/a.ts summary=missing check
DEFECT title=Auth gap severity=med path=src/b.ts summary=role bypass
SUMMARY: found 2 issues
ARTIFACT file docs/scans/2026-08-12-abcd.md Scan report
`;
    const parsed = parseScanOutcome(raw);
    expect(parsed.reportPath).toBe("docs/scans/2026-08-12-abcd.md");
    expect(parsed.summaryLine).toBe("found 2 issues");
    expect(parsed.defects).toHaveLength(2);
    expect(parsed.defects[0]).toEqual({
      title: "Null deref",
      severity: "high",
      path: "src/a.ts",
      summary: "missing check",
    });
  });

  it("builds report markdown and dedupe keys", () => {
    const md = buildScanReportMarkdown({
      runTitle: "Scan",
      defects: [
        {
          title: "X",
          severity: "low",
          path: "a.ts",
          summary: "y",
        },
      ],
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(md).toContain("# Scan");
    expect(md).toContain("### X");
    expect(defectDedupeKey({ title: "X", path: "A.ts" })).toBe("x|a.ts");
  });
});
