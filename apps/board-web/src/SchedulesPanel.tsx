import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Schedule, type ScheduleRun } from "./api";

const CRON_PRESETS: Array<{ label: string; cron: string }> = [
  { label: "每小时", cron: "0 * * * *" },
  { label: "每 6 小时", cron: "0 */6 * * *" },
  { label: "每天 09:00", cron: "0 9 * * *" },
  { label: "每天 18:00", cron: "0 18 * * *" },
  { label: "工作日 09:00", cron: "0 9 * * 1-5" },
  { label: "每周一 09:00", cron: "0 9 * * 1" },
  { label: "自定义…", cron: "__custom__" },
];

const STATUS_LABEL: Record<ScheduleRun["status"], string> = {
  queued: "排队中",
  running: "执行中",
  done: "成功",
  failed: "失败",
};

function presetValueForCron(cron: string): string {
  const hit = CRON_PRESETS.find((p) => p.cron === cron);
  return hit ? hit.cron : "__custom__";
}

export function SchedulesPanel(props: {
  boardId: string;
  open: boolean;
  onClose: () => void;
  onRan?: () => void;
  onOpenCard?: (cardId: string) => void;
}) {
  const [items, setItems] = useState<Schedule[]>([]);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [historyScheduleId, setHistoryScheduleId] = useState<string | "all" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [name, setName] = useState("代码缺陷扫描");
  const [preset, setPreset] = useState("0 9 * * *");
  const [cron, setCron] = useState("0 9 * * *");
  const [focusHint, setFocusHint] = useState("");
  const [maxDefects, setMaxDefects] = useState(10);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCron, setEditCron] = useState("");

  const refresh = useCallback(async () => {
    const list = await api.listSchedules(props.boardId);
    setItems(list);
  }, [props.boardId]);

  const refreshRuns = useCallback(async () => {
    if (!historyScheduleId) {
      setRuns([]);
      return;
    }
    const list = await api.listScheduleRuns(props.boardId, {
      scheduleId: historyScheduleId === "all" ? undefined : historyScheduleId,
      limit: 50,
    });
    setRuns(list);
  }, [props.boardId, historyScheduleId]);

  useEffect(() => {
    if (!props.open) return;
    refresh().catch((e) => setError(String(e)));
  }, [props.open, refresh]);

  useEffect(() => {
    if (!props.open || !historyScheduleId) return;
    refreshRuns().catch((e) => setError(String(e)));
  }, [props.open, historyScheduleId, refreshRuns]);

  const historyTitle = useMemo(() => {
    if (historyScheduleId === "all") return "全部执行记录";
    if (!historyScheduleId) return null;
    return (
      items.find((s) => s.id === historyScheduleId)?.name ?? "执行记录"
    );
  }, [historyScheduleId, items]);

  if (!props.open) return null;

  return (
    <div className="schedules-backdrop" role="presentation" onClick={props.onClose}>
      <div
        className="schedules-panel schedules-panel-wide"
        role="dialog"
        aria-label="定时任务"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="schedules-header">
          <h2>定时任务</h2>
          <div className="schedules-header-actions">
            <button
              type="button"
              className="linkish"
              onClick={() =>
                setHistoryScheduleId((cur) => (cur === "all" ? null : "all"))
              }
            >
              {historyScheduleId === "all" ? "收起记录" : "全部执行记录"}
            </button>
            <button type="button" className="linkish" onClick={props.onClose}>
              关闭
            </button>
          </div>
        </header>
        <p className="meta">
          支持标准 5 段 cron（分 时 日 月 周，本机时区）。到期或「立即运行」后创建扫描运行卡与冻结缺陷卡；批准解冻后拖到开发由 Dev Bot 执行。需 Worker 常驻。
        </p>
        {error && (
          <p className="board-error" role="alert">
            {error}
          </p>
        )}

        <section className="schedules-create">
          <h3>新建</h3>
          <div className="schedules-form">
            <label className="field">
              名称
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              频率预设
              <select
                value={preset}
                onChange={(e) => {
                  const v = e.target.value;
                  setPreset(v);
                  if (v !== "__custom__") setCron(v);
                }}
              >
                {CRON_PRESETS.map((p) => (
                  <option key={p.label} value={p.cron}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field-wide">
              Cron 表达式
              <input
                className="mono"
                value={cron}
                onChange={(e) => {
                  setCron(e.target.value);
                  setPreset(presetValueForCron(e.target.value.trim()));
                }}
                placeholder="分 时 日 月 周，例如 0 9 * * 1-5"
                spellCheck={false}
              />
              <span className="meta">
                例：<code>0 */2 * * *</code> 每 2 小时；
                <code>30 8 * * 1-5</code> 工作日 08:30
              </span>
            </label>
            <label className="field field-wide">
              扫描关注点（可选）
              <textarea
                rows={2}
                value={focusHint}
                onChange={(e) => setFocusHint(e.target.value)}
                placeholder="例如：支付相关服务、空指针、鉴权绕过…"
              />
            </label>
            <label className="field field-narrow">
              最多建卡数
              <input
                type="number"
                min={1}
                max={50}
                value={maxDefects}
                onChange={(e) => setMaxDefects(Number(e.target.value) || 10)}
              />
            </label>
          </div>
          <div className="schedules-create-footer">
            <button
              type="button"
              disabled={busyId === "create"}
              onClick={async () => {
                setBusyId("create");
                setError(null);
                try {
                  await api.createSchedule(props.boardId, {
                    name: name.trim() || "代码缺陷扫描",
                    cron: cron.trim(),
                    config: {
                      focusHint: focusHint.trim() || undefined,
                      autoCreateTasks: true,
                      maxDefects,
                    },
                  });
                  await refresh();
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusyId(null);
                }
              }}
            >
              {busyId === "create" ? "创建中…" : "创建定时任务"}
            </button>
          </div>
        </section>

        <section className="schedules-list">
          <h3>已配置 ({items.length})</h3>
          {items.length === 0 && <p className="meta">暂无定时任务</p>}
          <ul>
            {items.map((s) => (
              <li key={s.id} className="schedules-item">
                <div>
                  <strong>{s.name}</strong>
                  <div className="meta">
                    <code>{s.cron}</code>
                    {" · "}下次 {new Date(s.nextRunAt).toLocaleString()}
                    {s.lastRunAt
                      ? ` · 上次 ${new Date(s.lastRunAt).toLocaleString()}`
                      : ""}
                  </div>
                  {s.config.focusHint && (
                    <div className="meta">关注：{s.config.focusHint}</div>
                  )}
                  {editingId === s.id && (
                    <label className="field" style={{ marginTop: 8 }}>
                      修改 Cron
                      <input
                        value={editCron}
                        onChange={(e) => setEditCron(e.target.value)}
                        spellCheck={false}
                      />
                      <span className="schedules-actions" style={{ marginTop: 6 }}>
                        <button
                          type="button"
                          disabled={busyId === s.id}
                          onClick={async () => {
                            setBusyId(s.id);
                            setError(null);
                            try {
                              await api.updateSchedule(props.boardId, s.id, {
                                cron: editCron.trim(),
                              });
                              setEditingId(null);
                              await refresh();
                            } catch (err) {
                              setError(String(err));
                            } finally {
                              setBusyId(null);
                            }
                          }}
                        >
                          保存 Cron
                        </button>
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => setEditingId(null)}
                        >
                          取消
                        </button>
                      </span>
                    </label>
                  )}
                </div>
                <div className="schedules-actions">
                  <label className="schedules-toggle">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      disabled={busyId === s.id}
                      onChange={async (e) => {
                        setBusyId(s.id);
                        setError(null);
                        try {
                          await api.updateSchedule(props.boardId, s.id, {
                            enabled: e.target.checked,
                          });
                          await refresh();
                        } catch (err) {
                          setError(String(err));
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    />
                    启用
                  </label>
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() => {
                      setEditingId(s.id);
                      setEditCron(s.cron);
                    }}
                  >
                    编辑 Cron
                  </button>
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() =>
                      setHistoryScheduleId((cur) =>
                        cur === s.id ? null : s.id,
                      )
                    }
                  >
                    {historyScheduleId === s.id ? "收起记录" : "执行记录"}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={async () => {
                      setBusyId(s.id);
                      setError(null);
                      try {
                        await api.runSchedule(props.boardId, s.id);
                        await refresh();
                        if (historyScheduleId === s.id || historyScheduleId === "all") {
                          await refreshRuns();
                        }
                        props.onRan?.();
                      } catch (err) {
                        setError(String(err));
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    立即运行
                  </button>
                  <button
                    type="button"
                    className="dangerish"
                    disabled={busyId === s.id}
                    onClick={async () => {
                      if (!window.confirm(`删除定时任务「${s.name}」？`)) return;
                      setBusyId(s.id);
                      setError(null);
                      try {
                        await api.deleteSchedule(props.boardId, s.id);
                        if (historyScheduleId === s.id) setHistoryScheduleId(null);
                        await refresh();
                      } catch (err) {
                        setError(String(err));
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {historyScheduleId && (
          <section className="schedules-history">
            <div className="schedules-header">
              <h3>{historyTitle}</h3>
              <button
                type="button"
                className="linkish"
                onClick={() => refreshRuns().catch((e) => setError(String(e)))}
              >
                刷新
              </button>
            </div>
            {runs.length === 0 ? (
              <p className="meta">暂无执行记录</p>
            ) : (
              <table className="schedules-runs-table">
                <thead>
                  <tr>
                    <th>开始时间</th>
                    <th>任务</th>
                    <th>触发</th>
                    <th>状态</th>
                    <th>运行卡</th>
                    <th>结束 / 错误</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.startedAt).toLocaleString()}</td>
                      <td>{r.scheduleName ?? r.scheduleId.slice(0, 8)}</td>
                      <td>{r.trigger === "manual" ? "手动" : "定时"}</td>
                      <td>
                        <span className={`run-status run-status-${r.status}`}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td>
                        {r.runCardId ? (
                          <button
                            type="button"
                            className="linkish"
                            onClick={() => props.onOpenCard?.(r.runCardId!)}
                            title={r.runCardId}
                          >
                            {r.runCardTitle || r.runCardId.slice(0, 8)}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="meta">
                        {r.finishedAt
                          ? new Date(r.finishedAt).toLocaleString()
                          : "—"}
                        {r.error ? ` · ${r.error.slice(0, 120)}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
