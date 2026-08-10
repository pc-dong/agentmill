import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ArtifactHint } from "./api";
import { MarkdownBody } from "./MarkdownBody";
import { SlashSuggestMenu, useSlashSuggest } from "./SlashSuggest";

const ARTIFACT_LINE =
  /^ARTIFACT\s+(file|url|pr)\s+(\S+)(?:\s+(.+))?$/i;

function parseArtifactHints(text: string): ArtifactHint[] {
  const out: ArtifactHint[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(ARTIFACT_LINE);
    if (!m) continue;
    out.push({
      kind: m[1]!.toLowerCase() as ArtifactHint["kind"],
      href: m[2]!,
      label: m[3]?.trim() || undefined,
    });
  }
  return out;
}

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

export function DesignChat(props: {
  boardId: string;
  cardId: string;
  cardTitle?: string;
  onSettled: () => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [historyOnly, setHistoryOnly] = useState(false);
  /** Closed session id when viewing read-only history (for 继续对齐). */
  const [historySessionId, setHistorySessionId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef("");
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const slash = useSlashSuggest({
    boardId: props.boardId,
    value: draft,
    setValue: setDraft,
    textareaRef: draftRef,
  });

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
          setBusy(false);
          break;
        case "session.agent_error":
          setError(msg.message);
          setBusy(false);
          streamRef.current = "";
          setLines((prev) =>
            prev.filter((l) => !(l.role === "assistant" && l.streaming)),
          );
          break;
        case "error":
          setError(msg.message);
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

  useEffect(() => {
    let cancelled = false;
    setHydrating(true);
    setSessionId(null);
    setLines([]);
    setHistoryOnly(false);
    setHistorySessionId(null);
    setStatusNote(null);
    (async () => {
      try {
        const latest = await api.getLatestSession(
          props.boardId,
          props.cardId,
          "design",
        );
        if (cancelled || !latest) return;
        const msgs = latest.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            body: m.body,
          }));
        if (latest.session.status === "open") {
          setSessionId(latest.session.id);
          setLines(msgs);
          setHistoryOnly(false);
          setHistorySessionId(null);
          if (msgs.length > 0) setStatusNote("已恢复进行中的设计对齐");
        } else if (msgs.length > 0) {
          setLines(msgs);
          setHistoryOnly(true);
          setHistorySessionId(latest.session.id);
          setStatusNote("显示上次设计对齐记录（只读，可继续对齐）");
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
        "design",
      );
      setSessionId(id);
      setHistoryOnly(false);
      setHistorySessionId(null);
      const msgs = await api.listSessionMessages(id);
      setLines(
        msgs
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", body: m.body })),
      );
      if (resumed) setStatusNote("已恢复进行中的设计对齐");
      else setStatusNote("已开始新一轮设计对齐");
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
      setLines(
        msgs
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", body: m.body })),
      );
      setStatusNote("已继续上次设计对齐会话");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function sendMessage() {
    const text = draft.trim();
    if (!text || !sessionId || !wsRef.current || wsRef.current.readyState !== 1) {
      return;
    }
    setError(null);
    setDraft("");
    setLines((prev) => [...prev, { role: "user", body: text }]);
    setBusy(true);
    streamRef.current = "";
    wsRef.current.send(
      JSON.stringify({
        type: "session.user_message",
        sessionId,
        text,
      }),
    );
  }

  async function settle() {
    if (!sessionId) return;
    const closedId = sessionId;
    setError(null);
    setBusy(true);
    try {
      const lastAssistant = [...lines]
        .reverse()
        .find((l) => l.role === "assistant" && !l.streaming);
      const artifacts = lastAssistant
        ? parseArtifactHints(lastAssistant.body)
        : [];
      await api.settleSession(
        sessionId,
        artifacts.length
          ? { artifacts, comment: "settled from chat" }
          : { comment: "settled from chat" },
      );
      setHistoryOnly(true);
      setHistorySessionId(closedId);
      setSessionId(null);
      setStatusNote("设计对齐已沉淀，记录仍可查看；可点「继续对齐」");
      props.onSettled();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deepDive() {
    setError(null);
    setStatusNote(null);
    setBusy(true);
    try {
      const transcript = lines
        .filter((l) => !l.streaming && l.body.trim())
        .map((l) => `${l.role === "user" ? "user" : "design"}: ${l.body}`)
        .join("\n\n")
        .trim();
      const summary =
        transcript ||
        `Deep dive design for: ${props.cardTitle ?? props.cardId}`;
      await api.createDesignJob(props.cardId, {
        kind: "deep_dive",
        summary,
      });
      setStatusNote(
        sessionId
          ? "已提交 Cursor 深挖 Job，可继续在本会话对齐；完成后请再点沉淀结论"
          : "已提交 Cursor 深挖 Job，完成后请再点沉淀结论；可「继续对齐」回到上次会话",
      );
      props.onSettled();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (hydrating) {
    return (
      <section className="design-chat">
        <h3>设计对齐</h3>
        <p className="meta">加载对齐记录…</p>
      </section>
    );
  }

  if (!sessionId) {
    return (
      <section className="design-chat">
        <h3>设计对齐</h3>
        {error && <p className="chat-error">{error}</p>}
        {statusNote && <p className="meta">{statusNote}</p>}
        {lines.length > 0 && (
          <ul className="chat-transcript">
            {lines.map((line, i) => (
              <li key={i} className={`chat-line chat-${line.role}`}>
                <strong>{line.role === "user" ? "你" : "Design Bot"}</strong>
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
              继续对齐
            </button>
          )}
          <button type="button" disabled={busy} onClick={startSession}>
            {historyOnly ? "开始新一轮对齐" : "开始对齐"}
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
      <h3>设计对齐</h3>
      {error && <p className="chat-error">{error}</p>}
      {statusNote && <p className="meta">{statusNote}</p>}
      <ul className="chat-transcript">
        {lines.map((line, i) => (
          <li key={i} className={`chat-line chat-${line.role}`}>
            <strong>{line.role === "user" ? "你" : "Design Bot"}</strong>
            {line.role === "assistant" ? (
              <MarkdownBody text={line.body} streaming={line.streaming} />
            ) : (
              <pre>{line.body}</pre>
            )}
            {line.streaming && <span className="chat-streaming">…</span>}
          </li>
        ))}
      </ul>
      <div className="mention-wrap chat-composer-wrap">
        <textarea
          ref={draftRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            slash.detect(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={slash.onKeyDown}
          onBlur={() => {
            setTimeout(() => slash.close(), 150);
          }}
          rows={2}
          placeholder="描述设计目标或追问… 输入 / 可选用 skill 或命令"
          disabled={busy}
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
        <button type="button" disabled={busy || !draft.trim()} onClick={sendMessage}>
          发送
        </button>
        <button type="button" disabled={busy} onClick={settle}>
          沉淀结论
        </button>
        <button type="button" disabled={busy} onClick={deepDive}>
          在 Cursor 中深挖
        </button>
      </div>
    </section>
  );
}
