---
name: backend-prototype
description: >-
  Thin backend prototype for TECH only: domain-layer entity and use-case
  interface definitions (Phase 4 optional); API-layer interface definitions
  with SpringDoc annotations (Phase 6 optional). Never Impl, repository, ORM
  mappers, migrations, or business logic. Writes branch/paths to
  TECH-DESIGN. Use when user asks for 后端原型, or when
  epic-prd-tech-design-workflow / tech-design-author routes here. No project
  structure is assumed — read the project files first.
---

# Backend Prototype（TECH Phase 4 / 6 可选）

> 编排：[`../SKILL.md`](../SKILL.md)  
> TECH 作者：[`../tech-design-author/SKILL.md`](../tech-design-author/SKILL.md)  
> API 文档：`../../generate-api-doc/SKILL.md`（apps-reference 按项目实际）

**目标**：用最少代码把契约钉住——**实体、接口签名、SpringDoc 注解**——供 TECH / 评审对齐。  
**不是**：功能实现、落库、联调、完整业务闭环。

两段可分开跑。契约源（接口段）= **API 层接口 + SpringDoc 注解**（+ 可选生成的 HTML）；**不写** `tech/openapi/*.yaml`。

---

## 分层模型（只有两层）

本 skill 只涉及两个层，**不假设**任何包名、目录、模块或组件名，各层落位以项目文件为准：

| 层 | 本 skill 允许的内容 |
|----|--------------------|
| **领域层** | 实体 / VO / 枚举等数据结构定义；UseCase 接口定义（方法签名 + Command/Query 参数类型） |
| **API 层** | 对外接口定义（方法签名 + HTTP/路由注解）；**SpringDoc 注解**（接口描述、`@Schema` DTO） |

原则：

- 两层之间只通过**接口定义**衔接：API 接口可以引用领域层接口与 DTO，**不引用任何实现**（无 Impl、无仓储、无适配器）。
- 契约 = 接口签名 + 注解。**任何实现类（包括 stub 壳）都不在本 skill 范围内**——实现全部留给正式实现阶段。
- 具体项目结构（单体 / 分层 / 微服务、模块与包名、目录位置）**以项目文件为准**，本 skill 不规定。

---

## 项目结构（先探测，不假设）

动手前先读项目文件确定实际结构：

- **后端仓库位置与模块划分**：读工作区根 README；后端若与文档同仓则看根 `pom.xml` / `build.gradle` / `settings.gradle` 确认模块，否则找后端子仓库
- **领域层与 API 层落位**：读仓库内后端规则文件（如 `.cursor/rules/` 下相关规则，按项目实际）与现有实体 / 接口 / Controller 代码，确认领域层与 API 层实际目录、包名、命名习惯（如 Controller 接口的命名与注解风格）
- **SpringDoc 约定**：读 `generate-api-doc` skill 的 apps-reference 与项目内 SpringDoc 配置

> 原则：**项目结构以项目文件为准**；本 skill 只规定「契约边界」，不规定包名、模块名、类名或工具路径。

---

## 硬边界（先读再动手）

### ✅ 允许（原型范围）

| 层（按项目实际落位） | 允许写什么 |
|----|------------|
| 领域层 | 实体 / VO / 枚举等**数据结构**（字段、类型、简单构造/工厂签名） |
| 领域层 | UseCase **接口**（方法签名 + Command/Query 参数类型；接口所在目录按项目分层实际） |
| API 层 | Controller **接口**定义（方法签名 + HTTP/路由注解） |
| API 层 | **SpringDoc 注解**（接口/参数描述、`@Schema` DTO——DTO 仅为字段 + 注解） |
| 各层 | 纯数据结构上的极薄校验占位（如静态工厂参数非空），**不**写完整业务规则 |

### ❌ 禁止（即使用户说「更新领域模型 / API」也默认禁止）

除非用户**明确**说「完整实现 / 落地业务 / 写 Impl」：

- **任何实现类**：UseCase Impl、Controller 实现（含 stub 壳）、Repository / 仓储端口实现、适配器
- ORM 实体 / Mapper / XML（MyBatis 等按项目实际技术栈）
- 数据库迁移脚本 / 生产库 ALTER（Liquibase、Flyway 等按项目实际；TECH `tech/ddl/*.sql` 草稿由 **tech-design-author** 管，不在本 skill）
- 业务校验落到实现、持久化读写、事件发布、Audit 埋点
- 为「跑通」而补装配、改 Config、改测试到业务级通过
- 以「已有代码是完整实现」为由，把增量也做成完整实现

**增量场景（如 P-001-01 v0.2 加字段）**：只改  
1）领域对象字段 +（可选）UseCase 接口 Command 签名；  
2）API 接口签名 / DTO 字段 / SpringDoc 注解。  
**不要**顺手改任何实现类、ORM 实体、迁移脚本。

---

## 何时使用

| 段 | 时机 |
|----|------|
| 领域段 A | Phase 4 或用户说「后端领域原型 / 更新领域模型契约」 |
| 接口段 B | Phase 6 或用户说「后端接口原型 / 出 API 文档」 |

用户只说「改原型 / 更新领域模型和 API」且未要求实现 → **默认只做 A+B 的接口与注解契约**，完成后停住，询问是否进入正式实现。

---

## 公共前置

