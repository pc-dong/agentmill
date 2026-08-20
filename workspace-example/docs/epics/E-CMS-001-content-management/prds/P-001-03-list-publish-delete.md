# 需求规格说明书：内容管理 — 列表、发布下线与删除

> 文档类型：需求规格 / Feature Specification  
> 适用目录：`docs/epics/E-CMS-001-content-management/prds/`  
> PRD ID：`P-001-03`  
> Epic ID：`E-CMS-001`  
> Epic 路径：`docs/epics/E-CMS-001-content-management/EPIC.md`  
> 共享上下文路径：`docs/epics/E-CMS-001-content-management/shared-context.md`  
> 全局共享上下文：`docs/epics/global-share-context.md`（订阅配置为跨 Epic 可复用能力）  
> stories_appendix：无  
> 关联卡号 / Story：DEMO-1004（父项 DEMO-1001）  
> 需求类型：NEW  
> 版本：v0.1  
> 作者：产品 / BA（源需求：`material/<源需求文档>.pdf`）  
> 日期：2026-01-08  
> 体系说明：`docs/README-PRD体系.md`

---

## 0. Epic 归属与引用

### 0.1 本 PRD 覆盖的子场景

运营在列表中筛选查看内容，并对内容执行发布 / 下线 / 删除；定义 C 端正式详情的**关键验收要点**（完整 C 端交互另册）。对应 Epic 主旅程步骤 4–5。

### 0.2 继承自 Epic 的内容（只引用，不展开）

| 类型 | 引用 |
|------|------|
| 跨 Epic 术语 / 已有能力 | 见 `docs/epics/global-share-context.md`（SubscriptionConfig 订阅配置） |
| 术语 | 见 `shared-context.md` §1（运行状态 / 订阅 subject / triggerPoint） |
| 共享权限码 | 见 `shared-context.md` §2 |
| 共享业务对象 | 见 `shared-context.md` §3（Content / ContentRuntimeStatus / SubscriptionConfig） |
| 跨 PRD 约束 | 引用：`E-R-001`、`E-R-004`（`shared-context.md` §5） |

### 0.3 本 PRD 独占内容

- 列表筛选 / 分页字段
- 发布 / 下线 / 删除规则与状态流转
- C 端正式详情 API 的关键验收要点（运行状态、下线后不可访问）

### 0.4 不重复约定

- 字段定义（基本信息 / 模块）以 P-001-01 / P-001-02 为准。
- 共享定义以 `shared-context.md` 为准。

---

## 1. 需求说明

### 1.1 需求名称

内容列表、发布 / 下线与删除

### 1.2 需求类型

NEW

### 1.3 版本信息

NEW 需求，本节写「无」。

### 1.4 背景

内容配置完成后需要发布才对 C 端可见；内容过期或失误需要下线；草稿可删除。列表是运营管理入口。回链 Epic 背景见 `EPIC.md` §1。

### 1.5 目标

- 运营可按条件筛选 / 分页查看内容列表。
- 发布：DRAFT → PUBLISHED，C 端可访问；下线：PUBLISHED → OFFLINE，C 端立即不可访问。
- 删除：仅 DRAFT 且未被引用的内容。

### 1.6 范围

本次需求包含：

- 列表查询（筛选 / 分页 / 排序）
- 发布 / 下线（含订阅联动框架级约定）
- 删除
- C 端正式详情 API 关键验收要点

---

## 2. 功能说明

### 2.1 功能概述

列表页 + 三个状态操作；发布 / 下线触发跨域事件（订阅域消费）。

### 2.2 适用场景（业务视角）

| 使用方 | 说明 | 典型场景 |
|---|---|---|
| 内容运营 | 内容生命周期管理 | 上线前发布、过期或失误下线 |
| C 端用户 | 内容阅读者 | 打开内容页阅读；订阅用户收到更新通知 |

### 2.3 主要业务对象

| 业务对象 | 业务对象英文 | 说明 |
|---|---|---|
| 内容 | Content | 状态流转主体 |
| 运行状态 | ContentRuntimeStatus | C 端按时间计算（SCHEDULED/RUNNING/EXPIRED） |
| 订阅配置 | SubscriptionConfig | 发布后由订阅域创建/恢复（channel + related_uuid） |

