/** Structured payload for mention-triggered jobs (JSON in jobs.payload). */
export type MentionJobPayload = {
  mentionBody: string;
  includeCommentHistory: boolean;
  triggerCommentId?: string;
};

export type CommentLike = {
  id?: string;
  author: string;
  body: string;
  createdAt?: string;
};

const SHORT_COMMENT_MAX = 240;
const SUMMARY_MAX = 160;
const HISTORY_LIMIT = 15;

export function encodeMentionPayload(payload: MentionJobPayload): string {
  return JSON.stringify({
    mentionBody: payload.mentionBody,
    includeCommentHistory: Boolean(payload.includeCommentHistory),
    triggerCommentId: payload.triggerCommentId,
  });
}

/** Parse mention job payload; plain text falls back to mention-only (no history). */
export function parseMentionPayload(raw: string | null | undefined): MentionJobPayload {
  const text = (raw ?? "").trim();
  if (!text) {
    return { mentionBody: "", includeCommentHistory: false };
  }
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as Partial<MentionJobPayload>;
      if (typeof parsed.mentionBody === "string") {
        return {
          mentionBody: parsed.mentionBody,
          includeCommentHistory: Boolean(parsed.includeCommentHistory),
          triggerCommentId:
            typeof parsed.triggerCommentId === "string"
              ? parsed.triggerCommentId
              : undefined,
        };
      }
    } catch {
      // treat as plain mention body
    }
  }
  return { mentionBody: text, includeCommentHistory: false };
}

function isHumanAuthor(author: string): boolean {
  const a = author.trim().toLowerCase();
  return a === "human" || a === "人" || a === "user";
}

/** Compress long comments without an LLM call (protocol lines / first paragraph). */
export function summarizeCommentBody(
  body: string,
  maxLen = SUMMARY_MAX,
): string {
  const raw = body.trim();
  if (!raw) return "[摘要] （空）";

  const summary = raw.match(/^\s*SUMMARY:\s*(.+)$/im)?.[1]?.trim()
    ?? raw.match(/\bSUMMARY:\s*([^\n]+)/i)?.[1]?.trim();
  if (summary) {
    const s =
      summary.length <= maxLen ? summary : `${summary.slice(0, maxLen - 1)}…`;
    return `[摘要] SUMMARY: ${s}`;
  }
  const verify = raw.match(/\bVERIFY\s+(pass|fail)\b/i);
  if (verify) return `[摘要] VERIFY ${verify[1]!.toLowerCase()}`;
  const test = raw.match(/\bTEST\s+(pass|fail)\b/i);
  if (test) return `[摘要] TEST ${test[1]!.toLowerCase()}`;

  if (raw.startsWith("实现总结")) {
    const rest = raw.slice("实现总结".length).trim().replace(/\s+/g, " ");
    const s =
      rest.length <= maxLen ? rest : `${rest.slice(0, maxLen - 1)}…`;
    return `[摘要] 实现总结 ${s || "…"}`;
  }

  const flat = raw.replace(/\s+/g, " ");
  if (flat.length <= maxLen) return `[摘要] ${flat}`;
  return `[摘要] ${flat.slice(0, maxLen - 1)}…`;
}

export function formatCommentForHistory(comment: CommentLike): string {
  const body = comment.body.trim();
  const human = isHumanAuthor(comment.author);
  const short = body.length <= SHORT_COMMENT_MAX;
  const text =
    human || short ? body : summarizeCommentBody(body);
  return `${comment.author}: ${text}`;
}

/**
 * Build a compact history block for mention prompts.
 * Keeps human + short comments verbatim; long bot/system comments are summarized.
 */
export function formatMentionCommentHistory(
  comments: CommentLike[],
  opts: {
    triggerCommentId?: string;
    mentionBody?: string;
    limit?: number;
  } = {},
): string {
  const limit = opts.limit ?? HISTORY_LIMIT;
  let list = comments.filter((c) => c.body.trim());
  if (opts.triggerCommentId) {
    list = list.filter((c) => c.id !== opts.triggerCommentId);
  } else if (opts.mentionBody?.trim()) {
    const needle = opts.mentionBody.trim();
    // Drop the newest exact duplicate of the triggering mention.
    for (let i = list.length - 1; i >= 0; i--) {
      if (
        isHumanAuthor(list[i]!.author) &&
        list[i]!.body.trim() === needle
      ) {
        list = [...list.slice(0, i), ...list.slice(i + 1)];
        break;
      }
    }
  }
  const slice = list.slice(-limit);
  if (slice.length === 0) return "";
  return slice.map(formatCommentForHistory).join("\n");
}

export function buildMentionPromptSection(input: {
  mentionBody: string;
  historyBlock?: string;
}): string {
  const lines = [
    "## Human mention (priority)",
    "The user @mentioned you. Answer their message directly first.",
    "Do not re-audit or re-implement the whole card unless they explicitly asked for that.",
    "If they only asked a question (branch, path, status, explanation), answer briefly and do NOT emit SUMMARY:.",
    "",
    "User message:",
    input.mentionBody.trim() || "(empty mention)",
  ];
  if (input.historyBlock?.trim()) {
    lines.push(
      "",
      "## Recent comments (filtered)",
      "Human and short comments are verbatim; long comments are summarized.",
      input.historyBlock.trim(),
    );
  }
  return lines.join("\n");
}
