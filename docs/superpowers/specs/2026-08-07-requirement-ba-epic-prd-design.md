# Design: 需求卡 BA 澄清与 Epic/PRD 产出

> 状态：已批准（对话确认 2026-08-07）  
> 日期：2026-08-07  
> 相关：`docs/superpowers/specs/2026-08-06-ai-workforce-kanban-design.md`  
> 参考体系：Marriott `union_platform/docs/README-PRD体系.md` 与 Epic/PRD 模版

---

## 1. 问题与目标

### 1.1 问题

AI Workforce 看板在 **设计列的设计卡（`type=design`）** 上已有 DesignChat（流式澄清 + 沉淀 ArtifactRef），但 **需求列 requirement 卡** 仅有标题/关联/评论 `@`，无法：

- 与 AI 多轮澄清需求  
- 按 Marriott 风格产出 `EPIC.md` / `shared-context.md` / `prds/*.md`  
- 在「无 Epic / 已有 Epic」两种情况下正确落盘与挂卡  

规格原文「需求列可 `@` Design 协助澄清」尚未落地。

### 1.2 目标

1. 需求卡侧栏提供 **BA Bot** 轻量流式澄清（方案 1）。  
2. 可选 **Cursor 深挖**（方案 2），可跑 Epic/PRD 相关 skill；与轻量通道共用沉淀协议。  
3. 沉淀后在看板 `workspacePath` 写出文档；看板只存 ArtifactRef。  
4. **无 Epic → 新建 Epic 目录 + PRD + 看板 Epic 卡（需求列）并挂 `epicId`；已有 Epic → 只新建/更新 PRD 并回写索引。**

### 1.3 非目标

- TECH-DESIGN / 前端·后端原型 skill 全链路  
- 强制 CI lint 文档、自动迁移 Marriott 存量 Epic  
- 需求卡因沉淀自动离开需求列  
- 用 BA 替代设计列 Design Bot  

---

## 2. 已确认决策

| 决策点 | 选择 |
|--------|------|
| 新建 vs 关联 | 混合：无 Epic → create Epic+PRD；有 Epic → link，只 PRD |
| 沉淀后看板 | 策略 A：保留需求卡；create 时自动建 Epic 卡（`requirements`）并挂 `epicId`；双方挂 ArtifactRef |
| AI 角色 | 独立 **BA Bot**（`role=ba`，盯 `requirements`），不复用 Design Bot 身份 |
| 交互 | 方案 1（侧栏 Session）+ 方案 2（Cursor 深挖）结合 |
| 写盘位置 | **Worker（本机 workspace）**；API 只改 SQLite 卡片状态 |
| 模版 | AIW workspace 内精简版 Marriott 模版（章节对齐，不强制一次写满） |

---

## 3. 双通道交互

```text
轻量（默认）                         深挖（可选）
RequirementChat（Session + WS）       「在 Cursor 中深挖」
  BA Bot grilling 澄清                  Worker → Cursor oneshot/resume
  输出沉淀协议草稿                        可指引 epic-author / prd-author 等 skill
        ↘______________________________↙
                    统一沉淀
     UI「沉淀」→ API 记录意图 → Job(ba, settle)
     → Worker 写盘 → API ba-settle 建卡/挂 link → 关 Session
```

| 通道 | 何时 | 依赖 |
|------|------|------|
| 轻量 | 日常澄清、Draft 文档 | chatStream（Mock/Cursor） |
| 深挖 | 大主题、要对齐 Marriott skill | 本机 Cursor + skill；缺失则降级提示，轻量仍可用 |

---

## 4. Workspace 目录约定

相对看板 `workspacePath`：

```text
docs/
├── README-PRD体系.md              # 可选短入口
├── template/
│   ├── EPIC模版.md
│   ├── EPIC-共享上下文模版.md
│   └── AI友好的PRD模版.md
└── epics/
    └── <epic-id>-<slug>/
        ├── EPIC.md
        ├── shared-context.md
        └── prds/
            └── <prd-id>-<slug>.md
```

ID 规则对齐 Marriott：`E-<领域>-<序号>`、`P-<epic序号>-<序号>`、英文 slug。  
首期允许 BA 建议 ID/slug，人可在沉淀前改关联或要求助手重发协议行。

---

## 5. 统一沉淀协议

助手摘要或 Job 输入须含结构化行（大小写不敏感关键字）：

```text
EPIC_MODE create|link
EPIC_ID E-XXX-001
EPIC_SLUG theme-login
EPIC_TITLE <标题>
PRD_ID P-001-01
PRD_SLUG login-oauth
PRD_TITLE <标题>
ARTIFACT file docs/epics/.../EPIC.md Epic
ARTIFACT file docs/epics/.../shared-context.md Shared
ARTIFACT file docs/epics/.../prds/....md PRD
```

| `EPIC_MODE` | Worker | API `ba-settle` |
|-------------|--------|-----------------|
| `create` | 写 EPIC + shared-context + PRD（按模版填充会话结论） | 若尚无该 `EPIC_ID` 对应 Epic 卡则创建（`requirements`）；需求卡设 `epicId`；双方追加 artifacts |
| `link` | 只写/更新 PRD；patch 已有 `EPIC.md` 的 PRD 索引表 | 需求卡 `epicId` 必须已指向该 Epic；追加 artifacts；不新建 Epic 卡 |