---

## 3. 权限码

| 权限码 | 说明 | 本场景允许的操作 |
|---|---|---|
| `CONTENT_VIEW` | 内容查看 | 列表 / 详情查看 |
| `CONTENT_UPDATE` | 内容更新 | 发布 / 下线 / 删除 |
| `CONTENT_PREVIEW` | 内容预览 | 预览入口 |

### 3.1 权限规则

- PR-001：发布 / 下线 / 删除均要求 `CONTENT_UPDATE`（与内容编辑同权，引用：EP-003）。
- PR-002：请求方未持有所需权限码时，系统拒绝操作并返回明确错误。

---

## 4. 业务流程

### 4.1 主流程（发布）

1. 用户持 `CONTENT_UPDATE` 在列表点击「发布」。
2. 系统校验内容为 DRAFT 且配置完整（至少 1 个模块）。
3. 系统将状态置为 PUBLISHED，记录发布人与发布时间。
4. 系统发送「内容已发布」事件（含内容 uuid 与订阅要素）。
5. 订阅域消费事件后创建/恢复 `subject=CONTENT`、`subjectId=内容uuid`、`triggerPoint=ContentPublishedNotification` 的订阅配置，并向已订用户推送更新通知。

### 4.2 主流程（下线）

1. 用户持 `CONTENT_UPDATE` 点击「下线」。
2. 系统将状态置为 OFFLINE。
3. 系统发送「内容已下线」事件；订阅域对对应订阅配置**软删**（写 `deleted_at`，不物理删除）。
4. C 端正式详情 API 立即拒绝访问（引用：E-R-004）。

### 4.3 主流程（删除）

1. 用户持 `CONTENT_UPDATE` 对 DRAFT 内容点击「删除」并确认。
2. 系统逻辑删除内容及其模块。

### 4.4 异常流程

| 编号 | 触发条件 | 系统行为 | 结果 |
|---|---|---|---|
| EX-001 | 发布非 DRAFT 内容 | 拒绝 | 返回状态不允许发布错误 |
| EX-002 | 发布时内容无任何模块 | 拒绝 | 返回配置不完整错误 |
| EX-003 | 删除非 DRAFT 内容 | 拒绝 | 返回状态不允许删除错误 |
| EX-004 | C 端访问 OFFLINE / DRAFT 内容正式详情 | 拒绝 | 返回 404 / 业务错误（E-R-004） |

---

## 5. 字段表

### 5.1 列表筛选 / 展示字段

| 字段名 | 中文名 | 类型 | 必填 | 描述 | 取值 / 枚举 / 来源 |
|---|---|---|---:|---|---|
| title | 标题 | string | 否 | 模糊匹配 | 用户输入 |
| contentType | 内容类型 | enum | 否 | 精确匹配 | ANNOUNCEMENT / HELP |
| status | 内容状态 | enum | 否 | 精确匹配 | DRAFT / PUBLISHED / OFFLINE |
| startAtRange | 时间区间 | datetime[] | 否 | 按 startAt 区间过滤 | 用户输入 |
| page / size | 分页参数 | number | 否 | 默认 1 / 20 | 系统默认 |

列表展示列：uuid、title、contentType、status、startAt、endAt、updatedBy、updatedAt。

### 5.2 状态操作审计字段

| 字段名 | 中文名 | 类型 | 必填 | 描述 | 取值 / 枚举 / 来源 |
|---|---|---|---:|---|---|
| publishedBy / publishedAt | 发布人 / 发布时间 | string / datetime | 是（发布后） | 最近一次发布审计 | 系统生成 |
| offlineBy / offlineAt | 下线人 / 下线时间 | string / datetime | 是（下线后） | 最近一次下线审计 | 系统生成 |

---

## 6. 字段变更说明

NEW 需求，本节写「无」。

---

## 7. 业务规则

### 7.1 查询规则

R-QUERY-001：权限范围查询

- 适用场景：QUERY
- 条件：用户查询列表
- 动作：系统仅返回用户权限范围内的数据（持 `CONTENT_VIEW` 可见全部内容行）

R-QUERY-002：默认排序

