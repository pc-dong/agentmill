import { parseBaSettle } from "./parseBaSettle";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

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

export function RequirementChat(props: {
  boardId: string;
  cardId: string;
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
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef("");

  const statusLine = props.epicId
    ? `已关联 Epic：${props.epicTitle ?? props.epicId}`
    : "将新建 Epic + PRD";

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

  async function startSession() {
    setError(null);
    setStatusNote(null);
    setBusy(true);
    try {
      const { id } = await api.createSession(props.boardId, props.cardId, "ba");
      setSessionId(id);
      const msgs = await api.listSessionMessages(id);
      setLines(
        msgs
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", body: m.body })),
      );
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
    setError(null);
    setStatusNote(null);
    setBusy(true);
    try {
      const lastAssistant = [...lines]
        .reverse()
        .find((l) => l.role === "assistant" && !l.streaming);
      if (!lastAssistant?.body.trim()) {
        throw new Error("没有可沉淀的 BA 回复");
      }
      const parsed = parseBaSettle(lastAssistant.body);
      if ("error" in parsed) {
        throw new Error(`BA settle 协议无效: ${parsed.error}`);
      }
      await api.createBaJob(props.cardId, {
        kind: "settle",
        summary: lastAssistant.body,
      });
      setStatusNote("已提交沉淀 Job，请等 Worker");
      await api.settleSession(sessionId, {
        comment: "ba settle enqueued",
      });
      setSessionId(null);
      setLines([]);
      props.onSettled();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!sessionId) {
    return (
      <section className="design-chat">
        <h3>需求澄清</h3>
        <p className="meta">{statusLine}</p>
        {error && <p className="chat-error">{error}</p>}
        {statusNote && <p className="meta">{statusNote}</p>}
        <button type="button" disabled={busy} onClick={startSession}>
          开始澄清
        </button>
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
            <strong>{line.role === "user" ? "你" : "BA Bot"}</strong>
            <pre>{line.body}</pre>
            {line.streaming && <span className="chat-streaming">…</span>}
          </li>
        ))}
      </ul>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        placeholder="描述需求或回答 BA 追问…"
        disabled={busy}
      />
      <div className="chat-actions">
        <button type="button" disabled={busy || !draft.trim()} onClick={sendMessage}>
          发送
        </button>
        <button type="button" disabled={busy} onClick={settle}>
          沉淀结论
        </button>
      </div>
    </section>
  );
}
