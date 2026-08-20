# 技术方案增量：基本信息新增内容摘要（summary）

> 文档类型：Technical Design Delta（迭代变更视图）  
> 适用目录：`docs/epics/E-CMS-001-content-management/`  
> 文件名约定：`TECH-DESIGN-delta-v{版本}-{kebab-slug}.md`（本文件：`TECH-DESIGN-delta-v0.2-content-summary.md`）  
> Tech ID：`T-CMS-001`（与全量 TECH 一致）  
> Epic ID：`E-CMS-001`  
> 全量 TECH：`TECH-DESIGN.md`（同目录；**聚合后权威**）  
> 基线版本：v0.1（本迭代合并前的全量 TECH 版本）  
> 本版版本：v0.2（与全量 TECH 文首版本一致）  
> 覆盖 PRD：见 §1  
> 关联卡号：DEMO-1005  
> 状态：Ready  
> 作者：研发负责人（示例）  
> 日期：2026-01-10  
> 模版：`docs/template/技术方案增量模版.md`  
> 体系说明：`docs/README-PRD体系.md`

---

## 0. 本迭代摘要

### 0.1 一句话

内容基本信息新增可选字段 `summary`（内容摘要），用于列表展示与分享卡片；贯通创建 / 编辑 / 详情 / C 端投影。

### 0.2 In / Out

| 类型 | 内容 |
|------|------|
| In | `content` 表 ADD COLUMN；创建/编辑/详情 API 增字段；C 端投影返回 |
| Out | 列表筛选条件不加该字段；历史数据回填 |

### 0.3 权威与冲突

| 内容 | 权威来源 |
|------|----------|
| 当前全量契约（聚合后） | `TECH-DESIGN.md` + `tech/` |
| **本迭代改了什么** | **本文** |
| 业务规则 / AC | P-001-01 + `shared-context.md` |
| HTTP 字段级 | SpringController / 生成 HTML（若有） |

冲突：全量 TECH + `tech/` > 本文摘要；发现不一致 → **先回写全量再改本文**。

---

## 1. 影响 PRD

| PRD ID | 标题 | 本迭代覆盖点（实现视角） |
|--------|------|--------------------------|
| P-001-01 | 内容基本信息 | 字段表新增 `summary` 行；创建/编辑/详情 API |

---

## 2. 字段 / 领域变更

| 变更 | 对象 | 说明 | 落点（表列 / 领域类） |
|------|------|------|----------------------|
| ADD | `Content.summary` | 内容摘要；可选；≤200 字符 | `content.summary` / `…/Content.java` |

---

## 3. API / 事件变更

> 只列**相对基线有变更**的行。

| 类型 | Path / Event | Method | 变更类型 | 关联 PRD | 备注 |
|------|--------------|--------|----------|----------|------|
| HTTP | `/api-content/admin/api/v1/contents` | POST | MODIFY | P-001-01 | 请求/响应体增 `summary`（可空） |
| HTTP | `/api-content/admin/api/v1/contents/{uuid}` | PUT | MODIFY | P-001-01 | 同上；可清空 |
| HTTP | `/api-content/admin/api/v1/contents/{uuid}` | GET | MODIFY | P-001-01 | 响应体增字段 |
| HTTP | `/api-content/public/api/v1/contents/{uuid}` | GET | MODIFY | P-001-01 | C 端投影返回该字段 |

无新增事件。

---

## 4. DDL / 持久化

| 脚本 / 对象 | 变更 | 说明 |
|-------------|------|------|
| `tech/ddl/1xx_alter_content_add_summary.sql` | ADD COLUMN `summary VARCHAR(200) NULL` | 全量 `schema.md` §content 已同步 |

---

## 5. 行为 / 规则变更

| 规则 / 行为 | 相对基线的差异 | 引用 |
|-------------|----------------|------|
| 创建/编辑校验 | 新增长度校验：≤200 字符；空值合法 | P-001-01 R-CREATE-001 扩展 |

---

## 6. 原型契约（可选）

| 项 | 值 |
|----|-----|
| 前端仓库 / 分支 / path | 无本迭代前端 |
| 后端仓库 / 分支 | 未做 |
| 领域 / UseCase 接口 path | 未做 |
| Controller / DTO path | 未做 |
| API 文档 HTML | 未导出 |
| 状态 | 未做 |
| 范围说明 | **仅契约**；Impl / 落库见 §7 |

---

## 7. 实现清单（供 writing-plans）

- [ ] DDL / Liquibase 落地（`1xx_alter_content_add_summary.sql`）
- [ ] 领域字段 + UseCaseImpl 校验
- [ ] DTO / Controller 增字段
- [ ] C 端投影增字段
- [ ] 单测 / api-test

---

## 8. 回写全量记录

| 全量 TECH / tech 位置 | 已合并内容 |
|-----------------------|------------|
| `TECH-DESIGN.md` §4.1 表清单 / §5.1 API 备注 | `summary` 已注明 v0.2 |
| `tech/ddl/schema.md` §2 `content` 表 | 列已加入 |
| Epic §0.1 Tech 索引 | 已链本文（v0.2） |

---

## 写作约束

1. **短**：读者应在数分钟内看完「本轮改什么」。
2. **不抄全量**：无变更章节写「无」或省略小节。
3. **先全量后增量**：聚合结果写入 `TECH-DESIGN.md` + `tech/`；本文只保留差集与实现勾选。
4. **多 PRD**：同一版本号一份 delta；§1 列出全部覆盖 PRD。
5. Agent：`.agents/skills/epic-prd-tech-design-workflow/tech-design-author/SKILL.md`（增量流程）。
