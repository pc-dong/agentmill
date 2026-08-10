# Design: 拆分对齐、设计列 Task 与开发门禁

> 状态：已实现（分支 `feat/split-align-dev-gate`，2026-08-10）  
> 实现计划：`docs/superpowers/plans/2026-08-10-split-align-dev-gate.md`  

> 日期：2026-08-10  
> 相关：`docs/superpowers/specs/2026-08-06-ai-workforce-kanban-design.md`  
> 前置现状：设计卡 `design-jobs`（split/verify/deep_dive）；Split 产物曾直接落 `dev` 且 `frozen`，Verify pass 后 Dev poll

---

## 1. 问题与目标

### 1.1 问题

当前「拆分 → 开发」节奏偏自动：

1. Split Bot 在 **开发列** 创建冻结 task，人无法在设计列先审拆分结果。  
2. Verify 解冻后 Dev Bot 即可 poll，缺少「人手拖进开发列才开工」的闸门。  
3. 拆分完成后缺少与 Split Bot 的对齐交互；无法按对齐结论增删/改 task。  
4. Dev 完成进入测试列时，缺少强制的实现总结评论。

### 1.2 目标

1. 点击「拆分任务」后，Split Bot 拆分；task **先落在设计列**（`frozen: true`）。  
2. 设计卡与 task 卡均可与 Split Bot **对齐**；按协议改拆分。  
3. **保留 Verify 硬门槛**：通过后才允许人手把 task 从设计列拖到开发列。  
4. 仅当人拖到开发列后，Dev Bot 才自动开工。  
5. Dev 完成时必须在评论写 **短实现总结**，再进入测试列。  
6. Verify 通过后仍可对齐改结构；结构一变须 **重新 Verify** 才能再拖进开发。  
7. 已离开设计列的在途卡：对齐不自动改写；删除需人确认。

### 1.3 非目标

- 取消 Verify 或把 Verify 降为软建议  
- 用新的 `splitStatus` 状态机全面替代 `frozen`（本设计仍复用 `frozen` + 设计卡 Verify 有效标记）  
- 拆分结果仅存「影子列表」、对齐完再批量发布（与「设计列可见 + 单卡对齐」冲突）  
- 强制 Dev 挂 ARTIFACT 才算完成  
- 改变设计卡 `design→done` 的人审与「关联 task 全 Done」规则  

---

## 2. 已确认决策

| 决策点 | 选择 |
|--------|------|
| 对齐入口 | **C**：设计卡批量对齐 + 单张 task 卡对齐 |
| Verify | **A**：硬门槛；对齐结束后仍需「校验覆盖」通过，才允许 `design→dev` |
| 对齐窗口 | **B**：Verify 后仍可改；结构变更后须重跑 Verify |
| 在途卡 | **B**：在途不动；只自动改仍在设计列的卡；删在途卡需人确认 |
| Dev 总结 | **A**：短摘要即可（做什么、关键改动点；有 PR/路径则附上） |
| 实现路径 | **方案 1**：扩展 task 占用列 + 复用 frozen/Verify + Session 对齐 |

---

## 3. 端到端流程

```text
设计卡 [拆分任务]
  → Split oneshot → 在设计列创建 task(designId, frozen=true)
  → [拆分对齐] 设计卡 / task 卡 Session（role=split）
       settle 协议 → create/update/delete（规则见 §5）→ dirty Verify
  → [校验覆盖] VERIFY pass
       → 解冻该 designId 下仍在 design 的 frozen task
       → 置设计卡 splitVerified 有效
  → 人手拖 task：design → dev（门禁见 §4）
  → Dev Bot poll → 实现 → 评论 SUMMARY → move test
```

结构再次变更后：清空 Verify 有效 + 重冻仍在设计列的 task；须重新 Verify。

---

## 4. Domain：列、占用与门禁

### 4.1 Occupancy

- `task` 可占列：`design | dev | test | accept | done`（相对现状增加 `design`）。  
- `design` 卡仍占：`design | done`。  
- 看板可见列不变：`requirements → design → dev → test → accept → done`。

### 4.2 Split 建卡

- Outcome 创建 task：`column: "design"`，`type: "task"`，`designId` = 当前设计卡 id，`epicId` 继承主题 epic，`frozen: true`。  
- **不再**直接写入 `dev`。

### 4.3 移动门禁

| 动作 | 规则 |
|------|------|
| Bot `design→dev` | **禁止**（只有人拖） |
| Human `design→dev` | 必须 `frozen === false` **且** 所属设计卡 Verify **有效** |
| Verify pass | 解冻该 `designId` 下、仍在 `design` 的 frozen task；置设计卡 Verify 有效（见 §4.4） |
| Verify fail | 仅评论；不解冻；不置有效 |
| Dev Bot claim | 仍仅 `watchColumns: ["dev"]`；跳过 `frozen`；不 claim 设计列 task |

人拖拒绝时 API/UI 须说明原因：`frozen` / 未 Verify / Verify 已因拆分变更失效。

### 4.4 设计卡 Verify 有效标记

在设计卡（或等价持久化字段）维护 **`splitVerifiedAt`（nullable timestamp）**（名称实现可微调，语义固定）：

- Verify pass → 写入当前时间（有效）。  
- 任意 **结构变更**（§5 定义）→ 置 `null`（无效），并对该 `designId` 下仍在 `design` 的 task 设 `frozen: true`。  
- `design→dev` 门禁读：`splitVerifiedAt != null`。

不引入完整 `splitStatus` 状态机；`frozen` 继续表示「不可被 Dev claim / 不可未批准乱移」。

### 4.5 结构变更（dirty）定义

下列任一成功即 dirty：

