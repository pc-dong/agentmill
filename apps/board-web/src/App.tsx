import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type BoardSummary, type Card } from "./api";
import { BoardView } from "./BoardView";
import { CardDrawer } from "./CardDrawer";
import { ConfirmDialog } from "./ConfirmDialog";
import { SchedulesPanel } from "./SchedulesPanel";

const BOARD_KEY = "agentmill.boardId";
const LEGACY_BOARD_KEY = "aiw.boardId";

/** Read the current board id, migrating the legacy "aiw.boardId" key. */
function readBoardId(): string | null {
  const current = localStorage.getItem(BOARD_KEY);
  if (current) return current;
  const legacy = localStorage.getItem(LEGACY_BOARD_KEY);
  if (legacy) {
    localStorage.setItem(BOARD_KEY, legacy);
    localStorage.removeItem(LEGACY_BOARD_KEY);
    return legacy;
  }
  return null;
}

function writeBoardId(id: string) {
  localStorage.setItem(BOARD_KEY, id);
  localStorage.removeItem(LEGACY_BOARD_KEY);
}

export function App() {
  const [boardId, setBoardId] = useState<string | null>(() => readBoardId());
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [boardsLoaded, setBoardsLoaded] = useState(false);
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPath, setPickerPath] = useState("");
  const [pickerParent, setPickerParent] = useState<string | null>(null);
  const [pickerDirs, setPickerDirs] = useState<
    Array<{ name: string; path: string }>
  >([]);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [workspacePath, setWorkspacePath] = useState(
    "/tmp/agentmill-demo-ws",
  );
  const [title, setTitle] = useState("");
  const [epicIdForReq, setEpicIdForReq] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Card | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [schedulesOpen, setSchedulesOpen] = useState(false);

  const refreshBoards = useCallback(async () => {
    const list = await api.listBoards();
    setBoards(list);
    setBoardsLoaded(true);
    setBoardId((current) => {
      if (current && list.some((b) => b.id === current)) return current;
      const first = list[0]?.id ?? null;
      if (first) writeBoardId(first);
      return first;
    });
  }, []);

  useEffect(() => {
    refreshBoards().catch(console.error);
  }, [refreshBoards]);

  const currentBoard = useMemo(
    () => boards.find((b) => b.id === boardId) ?? null,
    [boards, boardId],
  );

  function switchBoard(id: string) {
    writeBoardId(id);
    setBoardId(id);
    setSelected(null);
    setCards([]);
    setEpicIdForReq("");
  }

  async function createBoard() {
    const name = newBoardName.trim() || `Board ${boards.length + 1}`;
    const board = await api.createBoard(name, workspacePath);
    setNewBoardOpen(false);
    setNewBoardName("");
    await refreshBoards();
    switchBoard(board.id);
  }

  async function openPicker(initial: string) {
    setPickerError(null);
    setPickerOpen(true);
    await browsePicker(initial || workspacePath);
  }

  async function browsePicker(target: string) {
    try {
      const r = await api.dirPicker(target);
      setPickerPath(r.path);
      setPickerParent(r.parent);
      setPickerDirs(r.dirs);
      setPickerError(null);
    } catch (e) {
      setPickerError(String(e));
    }
  }

  function pickDirectory(path: string) {
    setWorkspacePath(path);
    setPickerOpen(false);
  }

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
    if (!boardsLoaded) {
      return (
        <div className="app">
          <h1>Agentmill</h1>
          <p>加载看板列表…</p>
        </div>
      );
    }
    return (
      <div className="app">
        <h1>Agentmill</h1>
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
            writeBoardId(board.id);
            await refreshBoards();
          }}
        >
          创建看板
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        {/* Row 1: board configuration */}
        <div className="toolbar-row board-config-row">
          <h1 style={{ margin: 0, fontSize: 20 }}>Agentmill</h1>
          <select
            value={boardId}
            onChange={(e) => switchBoard(e.target.value)}
            title="切换看板（每个看板绑定一个 workspace）"
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} — {b.workspacePath}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setNewBoardOpen((v) => !v)}>
            + 看板
          </button>
          {newBoardOpen && (
            <span
              style={{ display: "inline-flex", gap: 6, alignItems: "center", position: "relative" }}
            >
              <input
                placeholder="看板名称"
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                style={{ width: 120 }}
              />
              <input
                placeholder="Workspace 路径"
                value={workspacePath}
                onChange={(e) => setWorkspacePath(e.target.value)}
                style={{ width: 220 }}
              />
              <button type="button" onClick={() => void openPicker(workspacePath)}>
                浏览…
              </button>
              <button type="button" onClick={() => void createBoard()}>
                创建
              </button>
              {pickerOpen && (
                <div className="dir-picker">
                  <div className="dir-picker-head">
                    <button
                      type="button"
                      disabled={!pickerParent}
                      onClick={() => pickerParent && void browsePicker(pickerParent)}
                      title="上级目录"
                    >
                      ↑
                    </button>
                    <span className="dir-picker-path" title={pickerPath}>
                      {pickerPath || "…"}
                    </span>
                    <button type="button" onClick={() => setPickerOpen(false)}>
                      ✕
                    </button>
                  </div>
                  {pickerError && (
                    <p className="dir-picker-error">{pickerError}</p>
                  )}
                  <ul className="dir-picker-list">
                    {pickerDirs.length === 0 && (
                      <li className="dir-picker-empty">（无子目录）</li>
                    )}
                    {pickerDirs.map((d) => (
                      <li key={d.path}>
                        <button
                          type="button"
                          className="dir-picker-item"
                          onClick={() => void browsePicker(d.path)}
                        >
                          📁 {d.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="dir-picker-foot">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => pickDirectory(pickerPath)}
                    >
                      选择此目录
                    </button>
                  </div>
                </div>
              )}
            </span>
          )}
          {currentBoard && (
            <span
              title={`当前 workspace：${currentBoard.workspacePath}`}
              style={{ color: "#888", fontSize: 12 }}
            >
              📁 {currentBoard.workspacePath}
            </span>
          )}
          <span className="toolbar-spacer" />
          <button type="button" onClick={() => refresh()}>
            刷新
          </button>
          <button type="button" onClick={() => setSchedulesOpen(true)}>
            定时任务
          </button>
        </div>
        {/* Row 2: card creation */}
        <div className="toolbar-row card-create-row">
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
            className="btn-primary"
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
        </div>
      </header>
      <SchedulesPanel
        boardId={boardId}
        open={schedulesOpen}
        onClose={() => setSchedulesOpen(false)}
        onRan={() => {
          armJobWatch();
          void refresh();
        }}
        onOpenCard={(cardId) => {
          const card = cards.find((c) => c.id === cardId);
          if (card) {
            setSelected(card);
            setSchedulesOpen(false);
          } else {
            void refresh().then(() => {
              /* selection after refresh */
            });
            api.listCards(boardId).then((list) => {
              setCards(list);
              const c = list.find((x) => x.id === cardId);
              if (c) {
                setSelected(c);
                setSchedulesOpen(false);
              }
            });
          }
        }}
      />
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
