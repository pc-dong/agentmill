---
name: frontend-prototype
description: >-
  Build an interactive Console UI prototype in demo-console-frontend from Epic/PRD
  using existing components and stub data; start npm run dev (and auth-mock
  when needed); iterate on feedback; write branch + paths back to Epic/PRD. Use
  during Epic/PRD when the user asks for 前端原型, or when
  epic-prd-tech-design-workflow routes here.
---

# Frontend Prototype（Epic / PRD 可选）

> 编排：[`../SKILL.md`](../SKILL.md)  
> 提问：[`../doc-grilling/SKILL.md`](../doc-grilling/SKILL.md)  
> 前端约定：`demo-console-frontend/CLAUDE.md`、本地开发说明文档（按项目实际）

在 **Epic / PRD 撰写过程中**可随时触发；不阻塞文档 Phase，但产出必须回写到 Epic（及相关 PRD）。

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

1. **确认范围（可批量）**：目标菜单/路由、参考已有模块、是否改已有菜单（决定是否起 auth-mock）。  
2. **建分支**（`demo-console-frontend`）：
   ```bash
   git fetch origin develop
   git checkout -b feature/<卡号>-<简短英文描述> origin/develop
   ```
3. **实现原型**：
   - 复用现有 Vue Options API / Element Plus / 布局与组件模式  
   - 数据用 **stub / mock**（本地常量或简易 mock），对齐已有展示样式  
   - 不接真实后端写路径（除非用户明确要求联调）  
4. **启动预览**：
   - **内容管理 / 已有 Console 菜单模块：不能只起前端。** 缺 auth-mock 或业务 app 时用户无法进页 / 接口 ECONNREFUSED——须在回写与回复中写明「预览前置」，勿声称已可预览。  
   - 顺序：① `demo-backend-service/tools/auth-mock/./run.sh`（端口按项目约定）→ ② 相关本机后端（内容管理至少 content app `bootRun`，端口按项目约定）→ ③ `cd demo-console-frontend && npm run dev` → ④ 本地开发说明文档中的 bookmarklet 写入 Mock JWT  
   - 轮询：auth-mock `/__admin/mappings`、业务 api-docs/health、前端 dev server 均就绪后再请用户点验  
   - 纯新壳且无菜单依赖时才可仅 `npm run dev` + stub（须在文档注明）  
5. **迭代**：收集修改意见 → 改代码 → 保持服务可预览 → 再确认。  
6. **回写文档**（必做）：

### Epic `EPIC.md`（建议 §0.2）

| 项 | 值 |
|----|-----|
| 前端仓库 | `demo-console-frontend` |
| 分支 | `feature/<卡号>-…` |
| 主要 path | `src/...`（列表） |
| 启动 | `npm run dev`（+ auth-mock 若适用） |
| 状态 | Draft / 已对齐 |

### 相关 PRD

在文首或「原型」小节增加同样分支 + **本 PRD 相关文件 path**（可与 Epic 列表子集一致）。

7. **doc-grilling D1** 后回到 Epic/PRD 流程。

## 禁止

- 在 `develop` / `master` 上直接改  
- 把 stub 响应当成 TECH/后端权威契约（契约以 Controller/HTML 为准） 
- 未回写分支/path 就声称原型完成  

## 独立触发

用户「只做前端原型」→ 直接本 skill（仍建议有 Epic 目录可回写）。
