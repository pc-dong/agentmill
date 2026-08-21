---
name: epic-author
description: >-
  Author Union Platform Epic.md and shared-context.md from docs/template (Phase
  0–1). Use when creating or updating an Epic, shared-context, or global-share
  references; when the user asks to write Epic only; or when
  epic-prd-tech-design-workflow routes to Epic authoring.
---

# Epic Author（Phase 0–1）

> 体系：`docs/README-PRD体系.md` · 模版：`docs/template/` · 样例结构：`docs/epics/E-CMS-001-content-management/`  
> 提问：先 `Read` 同级 [`../doc-grilling/SKILL.md`](../doc-grilling/SKILL.md)  
> [preset] 模版种子：上级目录 `../template/`（随本 preset 分发，含 `../README-PRD体系.md`）。工作区缺 `docs/template/` 时先播种（复制 `../template` → 工作区 `docs/template`，或加载 `init-prd-docs`），再按 `docs/template/` 路径执行。

**默认不写实现代码**；止于 Epic / shared-context 文档 Ready（人对齐）。  
**例外**：人确认后可随时跑 [`../frontend-prototype/SKILL.md`](../frontend-prototype/SKILL.md)，并回写 Epic §0.2。

## Phase 0 — 上下文与范围对齐

**必读**：`docs/README-PRD体系.md`；跨 Epic 能力则读 `docs/epics/global-share-context.md`。

**可批量确认**（缺一则一次勾选）：

| 项 | 例 |
|----|-----|
| Epic 中文名 / slug | 内容管理 / content-management |
| Epic ID / 领域缩写 | E-CMS-001 |
| 关联卡号 | DEMO-1001… |
| 是否新建目录 | `docs/epics/<id>-<slug>/` |

**B1（边界有争议则单问）**：In / Out。

产出：一句话目标 + 拟拆 PRD 标题列表（可先只有标题）。  
然后执行 **doc-grilling D1** 门禁，再进 Phase 1。

## Phase 1 — Epic + 共享上下文

1. 复制模版：
   - `docs/template/EPIC模版.md` → `docs/epics/<id>-<slug>/EPIC.md`
   - `docs/template/EPIC-共享上下文模版.md` → `shared-context.md`
2. 填写：目标、成功标准、In/Out、用户旅程（步骤挂 `→ 详见 P-xxx`）、PRD 索引。
3. `shared-context`：术语、权限码、业务对象、`E-R-xxx`；**引用** global，不重定义 `G-R-xxx` / CouponStock 等。
4. 需要新跨 Epic 能力：先改 `global-share-context.md`（改 global = **B1**）。

**人确认点**

- 批量：旅程拆 PRD 是否合理  
- B1：权限码命名（未定 → doc-grilling C1）  
- 可选：是否现在做 **frontend-prototype**（不阻塞进 PRD）

结束时跑 **doc-grilling D1**（产出清单 + B1 队列清空）。若做了前端原型，确认 §0.2 已填。
