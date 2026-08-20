# 共享上下文：内容管理（Content Management）

> 文档类型：Epic Shared Context（本 Epic 单一事实源）  
> 所属 Epic：`EPIC.md`（同目录）  
> Epic ID：`E-CMS-001`  
> 版本：v0.1  
> 路径约定：`docs/epics/E-CMS-001-content-management/shared-context.md`  
> 全局共享上下文：`docs/epics/global-share-context.md`（跨 Epic；必引用）  
> 体系说明：`docs/README-PRD体系.md`  
> 说明：本文件为**通用示例**；术语与枚举码值按项目实际替换。

> 下属 PRD **只引用、不重新定义**本文与 global 已定义内容。  
> 冲突：`global-share-context.md` > 本文 > PRD（针对同一术语/对象）。

---

## 0. 引用全局共享上下文

本 Epic 复用的跨 Epic 能力（只列引用，不重定义）：

| 能力 / 术语 | 见 global 章节 |
|-------------|----------------|
| <本 Epic 暂无额外 global 依赖；若引用券域等已有能力，在此按行登记> | — |

---

## 1. 术语表

| 术语 | 术语英文 | 定义 | 备注 |
|------|----------|------|------|
| 内容 | Content | 可配置内容页的运营内容实体 | Console 菜单「内容管理」 |
| 内容类型 | Content Type | 按用途划分的内容分类 | 当前：公告、帮助文档 |
| 内容模板 | Content Template | 内容页版式分类 | 当前：标准图文、图集；代码字段 `CONTENT_TEMPLATE` |
| 展示配置 / 全局配置 | Display / Global Config | 内容级（非单模块）配置：分享文案、订阅开关等 | Console Section：`global` |
| 模块 | Module | 内容页上可编排的内容区块，有类型与顺序 | Console Section：`module` |
| 模块类型 | Module Type | 模块的可扩展分类（富文本、图片、视频等） | 见 §3 业务对象 |
| 内容基本信息 | Basic Info | 内容主数据：标题、内容类型、时间、状态等 | Console Section：`basic` |
| 权限码 | Permission Code | 系统能力控制标识；由管理员分配给角色 | PRD 以权限码描述能力，不枚举角色 |
| 内容页 | Content Page | C 端内容落地页（H5 / 小程序） | 正式 / 预览 API 见 P-001-03 |
| 运行状态 | Content Runtime Status | C 端按时间计算的动态状态 | `SCHEDULED` 未开始 / `RUNNING` 进行中 / `EXPIRED` 已结束 |
| 订阅 subject | Subscription Subject | 消息订阅主体类型 | 内容级：`CONTENT`（`subjectId`=内容 uuid） |
| 订阅 triggerPoint | Trigger Point | 订阅/推送触发点 | 内容发布通知：`ContentPublishedNotification` |

---

## 2. 共享权限码

> 系统以权限码控制能力；角色仅作为权限码的承载容器（由管理员配置），**规格文档不定义、不绑定具体角色**。  
> 源 Story：DEMO-1001。菜单归属「内容管理」。

| 权限码（建议值） | 中文名 | 典型能力 | 备注 |
|--------|------|----------|------|
| `CONTENT_MANAGEMENT` | 内容管理 | 菜单可见并进入列表 | 菜单权限；勾选后默认勾选下列功能码 |
| `CONTENT_VIEW` | 内容查看 | 列表/详情查看 | 默认权限；**不可取消勾选** |
| `CONTENT_CREATE` | 内容新建 | 新建内容 | 可取消勾选；取消菜单时一并取消 |
| `CONTENT_UPDATE` | 内容更新 | 编辑内容；删除；发布/下线 | 可取消勾选；取消菜单时一并取消 |
| `CONTENT_PREVIEW` | 内容预览 | 预览入口 | 可取消勾选；取消菜单时一并取消 |

> 若线上权限码字符串与上表建议值不一致，以实现/权限平台登记为准，但**能力划分不得合并混淆**（尤其查看 vs 更新 vs 预览）。

---

## 3. 共享业务对象