- 适用场景：QUERY
- 条件：用户未指定排序条件
- 动作：系统按 `updatedAt` 倒序返回结果

R-QUERY-003：分页返回

- 适用场景：QUERY
- 条件：用户查询列表数据
- 动作：系统返回总数、当前页、页大小和结果列表

### 7.2 发布规则

R-PUBLISH-001：发布前置校验

- 适用场景：UPDATE
- 条件：执行发布
- 动作：内容必须为 DRAFT，且**至少配置 1 个模块**；否则拒绝（EX-001 / EX-002）

R-PUBLISH-002：发布事件

- 适用场景：UPDATE
- 条件：发布成功
- 动作：系统发送「内容已发布」事件（Event Type：`com.example.events.content.ContentPublished`；至少含内容 uuid 与订阅要素：subject/subjectId/triggerPoint）

R-PUBLISH-003：订阅恢复

- 适用场景：UPDATE
- 条件：订阅域消费发布事件时，同 subject/subjectId/triggerPoint 已存在**软删**行
- 动作：订阅域恢复该行（清空 `deleted_at`）并更新必要字段，**不新建第二行**

### 7.3 下线规则

R-OFFLINE-001：下线前置校验

- 适用场景：UPDATE
- 条件：执行下线
- 动作：内容必须为 PUBLISHED；否则拒绝

R-OFFLINE-002：下线事件与订阅软删

- 适用场景：UPDATE
- 条件：下线成功
- 动作：系统发送「内容已下线」事件（Event Type：`com.example.events.content.ContentOffline`）；订阅域对对应订阅配置**软删**（写 `deleted_at`，不物理删除）；再次发布时按 R-PUBLISH-003 恢复

R-OFFLINE-003：C 端立即不可访问

- 适用场景：UPDATE
- 条件：内容状态变为 OFFLINE
- 动作：C 端正式详情 API 拒绝访问（引用：E-R-004；EX-004）

### 7.4 删除规则

R-DELETE-001：删除前置校验

- 适用场景：DELETE
- 条件：执行删除
- 动作：内容必须为 DRAFT；否则拒绝（EX-003）

R-DELETE-002：级联逻辑删除

- 适用场景：DELETE
- 条件：删除成功
- 动作：系统逻辑删除内容及其全部模块

R-DELETE-003：引用数据不可删除

- 适用场景：DELETE
- 条件：内容已被其他业务引用（如运营位配置）
- 动作：系统拒绝删除，并提示数据已被使用

### 7.5 C 端关键验收要点

R-CEND-001：运行状态计算

- 适用场景：QUERY
- 条件：C 端请求正式详情
- 动作：系统按时间计算 `runtimeStatus`：now < startAt → `SCHEDULED`；startAt ≤ now ≤ endAt → `RUNNING`；now > endAt → `EXPIRED`

R-CEND-002：正式详情仅对 PUBLISHED 开放

- 适用场景：QUERY
- 条件：C 端请求非 PUBLISHED 内容的正式详情
- 动作：系统拒绝（EX-004）；预览能力走 Console 预览入口（持 `CONTENT_PREVIEW`），返回内容与正式详情同构

---

## 8. 业务规则变更说明

NEW 需求，本节写「无」。

---

## 9. 状态流转规则

| 当前状态 | 触发动作 | 目标状态 | 所需权限码 | 规则编号 |
|---|---|---|---|---|
| draft | publish | published | `CONTENT_UPDATE` | R-PUBLISH-001 |
| published | offline | offline | `CONTENT_UPDATE` | R-OFFLINE-001 |
| offline | publish | published | `CONTENT_UPDATE` | R-PUBLISH-001（再次发布） |
| draft | delete | （逻辑删除） | `CONTENT_UPDATE` | R-DELETE-001 |

R-PUBLISH-001 / R-OFFLINE-001 / R-DELETE-001：见 §7。

---

## 10. 数据约束

### 10.1 唯一性约束

| 字段 | 唯一范围 | 说明 |
|---|---|---|
| (subject, subjectId, triggerPoint) | 订阅域全局 | 同键唯一；下线走软删、发布走恢复（R-PUBLISH-003 / R-OFFLINE-002） |

### 10.2 引用约束

