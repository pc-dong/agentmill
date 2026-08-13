export type ParsedDefect = {
  title: string;
  severity: string;
  path: string;
  summary: string;
};

export type ParsedScanOutcome = {
  reportPath?: string;
  defects: ParsedDefect[];
  summaryLine?: string;
};

const REPORT_LINE = /^REPORT\s+(?:path\s+)?(.+)$/i;
const DEFECT_LINE = /^DEFECT\s+(.+)$/i;
const SUMMARY_LINE = /^SUMMARY:\s*(.+)$/im;

function parseKvChunk(rest: string): Record<string, string> {
  const out: Record<string, string> = {};
  // title=… severity=… path=… summary=…
  const re = /(\w+)=([^=]*?)(?=\s+\w+=|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    out[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  return out;
}

export function parseScanOutcome(summary: string): ParsedScanOutcome {
  const outcome: ParsedScanOutcome = { defects: [] };
  const summaryMatch = summary.match(SUMMARY_LINE);
  if (summaryMatch) {
    outcome.summaryLine = summaryMatch[1]!.trim();
  }

  for (const raw of summary.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const reportMatch = line.match(REPORT_LINE);
    if (reportMatch) {
      outcome.reportPath = reportMatch[1]!.trim().replace(/^path\s+/i, "");
      continue;
    }

    const defectMatch = line.match(DEFECT_LINE);
    if (defectMatch) {
      const kv = parseKvChunk(defectMatch[1]!.trim());
      const title = (kv.title ?? "").trim();
      if (!title) continue;
      outcome.defects.push({
        title,
        severity: (kv.severity ?? "med").trim() || "med",
        path: (kv.path ?? "").trim(),
        summary: (kv.summary ?? "").trim(),
      });
    }
  }

  return outcome;
}

export function defectDedupeKey(d: {
  title: string;
  path: string;
}): string {
  return `${d.title.trim().toLowerCase()}|${d.path.trim().toLowerCase()}`;
}

export function buildScanReportMarkdown(input: {
  runTitle: string;
  focusHint?: string;
  summaryLine?: string;
  defects: ParsedDefect[];
  generatedAt?: string;
}): string {
  const at = input.generatedAt ?? new Date().toISOString();
  const lines = [
    `# ${input.runTitle}`,
    "",
    `Generated: ${at}`,
    input.focusHint ? `Focus: ${input.focusHint}` : "",
    input.summaryLine ? `Summary: ${input.summaryLine}` : "",
    "",
    `## Defects (${input.defects.length})`,
    "",
  ].filter((l) => l !== "");

  if (input.defects.length === 0) {
    lines.push("_No defects reported._", "");
  } else {
    for (const d of input.defects) {
      lines.push(
        `### ${d.title}`,
        "",
        `- Severity: ${d.severity}`,
        d.path ? `- Path: \`${d.path}\`` : "- Path: _(n/a)_",
        d.summary ? `- Summary: ${d.summary}` : "",
        "",
      );
    }
  }
  return lines.filter((l) => l !== undefined).join("\n");
}