| 业务对象 | 业务对象英文 | 说明 | 关键状态概念（可选） | 归属关系 |
|----------|--------------|------|----------------------|----------|
| 内容 | Content | 内容聚合根：基本信息 + 展示配置 + 模块列表；**id + uuid 双 ID**（接口以 uuid 为主） | DRAFT（待发布）/ PUBLISHED（已发布）/ OFFLINE（已下线） | 拥有多个 Module |
| 运行状态 | ContentRuntimeStatus | C 端按时间计算的动态状态（与 Console status 独立） | SCHEDULED（未开始）/ RUNNING（进行中）/ EXPIRED（已结束） | 见 P-001-03 |
| 内容类型 | ContentType | 枚举：ANNOUNCEMENT=公告；HELP=帮助文档；创建后不可修改（见 E-R-002） | 无 | 属于 Content 基本信息 |
| 内容模板 | ContentTemplate | 枚举：STANDARD=标准图文；GALLERY=图集 | 无 | 属于展示/全局配置；与内容类型默认对应、允许改选（见 E-R-002） |
| 展示配置 | ContentGlobalConfig | 分享文案、分享图、订阅开关等内容页级配置 | 无 | 1:1 从属于 Content |
| 模块 | ContentModule | 内容页模块实例（含类型、序号、模板、配置载荷） | 创建后 moduleType/moduleTemplate 锁定（见 P-001-02） | N:1 从属于 Content |
| 模块类型 | ModuleType | 当前已知：`RICH_TEXT`（富文本）；`IMAGE`（图片）；`VIDEO`（视频） | 可扩展 | 描述 Module 的类型 |
| 富文本模板 | RichTextTemplate | ARTICLE（正文段落） | 无 | 属于 RICH_TEXT |
| 图片模板 | ImageTemplate | SINGLE_IMAGE（单图）/ GALLERY（图集 2–9 张） | 无 | 属于 IMAGE |
| 视频模板 | VideoTemplate | VIDEO（单视频） | 无 | 属于 VIDEO |
| 订阅配置 | SubscriptionConfig | 可复用订阅配置（channel + related_uuid） | 无 | 0..1 从属于 Content（`related_uuid`=内容 uuid）；发布后由订阅域创建/恢复 |

---

## 4. 共享权限原则

- EP-001：是否允许内容相关操作，以请求方是否持有对应**权限码**为准，不以角色名为准。
- EP-002：无菜单权限码时不可见「内容管理」；无 `CONTENT_VIEW` 时不可访问列表。
- EP-003：发布 / 下线 / 删除 归属 **`CONTENT_UPDATE`（内容更新）**，与内容编辑同权；预览单独使用 `CONTENT_PREVIEW`；新建使用 `CONTENT_CREATE`。
- EP-004：公告与帮助文档共用同一内容权限域，**不按内容类型隔离权限码**。
- EP-005：下线后 C 端不可访问（与 E-R-004 一致）。

---

## 5. 跨 PRD 约束

> 另须遵守 global 已登记的 `G-R-xxx`（本 Epic 当前未引用，登记后在此列编号）。

E-R-001：三区结构固定

- 适用：下属全部 PRD
- 条件：任何内容配置与校验
- 动作：必须按「基本信息 → 展示配置 → 模块列表」三区理解与实现；不得将模块私有字段提升为与三区平级的第四套无归属配置（除非新开 Epic 变更本约束）

E-R-002：内容类型与模板枚举受控；内容类型创建后不可改

- 适用：P-001-01、P-001-02
- 条件：创建时选择内容类型；创建或修改内容模板
- 动作：
  1. 仅允许 §3 已定义枚举值；新增枚举必须先更新本文再改 PRD。
  2. 创建时按内容类型带出默认模板：公告 → 标准图文（`STANDARD`）；帮助文档 → 图集（`GALLERY`）。
  3. 内容类型（`ContentType`）在创建成功后**不允许修改**；编辑态该字段只读。
  4. 内容模板允许运营改选（可与内容类型交叉组合），不得因内容类型只读而禁止改模板。

E-R-003：模块类型可扩展但必须登记

- 适用：P-001-02 及各模块 PRD
- 条件：新增模块类型
- 动作：先在本文 §3 `ModuleType` 登记中英文名称与 code，再编写模块 PRD；未登记类型不得进入实现

E-R-004：下线后 C 端不可访问

- 适用：下属全部 PRD（含关键 C 端验收要点；正式详情 API 见 P-001-03）
- 条件：内容状态为 OFFLINE（已下线）时，用户打开内容页 / 调正式详情 API
- 动作：C 端**不可再访问**该内容页（展示统一错误页 / 下线态即可）；正式详情 API 须拒绝（404/业务错误）；不得继续按已发布页渲染模块内容
