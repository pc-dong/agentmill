import { useEffect, useState } from "react";
import { api, type Card } from "./api";
import { DesignChat } from "./DesignChat";

export function CardDrawer(props: {
  card: Card;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [comments, setComments] = useState<
    Array<{ id: string; author: string; body: string }>
  >([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listComments(props.card.id).then(setComments).catch((e) => setError(String(e)));
  }, [props.card.id]);

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

  return (
    <aside className="drawer">
      <button type="button" onClick={props.onClose}>
        关闭
      </button>
      <h2>{props.card.title}</h2>
      <p className="meta">
        {props.card.type} · {props.card.column}
      </p>
      <p>{props.card.description}</p>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

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
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
      <button
        type="button"
        onClick={async () => {
          await api.addComment(props.card.id, "human", body);
          setBody("");
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
