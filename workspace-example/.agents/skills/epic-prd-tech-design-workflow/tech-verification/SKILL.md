---
name: tech-verification
description: >-
  Verify Union Platform TECH-DESIGN coverage against Epic/PRD (V-DOMAIN, V-DB,
  V-API, V-SEQ, Ready gate). Use after domain/DDL/API-list (and optional
  backend-prototype Controller/HTML)/sequence work, before marking Tech Ready,
  or when the user asks to audit TECH vs PRD coverage.
---

# TECH Verification（覆盖率校验）

> 在 Phase 4～7 各自结束后、以及 Phase 8 Ready 前执行。  
> 缺口涉及决策时：`Read` [`../doc-grilling/SKILL.md`](../doc-grilling/SKILL.md)。  
> API 权威：API 接口 + SpringDoc / generate-api-doc HTML（**不是** `tech/openapi/*.yaml`）。

输出固定为：

1. **已覆盖**（PRD/E-R → TECH 落点）  
2. **缺口**（必须补文档或升 OPEN / 问人）  
3. **有意 Out**（写明对应 PRD Out 或 Epic Out）

从 Epic `prds/*.md` + `shared-context.md`（+ 必要 global）收集检查项；**默认扫本 Epic 全部 PRD**（TECH 为 Epic 级）。  
若本轮有 `TECH-DESIGN-delta-v*.md`：在对应 V-* 额外做**差集抽检**（delta §2–§5 声明的变更须在全量 TECH / `tech/` / Controller 有落点）。

---

## 公共：抽取检查项

| 来源 | 抽取 |
|------|------|
| PRD 字段表 | 每个持久或 API 可见字段 |
| `R-*` / AC | 每条规则与验收 |
| 状态机 | 状态 × 动作 |
| 权限码 | `THEME_*` 等 |
| `E-R-*` / `G-R-*` | 跨场景 / 跨 Epic 约束 |
| Epic 旅程 | 每步对应的写/读/协作路径 |

---

## V-DOMAIN

**通过标准**：每个业务对象 / 关键规则在领域图或 §3 有落点；外部依赖有 UseCase/Listener/事件名。

| 检查 | 方法 |
|------|------|
| 业务对象 | PRD/shared 对象表 ⊆ domain 类或注明「外部/不建模」 |
| 枚举 | PRD 枚举 ⊆ domain 枚举；字面量未定 → OPEN 或问人 |
| 不变量 | `E-R-*` / 关键 `R-*` 在 §3 不变量或行为中有对应 |
| 聚合边界 | 写路径一致性（谁保证事务/发布）说得清 |
| 外部能力 | 复用能力以 **UseCase/Listener** 出现，禁止含糊「调一下库」 |
| Out | Epic/PRD Out 未偷偷进领域模型 |

失败：缺口表 `| ID/对象 | 问题 | 建议 |` → 补 `domain.puml`/§3 或问人。

---

## V-DB

**通过标准**：需持久字段有表/JSON 路径；隔离与软删策略明确。

| 检查 | 方法 |
|------|------|
| 字段落库 | PRD 需持久字段 → `schema.md` 列或 JSON path |
| 仅 API 投影 | 派生字段 → 标明不落库 |
| 复用表 | ALTER/复用约定 + **隔离键**书面化 |
| 存量数据 | 回填 / 不回填有决议（OPEN-DB） |
| 索引/唯一 | 与规则一致；软删策略写明 |
| 禁止 | `G-R-*` 未违规进本 Epic 表 |

失败：补 DDL/§4 或问人。

---

## V-API

**通过标准**：需系统交互的 PRD 场景有 API 或显式「无 HTTP / 前端拼 URL / 复用他服务」；若已跑 backend-prototype 接口段，则 §5 path 能在 API 接口（或生成 HTML）找到，且主成功/主失败在 SpringDoc 有描述。

| 检查 | 方法 |
|------|------|
| 场景覆盖 | 创建/改/发/撤/删/列表/详情/… ↔ §5 HTTP 或「不提供」；跨服务 MQ ↔ §5 事件监听表 |
| PRD 关联 | §5「关联 PRD」可追溯；无孤儿 API / 无孤儿事件 |
| 权限 | PRD 权限码在备注或 Controller/DTO `@Schema`/`@Operation` |
| 错误 | 主失败有 HTTP + 业务码（或统一错误体；SpringDoc `@ExampleObject` 优先） |
| Controller/HTML | 若 §7 已填原型契约：path 与 §5 一致；冲突以 Controller/HTML 为准并记缺口「未回写 §5」 |
| 禁止复用 | 写明不调用的旧 path 在「不提供」区 |
| 事件监听 | PRD/E-R 要求的 MQ 消费场景均在 §5 事件表；软删/恢复策略写清；时序图 Event Type 与表一致 |
| 非 HTTP 其它 | Scheduler/Audit 等在 §5.x 或 §7 例外表 |
| 废弃 | **不**要求 `tech/openapi/*.yaml` 存在或与 §5 一致 |

失败：补 §5 / Controller 原型 / HTML 或问人。

---

## V-SEQ

**通过标准**：主写/主读/跨服务协作至少各有一张（若 TECH 声称有）；与 §5 / Controller / 外部 UseCase 一致。

| 检查 | 方法 |
|------|------|
| 旅程/发布等 | 有对应 `.puml` |
| 参与者 | 经 `XxxUseCase`，非直写他域表 |
| 角色命名 | 与 §8、PRD 一致 |
| 异常分支 | 关键 4xx 有 alt 或注明见 Controller/HTML 错误示例 |
| 与 V-API | path/command 能在 §5 或 API 接口找到 |

失败：补 `.puml`/§6 或问人。

---

## Ready 前总检（Phase 8）

对照 `TECH-DESIGN.md` §11 与 `docs/README-PRD体系.md` 技术方案门禁：

- [ ] 覆盖 PRD 索引完整
- [ ] V-DOMAIN / V-DB / V-API / V-SEQ 均曾输出且缺口为 0 或已转 OPEN 关闭
- [ ] §5 齐全；若跑过 backend-prototype 接口段，则 §7 原型契约表 + Controller/HTML 可定位（**不**要求 `tech/openapi/*.yaml`）
- [ ] 若有迭代增量：`TECH-DESIGN-delta-v*` 已在全量 §0.2 索引；差集抽检通过
- [ ] §9 OPEN-* 均有决议
- [ ] §8 前端要点足以联调（若有前端原型，Epic/PRD 已回写分支/path）
- [ ] 人确认 Tech 状态 → Ready
