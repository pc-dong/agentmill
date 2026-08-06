# AI Workforce：轻量看板式人机协作交付工具 — 设计规格

**日期：** 2026-08-06  
**状态：** 待用户审阅  
**定位：** 个人 / 小团队自用；看板可远程访问，AI 执行仅在本机

## 1. 背景与目标

把「Issue / 看板 → 手动开 Cursor 等 agent → 干活 → 再回写状态」的手工链，收敛成一套轻量交付工具：

- 人以看板编排交付流程；
- AI 员工（多角色）通过统一抽象层执行设计 / 拆分 / 校验 / 开发 / 测试 / 验收相关工作；
- 底层首期接 Cursor（local runtime），后续可插拔 Claude Code / Codex / OpenCode / pi 等。

### 1.1 成功标准（MVP）

在一个真实「一 workspace 多 git 仓」项目上跑通：

1. 人创建 Epic 与多张需求卡；
2. 与 Design Bot 实时对齐，设计文档落入 workspace，卡片/Epic 只挂 link；
3. Split Bot 拆任务 → Verify Bot 做覆盖校验；
4. Dev / Test 至少一张任务卡进入验收；
5. 测试失败退回开发、满 3 次冻结并人工介入可演示；
6. 人批准后进入 Done。

## 2. 范围

### 2.1 MVP 包含

- Board 服务 + Web UI（可远程）+ 本机 Worker Daemon
- Epic 主题、固定列工作流、评论、`@`、两道人批门禁
- 六类 AI 员工与角色 prompt 包
- 设计阶段侧栏实时对话 +「Cursor 深挖」
- Agent 抽象层 + 仅 Cursor Adapter
- 测试失败退回与 `rework_count` 熔断

### 2.2 非目标

- 多租户与复杂权限体系
- GitHub Issues/PR 双向同步（开发仅要求卡片可挂 PR link）
- 非 Cursor 驱动的生产实现
- CI/CD 编排平台、移动端
- 一张卡片跨多个 workspace

## 3. 架构

三个进程边界：

```text
[远程可访问]                    [本机]
 Web UI  →  Board API  ↔  Worker Daemon → Agent 抽象层 → Cursor Adapter
              ↓                              ↓
           SQLite                      Workspace（多 repo + 文档）
```

| 组件 | 职责 |
|------|------|
| Board API + UI | 看板、Epic、卡片、评论、门禁、员工配置、侧栏会话入口 |
| Worker Daemon | 认领 Job、定时扫列、流式桥接对话、唤起/托管 Cursor run、回写 |
| Agent 抽象层 | 统一 `startRun` / `chat` / `resume` / `cancel` / `getStatus` |
| Cursor Adapter | MVP 唯一驱动；cwd = Board 绑定的 workspace |

**原则：** AI 执行不出本机；看板状态与会话元数据在 Board；设计/方案等长文真相在 workspace 文件系统。

## 4. 领域模型

### 4.1 核心对象

| 对象 | 说明 |
|------|------|
| **Workspace** | 本机目录；可含多个独立 git 仓；与 Board 1:1 |
| **Board** | 一个 workspace 的交付看板 |
| **Epic** | 主题聚合根；看板上以 `type=epic` 的主题卡呈现，流经设计/拆分/校验；关联多需求、设计产物 link、任务卡 |
| **Card** | 工作项；`type` ∈ {epic, requirement, task}（设计不以长文卡片为真相） |
| **Employee** | AI 员工：角色、盯的列、prompt 包、adapter（MVP=cursor） |
| **Comment** | 沟通与事件流水 |
| **Session** | 卡片/Epic 上的实时对齐会话（桥到本机 Cursor） |
| **ArtifactRef** | link 记录（workspace 相对路径或 PR URL 等），不存正文 |
| **Job** | Worker 可认领的执行单元（来自 `@` 或定时扫描） |

**卡片默认作用范围：** 整个 workspace；范围收敛靠标题/描述中的自然语言说明（如「只动 frontend/」），不强制选子仓字段。

### 4.2 看板列

```text
需求 → 设计 → 拆分 → 校验 → 开发 → 测试 → 验收 → Done
```

| 列 | 主要执行者 | 出门规则 |
|----|------------|----------|
| 需求 | 人（可 `@` Design 协助澄清） | 人将相关需求归入 Epic 后，把 **epic 主题卡** 放入「设计」列 |
| 设计 | Design Bot + 人（侧栏 / Cursor） | **人批准** → 主题卡进入拆分 |
| 拆分 | Split Bot | 生成任务卡 + breakdown 文档 link → 校验 |
| 校验 | Verify Bot | 覆盖通过 → 任务进入开发；不通过 → 打回拆分并写缺口 |
| 开发 | Dev Bot | 完成并挂 PR link → 可自推测试 |
| 测试 | Test Bot | 通过 → 验收；不通过见 §5.2 |
| 验收 | Review Bot + 人 | Review 只写意见/link；**人批准** → Done |

**列上谁在流动（消除歧义）：**

| 列 | 出现的卡片类型 |
|----|----------------|
| 需求 | `requirement`（通过 `epic_id` 归属主题；可用 Epic 视图筛选） |
| 设计 / 拆分 / 校验 | `epic` 主题卡（整主题进入设计→拆分→校验；上下文=其下需求+设计文档） |
| 开发 / 测试 / 验收 / Done | `task`（由 Split 生成，继承 `epic_id`） |

主题视图 / 筛选用于从 Epic 一眼看到关联需求、任务与产物 link；不另建一套平行看板。

### 4.3 产物约定

