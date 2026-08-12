/** Deduplicate artifact refs by kind + href (trim). Newer wins; prefer labeled. */
export function dedupeArtifacts<
  T extends { kind: string; href: string; label?: string },
>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const href = item.href.trim();
    if (!href) continue;
    const key = `${item.kind}:${href}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...item, href });
      continue;
    }
    const prevLabel = prev.label?.trim();
    const nextLabel = item.label?.trim();
    if (prevLabel && !nextLabel) continue;
    map.set(key, { ...item, href });
  }
  return [...map.values()];
}
