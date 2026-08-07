import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Card } from "./api";
import { DesignChat } from "./DesignChat";
import { RequirementChat } from "./RequirementChat";

type Employee = {
  id: string;
  role: string;
  displayName: string;
};

export function CardDrawer(props: {
  card: Card;
  cards: Card[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [comments, setComments] = useState<
    Array<{ id: string; author: string; body: string }>
  >([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(props.card.title);
  const [description, setDescription] = useState(props.card.description);
  const [epicId, setEpicId] = useState(props.card.epicId ?? "");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const epics = useMemo(
    () => props.cards.filter((c) => c.type === "epic" && c.id !== props.card.id),
    [props.cards, props.card.id],
  );

  const epicTitle = useMemo(() => {
    if (!props.card.epicId) return undefined;
    return props.cards.find((c) => c.id === props.card.epicId)?.title;
  }, [props.cards, props.card.epicId]);

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
    api.listComments(props.card.id).then(setComments).catch((e) => setError(String(e)));
    api
      .listEmployees(props.card.boardId)
      .then(setEmployees)
      .catch((e) => setError(String(e)));
  }, [props.card]);

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
        ...(props.card.type !== "epic"
          ? { epicId: epicId || null }
          : {}),
      });
      props.onChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <aside className="drawer">
      <button type="button" onClick={props.onClose}>
        关闭
      </button>
      <label className="field">
        标题
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <p className="meta">
        {props.card.type} · {props.card.column}
      </p>
      <label className="field">
        描述
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
        />
      </label>
      {props.card.type !== "epic" && (
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
      <button type="button" onClick={saveEdits}>
        保存修改
      </button>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

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
        <button
          type="button"
          onClick={async () => {
            setError(null);
            try {
              await api.moveCard(props.card.id, {
                to: "design",
                actor: "human",
              });
              props.onChanged();
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          进入设计列
        </button>
      )}

      {props.card.type === "epic" && props.card.column === "design" && (
        <>
          <DesignChat
            boardId={props.card.boardId}
            cardId={props.card.id}
            onSettled={props.onChanged}
          />
          <button type="button" onClick={() => approveTo("split")}>
            人批：设计 → 拆分
          </button>
        </>
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

      <h3>评论 / @Bot</h3>
      <ul>
        {comments.map((c) => (
          <li key={c.id}>
            <strong>{c.author}</strong>: {c.body}
          </li>
        ))}
      </ul>
      <div className="mention-wrap">
        <textarea
          ref={textareaRef}
          value={body}
          rows={3}
          placeholder="输入 @ 选择 Bot，如 @Design Bot"
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
                  {emp.displayName}
                  <span className="meta"> @{emp.role}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
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
    </aside>
  );
}
