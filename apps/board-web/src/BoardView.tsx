import { useRef, useState } from "react";
import type { Card } from "./api";
import { DocPreviewModal } from "./DocPreviewModal";
import { requirementDerivedBadges, statusLabel } from "./derivedBadges";

const COLUMNS: Array<{ id: string; label: string }> = [
  { id: "requirements", label: "需求" },
  { id: "design", label: "待办" },
  { id: "dev", label: "开发" },
  { id: "test", label: "测试" },
  { id: "accept", label: "验收" },
  { id: "done", label: "Done" },
];

const OCCUPANCY: Record<Card["type"], readonly string[]> = {
  requirement: ["requirements"],
  epic: ["requirements"],
  design: ["design", "done"],
  task: ["design", "dev", "test", "accept", "done"],
};

const HUMAN_GATES = new Set(["design→done", "accept→done"]);

function needsHumanGate(from: string, to: string): boolean {
  return HUMAN_GATES.has(`${from}→${to}`);
}

function formatElapsed(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m${String(s).padStart(2, "0")}s`;
}

export function BoardView(props: {
  cards: Card[];
  onOpen: (card: Card) => void;
  onMove: (
    card: Card,
    to: string,
    opts?: { humanApproved?: boolean },
  ) => Promise<void>;
  onRequestDelete: (card: Card) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ card: Card; path: string } | null>(
    null,
  );
  const dragCardRef = useRef<Card | null>(null);
  const didDragRef = useRef(false);

  const epicTitle = (epicId: string | null) => {
    if (!epicId) return null;
    return props.cards.find((c) => c.id === epicId)?.title ?? null;
  };

  const dragging = draggingId
    ? props.cards.find((c) => c.id === draggingId)
    : null;

  async function handleDrop(columnId: string) {
    const card = dragCardRef.current;
    setDragOverCol(null);
    setDraggingId(null);
    dragCardRef.current = null;
    if (!card || card.column === columnId) return;

    if (card.type === "epic") {
      setError("Epic 是主题容器，固定在需求列，请用「开一轮设计」推进");
      return;
    }

    if (!OCCUPANCY[card.type].includes(columnId)) {
      setError(
        `${card.type} 不能放到「${COLUMNS.find((c) => c.id === columnId)?.label ?? columnId}」列`,
      );
      return;
    }

    const skipFrozenConfirm =
      card.type === "task" &&
      card.column === "design" &&
      columnId === "dev";

    let humanApproved = false;
    if (needsHumanGate(card.column, columnId)) {
      const ok = window.confirm(
        `将「${card.title}」从 ${card.column} 移到 ${columnId} 需要人工确认，是否继续？`,
      );
      if (!ok) return;
      humanApproved = true;
    } else if (card.frozen && !skipFrozenConfirm) {
      const ok = window.confirm(
        `卡片「${card.title}」已冻结，确认仍要移动吗？`,
      );
      if (!ok) return;
      humanApproved = true;
    }

    setError(null);
    try {
      await props.onMove(card, columnId, { humanApproved });
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="board-wrap">
      {error && (
        <p className="board-error" role="alert">
          {error}
          <button type="button" className="linkish" onClick={() => setError(null)}>
            关闭
          </button>
        </p>
      )}
      <div className="board">
        {COLUMNS.map((col) => {
          const allowed = dragging
            ? dragging.type !== "epic" &&
              OCCUPANCY[dragging.type].includes(col.id)
            : true;
          const isOver = dragOverCol === col.id && allowed;
          return (
            <section
              className={`column${isOver ? " column-drop-target" : ""}${
                dragging && !allowed ? " column-drop-forbidden" : ""
              }`}
              key={col.id}
              onDragOver={(e) => {
                if (!draggingId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = allowed ? "move" : "none";
                setDragOverCol(col.id);
              }}
              onDragLeave={() => {
                setDragOverCol((cur) => (cur === col.id ? null : cur));
              }}
              onDrop={(e) => {
                e.preventDefault();
                void handleDrop(col.id);
              }}
            >
              <h3>{col.label}</h3>
              {props.cards
                .filter((c) => c.column === col.id)
                .map((c) => {
                  const linked = epicTitle(c.epicId);
                  const canDrag = c.type !== "epic";
                  const derived =
                    c.type === "requirement"
                      ? requirementDerivedBadges(c, props.cards)
                      : [];
                  const reqStatus =
                    c.type === "requirement" ? statusLabel(c.status) : "";
                  const reqCount =
                    c.type === "design"
                      ? (c.requirementIds ?? []).length
                      : 0;
                  return (
                    <div
                      key={c.id}
                      className={`card${c.frozen ? " frozen" : ""}${
                        c.type === "epic" ? " epic" : ""
                      }${c.type === "design" ? " design" : ""}${
                        c.lockedJobId ? " bot-busy" : ""
                      }${draggingId === c.id ? " card-dragging" : ""}${
                        !canDrag ? " card-fixed" : ""
                      }`}
                      draggable={canDrag}
                      onDragStart={(e) => {
                        if (!canDrag) {
                          e.preventDefault();
                          return;
                        }
                        didDragRef.current = false;
                        dragCardRef.current = c;
                        setDraggingId(c.id);
                        setError(null);
                        e.dataTransfer.setData("text/plain", c.id);
                        e.dataTransfer.effectAllowed = "move";
                        requestAnimationFrame(() => {
                          didDragRef.current = true;
                        });
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverCol(null);
                        dragCardRef.current = null;
                        setTimeout(() => {
                          didDragRef.current = false;
                        }, 50);
                      }}
                      onClick={() => {
                        if (didDragRef.current) return;
                        props.onOpen(c);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          props.onOpen(c);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="card-top">
                        <div className="meta">
                          {c.type}
                          {c.reworkCount > 0 ? ` · rework ${c.reworkCount}` : ""}
                          {c.frozen ? " · FROZEN" : ""}
                        </div>
                        <button
                          type="button"
                          className="card-delete"
                          title="删除卡片"
                          aria-label={`删除 ${c.title}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onRequestDelete(c);
                          }}
                        >
                          ×
                        </button>
                      </div>
                      <strong>{c.title}</strong>
                      {c.lockedJobId && (
                        <span
                          className="bot-busy-badge"
                          title={
                            c.lockedAt
                              ? `自 ${c.lockedAt} 起处理中`
                              : "Bot 正在处理此卡"
                          }
                        >
                          <span className="bot-busy-dot" aria-hidden />
                          {c.processingBy
                            ? `${c.processingBy} 处理中`
                            : "Bot 处理中"}
                        </span>
                      )}
                      {c.activeJob && (
                        <div className="bot-job-progress" title={c.activeJob.progress ?? undefined}>
                          <div className="bot-job-progress-meta">
                            {c.activeJob.displayName}
                            {" · "}
                            {c.activeJob.trigger}
                            {c.activeJob.claimedAt
                              ? ` · 已 ${formatElapsed(c.activeJob.claimedAt)}`
                              : ""}
                          </div>
                          {c.activeJob.progress && (
                            <div className="bot-job-progress-text">
                              {c.activeJob.progress}
                            </div>
                          )}
                        </div>
                      )}
                      {reqStatus && (
                        <span
                          className={`status-badge status-${c.status ?? "open"}`}
                        >
                          {reqStatus}
                        </span>
                      )}
                      {derived.map((b) => (
                        <span key={b} className="derived-badge" title={b}>
                          {b}
                        </span>
                      ))}
                      {reqCount > 0 && (
                        <div className="meta">关联需求 {reqCount}</div>
                      )}
                      {linked && <div className="epic-link">→ {linked}</div>}
                      {c.artifacts
                        .filter(
                          (a) =>
                            a.kind === "file" &&
                            (/EPIC\.md$/i.test(a.href) ||
                              /\/prds\//.test(a.href) ||
                              /\.(java|ts|tsx|js|jsx|css|md)$/i.test(a.href)),
                        )
                        .slice(0, 3)
                        .map((a) => (
                          <button
                            key={a.href}
                            type="button"
                            className="artifact-chip"
                            title={`预览 ${a.href}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreview({ card: c, path: a.href });
                            }}
                          >
                            {a.label ||
                              (/EPIC\.md$/i.test(a.href)
                                ? "Epic"
                                : /\/prds\//.test(a.href)
                                  ? "PRD"
                                  : /\.java$/i.test(a.href)
                                    ? "Java"
                                    : /\.(ts|tsx|js|jsx)$/i.test(a.href)
                                      ? "前端"
                                      : "文档")}
                          </button>
                        ))}
                    </div>
                  );
                })}
            </section>
          );
        })}
      </div>
      <p className="board-hint meta">
        Epic 固定需求列；拆分任务落在待办列，校验通过后可拖入开发。也可直接新建任务到待办列再拖入开发。设计卡用侧栏「拆分对齐/校验」。相关任务全部
        Done 后可将设计卡拖到 Done（需确认）。验收→Done 也需确认。
      </p>
      {preview && (
        <DocPreviewModal
          boardId={preview.card.boardId}
          card={preview.card}
          cards={props.cards}
          initialPath={preview.path}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
