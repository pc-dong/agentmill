---
name: prd-author
description: >-
  Author Union Platform PRD markdown from docs/template (Phase 2). Use when
  writing or splitting PRDs under an Epic, adding Stories appendices, or when
  epic-prd-tech-design-workflow routes to PRD authoring; also for "只写 PRD".
---

# PRD Author（Phase 2）

> 体系：`docs/README-PRD体系.md` · 模版：`docs/template/AI友好的PRD模版.md`  
> 提问：[`../doc-grilling/SKILL.md`](../doc-grilling/SKILL.md)  
> 前置：Epic 目录与 PRD 索引已存在（或先跑 `epic-author`）  
> [preset] 模版种子：上级目录 `../template/`（随本 preset 分发，含 `../README-PRD体系.md`）。工作区缺 `docs/template/` 时先播种（复制 `../template` → 工作区 `docs/template`，或加载 `init-prd-docs`），再按 `docs/template/` 路径执行。

**默认不写实现代码**；不新增业务规则到 Stories 附录。  
**例外**：人确认后可随时跑 [`../frontend-prototype/SKILL.md`](../frontend-prototype/SKILL.md)，并回写 Epic §0.2 + 本 PRD §14。

## 步骤

对 Epic 索引中每个 PRD：

1. 复制 `docs/template/AI友好的PRD模版.md` → `prds/<prd-id>-<slug>.md`
2. 填齐：字段表、规则 `R-*`、状态机、AC、权限；文首回链 Epic / shared-context / global。
3. 过大则加 `PRD-Stories附录模版.md`（**不新增业务规则**）。
4. 回写 Epic §0 索引状态（Draft → 人对齐后 Ready）。
5. 若已有 / 新建前端原型：填 §14（分支 + path；冲突时业务规则与 AC 以 PRD 为准）。

## 人确认点

- 批量：各 PRD In/Out 清单  
- B1：跨 PRD 规则是否上收为 `E-R-xxx`；枚举/状态机字面量未定  
- 可选：是否现在做 **frontend-prototype**（不阻塞进 TECH）

## PRD Ready 粗检

字段/规则/AC 齐全；无「待产品确认」占位（有则标 OPEN 或 doc-grilling 单问）；若声明有原型则 §14 可定位。

结束时跑 **doc-grilling D1**。
