import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * LLMs sometimes emit GFM tables on one line:
 * `| h1 | h2 | |---|---| | c1 | c2 |`
 * Split row boundaries (`| |`) into newlines so remark-gfm can parse them.
 * Skip when the block already has line breaks (normal tables).
 */
function normalizeJammedGfmTables(md: string): string {
  return md.replace(/\|[^\n]*\|[-:| \t]+\|[^\n]*/g, (segment) => {
    if (segment.includes("\n")) return segment;
    if (!/\|[-:\s|]+\|/.test(segment)) return segment;
    return segment.replace(/\|\s+\|/g, "|\n|");
  });
}

export function MarkdownBody(props: { text: string; streaming?: boolean }) {
  const raw = props.text || (props.streaming ? "…" : "");
  if (!raw) return null;
  const text = normalizeJammedGfmTables(raw);
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
