---
name: frontend-prototype
description: >-
  Build an interactive frontend UI prototype from Epic/PRD using the project's
  existing components, layout and stub data; start the local dev server (plus
  any auth/mock/backend the project requires); iterate on feedback; write
  branch + paths back to Epic/PRD. Use during Epic/PRD when the user asks for
  前端原型, or when epic-prd-tech-design-workflow routes here. No project
  structure is assumed — read the project files first.
---

# Frontend Prototype（Epic / PRD 可选）

> 编排：[`../SKILL.md`](../SKILL.md)  
> 提问：[`../doc-grilling/SKILL.md`](../doc-grilling/SKILL.md)

在 **Epic / PRD 撰写过程中**可随时触发；不阻塞文档 Phase，但产出必须回写到 Epic（及相关 PRD）。

## 项目结构（先探测，不假设）

**本 skill 不规定任何仓库名、目录名、技术栈或启动命令**。动手前先读项目文件确定实际结构：

- **前端仓库位置与包管理器**：读工作区根 README；前端若与文档同仓则直接看根 `package.json`，否则找前端子仓库（其 `package.json` 即事实）
- **组件与样式约定**：读已有页面/组件代码与组件库声明（`package.json` 依赖、UI 配置），以及仓库内约定文档（如 `CLAUDE.md`、`.cursor/rules/` 下的前端规则）
- **本地开发与启动**：读仓库 README / 本地开发说明（若存在），确认 dev script、是否需要 mock / 认证工具、是否依赖本机后端服务、端口约定
- **现有入口体系**：读路由配置与菜单定义，确认新页面挂载位置与是否需要新增/修改已有入口

> 原则：**项目结构以项目文件为准**；不确定时用读/搜索工具确认，不要凭记忆假设。

## 何时使用

- 用户说「做前端原型 / 搭交互 / stub 页面」  
- 编排器在 Phase 1–2 提示可选入口后用户确认  

## 前置

| 项 | 要求 |
|----|------|
| Epic | 目录与目标/旅程至少 Draft |
| 卡号 | 有则建同名 feature 分支；无则 B1 向人要 |
| PRD | 有则按 PRD 字段/交互细化；仅有 Epic 时先搭壳再迭代 |

## 步骤

1. **确认范围（可批量）**：目标入口（菜单/路由）、参考已有模块、是否改已有入口（决定是否需要 mock / 认证工具）。  
2. **探测项目结构**（见上），在前端仓库建 feature 分支：
   ```bash
   git fetch origin <主干>
   git checkout -b feature/<卡号>-<简短英文描述> origin/<主干>
   ```
   （主干名按项目实际，如 `develop` / `main`。）  
3. **实现原型**：
   - 复用项目现有组件库、布局与代码模式（读现有页面确认）  
   - 数据用 **stub / mock**（本地常量或项目已有 mock 机制），对齐已有展示样式  
   - 不接真实后端写路径（除非用户明确要求联调）  
4. **启动预览**：
   - 需要登录/权限或后端依赖的页面：**不能只起前端。** 缺 mock / 认证或相关本机后端时用户无法进页 / 接口连不通——须在回写与回复中写明「预览前置」，勿声称已可预览。  
   - 顺序按项目实际（通常：mock/认证工具 → 相关本机后端服务 → `npm run dev` 等 dev script；端口按项目约定）  
   - 轮询 mock 管理端点、业务 api-docs/health、前端 dev server 均就绪后再请用户点验  
   - 纯新壳且无入口/后端依赖时才可仅 dev server + stub（须在文档注明）  
5. **迭代**：收集修改意见 → 改代码 → 保持服务可预览 → 再确认。  
6. **回写文档**（必做）：

### Epic `EPIC.md`（建议 §0.2）

| 项 | 值 |
|----|-----|
| 前端仓库 | （项目实际仓库名） |
| 分支 | `feature/<卡号>-…` |
| 主要 path | `src/...`（列表，按项目实际） |
| 启动 | dev script（+ mock/认证若适用，按项目实际） |
| 状态 | Draft / 已对齐 |

### 相关 PRD

在文首或「原型」小节增加同样分支 + **本 PRD 相关文件 path**（可与 Epic 列表子集一致）。

7. **doc-grilling D1** 后回到 Epic/PRD 流程。

## 禁止

- 在主干（`develop` / `master` 等，按项目实际）上直接改  
- 把 stub 响应当成 TECH/后端权威契约（契约以 Controller/HTML 为准） 
- 未回写分支/path 就声称原型完成  

## 独立触发

用户「只做前端原型」→ 直接本 skill（仍建议有 Epic 目录可回写）。