| 当前对象字段 | 引用对象 | 引用字段 | 约束说明 |
|---|---|---|---|
| content.uuid | SubscriptionConfig.related_uuid | uuid | 订阅配置由订阅域维护，本域只发事件 |

### 10.3 数据保留策略

- DATA-001：逻辑删除的内容与模块不出现在普通查询与 C 端投影中。
- DATA-002：下线产生的订阅软删行保留（再次发布可恢复）。

---

## 11. 影响范围

NEW 需求，本节写「无」。

---

## 12. 验收标准

### 12.1 功能验收

AC-001：正常发布

- 给定：DRAFT 内容已配置至少 1 个模块，请求方持 `CONTENT_UPDATE`
- 当：点击发布
- 则：状态变为 PUBLISHED，发送「内容已发布」事件，记录发布审计

AC-002：发布校验失败

- 给定：DRAFT 内容无任何模块
- 当：点击发布
- 则：拒绝发布并提示配置不完整

AC-003：下线

- 给定：内容为 PUBLISHED
- 当：点击下线
- 则：状态变为 OFFLINE，发送「内容已下线」事件；C 端正式详情立即 404

AC-004：再次发布恢复订阅

- 给定：内容下线后再次发布
- 当：订阅域消费发布事件
- 则：恢复原订阅软删行，不产生重复行

AC-005：删除约束

- 给定：内容为 PUBLISHED
- 当：点击删除
- 则：拒绝删除并提示状态不允许

AC-006：C 端运行状态

- 给定：PUBLISHED 内容处于进行期
- 当：C 端请求正式详情
- 则：返回 `runtimeStatus=RUNNING` 且含模块投影

### 12.2 数据验收

AC-DATA-001：发布 / 下线后审计字段（publishedBy/At、offlineBy/At）正确落库。
AC-DATA-002：删除后内容与模块均逻辑删除，普通查询不返回。
AC-DATA-003：订阅域同键仅一行；下线仅写 `deleted_at`。

### 12.3 权限验收

AC-PERM-001：持有所需权限码的请求可以执行对应操作。
AC-PERM-002：未持有所需权限码的请求不能执行对应操作。

---

## 13. 测试场景建议

| 场景编号 | 场景名称 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|
| TC-001 | 正常发布 | DRAFT + ≥1 模块 | 发布 | PUBLISHED + 事件发出 |
| TC-002 | 空配置发布 | DRAFT + 0 模块 | 发布 | 拒绝 |
| TC-003 | 下线 | PUBLISHED | 下线 | OFFLINE；C 端 404 |
| TC-004 | 再次发布 | OFFLINE | 发布 | PUBLISHED；订阅恢复不重复 |
| TC-005 | 删除 DRAFT | DRAFT | 删除 | 逻辑删除成功 |
| TC-006 | 删除已发布 | PUBLISHED | 删除 | 拒绝 |
| TC-007 | 列表筛选 | 存在多状态内容 | 按 status=PUBLISHED 筛选 | 仅返回已发布行，分页字段齐全 |
| TC-008 | 运行状态 | 未到 startAt 的已发布内容 | C 端详情 | SCHEDULED |
| TC-009 | 无权限 | 未持有 CONTENT_UPDATE | 发布 | 拒绝 |

---

## 14. 原型引用说明

| 项 | 值 |
|----|-----|
| 仓库 / 分支 | `demo-console-frontend` / 未做 |
| 本 PRD 相关 path | `src/...` |
| 启动 | `npm run dev`（+ auth-mock 若适用） |
| 静态 HTML / 链接（可选） | 未做 |

---

## 15. 合并说明

NEW 需求，本节写「无」。

---

## 16. AI 实现提示

1. 状态机以本 PRD §9 为准；不得发明未定义的流转（如 DRAFT 直接删除以外的路径）。
2. 事件契约（Event Type / 要素）以 `TECH-DESIGN.md` §5 事件表为准；订阅侧行为由订阅域消费方实现，本域只保证事件正确发出。
3. C 端完整交互不在本 PRD；实现 C 端详情 API 时仅按 §7.5 关键要点验收。
4. 先读 `EPIC.md`，再读 `shared-context.md`，再读本 PRD；冲突停止并记录。
