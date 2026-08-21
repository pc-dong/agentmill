---
name: epic-prd-tech-design-workflow
description: >-
  Orchestrates Union Platform Epic → PRD → TECH-DESIGN documentation (Phases
  0–8) via nested skills under this folder. Use for the full docs workflow,
  需求文档/技术方案工作流, or when skipping segments (Epic only / PRD only /
  TECH from Phase 3). Independently: doc-grilling, epic-author, prd-author,
  tech-design-author, tech-verification, frontend-prototype, backend-prototype.
---

# Epic / PRD / TECH-DESIGN 工作流（编排器）

> 权威体系：`docs/README-PRD体系.md` · 模版：`docs/template/`  
> 样例结构：`docs/epics/E-CMS-001-content-management/`（勿当业务真理）  
> 设计：`docs/superpowers/specs/<date>-<topic>-design.md`（按项目实际填写）  
> [preset] 模版种子随本 preset 分发：本 skill 基目录 `template/` 与 `README-PRD体系.md`。工作区缺 `docs/template/` 时，先把 `<base>/template` 复制到工作区 `docs/template`、`<base>/README-PRD体系.md` 复制到 `docs/`（或加载 `init-prd-docs` 播种），之后所有 `docs/...` 路径照常按工作区相对路径执行。

本 skill **只编排**；细则在嵌套子 skill。执行某段前 **必须 `Read` 对应 `SKILL.md`**，按其步骤做，不要凭记忆省略门禁。

## 子 skill 地图（均在本目录下）

| 子 skill | 路径 | 职责 |
|----------|------|------|
| doc-grilling | [`doc-grilling/SKILL.md`](doc-grilling/SKILL.md) | B1/C1/D1 提问与 Phase 门禁 |
| epic-author | [`epic-author/SKILL.md`](epic-author/SKILL.md) | Phase 0–1 Epic + shared-context |
| prd-author | [`prd-author/SKILL.md`](prd-author/SKILL.md) | Phase 2 PRD |
| frontend-prototype | [`frontend-prototype/SKILL.md`](frontend-prototype/SKILL.md) | Epic/PRD 可选：前端 stub 原型（结构按项目实际） |
| tech-design-author | [`tech-design-author/SKILL.md`](tech-design-author/SKILL.md) | Phase 3–8 全量 TECH + **`TECH-DESIGN-delta-v*`** 迭代增量 + `tech/` |
| backend-prototype | [`backend-prototype/SKILL.md`](backend-prototype/SKILL.md) | TECH 可选：仅领域数据结构+UseCase 接口 / Controller+DTO stub+SpringDoc（无 Impl） |
| tech-verification | [`tech-verification/SKILL.md`](tech-verification/SKILL.md) | V-DOMAIN / V-DB / V-API / V-SEQ / Ready 总检 |

子 skill **可独立触发**。全流程或跳段时由本编排器路由。

## 硬性门禁（摘要）

1. 关决策 → **doc-grilling**（不得臆造）。  
2. 事实先查仓库 / 模版 / global。  
3. 每 Phase（或子 skill 段落）结束 → **doc-grilling D1**，B1 清空后再进下一段。  
4. TECH 的 domain/db/api/seq 后 → **tech-verification** 对应 V-*。  
5. 冲突：global > epic shared-context > PRD；**API 字段级契约：API 接口（+ SpringDoc）/ 生成 HTML > TECH §5 列表**（回写列表）。全量 **TECH + `tech/` > `TECH-DESIGN-delta-v*`**。**不再**以 `tech/openapi/*.yaml` 为权威。  
6. **默认不写业务实现代码**，止于文档 Ready。  
7. **例外**：用户明确触发（或 Phase 内确认）**frontend-prototype** / **backend-prototype** 时，允许其 skill 约定范围内的原型代码（stub UI / **仅**领域实体 + UseCase 接口 / API 接口 + DTO + SpringDoc 注解）。**禁止** UseCase Impl、Repository、ORM Mapper、迁移脚本、完整业务（除非用户另要求「正式实现」）。

## 进度清单

```text
Phase 0–1  epic-author      （可选随时 → frontend-prototype）
Phase 2    prd-author       （可选随时 → frontend-prototype）
Phase 3–8  tech-design-author
             Phase 4 可选 → backend-prototype 领域段
             Phase 6 可选 → backend-prototype 接口段 + generate-api-doc
             （内嵌 tech-verification + doc-grilling）
```

## 默认路由（全流程 A1）

按序：

1. `Read` **doc-grilling**（会话内提问纪律）  
2. `Read` + 执行 **epic-author**（0–1）；提示可选 **frontend-prototype**  
3. `Read` + 执行 **prd-author**（2）；提示可选 **frontend-prototype**  
4. `Read` + 执行 **tech-design-author**（3–8；Phase 4/6 提示可选 **backend-prototype**）

每段结束后等人确认（D1）再进入下一段。

## 跳段入口

| 用户意图 | 路由 |
|----------|------|
| 只写 / 改 Epic | → **epic-author**（仍建议先读 doc-grilling） |
| 只写 / 改 PRD | → **prd-author**（确认 Epic 索引已有） |
| 前端原型 / stub 交互 | → **frontend-prototype** |
| 从 TECH 起 / 只做 TECH / 写迭代增量 delta | → **tech-design-author** |
| 后端领域 / 接口原型 | → **backend-prototype** |
| 只校验 TECH 覆盖率 | → **tech-verification** |
| 只澄清决策 / grilling | → **doc-grilling** |

未说明时：**默认全流程**。

## 附加资源

- `docs/README-PRD体系.md`、`docs/template/`  
- `generate-api-doc` skill（接口原型导出 HTML）  
- 可选风格参考：`.agents/skills/grilling/SKILL.md`
