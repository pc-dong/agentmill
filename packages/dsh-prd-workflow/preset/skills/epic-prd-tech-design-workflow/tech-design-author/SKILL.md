---
name: tech-design-author
description: >-
  Author Union Platform TECH-DESIGN.md (full) and TECH-DESIGN-delta-v*.md
  (iteration change views), plus tech/ artifacts (domain.puml, DDL, API list,
  sequences, frontend notes, OPEN closeout) for Phases 3–8. OpenAPI yaml is not
  authored—API detail comes from optional backend-prototype (API 接口 + SpringDoc +
  generate-api-doc). Use when drafting TECH; or when epic-prd-tech-design-workflow
  routes here. Run tech-verification after domain/db/api/seq steps.
---

# TECH Design Author（Phase 3–8）

> 全量模版：`docs/template/技术方案模版.md` + `docs/template/tech/`  
> **迭代增量模版**：`docs/template/技术方案增量模版.md` → `TECH-DESIGN-delta-v{版本}-{kebab-slug}.md`  
> 提问：[`../doc-grilling/SKILL.md`](../doc-grilling/SKILL.md)  
> 校验：每步后 `Read` [`../tech-verification/SKILL.md`](../tech-verification/SKILL.md) 对应 V-*  
> 后端原型（可选）：[`../backend-prototype/SKILL.md`](../backend-prototype/SKILL.md)  
> [preset] 模版种子：上级目录 `../template/`（随本 preset 分发，含 `../README-PRD体系.md`）。工作区缺 `docs/template/` 时先播种（复制 `../template` → 工作区 `docs/template`，或加载 `init-prd-docs`），再按 `docs/template/` 路径执行。
> 前置：Epic + PRD 已齐（或用户明确只要 TECH 骨架）

**默认不写业务实现**；Phase 4/6 经人确认可跑 **backend-prototype**。  
冲突裁定：全量 **TECH + `tech/`** > delta 摘要 > 臆测；§5 与 **API 接口（+ SpringDoc）/ 生成 HTML** 冲突 → **以接口/HTML 为准**并回写列表。  
**禁止**把 `tech/openapi/*.yaml` 当作权威契约（模版中该目录已废弃）。

每个 Phase 结束执行 **doc-grilling D1**，再进下一 Phase。

## 全量 vs 迭代增量

| 文档 | 职责 |
|------|------|
| `TECH-DESIGN.md` | **聚合后全量权威**（领域/表/API/时序/OPEN） |
| `TECH-DESIGN-delta-v{ver}-{slug}.md` | **本迭代变更视图**（字段/API/DDL/行为差集 + 实现勾选）；一份可覆盖**多个 PRD** |

命名：`TECH-DESIGN-delta-v0.2-content-summary.md`（版本与全量文首一致；slug≤5 英文词）。  
**禁止**在全量 §0 堆长「变更影响清单」；§0.2 只保留**增量索引表**，细节进 delta。

### 增量迭代流程（已有 Ready 全量后的下一版）

1. 确定本版版本号（相对基线 +1）与 slug、覆盖 PRD 列表  
2. 复制 `技术方案增量模版.md` → Epic 根目录 `TECH-DESIGN-delta-v…md`，填 §0–§8 差集  
3. **合并**进全量：更新 `TECH-DESIGN.md` 对应 §3–§8 / `tech/`（聚合结果）  
4. 全量 §0.2 增量索引加一行；Epic Tech 索引可链 delta  
5. 可选 backend-prototype → 回写 **delta §6 + 全量 §7**  
6. D1 → tech-verification（全量 V-*；delta 做差集抽检）

首版 Epic（尚无基线）：可只写全量；首个 Ready 后的变更一律走 delta。

## Phase 3 — TECH 骨架

1. 复制 `docs/template/技术方案模版.md` → `TECH-DESIGN.md`
2. 复制 `docs/template/tech/` → Epic 下 `tech/`（**不要**依赖 `tech/openapi/*.yaml` 作为交付）
3. 填 §0 覆盖 PRD、§0.2 增量索引（可空）、§1 目标/InOut、§2 复用依赖（路径尽量可定位）
4. Tech ID = `T-<同 Epic 领域序号>`（例 `E-CMS-001` → `T-CMS-001`）
5. 若本轮已是「相对旧 Ready 的增量」：同步建 `TECH-DESIGN-delta-v…md`（见上）

**B1 串行**：服务归属 → 复用表/HTTP → API 边界（console / c-end / scheduler…）。

## Phase 4 — 领域模型 + V-DOMAIN

1. 画/更新 `tech/domain.puml`
2. TECH §3：设计决策、不变量、持久化边界；**增量字段写入 delta §2**
3. **可选**：询问是否跑 **backend-prototype 领域段**（**仅**领域实体 + UseCase 接口签名；禁止 Impl / 落库）→ 若是则 `Read` 并执行该 skill 段 A  
4. **跑 tech-verification → V-DOMAIN** → 补模型或 OPEN / B1  
5. B1：聚合边界、外部依赖命名（UseCase 非 *Port，除非项目惯例）

## Phase 5 — 数据库 + V-DB

1. 更新 `tech/ddl/schema.md` + 草稿 `0xx_*.sql` / `1xx_*.sql`
2. TECH §4 表清单与结论；**本迭代脚本/列写入 delta §4**
3. **跑 V-DB**
4. B1 串行：共表隔离 → 存量回填 → 软删与唯一约束

## Phase 6 — API 列表 +（可选）接口原型 + V-API

1. TECH §5 **HTTP 表**（变更类型、关联 PRD、备注）— 全量保持完整列表  
2. TECH §5 **事件监听表**（MQ）：每个跨服务消费场景一行  
3. **delta §3** 只列本迭代 ADD/MODIFY 行  
4. **不要**手写 `tech/openapi/*.yaml`  
5. **可选**：询问是否跑 **backend-prototype 接口段** → 执行后填 **全量 §7 + delta §6**  
6. §5 与 Controller/HTML 冲突 → 改列表对齐 Controller/HTML  
7. **跑 V-API**（须覆盖 HTTP **与** 事件监听行）  
8. B1：独立资源 vs 复用旧 HTTP；Scheduler/MQ；错误码段  

## Phase 7 — 时序图 + V-SEQ

1. `tech/sequences/*.puml`
2. TECH §6 索引 + 可选摘要；行为差写入 **delta §5**
3. **跑 V-SEQ**
4. B1：跨服务是否经既有 UseCase（禁止 Module 直写他域表）

## Phase 8 — 前端对接 + OPEN + Ready

1. TECH §8（**不写 UI 布局**；若 Epic/PRD 已有前端原型，可链分支/path）；delta §6 可摘要  
2. §9：每条 OPEN **一次 B1 单问**，禁止批量默认关闭  
3. §11 勾选；Epic 回链 Tech → Ready；**§0.2 增量索引状态同步**  
4. 跑 tech-verification **Ready 前总检**
