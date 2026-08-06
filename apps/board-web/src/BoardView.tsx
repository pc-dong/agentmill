import type { Card } from "./api";

const COLUMNS: Array<{ id: string; label: string }> = [
  { id: "requirements", label: "需求" },
  { id: "design", label: "设计" },
  { id: "split", label: "拆分" },
  { id: "verify", label: "校验" },
  { id: "dev", label: "开发" },
  { id: "test", label: "测试" },
  { id: "accept", label: "验收" },
  { id: "done", label: "Done" },
];

export function BoardView(props: {
  cards: Card[];
  onOpen: (card: Card) => void;
}) {
  return (
    <div className="board">
      {COLUMNS.map((col) => (
        <section className="column" key={col.id}>
          <h3>{col.label}</h3>
          {props.cards
            .filter((c) => c.column === col.id)
            .map((c) => (
              <button
                key={c.id}
                className={`card${c.frozen ? " frozen" : ""}`}
                onClick={() => props.onOpen(c)}
              >
                <div className="meta">
                  {c.type}
                  {c.reworkCount > 0 ? ` · rework ${c.reworkCount}` : ""}
                  {c.frozen ? " · FROZEN" : ""}
                </div>
                <strong>{c.title}</strong>
              </button>
            ))}
        </section>
      ))}
    </div>
  );
}
