import { parseBaSettle } from "./parseBaSettle";
import { MarkdownBody } from "./MarkdownBody";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { SlashSuggestMenu, useSlashSuggest } from "./SlashSuggest";

type ChatLine = {
  role: "user" | "assistant";
  body: string;
  streaming?: boolean;
};

type WsServerMsg =
  | { type: "session.agent_delta"; sessionId: string; text: string }
  | { type: "session.agent_done"; sessionId: string; summary: string }
  | { type: "session.agent_error"; sessionId: string; message: string }
  | { type: "error"; message: string };

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function lastUserIndex(lines: ChatLine[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.role === "user") return i;
  }
  return -1;
}

export function RequirementChat(props: {
  boardId: string;
  cardId: string;
  cardTitle: string;
  epicId: string | null;
  epicTitle?: string;
  onSettled: () => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [historyOnly, setHistoryOnly] = useState(false);
  /** Closed session id when viewing read-only history (for 继续澄清). */
  const [historySessionId, setHistorySessionId] = useState<string | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef("");
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  /** After requesting settle protocol from BA, auto-submit when reply arrives. */
  const pendingSettleRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;

  const slash = useSlashSuggest({
    boardId: props.boardId,
    value: draft,
    setValue: setDraft,
    textareaRef: draftRef,
  });

  const statusLine = props.epicId
    ? `已关联 Epic：${props.epicTitle ?? props.epicId}`
    : "将新建 Epic + PRD";

  function linesFromMessages(
    msgs: Array<{ role: string; body: string }>,
  ): ChatLine[] {
    return msgs
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        body: m.body,
      }));
  }

  const appendDelta = useCallback((text: string) => {
    streamRef.current += text;
    const body = streamRef.current;
    setLines((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last.streaming) {
        return [...prev.slice(0, -1), { ...last, body }];
      }
      return [...prev, { role: "assistant", body, streaming: true }];
    });
  }, []);

  const finalizeAssistant = useCallback((summary: string) => {
    streamRef.current = "";
    setLines((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last.streaming) {
        return [...prev.slice(0, -1), { role: "assistant", body: summary }];
      }
      return [...prev, { role: "assistant", body: summary }];
    });
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "hello",
          role: "ui",
          boardId: props.boardId,
        }),
      );
    };

    ws.onmessage = (ev) => {
      let msg: WsServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as WsServerMsg;
      } catch {
        return;
      }
      if ("sessionId" in msg && msg.sessionId !== sessionId) return;

      switch (msg.type) {
        case "session.agent_delta":
          appendDelta(msg.text);
          break;
        case "session.agent_done":
          finalizeAssistant(msg.summary);
          if (pendingSettleRef.current) {
            pendingSettleRef.current = false;
            void finishSettle(msg.summary);
          } else {
            setBusy(false);
            setStatusNote(null);
          }
          break;
        case "session.agent_error":
          pendingSettleRef.current = false;
          setError(msg.message);
          setBusy(false);
          setStatusNote(null);
          streamRef.current = "";
          setLines((prev) =>
            prev.filter((l) => !(l.role === "assistant" && l.streaming)),
          );
          break;
        case "error":
          pendingSettleRef.current = false;
          setError(msg.message);
          setBusy(false);
          setStatusNote(null);
          break;
      }
    };

    ws.onerror = () => setError("WebSocket 连接失败");
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
    };

    return () => {
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [sessionId, props.boardId, appendDelta, finalizeAssistant]);

  // Restore open session (or show latest closed history) after refresh.
  useEffect(() => {
    let cancelled = false;
    setHydrating(true);
    setError(null);
    setSessionId(null);
    setLines([]);
    setHistoryOnly(false);
    setHistorySessionId(null);
    setStatusNote(null);
    setEditingIdx(null);

    (async () => {
      try {
        const latest = await api.getLatestSession(
          props.boardId,
          props.cardId,
          "ba",
        );
        if (cancelled || !latest) return;
        const msgs = linesFromMessages(latest.messages);
        if (latest.session.status === "open") {
          setSessionId(latest.session.id);
          setLines(msgs);
          setHistoryOnly(false);
          setHistorySessionId(null);
          setStatusNote(
            msgs.length > 0 ? "已恢复进行中的澄清会话" : null,
          );
        } else if (msgs.length > 0) {
          setLines(msgs);
          setHistoryOnly(true);
          setHistorySessionId(latest.session.id);
          setStatusNote("显示上次已结束的澄清记录（只读）");
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.boardId, props.cardId]);

  async function startSession() {
    setError(null);
    setStatusNote(null);
    setBusy(true);
    try {
      const { id, resumed } = await api.createSession(
        props.boardId,
        props.cardId,
        "ba",
      );
      setSessionId(id);
      setHistoryOnly(false);
      setHistorySessionId(null);
      const msgs = await api.listSessionMessages(id);
      setLines(linesFromMessages(msgs));
      if (resumed) {
        setStatusNote("已恢复进行中的澄清会话");
      } else {
        setStatusNote("已开始新一轮澄清");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function continueSession() {
    if (!historySessionId) return;
    setError(null);
    setStatusNote(null);
    setBusy(true);
    try {
      const reopened = await api.reopenSession(historySessionId);
      setSessionId(reopened.id);
      setHistoryOnly(false);
      setHistorySessionId(null);
      const msgs = await api.listSessionMessages(reopened.id);
      setLines(linesFromMessages(msgs));
      setStatusNote("已继续上次澄清会话");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function closeWithoutSettle() {
    if (!sessionId) return;
    setError(null);
    setBusy(true);
    try {
      await api.closeSession(sessionId);
      setStatusNote("会话已关闭，记录仍可查看");
      setHistoryOnly(true);
      setHistorySessionId(sessionId);
      setSessionId(null);
      setEditingIdx(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function sendMessage() {
    const text = draft.trim();
    if (!text || !sessionId) return;
    if (!wsRef.current || wsRef.current.readyState !== 1) {
      setError("未连上会话通道，请关闭后重新「开始澄清」，并确认 Worker 已启动且 boardId 一致");
      return;
    }
    setError(null);
    setStatusNote("BA 正在回复…");
    setDraft("");
    setEditingIdx(null);
    setBusy(true);
    streamRef.current = "";
    setLines((prev) => [
      ...prev,
      { role: "user", body: text },
      { role: "assistant", body: "", streaming: true },
    ]);
    wsRef.current.send(
      JSON.stringify({
        type: "session.user_message",
        sessionId,
        text,
      }),
    );
  }

  function stopGeneration() {
    if (!sessionId || !wsRef.current || wsRef.current.readyState !== 1) return;
    pendingSettleRef.current = false;
    wsRef.current.send(
      JSON.stringify({
        type: "session.abort",
        sessionId,
      }),
    );
    setStatusNote("正在打断…");
  }

  function beginEditLastUser() {
    const idx = lastUserIndex(lines);
    if (idx < 0 || busy) return;
    setEditingIdx(idx);
    setEditDraft(lines[idx]?.body ?? "");
  }

  function buildSettleProtocolRequest(): string {
    const modeHint = props.epicId
      ? `卡片已关联 Epic，请使用 EPIC_MODE link，并与已有 Epic 对齐。`
      : `卡片尚未关联 Epic，请使用 EPIC_MODE create。`;
    return [
      "请根据以上澄清结论立即输出沉淀协议，不要再追问。",
      `需求卡片标题：${props.cardTitle}`,
      modeHint,
      "必须逐行输出纯文本协议（不要包在 markdown 代码块里，不要用列表符号）：",
      "EPIC_MODE create|link",
      "EPIC_ID …",
      "EPIC_SLUG …",
      "EPIC_TITLE …",
      "PRD_ID …",
      "PRD_SLUG …",
      "PRD_TITLE …",
      "ARTIFACT file docs/epics/…/…md …",
    ].join("\n");
  }

  function sendChatText(text: string, status: string) {
    if (!sessionId) return;
    if (!wsRef.current || wsRef.current.readyState !== 1) {
      pendingSettleRef.current = false;
      setError("未连上会话通道，请确认 Worker 已启动");
      setBusy(false);
      return;
    }
    setError(null);
    setStatusNote(status);
    setEditingIdx(null);
    setBusy(true);
    streamRef.current = "";
    setLines((prev) => [
      ...prev,
      { role: "user", body: text },
      { role: "assistant", body: "", streaming: true },
    ]);
    wsRef.current.send(
      JSON.stringify({
        type: "session.user_message",
        sessionId,
        text,
      }),
    );
  }

  async function finishSettle(summary: string) {
    const sid = sessionIdRef.current;
    if (!sid) {
      setBusy(false);
      return;
    }
    setBusy(true);
    setStatusNote("正在提交沉淀…");
    try {
      const parsed = parseBaSettle(summary);
      if ("error" in parsed) {
        throw new Error(
          `BA settle 协议无效: ${parsed.error}。请再点「沉淀结论」，或让 BA 补全协议行后再试。`,
        );
      }
      await api.createBaJob(props.cardId, {
        kind: "settle",
        summary,
      });
      await api.settleSession(sid, {
        comment: "ba settle enqueued",
      });
      setStatusNote("已提交沉淀 Job，请等 Worker；澄清记录已保留");
      setHistoryOnly(true);
      setHistorySessionId(sid);
      setSessionId(null);
      props.onSettled();
    } catch (e) {
      setError(String(e));
      setStatusNote(null);
    } finally {
      setBusy(false);
    }
  }

  async function settle() {
    if (!sessionId) return;
    setError(null);
    setStatusNote(null);
    setBusy(true);
    try {
      const lastAssistant = [...lines]
        .reverse()
        .find((l) => l.role === "assistant" && !l.streaming);
      if (!lastAssistant?.body.trim()) {
        pendingSettleRef.current = true;
        sendChatText(
          buildSettleProtocolRequest(),
          "尚无 BA 结论，正在请其生成沉淀协议…",
        );
        return;
      }
      const parsed = parseBaSettle(lastAssistant.body);
      if ("error" in parsed) {
        pendingSettleRef.current = true;
        sendChatText(
          buildSettleProtocolRequest(),
          "上次回复缺少沉淀协议，正在请 BA 生成…",
        );
        return;
      }
      await finishSettle(lastAssistant.body);
    } catch (e) {
      pendingSettleRef.current = false;
      setError(String(e));
      setBusy(false);
    }
  }

  async function saveEditAndResend() {
    const text = editDraft.trim();
    if (!text || !sessionId || editingIdx === null) return;
    if (!wsRef.current || wsRef.current.readyState !== 1) {
      setError("未连上会话通道，请确认 Worker 已启动");
      return;
    }
    setError(null);
    setBusy(true);
    setStatusNote("已更新消息，BA 正在重新回复…");
    try {
      const { messages } = await api.editLastUserMessage(sessionId, text);
      const next = linesFromMessages(messages);
      streamRef.current = "";
      setLines([
        ...next,
        { role: "assistant", body: "", streaming: true },
      ]);
      setEditingIdx(null);
      setEditDraft("");
      wsRef.current.send(
        JSON.stringify({
          type: "session.retry",
          sessionId,
        }),
      );
    } catch (e) {
      setError(String(e));
      setBusy(false);
      setStatusNote(null);
    }
  }

  async function deepDive() {
    setError(null);
    setStatusNote(null);
    setBusy(true);
    try {
      const transcript = lines
        .filter((l) => !l.streaming && l.body.trim())
        .map((l) => `${l.role === "user" ? "user" : "ba"}: ${l.body}`)
        .join("\n\n")
        .trim();
      const summary =
        transcript || `Deep dive for: ${props.cardTitle}`;
      // Keep the clarification session open so history stays editable.
      // deep_dive jobs are claimable even while a session is open.
      await api.createBaJob(props.cardId, {
        kind: "deep_dive",
        summary,
      });
      setStatusNote(
        sessionId
          ? "已提交深挖 Job，可继续在本会话澄清；完成后请再点沉淀"
          : "已提交深挖 Job，完成后请再点沉淀；可「继续澄清」回到上次会话",
      );
      props.onSettled();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const lastUserIdx = lastUserIndex(lines);
  const canEditLast =
    !!sessionId && !busy && !historyOnly && lastUserIdx >= 0;

  if (hydrating) {
    return (
      <section className="design-chat">
        <h3>需求澄清</h3>
        <p className="meta">{statusLine}</p>
        <p className="meta">加载澄清记录…</p>
      </section>
    );
  }

  if (!sessionId) {
    return (
      <section className="design-chat">
        <h3>需求澄清</h3>
        <p className="meta">{statusLine}</p>
        {error && <p className="chat-error">{error}</p>}
        {statusNote && <p className="meta">{statusNote}</p>}
        {lines.length > 0 && (
          <ul className="chat-transcript">
            {lines.map((line, i) => (
              <li key={i} className={`chat-line chat-${line.role}`}>
                <strong>{line.role === "user" ? "你" : "BA Bot"}</strong>
                {line.role === "assistant" ? (
                  <MarkdownBody text={line.body} />
                ) : (
                  <pre>{line.body}</pre>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="chat-actions">
          {historyOnly && historySessionId && (
            <button type="button" disabled={busy} onClick={continueSession}>
              继续澄清
            </button>
          )}
          <button type="button" disabled={busy} onClick={startSession}>
            {historyOnly ? "开始新一轮澄清" : "开始澄清"}
          </button>
          <button type="button" disabled={busy} onClick={deepDive}>
            在 Cursor 中深挖
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="design-chat">
      <h3>需求澄清</h3>
      <p className="meta">{statusLine}</p>
      {error && <p className="chat-error">{error}</p>}
      {statusNote && <p className="meta">{statusNote}</p>}
      <ul className="chat-transcript">
        {lines.map((line, i) => (
          <li key={i} className={`chat-line chat-${line.role}`}>
            <div className="chat-line-head">
              <strong>{line.role === "user" ? "你" : "BA Bot"}</strong>
              {canEditLast && i === lastUserIdx && editingIdx !== i && (
                <button
                  type="button"
                  className="chat-edit-btn"
                  onClick={beginEditLastUser}
                >
                  编辑
                </button>
              )}
            </div>
            {editingIdx === i ? (
              <div className="chat-edit-block">
                <textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  rows={3}
                  autoFocus
                />
                <div className="chat-actions">
                  <button
                    type="button"
                    disabled={!editDraft.trim() || busy}
                    onClick={saveEditAndResend}
                  >
                    保存并重新发送
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditingIdx(null);
                      setEditDraft("");
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : line.role === "assistant" ? (
              <MarkdownBody text={line.body} streaming={line.streaming} />
            ) : (
              <pre>{line.body}</pre>
            )}
            {line.streaming && <span className="chat-streaming">正在生成</span>}
          </li>
        ))}
      </ul>
      {busy && <p className="meta chat-streaming">BA 正在回复…</p>}
      <div className="mention-wrap chat-composer-wrap">
        <textarea
          ref={draftRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            slash.detect(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={(e) => {
            slash.onKeyDown(e);
          }}
          onBlur={() => {
            setTimeout(() => slash.close(), 150);
          }}
          rows={2}
          placeholder="描述需求或回答 BA 追问… 输入 / 可选用 skill 或命令"
          disabled={busy || editingIdx !== null}
        />
        {slash.open && (
          <SlashSuggestMenu
            suggestions={slash.suggestions}
            index={slash.index}
            onPick={slash.insert}
            onHover={slash.setIndex}
          />
        )}
      </div>
      <div className="chat-actions">
        {busy ? (
          <button type="button" className="chat-stop-btn" onClick={stopGeneration}>
            停止生成
          </button>
        ) : (
          <button
            type="button"
            disabled={!draft.trim() || editingIdx !== null}
            onClick={sendMessage}
          >
            发送
          </button>
        )}
        <button type="button" disabled={busy} onClick={deepDive}>
          在 Cursor 中深挖
        </button>
        <button type="button" disabled={busy} onClick={settle}>
          沉淀结论
        </button>
        <button type="button" disabled={busy} onClick={closeWithoutSettle}>
          关闭会话
        </button>
      </div>
    </section>
  );
}