- `TASK create`  
- `TASK update` 改变 title/description/plan 边界（成功作用在仍位于 `design` 的卡）  
- `TASK delete` 成功删除（含人确认后删除在途卡）

仅 `SPLIT note` 或纯评论文本 → **不** dirty。

---

## 5. 拆分对齐：Session 与协议

### 5.1 入口

- **设计卡**：pipeline 增加「拆分对齐」；`employeeRole: "split"` Session（复用 create / reopen / settle / WS 流式模式，交互对齐 DesignChat）。  
- **Task 卡**：抽屉提供同角色 Split 会话；上下文默认：本卡 + 所属设计卡摘要 + 同 `designId` 兄弟 task 摘要。

### 5.2 与 oneshot 的关系

- 「拆分任务」按钮：仍 `POST /cards/:id/design-jobs`，`kind: "split"`（首次/再次 oneshot 拆分）。  
- 对齐中的改卡：走 **session settle**（或 settle 触发的 revise job），避免与 open session 抢普通 claim。  
- 若存在 open split session：点击「拆分任务 / 校验覆盖」前 **提示先 settle**（实现写死为提示阻断，不自动 settle，以免误关会话丢上下文）。

### 5.3 Settle 协议行

Agent 输出末尾可含：

| 行 | 行为 |
|----|------|
| `TASK create \| <title> \| <description> [| plan:path]` | 在设计列新建；继承 `designId`/`epicId`；`frozen: true`；dirty |
| `TASK update \| <cardId> \| <title> \| <description> [| plan:path]` | 仅当目标卡 **仍在 `design`**：更新字段并 dirty；否则跳过并评论说明，**不** dirty |
| `TASK delete \| <cardId>` | 卡在 `design`：直接删并 dirty。卡已离开 `design`：**不自动删**，评论请求确认；须人在 UI/API 带 `confirmDelete: true` 才删并 dirty |
| `SPLIT note \| …` | 仅评论；不 dirty |

### 5.4 在途卡保护

- Update：永不自动改写已离开 `design` 的卡。  
- Delete 在途：必须确认对话框（复用 `ConfirmDialog`）+ API `confirmDelete: true`。  
- 已在 `dev+` 的卡不因 dirty 被重冻或拉回设计列。

### 5.5 Claim / Session 冲突

- 卡上存在 open session 时：普通 poll/mention 不抢该卡（与现网一致）。  
- Split oneshot / Verify：要求无 open split session，或先 settle；不把 revise 偷偷做成 deep_dive 式旁路抢占（避免半开会话状态混乱）。

---

## 6. Dev 实现总结

- Prompt 要求结束时输出：`SUMMARY: <短摘要>`（做了什么、关键改动点；可选 PR/文件路径）。  
- Worker 在 `dev→test` 前解析 SUMMARY：  
  - 有 → 将该全文（或规范化短文）写入 task 评论，再 `moveCard(…, "test", "bot")`。  
  - 无 → **不移动**；warning 评论；job 失败或可重试。  
- 不强制 ARTIFACT。

---

## 7. UI

### 7.1 看板

- 设计列同时展示设计卡与其 task；task 角标区分类型，并体现 `FROZEN` / 待校验。  
- 拖拽 `design→dev` 失败时 toast/文案说明原因。

### 7.2 设计卡抽屉

- Pipeline：`拆分任务` → `拆分对齐` → `校验覆盖` → `完成 → Done`。  
- 文案：  
  - 有 frozen / 未 Verify：「拆分待校验，通过后可拖入开发列」  
  - dirty / Verify 无效：「拆分已变更，请重新校验覆盖」

### 7.3 Task 卡抽屉

- Split 对齐入口。  
- 若卡已不在设计列：提示「结构变更不会自动作用于此卡；删除需确认」。

---

## 8. API / 持久化要点（实现指引）

- DB：设计卡增加 `split_verified_at`（或 JSON 元数据等价字段）；迁移存量：已有 frozen-in-dev 的历史 task 不强制回迁，**新 Split** 一律落设计列。  
- `POST …/move`：对人 `task` + `design→dev` 校验 frozen + 父设计 `splitVerifiedAt`。  
- `POST …/design-jobs` verify pass 路径：写 `splitVerifiedAt` + 解冻设计列 task。  
- Split settle / revise 应用协议：create/update/delete + dirty 副作用。  
- `DELETE`（或专用 delete-card）在途 task：要求 `confirmDelete: true`。  
- Session：`employeeRole: "split"` 允许挂在 `design` 与 `task` 卡上。

---

## 9. 测试要点

1. Split 建卡：`column=design`、`frozen=true`、`designId` 正确。  
2. 未 Verify / frozen：人 `design→dev` 被拒；Bot `design→dev` 被拒。  
3. Verify pass：解冻 + `splitVerifiedAt` 有值；人可拖到 `dev`；Dev 可 poll。  
4. Settle create/update(design)/delete(design) → dirty；须重验才能再拖。  
5. Update 在途卡：跳过；delete 在途无 confirm 失败，有 confirm 成功并 dirty。  
6. Dev 无 `SUMMARY` 不进 `test`；有则评论 + 进入 `test`。  
7. Open split session 时点拆分/校验：被提示阻断。

---

## 10. 风险与后续

- **存量 task 在 `dev`**：本设计不自动回迁；文档与 UI 以新流程为准。  
- **再次 oneshot「拆分任务」**：可能与已有 task 重复；实现计划中应约定「追加创建 + dirty」或「先对齐再拆」的产品默认（默认：**追加 + dirty**，由 Verify 覆盖检查发现缺口/重复）。  
- 单卡与设计卡双 Session 并发：以卡级 session 隔离；dirty 以设计卡 Verify 标记为单一真相。