**幂等：** 同一 board 上按 `EPIC_ID`（可存于 Epic 卡 description/artifacts 元数据或约定标题前缀）查找已有 Epic 卡，避免重复创建。MVP 可用「artifacts 中含 `EPIC.md` 且路径含该 epic-id」或卡 description 首行 `epic_id: E-…` 匹配。

---

## 6. 组件与数据流

### 6.1 新增/扩展

| 单元 | 职责 |
|------|------|
| `ba` Employee | 建看板时种子；`watchColumns: ["requirements"]` |
| BA prompts | 澄清提问；强制协议行；深挖时提及 skill 名 |
| 协议解析（agent 包） | 解析 `EPIC_*` / `PRD_*` / 复用既有 `ARTIFACT` |
| `RequirementChat` UI | 复用 DesignChat 壳；关联状态条；沉淀；深挖按钮 |
| Worker 写盘 | 模版渲染 → 文件系统；失败则 Job fail |
| `POST .../ba-settle`（或扩展 settle） | 建 Epic 卡、挂 `epicId`、artifacts、审计评论 |

### 6.2 沉淀时序

```text
Human[沉淀] → API(创建 settle Job 或标记 session)
  → Worker claim
  → 读 session 摘要 / 协议行
  → 写 workspace 文件
  → API ba-settle(cardId, mode, epicId, artifacts, titles…)
  → 关 session；刷新看板
```

混合架构约束：**写盘不得假设 API 进程能访问 workspace**；必须经 Worker。

### 6.3 深挖

- 按钮创建 Job：`role=ba`，`trigger=deep_dive`（或 comment 标记）。  
- Prompt：在 workspace 内按模版/skill 产出或修订文档，回复仍须含沉淀协议行。  
- 完成后 WS/评论回推摘要；**人再点沉淀** 走同一写盘+ba-settle（避免 Cursor 直接改库）。  
- Cursor/skill 不可用：Job fail + 可读错误；不影响轻量通道。

---

## 7. 错误与边界

| 情况 | 行为 |
|------|------|
| 协议行缺失/非法 | 拒绝沉淀，UI 提示缺字段 |
| `link` 但需求卡无 `epicId` | 拒绝 |
| `create` 但已有 `epicId` | 默认改为 `link` 并提示，或要求人确认（实现选「默认 link + 警告评论」） |
| 写盘失败 | Job fail；不建卡、不改 `epicId` |
| 目标文件已存在 | MVP：覆盖并审计评论注明；不做版本树 |
| BA 扫列 | 可创建澄清提醒 Job；**不得**自动改列或自动沉淀 |

BA **不**推动设计→拆分门禁；设计仍由 **设计卡** 在设计列 + Design Bot 负责。BA 沉淀只建/挂 Epic + PRD，**不**自动创建设计卡。

---

## 8. UI 细则

需求卡（`type=requirement`，列=`requirements`）侧栏：

1. 关联状态：未挂 →「将新建 Epic + PRD」；已挂 →「将写入 Epic《标题》下的 PRD」  
2. 流式对话（Session/WS）  
3. 发送 / **沉淀** / **在 Cursor 中深挖**  
4. 已有 artifacts 列表可点击打开相对路径提示（MVP 纯文本即可）  
5. 粗状态选择（open / in_progress / done）与派生徽章；已挂 Epic 时可 **开一轮设计**（预勾本需求）

Epic 卡侧栏（固定需求列）：**开一轮设计**（勾选 open/in_progress 需求 → 创建设计卡），**不**放 BA 澄清（BA 挂在 requirement 上），**不**再「进入设计列」。

设计卡侧栏（设计列）：DesignChat + 人批设计→拆分。

---

## 9. 测试与验收

- 新建看板含 BA Bot  
- 协议解析单测（create/link、缺字段）  
- Worker：create 三文件；link 仅 PRD + 索引更新（可用临时目录）  
- API：ba-settle 幂等不重复建 Epic 卡  
- 冒烟：Mock 驱动需求卡澄清 → 沉淀 → 文件存在 + 需求卡 `epicId` + Epic 卡 artifacts  

---

## 10. 实现切片（单一 Plan）

| ID | 交付 |
|----|------|
| T1 | workspace 精简模版 + `ba` employee + prompts |
| T2 | 协议解析 + `ba-settle` API |
| T3 | Worker 写盘 + Job 接线 |
| T4 | `RequirementChat` + 沉淀触发 |
| T5 | Cursor 深挖入口 + Mock 冒烟脚本 |

---

## 11. 与主规格的关系

修订理解（不改主规格八列结构）：

- 需求列执行者补充：**人 + BA Bot**（澄清与文档 Draft）；Epic 固定本列。  
- 出门规则：人归拢需求后，在 Epic/需求侧栏 **开一轮设计** → 创建设计卡进设计列（而非移动 Epic）。  
- 设计列 DesignChat 挂在 **设计卡** 上，负责设计方案文档；BA 产出的是 **Epic/PRD 需求规格**，不是技术方案。
