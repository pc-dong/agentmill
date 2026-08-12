import { describe, expect, it } from "vitest";
import {
  buildMentionPromptSection,
  encodeMentionPayload,
  formatMentionCommentHistory,
  parseMentionPayload,
  summarizeCommentBody,
} from "./mentionContext.js";

describe("mentionContext", () => {
  it("round-trips structured payload JSON", () => {
    const raw = encodeMentionPayload({
      mentionBody: "@Dev Bot 当前分支？",
      includeCommentHistory: true,
      triggerCommentId: "c1",
    });
    expect(parseMentionPayload(raw)).toEqual({
      mentionBody: "@Dev Bot 当前分支？",
      includeCommentHistory: true,
      triggerCommentId: "c1",
    });
  });

  it("treats plain text payload as mention-only", () => {
    expect(parseMentionPayload("@Dev Bot hi")).toEqual({
      mentionBody: "@Dev Bot hi",
      includeCommentHistory: false,
    });
  });

  it("summarizes long bot comments via protocol lines", () => {
    const body = [
      "lots of narrative ".repeat(40),
      "SUMMARY: implemented oauth flow",
      "ARTIFACT file docs/x.md X",
    ].join("\n");
    expect(summarizeCommentBody(body)).toMatch(/SUMMARY: implemented oauth/);
  });

  it("keeps human and short comments; summarizes long bot ones", () => {
    const history = formatMentionCommentHistory(
      [
        { id: "1", author: "human", body: "先做登录" },
        {
          id: "2",
          author: "Dev Bot",
          body: `${"x".repeat(300)}\nSUMMARY: done login`,
        },
        { id: "3", author: "human", body: "@Dev Bot 当前分支是什么" },
      ],
      { triggerCommentId: "3" },
    );
    expect(history).toContain("human: 先做登录");
    expect(history).toContain("[摘要] SUMMARY: done login");
    expect(history).not.toContain("@Dev Bot 当前分支是什么");
  });

  it("builds priority mention section", () => {
    const section = buildMentionPromptSection({
      mentionBody: "@Dev Bot 当前分支？",
      historyBlock: "human: earlier",
    });
    expect(section).toMatch(/Human mention \(priority\)/);
    expect(section).toContain("@Dev Bot 当前分支？");
    expect(section).toContain("human: earlier");
    expect(section).toMatch(/do NOT emit SUMMARY/i);
  });
});
