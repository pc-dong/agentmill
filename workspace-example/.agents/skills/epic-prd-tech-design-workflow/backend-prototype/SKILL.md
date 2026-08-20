---
name: backend-prototype
description: >-
  Thin backend prototype for TECH only: domain data structures + port.in UseCase
  interfaces (Phase 4 optional); SpringController/DTO stubs with SpringDoc +
  optional generate-api-doc (Phase 6 optional). Never UseCase Impl, Repository,
  MyBatis, Liquibase, or business logic. Writes branch/paths to TECH-DESIGN. Use
  when user asks for 后端原型, or when epic-prd-tech-design-workflow /
  tech-design-author routes here.
---

# Backend Prototype（TECH Phase 4 / 6 可选）

> 编排：[`../SKILL.md`](../SKILL.md)  
> TECH 作者：[`../tech-design-author/SKILL.md`](../tech-design-author/SKILL.md)  
> API 文档：`.agents/skills/generate-api-doc/SKILL.md`  
> SpringDoc：`.cursor/rules/springdoc-openapi.mdc`  
> 六边形：`.cursor/rules/backend-java-hexagonal.mdc`

**目标**：用最少代码把契约钉住，供 TECH / 评审对齐。  
**不是**：功能实现、落库、联调、完整业务闭环。

两段可分开跑。契约源（接口段）= **SpringController + SpringDoc + 生成的 HTML**（**不写** `tech/openapi/*.yaml`）。

---

## 硬边界（先读再动手）

### ✅ 允许（原型范围）

| 层 | 允许改什么 |
|----|------------|
| Domain | 实体 / VO / 枚举等**数据结构**（字段、类型、简单构造/工厂签名） |
| Domain | `port.in.*UseCase` **接口**（方法签名 + Command/Query record） |
| Presentation（仅接口段） | `port.in.*Controller` + `*ControllerImpl` stub（Presenter 层；Impl **可**声明依赖 UseCase 接口，方法体仍 stub） |
| Presentation（仅接口段） | `port.out` Request/Result **View 接口**（及可选薄 DTO） |
| App（仅接口段） | `Spring*Controller` 路由 + 方法签名 + SpringDoc；**只依赖** `port.in.*Controller` + DTO |
| App（仅接口段） | 带 `@Schema` 的 DTO（可实现 port.out View） |
| Presentation / App（仅接口段） | 方法体 stub：`throw new UnsupportedOperationException("prototype")` 或 `return null`（统一一种） |

### ❌ 禁止（即使用户说「更新领域模型 / API」也默认禁止）

除非用户**明确**说「完整实现 / 落地业务 / 写 Impl / 写 DDL 到 liquibase」：

- UseCase **Impl**（含改已有 Impl 接新字段）
- Repository / Port.out **实现**、MyBatis Entity / Mapper / XML
- Liquibase / 生产库 ALTER（TECH `tech/ddl/*.sql` 草稿由 **tech-design-author** 管，不在本 skill）
- 业务校验落到 Impl、持久化读写、事件发布、Audit 埋点
- 为「跑通」而补全装配、改 Config、改测试到业务级通过
- 以「已有代码是完整实现」为由，把增量也做成完整实现

**增量场景（如 P-001-01 v0.2 加字段）**：只改  
1）领域对象字段 +（可选）UseCase 接口 Command 签名；  
2）接口段再改 DTO / port 接口 / Controller SpringDoc。  
**不要**顺手改 `*UseCaseImpl`、`*RepositoryImpl`、Entity、Liquibase。

---

## 何时使用

| 段 | 时机 |
|----|------|
| 领域段 A | Phase 4 或用户说「后端领域原型 / 更新领域模型契约」 |
| 接口段 B | Phase 6 或用户说「后端接口原型 / 出 API 文档」 |

用户只说「改原型 / 更新领域模型和 API」且未要求实现 → **默认只做 A+B 的薄契约**，完成后停住，询问是否进入正式实现。

---

## 公共前置

- Epic + 相关 PRD（接口段还需 §5 列表或可推导接口）  
- 卡号 → `demo-backend-service` 分支 `feature/<卡号>-<slug>`（与前端同卡同名）  
- 确认落在哪个 domain lib / `demo-*-app`

```bash
git fetch origin develop
git checkout -b feature/<卡号>-<简短英文描述> origin/develop
```

---

## 段 A — 领域原型（Phase 4）

**Done when**：领域类型 + `port.in` UseCase 接口能 `compileJava`；TECH 记了 path；**无** Impl/持久化 diff。

1. 对照 `tech/domain.puml` / PRD，在合适 **domain lib** 仅增加或修改：  
   - 领域模型**数据结构**（字段 / 枚举 / VO）  
   - **`port.in` UseCase 接口**（方法 + Command/Query 签名）  
2. 允许：纯数据结构上的极薄校验占位（如静态工厂参数非空），但**不要**写完整业务规则引擎或依赖仓储的逻辑。  
3. **不**写 UseCase Impl、Repository、MyBatis、Controller、Liquibase。  
4. 编译：优先 `:com.example.<module>:compileJava`（仅 domain 模块即可）。  
5. 回写 TECH「后端原型契约」中的领域 path（全量 §7；有 delta 则同步 §6）。  
6. doc-grilling D1 → 回到 Phase 4 / V-DOMAIN。

