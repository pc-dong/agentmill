# AI 友好的 Epic / PRD 体系

> 本文件是人与 AI 消费需求文档的**单一入口**。  
> 设计定稿：`docs/superpowers/specs/<date>-<topic>-design.md`（按项目实际填写）

## 1. 分层一览

| 层级 | 职责 | 路径 |
|------|------|------|
| 全局共享上下文 | 跨 Epic 术语、已有能力、`G-R-xxx`（全工作区一份） | `docs/epics/global-share-context.md` |
| Epic | 宏观目标、用户旅程、边界、PRD 索引 | `docs/epics/<epic-id>-<slug>/EPIC.md` |
| 共享上下文 | 术语、权限码、业务对象、权限原则、跨 PRD 约束（单一事实源） | `docs/epics/<epic-id>-<slug>/shared-context.md` |
| PRD | 某一子场景的可实现规格（字段 / 规则 / AC） | `docs/epics/<epic-id>-<slug>/prds/<prd-id>-<slug>.md` |
| Stories 附录（可选） | 过大 PRD 的实现切片；**不新增业务规则** | `docs/epics/<epic-id>-<slug>/prds/<prd-id>-stories.md` |
| 技术方案（Epic 级） | 领域模型、表、API 列表、时序、复用上下文；字段级 HTTP 契约见 API 接口 / api-doc HTML | `docs/epics/<epic-id>-<slug>/TECH-DESIGN.md` + `tech/`；**迭代变更**见同目录 `TECH-DESIGN-delta-v{版本}-{slug}.md` |

模版：

- 全局共享上下文：`docs/template/GLOBAL-共享上下文模版.md`（维护入口文件见上）
- Epic：`docs/template/EPIC模版.md`
- 共享上下文：`docs/template/EPIC-共享上下文模版.md`
- PRD：`docs/template/AI友好的PRD模版.md`
- Stories 附录：`docs/template/PRD-Stories附录模版.md`
- 技术方案：`docs/template/技术方案模版.md` + `docs/template/tech/`（附件骨架）
- 技术方案增量（迭代）：`docs/template/技术方案增量模版.md` → `TECH-DESIGN-delta-v{版本}-{kebab-slug}.md`

技术方案设计定稿：`docs/superpowers/specs/<date>-<topic>-design.md`（按项目实际填写）

## 2. 目录约定

```text
docs/
├── README-PRD体系.md
├── template/
│   ├── GLOBAL-共享上下文模版.md
│   ├── EPIC模版.md
│   ├── EPIC-共享上下文模版.md
│   ├── AI友好的PRD模版.md
│   ├── PRD-Stories附录模版.md
│   ├── 技术方案模版.md
│   └── tech/                          # 复制到 Epic 下的 tech/
│       ├── domain.puml
│       ├── sequences/
│       ├── ddl/schema.md
│       └── openapi/                   # 已废弃；见 README，勿再当契约
└── epics/
    ├── global-share-context.md        # 跨 Epic；全工作区一份
    └── <epic-id>-<slug>/
        ├── EPIC.md
        ├── shared-context.md          # 必填（本 Epic）；引用 global，不重定义
        ├── TECH-DESIGN.md             # 有实现时建议必填（全量权威）
        ├── TECH-DESIGN-delta-v*.md    # 可选；本迭代变更视图（可覆盖多 PRD）
        ├── tech/                      # 领域图 / DDL / 时序（API 契约见后端原型 HTML）
        └── prds/
            ├── <prd-id>-<slug>.md
            └── <prd-id>-stories.md   # 可选
```

过渡期：`docs/prd/*.md` 保留；**新需求**一律进入 `docs/epics/.../prds/`。

## 3. ID 与命名

| 项 | 规则 | 示例 |
|----|------|------|
| Epic ID | `E-<领域缩写>-<序号>` | `E-CMS-001` |
| PRD ID | `P-<epic序号>-<序号>` | `P-001-02` |
| slug | 英文短横线，稳定 | `content-management` |
| 跨 PRD 约束 | `E-R-xxx`（写在 `shared-context.md`） | `E-R-001` |
| 跨 Epic 约束 | `G-R-xxx`（写在 `global-share-context.md`） | `G-R-001` |
| 本场景规则 | `R-*-xxx`（写在 PRD） | `R-CREATE-001` |
| Tech ID | `T-<同 Epic 领域与序号>` | `T-CMS-001` |

## 4. 冲突裁定

1. 跨 Epic 术语 / 已有能力对象 / `G-R-xxx` → **以 `docs/epics/global-share-context.md` 为准**
2. 本 Epic 权限码 / 业务对象 / 术语 / 全局权限原则 → **以该 Epic `shared-context.md` 为准**（不得与 global 同名冲突）
3. 子场景字段、规则、状态、AC → **以 PRD 为准**
4. 原型与文档冲突 → 业务规则与 AC 以 PRD 为准
5. `shared-context.md` 与 PRD 共享定义冲突 → **停止实现**，在计划中记录冲突
6. 表结构 / API path / 时序 / 复用方式 → **以 `TECH-DESIGN.md` + `tech/` 为准**（不得在技术方案中重定义业务枚举语义）
7. API 列表（§5）与 **API 接口 / 生成 HTML** 冲突 → **以接口 / HTML 为准**，并回写 API 列表（**不以** `tech/openapi/*.yaml` 为准）

## 5. 人侧工作流