- Epic + 相关 PRD（接口段还需 §5 列表或可推导接口）  
- 卡号 → 后端仓库分支 `feature/<卡号>-<slug>`（与前端同卡同名）  
- 读项目文件确认领域层与 API 层落位（见「项目结构」）

```bash
git fetch origin <主干>
git checkout -b feature/<卡号>-<简短英文描述> origin/<主干>
```

（主干名按项目实际，如 `develop` / `main`。）

---

## 段 A — 领域原型（Phase 4）

**Done when**：领域实体 + UseCase 接口能编译（项目对应模块的编译任务）；TECH 记了 path；**无**实现类 / 持久化 diff。

1. 对照 `tech/domain.puml` / PRD，在领域层（目录按项目实际）仅增加或修改：  
   - 实体 / VO / 枚举**数据结构**（字段 / 类型 / 简单构造或工厂签名）  
   - **UseCase 接口**（方法签名 + Command/Query 参数类型）  
2. 允许：纯数据结构上的极薄校验占位（如静态工厂参数非空），但**不要**写完整业务规则引擎或依赖仓储的逻辑。  
3. **不**写 UseCase Impl、Repository、ORM Mapper、Controller、迁移脚本。  
4. 编译：优先对应领域模块的编译任务即可（不强制整 app 启动）。  
5. 回写 TECH「后端原型契约」中的领域 path（全量 §7；有 delta 则同步 §6）。  
6. doc-grilling D1 → 回到 Phase 4 / V-DOMAIN。

若编译因「缺少 Impl」失败：**不要**补 Impl；只保证接口/模型源文件本身可编译（不强制整 app bootRun）。

---

## 段 B — 接口原型（Phase 6）

**Done when**：API 层接口 + SpringDoc 注解能表达契约；可选已导出 HTML；TECH §7 表已填；**无**任何实现类 / 落库。

1. 依据 Epic / PRD / 领域模型 / TECH §5，在 API 层（目录按项目实际）仅增加或修改：  
   - Controller **接口**：方法签名 + HTTP/路由注解 + SpringDoc 描述注解  
   - DTO：字段 + `@Schema`（随接口定义）  
   - **不写**实现类（含 stub）、不装配 Bean  
2. 接口依赖边界：API 接口只引用领域层接口与 DTO；**不引用**任何实现、仓储或装配细节。  
3. （可选）更新 LOCAL `springdoc.paths-to-match` → **generate-api-doc** 导出 HTML/PDF。  
4. 回写：
   - 全量 `TECH-DESIGN.md` §7（后端原型契约表）
   - 若存在本迭代 `TECH-DESIGN-delta-v*.md` → 同步填 **delta §6**（同一 path 摘要）

### TECH-DESIGN.md「后端原型契约」（建议 §7；delta §6 同结构摘要）

| 项 | 值 |
|----|-----|
| 后端仓库 | （项目实际仓库名） |
| 分支 | `feature/<卡号>-…` |
| 领域实体 / UseCase 接口 paths | （段 A） |
| API 接口 paths | `…/XxxController.java`（按项目实际） |
| DTO / `@Schema` paths | （可选） |
| API 文档 HTML | `docs/api-doc/<app>-…html`（若已导出，按项目实际） |
| 状态 | Draft / 已导出 |
| 范围说明 | **原型仅接口 + 注解；业务实现另开实现任务** |

5. §5 与 API 接口 / 生成 HTML 冲突 → **以 API 接口 / HTML 为准**，回写 §5（并回写相关 delta §3 若本迭代有变更）。  
6. doc-grilling D1 → **tech-verification V-API** → 回到 Phase 6。

---

## 禁止（汇总）

- 手写 / 维护 `tech/openapi/*.yaml` 作为权威契约  
- **任何实现类（含 stub 壳、适配器）**——即使「只是壳」也不写  
- 原型阶段完整业务、落库、迁移脚本、审计/MQ 完整链路  
- 未回写分支 / path（接口段还要 HTML path）就声称原型完成  
- 把「更新领域模型 / API」理解成「端到端实现」

## 常见借口（驳回）

| 借口 | 正确做法 |
|------|----------|
| 「不加 Impl 编译不过」 | 只编译领域模块；接口定义本身可编译即可，不补实现 |
| 「没实现类没法启动 / 导出文档」 | 导出 SpringDoc 不依赖业务实现；装配缺失时如实报告「预览前置」，不补壳 |
| 「只写接口，生成文档没有请求/响应示例」 | 用 `@Schema` 描述 DTO 即可；示例与实现留到正式阶段 |
| 「字段不进 Repository 就没意义」 | 原型钉契约；落库留给实现 plan / executing-plans |
| 「顺手写了 Entity/DDL 更完整」 | 停手；DDL 草稿走 TECH `tech/ddl/`，生产脚本走实现任务 |
| 「已有功能是完整实现，增量也要完整」 | 增量原型仍只改模型字段 + 接口/DTO 签名 + 注解 |

## 独立触发

- 「只做后端领域原型」→ **仅段 A**  
- 「只做接口原型 / 出 API 文档」→ **仅段 B**  
- 「更新领域模型 + API 变更」（无实现字样）→ **A + B 接口与注解契约**，完成后询问是否开实现计划  

正式落地（Impl / ORM / 迁移脚本 / 测试）→ **writing-plans / executing-plans**，不要扩写本 skill。
