---
name: doc-grilling
description: >-
  Decision grilling for Union Platform Epic/PRD/TECH docs: one question at a
  time with a recommended answer (B1/C1/D1). Use when clarifying enums, shared
  tables, reuse vs new, error codes, cross-service boundaries, OPEN-* closeout,
  or any destructive documentation assumption; also when epic-prd-tech-design-workflow
  or author skills need human decisions.
---

# Doc Grilling（文档决策提问）

风格对齐 `.agents/skills/grilling/SKILL.md`：**决策一问一答、每问带推荐**；**事实先查环境**。本包自洽，不必另 invoke grilling。

## 硬规则

1. **不得臆造**触及 B1 的决策。  
2. **事实自查**：路径、既有表名、已有权限码、模版结构等能从仓库查到的 → **先查再写**，不要当选择题问人。  
3. **一次只问一个**决策；等人回复后再继续。  
4. 给出推荐，但**不得**把推荐直接写成已关闭 OPEN。  
5. 依赖关系：先问上游（如服务归属 → 再问是否复用某表）。

## B1 硬触发（必须 grilling）

下列任一未决 → 进入单问队列：

1. 枚举字面量 / 状态机取值未定  
2. 共表隔离 / 存量回填策略  
3. 复用 vs 新建（表、HTTP、服务、聚合）  
4. 错误码段 / 权限码命名  
5. 跨服务边界与协作方式（直调 vs UseCase / MQ）  
6. 破坏性假设（会改已有契约、数据、权限模型）  
7. OPEN-* 关闭或「可接受风险」拍板  

## 可批量勾选（非 B1）

Epic 名 / slug / 卡号 / 是否新建目录、已写出的产出清单对齐、非破坏性措辞微调 → 表格一次勾选或「OK」。

## 单问格式（C1）

```text
**Q（B1-<类目>）**：<一个决策点，一句话>

| 选项 | 含义 |
|------|------|
| A | … |
| B | … |
| C | …（可选） |

**推荐：X** — <一句理由>

（仅当方案冲突大时）短对比表：方案 / 优点 / 缺点
```

## Phase / 段落末门禁（D1）

1. 输出 **产出清单**（可批量勾选）  
2. 列出 **B1 待决队列** → 按 C1 **串行清空**（或显式升 OPEN 并经人确认可带 OPEN 前进）  
3. 再问一句：是否进入下一步 / 下一 Phase  