1. 若涉及跨 Epic 已有能力（如优惠券），先确认/更新 `docs/epics/global-share-context.md`
2. 复制 Epic 模版 + 共享上下文模版 → 建 `EPIC.md` 与 `shared-context.md`（文首声明引用 global）
3. 在 Epic 的 PRD 索引中登记拟拆 PRD（可先只有标题与一句话范围）
4. 复制 PRD 模版到 `prds/`，填写 `prd_id` / `epic_id` / `epic_path` / `shared_context_path`；需要时引用 global
5. 评审：人对齐看 Epic；跨 Epic 定义看 `global-share-context.md`；本 Epic 共享定义看 `shared-context.md`；可实现性看 PRD
6. PRD 过大时复制 Stories 附录模版，并回填 PRD 的 `stories_appendix`
7. UPDATE：改 global 或 `shared-context.md` 后检查所有下属 PRD；PRD 变更按 ADD / MODIFY / REMOVE
8. 进入实现前：复制 `技术方案模版.md` → `TECH-DESIGN.md`，复制 `docs/template/tech/` → Epic 下 `tech/`（可删废弃的 `openapi/`），填领域模型 / 表 / API 列表 / 时序 / 复用上下文；**相对已有 Ready 的迭代**再复制 `技术方案增量模版.md` → `TECH-DESIGN-delta-v{版本}-{slug}.md`（差集），合并进全量后在全量 §0.2 建索引；可选跑前端/后端原型 skill 并回写全量 §7 / delta §6 / api-doc HTML

**AI 代理工作流（推荐）**：按 skill  
`.agents/skills/epic-prd-tech-design-workflow/SKILL.md`（编排器）  
执行 Phase 0～8；子步骤见同目录嵌套 skill（`epic-author` / `prd-author` / `frontend-prototype` / `tech-design-author` / `backend-prototype` / `doc-grilling` / `tech-verification`）。不确定处按 `doc-grilling` 提问；领域模型 / 表 / API / 时序步骤结束后按 `tech-verification/SKILL.md` 做 PRD 覆盖率校验。可跳段或只跑某一子 skill。

**状态**

| 文档 | 流转 |
|------|------|
| Epic | Draft → Active → Done |
| PRD | Draft → Ready → Implementing → Done |
| 技术方案 | Draft → Ready → Implementing → Done |

`Ready`（PRD）= 人对齐完成，且字段 / 规则 / AC 齐全、Epic 与 shared-context 回链有效。  
`Ready`（技术方案）= 门禁清单通过（见模版 §11）；**建议**在写代码前达到 Ready；允许与 PRD Ready 并行起草。

## 6. AI 读取顺序

1. 本文件（了解约定）
2. `docs/epics/global-share-context.md`（跨 Epic 术语与已有能力；涉及券/领取位等时**必读**）
3. 目标 `EPIC.md`（目标、旅程、边界、PRD 索引；可选前端原型 §0.2）
4. 同目录 `shared-context.md`（本 Epic 共享事实源）
5. 目标 PRD 全文
6. 实现时：同目录 `TECH-DESIGN.md` + 所需 `tech/` 附件（领域图 / DDL / 时序）+ §7 指向的 api-doc HTML / API 接口；若任务属某迭代，先读对应 `TECH-DESIGN-delta-v*`
7. 仅当声明时：`*-stories.md`、前端原型分支、相关系统事实文档
8. 默认不读同 Epic 下其他 PRD（除非本 PRD 显式依赖 `P-xxx`）

实现时：不发明未定义行为；冲突停止并记录；不得把 Epic 旅程步骤当作可实现业务规则；API/表以技术方案与 **Controller/HTML** 为准；跨 Epic 对象名以 global 为准（如 `CouponStock` 而非 `CouponBatch`）。

## 7. 质量门禁

### Epic 就绪

- [ ] 有可衡量成功标准与清晰 In / Out
- [ ] 旅程步骤能映射到 PRD 索引（或标明后续拆分）
- [ ] 同目录存在 `shared-context.md`，且文首引用 `global-share-context.md`
- [ ] 共享术语 / 权限码 / 对象无内部矛盾；跨 Epic 术语未与 global 冲突
- [ ] 若存在跨 PRD 约束，均已编号 `E-R-xxx`（无则写「无」）

### PRD Ready

- [ ] `epic_id` / `epic_path` / `prd_id` / `shared_context_path` 有效
- [ ] 子场景能在 Epic 旅程中定位
- [ ] 权限码、对象名与 `shared-context.md` 对齐，无重新定义
- [ ] 字段表 + 规则 + AC 闭环
- [ ] UPDATE 时变更节与合并说明完整

### 技术方案 Ready

- [ ] `TECH-DESIGN.md` 存在，Tech ID 与 Epic 对齐
- [ ] `tech/domain.puml`、表设计、API 列表、主时序齐全；§7 原型契约已填或标明未做
- [ ] §相关上下文写明复用能力与依赖
- [ ] 若有接口原型：API 列表与 API 接口 / HTML path 一致
- [ ] 若有迭代增量：`TECH-DESIGN-delta-v*` 已在全量 §0.2 索引，且差集已合并进全量
- [ ] 未把业务规则从 PRD 挪到技术方案「另起一套」
- [ ] 领域/表/API/时序曾按 `epic-prd-tech-design-workflow` 的 V-* 校验，缺口已关闭或写入 OPEN 决议

### 实现前 AI 门禁

- [ ] 已读 `EPIC.md` + `shared-context.md` + 本 PRD
- [ ] 已读 `TECH-DESIGN.md` 与相关 `tech/` 附件（若本任务含接口/表/领域改动）
- [ ] 若本任务属某迭代：已读对应 `TECH-DESIGN-delta-v*`
- [ ] 无 shared-context ↔ PRD 冲突；无 PRD ↔ 技术方案语义冲突
- [ ] 范围未越出本 PRD / 本技术方案 In 范围
