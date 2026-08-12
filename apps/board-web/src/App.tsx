import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Card } from "./api";
import { BoardView } from "./BoardView";
import { CardDrawer } from "./CardDrawer";
import { ConfirmDialog } from "./ConfirmDialog";

const BOARD_KEY = "aiw.boardId";

export function App() {
  const [boardId, setBoardId] = useState<string | null>(
    () => localStorage.getItem(BOARD_KEY),
  );
  const [cards, setCards] = useState<Card[]>([]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [workspacePath, setWorkspacePath] = useState(
    "/tmp/ai-workforce-demo-ws",
  );
  const [title, setTitle] = useState("");
  const [epicIdForReq, setEpicIdForReq] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Card | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const epics = useMemo(
    () => cards.filter((c) => c.type === "epic"),
    [cards],
  );

  const refresh = useCallback(async () => {
    if (!boardId) return;
    const list = await api.listCards(boardId);
    setCards(list);
    setSelected((prev) =>
      prev ? (list.find((c) => c.id === prev.id) ?? null) : null,
    );
  }, [boardId]);

  /** Keep polling after a job is queued but not yet claimed (no lockedJobId yet). */
  const [jobWatchUntil, setJobWatchUntil] = useState(0);
  const armJobWatch = useCallback((ms = 90_000) => {
    setJobWatchUntil(Date.now() + ms);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [boardId]);

  // Clear the pre-claim watch window so polling can stop when idle.
  useEffect(() => {
    if (!jobWatchUntil) return;
    const delay = Math.max(0, jobWatchUntil - Date.now());
    const t = window.setTimeout(() => setJobWatchUntil(0), delay);
    return () => window.clearTimeout(t);
  }, [jobWatchUntil]);

  // While any card is locked, or we recently queued a job, poll so busy UI stays live.
  const anyBotBusy = useMemo(
    () => cards.some((c) => Boolean(c.lockedJobId)),
    [cards],
  );
  useEffect(() => {
    if (!boardId) return;
    const watchingQueue = jobWatchUntil > Date.now();
    if (!anyBotBusy && !watchingQueue) return;
    const id = window.setInterval(() => {
      refresh().catch(console.error);
    }, watchingQueue && !anyBotBusy ? 2000 : 4000);
    return () => window.clearInterval(id);
  }, [boardId, anyBotBusy, jobWatchUntil, refresh]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    const needsConfirmDelete =
      pendingDelete.type === "task" && pendingDelete.column !== "design";
    try {
      await api.deleteCard(pendingDelete.id, {
        confirmDelete: needsConfirmDelete || undefined,
      });
      if (selected?.id === pendingDelete.id) setSelected(null);
      setPendingDelete(null);
      await refresh();
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  const pendingDeleteIsInFlight =
    pendingDelete?.type === "task" && pendingDelete.column !== "design";

  if (!boardId) {
    return (
      <div className="app">
        <h1>AI Workforce</h1>
        <label>
          Workspace 路径
          <input
            value={workspacePath}
            onChange={(e) => setWorkspacePath(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <button
          type="button"
          onClick={async () => {
            const board = await api.createBoard("Local Board", workspacePath);
            localStorage.setItem(BOARD_KEY, board.id);
            setBoardId(board.id);
          }}
        >
          创建看板
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <header
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20 }}>AI Workforce</h1>
        <input
          placeholder="新卡片标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select
          value={epicIdForReq}
          onChange={(e) => setEpicIdForReq(e.target.value)}
          title="新建需求时关联的 Epic"
        >
          <option value="">需求关联 Epic（可选）</option>
          {epics.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={async () => {
            await api.createCard(boardId, {
              type: "requirement",
              title: title || "新需求",
              column: "requirements",
              epicId: epicIdForReq || null,
            });
            setTitle("");
            await refresh();
          }}
        >
          + 需求
        </button>
        <button
          type="button"
          onClick={async () => {
            await api.createCard(boardId, {
              type: "epic",
              title: title || "新主题",
              column: "requirements",
            });
            setTitle("");
            await refresh();
          }}
        >
          + Epic（需求列）
        </button>
        <button
          type="button"
          onClick={async () => {
            await api.createCard(boardId, {
              type: "task",
              title: title || "新任务",
              column: "design",
              frozen: false,
            });
            setTitle("");
            await refresh();
          }}
        >
          + 任务(待办列)
        </button>
        <button type="button" onClick={() => refresh()}>
          刷新
        </button>
      </header>
      <BoardView
        cards={cards}
        onOpen={setSelected}
        onMove={async (card, to, opts) => {
          await api.moveCard(card.id, {
            to,
            actor: "human",
            humanApproved: opts?.humanApproved,
          });
          await refresh();
        }}
        onRequestDelete={(card) => {
          setDeleteError(null);
          setPendingDelete(card);
        }}
      />
      {selected && (
        <CardDrawer
          card={selected}
          cards={cards}
          onClose={() => setSelected(null)}
          onChanged={refresh}
          onJobQueued={() => {
            armJobWatch();
            void refresh();
          }}
          onRequestDelete={() => {
            setDeleteError(null);
            setPendingDelete(selected);
          }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="确认删除卡片"
          message={
            pendingDeleteIsInFlight
              ? `「${pendingDelete.title}」已离开待办列（在途）。删除会标记所属设计拆分需重新校验，且不可恢复。确认继续？`
              : `确定删除「${pendingDelete.title}」吗？评论与会话将一并删除，且不可恢复。`
          }
          confirmLabel="确认删除"
          cancelLabel="取消"
          danger
          busy={deleting}
          onCancel={() => {
            if (deleting) return;
            setPendingDelete(null);
            setDeleteError(null);
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      )}
      {deleteError && (
        <p className="board-error" role="alert">
          {deleteError}
          <button
            type="button"
            className="linkish"
            onClick={() => setDeleteError(null)}
          >
            关闭
          </button>
        </p>
      )}
    </div>
  );
}