| 阶段 | 真相源 | 看板上 |
|------|--------|--------|
| 设计 | workspace 文档 | ArtifactRef（link） |
| 拆分 / 校验 | workspace 文档（如 breakdown、coverage-check） | link + 短结论评论 |
| 开发 | 代码 + PR | PR link |
| 测试 / 验收 | 报告文档或评论摘要 | link 或短结论 |

## 5. 工作流规则

### 5.1 人批门禁

1. **设计 → 拆分**：必须人批准。  
2. **验收 → Done**：必须人批准。  
3. 开发、测试在完成标准满足且未冻结时可自推。  
4. 人可手动改列；穿越门禁时写入审计评论。

### 5.2 测试退回与熔断

- 测试不通过：任务卡退回 **开发**，`rework_count += 1`。  
- 当 `rework_count >= 3`：**停止自动循环**，卡片进入冻结态「需人工决策」；Bot 可写报告并 `@` 人，但不得再自动改列。  
- 人决策后可：继续开发（可选择重置或保留计数，MVP 默认保留计数、由人显式「解除冻结并退回开发」或「放行验收」或「关闭」）。

```text
开发 → 测试 → 通过 → 验收
         ↓ 不通过且 count < 3
       开发（rework_count++）
         ↓ 不通过且 count >= 3
       需人工决策（冻结）
```

### 5.3 Split / Verify

- Split：输入 = Epic 下需求集合 + 设计文档；输出 = 若干 `task` 卡 + breakdown link。  
- Verify：检查任务集合是否覆盖需求与技术方案；不通过则打回拆分列并附缺口说明（文档 link + 评论）。

## 6. 触发与实时交互

### 6.1 触发

1. **`@` 指派**：评论或侧栏 `@Employee` → 创建 Job → Worker 认领。  
2. **定时扫列**：各员工扫描自己负责的列；跳过进行中 Session、已锁定、已冻结卡片；`card_id` / `epic_id` 级锁，超时回收。

### 6.2 设计阶段实时对齐（混合）

- **轻量：** 看板卡片/Epic 侧栏流式对话（UI → API → Worker → Cursor → 回推）。  
- **深挖：** 「在 Cursor 中打开」创建/续跑本机会话；结束后摘要 + 文档 link 回写。  
- **沉淀：** 用户确认后更新 workspace 文档，并写入 ArtifactRef。

## 7. Agent 抽象层

```text
AgentDriver
  id, displayName
  capabilities: { chat, oneshot, resume, workspaceAware }

  startRun(input) -> RunHandle
  chat(runId, message) -> AsyncStream[Event]
  resume(runId, message?) -> RunHandle
  cancel(runId)
  getStatus(runId) -> status + summary
```

**Event：** `text_delta` | `tool_call` | `artifact_hint(path)` | `done(summary)` | `error`

角色 prompt 包（配置）：Design / Split / Verify / Dev / Test / Review，与驱动实现分离。

### 7.1 Cursor Adapter（MVP）

- 使用 Cursor **local** runtime，`cwd` = Board 绑定 workspace。  
- 侧栏 → `chat` / 短 `resume`；定时 Job → `startRun` / oneshot。  
- 从事件或约定摘要字段解析产物路径与 PR URL；失败则评论提示人补 link。  
- 超时、取消、本机不可用 → Job 失败 + 评论，不自动改列。

### 7.2 后续驱动

新驱动实现同一接口即可；Board / 门禁 / Epic / 退回逻辑不变。MVP 配置仅启用 `cursor`。

## 8. 技术选型

| 层 | 选型 |
|----|------|
| 语言 | TypeScript（API、UI、Worker 统一） |
| Board API | Node + SQLite |
| Web UI | React SPA |
| 实时 | WebSocket（UI↔API↔Worker） |
| Worker | 本机 Daemon + `@cursor/sdk` local |
| 远程访问 | 自托管 API/UI；经 VPN / Tunnel 访问即可 |

## 9. 错误处理与并发

- Job 失败：记录错误评论，保持当前列（除非规则明确要求退回，如测试不通过）。  
- 同一卡片同时只允许一个执行锁；Session 与 Job 互斥或明确优先级（MVP：有活跃 Session 时定时扫描跳过该卡）。  
- 流式断线可 `resume`；超过保留期则新开 Session 并留痕。

## 10. 测试策略（规格级）

- **领域规则单测：** 门禁、退回计数熔断、Verify 打回、冻结态不可自推。  
- **契约测试：** AgentDriver mock；Board↔Worker Job 协议。  
- **手工 E2E：** §1.1 成功标准剧本（真实 workspace + Cursor）。

## 11. 迭代建议

| 迭代 | 目标 |
|------|------|
| I1 | Board + Epic/卡片/列/评论/门禁 UI；SQLite 模型 |
| I2 | Worker 骨架 + Job 认领 + Cursor oneshot 回写评论/link |
| I3 | Design 侧栏流式 + 文档沉淀；设计人批 → 拆分 |
| I4 | Split / Verify 员工与任务卡生成 |
| I5 | Dev / Test / 退回熔断 / Review + 验收人批 Done |

## 12. 已决问题与假设

| 项 | 决定 |
|----|------|
| 用户 | 个人 / 小团队（A） |
| 形态 | 混合：看板可远程，AI 本机（C） |
| 首驱 | Cursor |
| 员工 | 多角色分立（A） |
| 交付物 | 轻量 link；设计正文在 workspace |
| 绑定 | 一板一 workspace（可多 repo） |
| 任务范围 | 默认整 workspace，文案约束（A） |
| 实时对齐 | 侧栏 + Cursor 深挖（C） |
| 需求关联 | Epic 聚合（C） |
| 技术栈 | 全 TypeScript |

---

**审阅请关注：** 列与 Epic 职责是否清晰、退回熔断是否符合预期、MVP 边界是否可接受。通过后进入实现计划（writing-plans）。