若编译因「缺少 Impl」失败：**不要**补 Impl；改为不注册 Bean、或仅保证接口/模型源文件本身可编译（不强制整 app bootRun）。

---

## 段 B — 接口原型（Phase 6）

**Done when**：Presenter Controller + SpringController + DTO `@Schema` 能表达契约；可选已导出 HTML；TECH §7 表已填；**无** UseCase Impl / 落库。

### 强制分层（与 `.cursor/rules/backend-java-hexagonal.mdc` 一致）

```text
Spring*Controller (app)
  → port.in.*Controller (presentation-adapter *ControllerImpl)
    → UseCase（正式实现阶段；原型 Impl 方法体仍 stub）
```

- **`Spring*Controller` 禁止** import / 注入任何 `*UseCase`。
- 生成新 HTTP 接口时：**必须同时**生成 Presenter 层 `port.in.*Controller` + `*ControllerImpl`（+ 必要 `port.out` View），再写薄 Spring 壳。
- 参考：`SpringContentChannelController` → `ContentChannelController`；`SpringContentAdminController` → `ContentAdminController`。

1. 依据 Epic / PRD / 领域模型 / TECH §5，**成对**增加或修改：  
   - **presentation-adapter `*-controller-lib`**：  
     - `port.in.*Controller` 方法签名  
     - `*ControllerImpl` stub（可构造注入 UseCase 接口，**方法体不写业务**）  
     - `port.out` Request/Result **View**（及可选薄 DTO）  
   - **app**：  
     - `Spring*Controller`：路由 + 方法签名 + SpringDoc；**只注入** `port.in.*Controller`  
     - DTO：字段 + `@Schema`（可实现 port.out View）  
   - **Config**（可选，原型可不装配）：仅当需要编译/文档时再加 Bean stub，**不要**为跑通业务去写 UseCase Impl  
2. 方法体：**仅 stub**，禁止调用真实 UseCase Impl 完成业务（若项目已有 wiring，新增方法也保持 stub 或显式 `UnsupportedOperationException("prototype")`）。  
3. **不要**写 / 改 UseCase Impl、Mapper、Entity 完成落库。  
4. （可选）更新 LOCAL `springdoc.paths-to-match` → **generate-api-doc** 导出 HTML/PDF。  
5. 回写：
   - 全量 `TECH-DESIGN.md` §7（后端原型契约表）
   - 若存在本迭代 `TECH-DESIGN-delta-v*.md` → 同步填 **delta §6**（同一 path 摘要）

### TECH-DESIGN.md「后端原型契约」（建议 §7；delta §6 同结构摘要）

| 项 | 值 |
|----|-----|
| 后端仓库 | `demo-backend-service` |
| 分支 | `feature/<卡号>-…` |
| 领域模型 / UseCase 接口 paths | （段 A） |
| Presenter Controller paths | `…/port/in/*Controller.java` + `…/*ControllerImpl.java` |
| SpringController paths | `…/SpringXxxController.java` |
| Port / DTO paths | （可选） |
| API 文档 HTML | `docs/api-doc/demo-<app>-…html`（若已导出） |
| 状态 | Draft / 已导出 |
| 范围说明 | **原型仅契约；业务 Impl / DDL 落地另开实现任务** |

6. §5 与 Controller/HTML 冲突 → **以 Controller/HTML 为准**，回写 §5（并回写相关 delta §3 若本迭代有变更）。  
7. doc-grilling D1 → **tech-verification V-API** → 回到 Phase 6。

---

## 禁止（汇总）

- 手写 / 维护 `tech/openapi/*.yaml` 作为权威契约  
- 原型阶段完整业务、落库、Liquibase 生产脚本、审计/MQ 完整链路  
- 未回写分支 / path（接口段还要 HTML path）就声称原型完成  
- 把「更新领域模型 / API」理解成「端到端实现」

## 常见借口（驳回）

| 借口 | 正确做法 |
|------|----------|
| 「不加 Impl 编译不过」 | 只编译 domain；或方法体 stub；不补业务 Impl |
| 「SpringController 直接调 UseCase 更快」 | **禁止**；必须经 `port.in.*Controller` / Impl |
| 「只生成 SpringController，Presenter 以后再补」 | **禁止**；段 B 必须成对生成 Presenter + Spring 壳 |
| 「字段不进 Repository 就没意义」 | 原型钉契约；落库留给实现 plan / executing-plans |
| 「顺手写了 Entity/DDL 更完整」 | 停手；DDL 草稿走 TECH `tech/ddl/`，生产脚本走实现任务 |
| 「已有功能是完整实现，增量也要完整」 | 增量原型仍只改模型字段 + 接口/DTO 签名 |

## 独立触发

- 「只做后端领域原型」→ **仅段 A**  
- 「只做接口原型 / 出 API 文档」→ **仅段 B**  
- 「更新领域模型 + API 变更」（无实现字样）→ **A + B 薄契约**，完成后询问是否开实现计划  

正式落地（Impl / MyBatis / Liquibase / 测试）→ **writing-plans / executing-plans**，不要扩写本 skill。
