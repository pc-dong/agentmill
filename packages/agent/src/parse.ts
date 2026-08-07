import type { ArtifactHint } from "./types.js";

const LINE =
  /^ARTIFACT\s+(file|url|pr)\s+(\S+)(?:\s+(.+))?$/i;

export function parseArtifactHints(text: string): ArtifactHint[] {
  const out: ArtifactHint[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(LINE);
    if (!m) continue;
    out.push({
      kind: m[1]!.toLowerCase() as ArtifactHint["kind"],
      href: m[2]!,
      label: m[3]?.trim() || undefined,
    });
  }
  return out;
}
