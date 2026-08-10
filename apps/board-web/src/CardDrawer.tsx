import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Card, type RequirementStatus } from "./api";
import { DesignChat } from "./DesignChat";
import { DocPreviewModal } from "./DocPreviewModal";
import { requirementDerivedBadges, statusLabel } from "./derivedBadges";
import { MarkdownBody } from "./MarkdownBody";
import { RequirementChat } from "./RequirementChat";

type Employee = {
  id: string;
  role: string;
  displayName: string;
};

function DesignRoundPanel(props: {
  boardId: string;
  epicId: string;
  cards: Card[];
  preselectRequirementIds?: string[];
  onCreated: (design: Card) => void;
  onError: (msg: string) => void;
}) {
  const candidates = useMemo(
    () =>
      props.cards.filter(
        (c) =>
          c.type === "requirement" &&
          c.epicId === props.epicId &&
          (c.status === "open" ||
            c.status === "in_progress" ||
            !c.status),
      ),
    [props.cards, props.epicId],
  );

  const [selected, setSelected] = useState<Set<string>>(() => {
    const init = new Set(props.preselectRequirementIds ?? []);
    for (const id of init) {
      if (!candidates.some((c) => c.id === id)) init.delete(id);
    }
    return init;
  });
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const allowed = new Set(candidates.map((c) => c.id));
    setSelected((prev) => {
      const next = new Set<string>();
      for (const id of props.preselectRequirementIds ?? []) {
        if (allowed.has(id)) next.add(id);
      }
      for (const id of prev) {
        if (allowed.has(id)) next.add(id);
      }
      return next;
    });
    // Re-sync when epic or candidate set changes; candidates derived from cards+epicId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.epicId, props.cards, props.preselectRequirementIds]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) {
      props.onError("请至少勾选一个需求");
      return;
    }
    setBusy(true);
    try {
      const design = await api.createDesignRound(props.boardId, {
        epicId: props.epicId,
        title: title.trim() || undefined,
        requirementIds: [...selected],
      });
      props.onCreated(design);
    } catch (e) {
      props.onError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="design-round-panel">
      <h4>开一轮设计</h4>
      <p className="meta">勾选需求后创建设计卡（进入设计列）</p>
      {candidates.length === 0 ? (
        <p className="meta">该 Epic 下暂无 open / in_progress 需求</p>
      ) : (
        <ul className="design-round-list">
          {candidates.map((c) => (
            <li key={c.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                />{" "}
                {c.title}
                <span className="meta"> · {statusLabel(c.status) || "开放"}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <label className="field">
        设计卡标题（可选）
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="默认：Epic 标题 · 设计 日期"
        />
      </label>
      <button type="button" disabled={busy || selected.size === 0} onClick={submit}>
        {busy ? "创建中…" : "创建设计卡"}
      </button>
    </section>
  );
}

export function CardDrawer(props: {
  card: Card;
  cards: Card[];
  onClose: () => void;
  onChanged: () => void;
  onRequestDelete?: () => void;
}) {
  const [comments, setComments] = useState<
    Array<{ id: string; author: string; body: string }>
  >([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(props.card.title);
  const [description, setDescription] = useState(props.card.description);
  const [epicId, setEpicId] = useState(props.card.epicId ?? "");
  const [status, setStatus] = useState<RequirementStatus>(
    props.card.status ?? "open",
  );
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [linkedDesignIds, setLinkedDesignIds] = useState<string[]>([]);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [pipelineBusy, setPipelineBusy] = useState<
    "split" | "verify" | "done" | null
  >(null);
  const [pipelineNote, setPipelineNote] = useState<string | null>(null);
  const [pipelineTone, setPipelineTone] = useState<
    "info" | "wait" | "ok" | "err"
  >("info");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pipelinePollRef = useRef(0);

  const epics = useMemo(
    () => props.cards.filter((c) => c.type === "epic" && c.id !== props.card.id),
    [props.cards, props.card.id],
  );

  const epicTitle = useMemo(() => {
    if (!props.card.epicId) return undefined;
    return props.cards.find((c) => c.id === props.card.epicId)?.title;
  }, [props.cards, props.card.epicId]);

  const linkedRequirements = useMemo(() => {
    if (props.card.type !== "design") return [];
    const ids = new Set(props.card.requirementIds ?? []);
    return props.cards.filter((c) => ids.has(c.id));
  }, [props.card, props.cards]);

  const linkedDesigns = useMemo(() => {
    if (props.card.type !== "requirement") return [];
    return props.cards.filter((c) => linkedDesignIds.includes(c.id));
  }, [props.card.type, props.cards, linkedDesignIds]);

  const derived = useMemo(
    () => requirementDerivedBadges(props.card, props.cards),
    [props.card, props.cards],
  );

  const mentionSuggestions = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    return employees.filter(
      (e) =>
        e.displayName.toLowerCase().includes(q) ||
        e.role.toLowerCase().includes(q),
    );
  }, [employees, mentionQuery]);

  useEffect(() => {
    setTitle(props.card.title);
    setDescription(props.card.description);
    setEpicId(props.card.epicId ?? "");
    setStatus(props.card.status ?? "open");
    setPipelineBusy(null);
    setPipelineNote(null);
    pipelinePollRef.current += 1;
    api.listComments(props.card.id).then(setComments).catch((e) => setError(String(e)));
    api
      .listEmployees(props.card.boardId)
      .then(setEmployees)
      .catch((e) => setError(String(e)));
    if (props.card.type === "requirement" || props.card.type === "design") {
      api
        .getDesignLinks(props.card.id)
        .then((links) => setLinkedDesignIds(links.designIds))
        .catch(() => setLinkedDesignIds([]));
    } else {
      setLinkedDesignIds([]);
    }
  }, [props.card]);

  async function refreshComments() {
    const list = await api.listComments(props.card.id);
    setComments(list);
    return list;
  }

  async function runDesignPipeline(kind: "split" | "verify") {
    setError(null);
    setPipelineBusy(kind);
    setPipelineTone("info");
    setPipelineNote(
      kind === "split"
        ? "正在提交拆分 Job…"
        : "正在提交校验 Job…",
    );
    const pollToken = ++pipelinePollRef.current;
    const beforeIds = new Set(comments.map((c) => c.id));
    try {
      const { job } = await api.createDesignJob(props.card.id, { kind });
      const shortId = job.id.slice(0, 8);
      setPipelineTone("wait");
      setPipelineNote(
        kind === "split"
          ? `拆分 Job 已提交（${shortId}…）。Worker / Cursor 执行中，完成后会在下方评论回写，并创建冻结任务卡。`
          : `校验 Job 已提交（${shortId}…）。Worker / Cursor 执行中，完成后会在下方评论回写 VERIFY 结果。`,
      );
      props.onChanged();

      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        if (pipelinePollRef.current !== pollToken) return;
        const list = await refreshComments();
        const freshBot = list.filter(
          (c) =>
            !beforeIds.has(c.id) &&
            (c.author === "bot" ||
              c.body.includes("Split created") ||
              c.body.includes("VERIFY")),
        );
        if (i % 2 === 1) props.onChanged();
        if (freshBot.length > 0) {
          setPipelineTone("ok");
          setPipelineNote(
            kind === "split"
              ? "拆分已完成：请查看下方评论，并在「开发」列确认新任务卡（校验通过前为冻结）。"
              : "校验已完成：请查看下方评论中的 VERIFY 结论。",
          );
          props.onChanged();
          setPipelineBusy(null);
          return;
        }
        setPipelineNote(
          kind === "split"
            ? `拆分执行中…（已等待约 ${(i + 1) * 2.5}s，Job ${shortId}…）`
            : `校验执行中…（已等待约 ${(i + 1) * 2.5}s，Job ${shortId}…）`,
        );
      }
      setPipelineTone("wait");
      setPipelineNote(
        "仍在等待 Bot 回写。请确认 Cursor Worker 已启动且 board 一致；也可稍后刷新评论。",
      );
    } catch (e) {
      setPipelineTone("err");
      setPipelineNote(null);
      setError(String(e));
    } finally {
      if (pipelinePollRef.current === pollToken) {
        setPipelineBusy(null);
      }
    }
  }

  function detectMention(value: string, cursor: number) {
    const before = value.slice(0, cursor);
    const m = before.match(/@([^\s@]*)$/);
    if (!m) {
      setMentionOpen(false);
      return;
    }
    setMentionQuery(m[1] ?? "");
    setMentionOpen(true);
    setMentionIndex(0);
  }

  function insertMention(emp: Employee) {
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const before = body.slice(0, cursor);
    const after = body.slice(cursor);
    const m = before.match(/@([^\s@]*)$/);
    if (!m) return;
    const start = before.length - m[0].length;
    const next = `${before.slice(0, start)}@${emp.displayName} ${after}`;
    setBody(next);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      const pos = start + emp.displayName.length + 2;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  async function approveTo(to: string) {
    setError(null);
    try {
      await api.moveCard(props.card.id, {
        to,
        actor: "human",
        humanApproved: true,
      });
      props.onChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  async function saveEdits() {
    setError(null);
    try {
      await api.updateCard(props.card.id, {
        title: title.trim() || props.card.title,
        description,
        ...(props.card.type !== "epic" ? { epicId: epicId || null } : {}),
        ...(props.card.type === "requirement" ? { status } : {}),
      });
      props.onChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <>
    <aside className="drawer">
      <div className="drawer-toolbar">
        <button type="button" onClick={props.onClose}>
          关闭
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => props.onRequestDelete?.()}
        >
          删除卡片
        </button>
      </div>
      <label className="field">
        标题
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <p className="meta">
        {props.card.type} · {props.card.column}
        {props.card.type === "requirement" && statusLabel(props.card.status)
          ? ` · ${statusLabel(props.card.status)}`
          : ""}
      </p>
      {derived.length > 0 && (
        <div className="derived-row">
          {derived.map((b) => (
            <span key={b} className="derived-badge">
              {b}
            </span>
          ))}
        </div>
      )}
      {(props.card.epicId ||
        props.card.artifacts.length > 0 ||
        props.card.type === "epic" ||
        props.card.type === "design") && (
        <section className="card-links">
          <h4>文档链接</h4>
          {props.card.epicId && (
            <p className="card-link-epic">
              看板 Epic：
              <strong>{epicTitle ?? props.card.epicId}</strong>
            </p>
          )}
          {props.card.artifacts.length > 0 ? (
            <ul className="artifact-list">
              {props.card.artifacts.map((a, i) => (
                <li key={`${a.kind}-${a.href}-${i}`}>
                  {a.kind === "file" ? (
                    <>
                      <span className="artifact-kind">file</span>{" "}
                      <code title={a.href}>{a.label || a.href}</code>
                      <span className="artifact-path">{a.href}</span>
                      <button
                        type="button"
                        className="linkish artifact-preview-btn"
                        onClick={() => setPreviewPath(a.href)}
                      >
                        预览
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="artifact-kind">{a.kind}</span>{" "}
                      <a href={a.href} target="_blank" rel="noreferrer">
                        {a.label || a.href}
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="meta">
              {props.card.type === "epic" || props.card.epicId
                ? "可打开预览以查看关联 Epic / PRD / 设计与代码"
                : "沉淀后会在此显示 Epic / PRD 文件路径"}
            </p>
          )}
          <button
            type="button"
            className="artifact-open-all"
            onClick={() =>
              setPreviewPath(
                props.card.artifacts.find((a) => a.kind === "file")?.href ?? "",
              )
            }
          >
            打开文档预览
          </button>
        </section>
      )}
      <label className="field">
        描述
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
        />
      </label>
      {props.card.type === "requirement" && (
        <label className="field">
          需求状态
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as RequirementStatus)}
          >
            <option value="open">开放 (open)</option>
            <option value="in_progress">进行中 (in_progress)</option>
            <option value="done">完成 (done)</option>
          </select>
        </label>
      )}
      {props.card.type !== "epic" && props.card.type !== "design" && (
        <label className="field">
          关联 Epic
          <select value={epicId} onChange={(e) => setEpicId(e.target.value)}>
            <option value="">（无）</option>
            {epics.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {props.card.type === "design" && (
        <p className="meta">
          主题 Epic：{epicTitle ?? props.card.epicId ?? "—"}
        </p>
      )}
      <button type="button" onClick={saveEdits}>
        保存修改
      </button>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      {props.card.type === "design" && linkedRequirements.length > 0 && (
        <section className="card-links">
          <h4>关联需求</h4>
          <ul className="artifact-list">
            {linkedRequirements.map((r) => (
              <li key={r.id}>
                {r.title}
                <span className="meta"> · {statusLabel(r.status) || "—"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {props.card.type === "requirement" && linkedDesigns.length > 0 && (
        <section className="card-links">
          <h4>关联设计轮次</h4>
          <ul className="artifact-list">
            {linkedDesigns.map((d) => (
              <li key={d.id}>
                {d.title}
                <span className="meta"> · {d.column}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {props.card.type === "requirement" &&
        props.card.column === "requirements" && (
          <RequirementChat
            boardId={props.card.boardId}
            cardId={props.card.id}
            cardTitle={props.card.title}
            epicId={props.card.epicId}
            epicTitle={epicTitle}
            onSettled={props.onChanged}
          />
        )}

      {props.card.type === "epic" && props.card.column === "requirements" && (
        <DesignRoundPanel
          boardId={props.card.boardId}
          epicId={props.card.id}
          cards={props.cards}
          onCreated={() => props.onChanged()}
          onError={setError}
        />
      )}

      {props.card.type === "requirement" &&
        props.card.epicId &&
        props.card.column === "requirements" && (
          <DesignRoundPanel
            boardId={props.card.boardId}
            epicId={props.card.epicId}
            cards={props.cards}
            preselectRequirementIds={[props.card.id]}
            onCreated={() => props.onChanged()}
            onError={setError}
          />
        )}

      {props.card.type === "design" && props.card.column === "design" && (
        <>
          <DesignChat
            boardId={props.card.boardId}
            cardId={props.card.id}
            cardTitle={props.card.title}
            onSettled={props.onChanged}
          />
          <div className="design-pipeline">
            <div className="chat-actions">
              <button
                type="button"
                disabled={pipelineBusy !== null}
                onClick={() => void runDesignPipeline("split")}
              >
                {pipelineBusy === "split" ? "拆分中…" : "拆分任务"}
              </button>
              <button
                type="button"
                disabled={pipelineBusy !== null}
                onClick={() => void runDesignPipeline("verify")}
              >
                {pipelineBusy === "verify" ? "校验中…" : "校验覆盖"}
              </button>
              <button
                type="button"
                disabled={pipelineBusy !== null}
                onClick={async () => {
                  setError(null);
                  setPipelineBusy("done");
                  setPipelineTone("info");
                  setPipelineNote("正在将设计卡移入 Done…");
                  try {
                    await api.moveCard(props.card.id, {
                      to: "done",
                      actor: "human",
                      humanApproved: true,
                    });
                    setPipelineTone("ok");
                    setPipelineNote("设计卡已移入 Done。");
                    props.onChanged();
                  } catch (e) {
                    setPipelineTone("err");
                    setPipelineNote(null);
                    setError(String(e));
                  } finally {
                    setPipelineBusy(null);
                  }
                }}
              >
                {pipelineBusy === "done" ? "移动中…" : "完成 → Done"}
              </button>
            </div>
            {pipelineNote && (
              <p
                className={`design-pipeline-banner tone-${pipelineTone}`}
                role="status"
              >
                {pipelineBusy && pipelineTone === "wait" && (
                  <span className="design-pipeline-dot" aria-hidden />
                )}
                {pipelineNote}
              </p>
            )}
            <p className="meta">
              拆分会调用 Split Bot（writing-plans）生成 plan 并创建冻结任务卡；校验通过后解冻。相关任务全部
              Done 后可将设计卡移入 Done。
            </p>
          </div>
        </>
      )}
      {props.card.type === "design" && props.card.column === "done" && (
        <p className="meta">本轮设计已完成（Done）</p>
      )}
      {props.card.type === "task" && props.card.column === "accept" && (
        <button type="button" onClick={() => approveTo("done")}>
          人批：验收 → Done
        </button>
      )}
      {props.card.frozen && (
        <div>
          <button
            type="button"
            onClick={async () => {
              await api.humanDecision(props.card.id, "return_dev");
              props.onChanged();
            }}
          >
            解冻→开发
          </button>
          <button
            type="button"
            onClick={async () => {
              await api.humanDecision(props.card.id, "force_accept");
              props.onChanged();
            }}
          >
            解冻→验收
          </button>
          <button
            type="button"
            onClick={async () => {
              await api.humanDecision(props.card.id, "close_done");
              props.onChanged();
            }}
          >
            关闭→Done
          </button>
        </div>
      )}

      <section className="comment-section">
        <div className="comment-section-head">
          <h3>评论 / @Bot</h3>
          <span className="meta">{comments.length} 条</span>
        </div>
        {comments.length === 0 ? (
          <p className="comment-empty">还没有评论。用 @ 提及 Bot 可触发任务。</p>
        ) : (
          <ul className="comment-list">
            {comments.map((c) => {
              const isHuman = c.author === "human" || c.author === "人";
              const isAudit = c.body.trimStart().startsWith("[audit]");
              const roleClass = isHuman
                ? "comment-human"
                : isAudit
                  ? "comment-audit"
                  : "comment-bot";
              return (
                <li key={c.id} className={`comment-item ${roleClass}`}>
                  <div className="comment-item-head">
                    <span className="comment-avatar" aria-hidden>
                      {(c.author || "?").slice(0, 1).toUpperCase()}
                    </span>
                    <strong className="comment-author">{c.author}</strong>
                    {!isHuman && (
                      <span className="comment-badge">
                        {isAudit ? "系统" : "Bot"}
                      </span>
                    )}
                  </div>
                  <div className="comment-body">
                    {isHuman || isAudit ? (
                      <pre className="comment-plain">{c.body}</pre>
                    ) : (
                      <MarkdownBody text={c.body} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="comment-composer">
          <div className="mention-wrap">
            <textarea
              ref={textareaRef}
              value={body}
              rows={3}
              placeholder="输入评论，用 @ 选择 Bot…"
              onChange={(e) => {
                setBody(e.target.value);
                detectMention(e.target.value, e.target.selectionStart);
              }}
              onKeyDown={(e) => {
                if (!mentionOpen || mentionSuggestions.length === 0) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIndex((i) => (i + 1) % mentionSuggestions.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIndex(
                    (i) =>
                      (i - 1 + mentionSuggestions.length) %
                      mentionSuggestions.length,
                  );
                } else if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  insertMention(mentionSuggestions[mentionIndex]!);
                } else if (e.key === "Escape") {
                  setMentionOpen(false);
                }
              }}
              onBlur={() => {
                setTimeout(() => setMentionOpen(false), 150);
              }}
            />
            {mentionOpen && mentionSuggestions.length > 0 && (
              <ul className="mention-menu" role="listbox">
                {mentionSuggestions.map((emp, i) => (
                  <li key={emp.id}>
                    <button
                      type="button"
                      className={i === mentionIndex ? "active" : ""}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertMention(emp);
                      }}
                    >
                      <span className="mention-menu-name">{emp.displayName}</span>
                      <span className="meta">{emp.role}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="comment-composer-actions">
            <button
              type="button"
              className="comment-send"
              disabled={!body.trim()}
              onClick={async () => {
                if (!body.trim()) return;
                await api.addComment(props.card.id, "human", body);
                setBody("");
                setMentionOpen(false);
                const list = await api.listComments(props.card.id);
                setComments(list);
                props.onChanged();
              }}
            >
              发送
            </button>
          </div>
        </div>
      </section>
    </aside>
    {previewPath !== null && (
      <DocPreviewModal
        boardId={props.card.boardId}
        card={props.card}
        cards={props.cards}
        initialPath={previewPath || undefined}
        onClose={() => setPreviewPath(null)}
      />
    )}
    </>
  );
}
