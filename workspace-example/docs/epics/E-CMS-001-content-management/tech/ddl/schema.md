# 数据库表设计：Content Management（T-CMS-001）

> 所属：`docs/epics/E-CMS-001-content-management/TECH-DESIGN.md` §4  
> 草稿 SQL：同目录 `0xx_create_content.sql`、`1xx_alter_content_add_summary.sql`

---

## 1. 设计原则

| 原则 | 说明 |
|------|------|
| 聚合根独立表 | 基本信息落 `content`（NEW） |
| 全局展示配置 | **单表 + JSON**：分享文案、订阅开关等展示项不拆子表 |
| 模块多态 | `content_module` 公共行 + `payload` JSON；类型内模板随公共行列 |
| 订阅不落本域 | 订阅行由订阅域维护；本域只发 MQ 事件 |
| 媒体不落库 | 图片 / 视频 URL 由上传服务先传后引；本域不存文件本体 |

---

## 2. 表清单

| 表名 | 变更类型 | 说明 | 领域映射 |
|------|----------|------|----------|
| `content` | **NEW** | 聚合根基本信息（v0.2 含 `summary`） | Content |
| `content_global_config` | **NEW** | 内容模板 + `display_config` JSON | ContentGlobalConfig |
| `content_module` | **NEW** | 模块公共行 + payload JSON | ContentModule |

**不再创建**：`content_share_config`（分享配置入 JSON）、`content_module_media`（媒体 URL 入 payload）。

---

## 3. `content`（NEW + v0.2 ALTER）

| 列名 | 类型 | 可空 | 默认 | 说明 |
|------|------|------|------|------|
| `id` | BIGINT | NO | AI | 内部主键 |
| `uuid` | CHAR(36) | NO | — | 对外唯一标识 |
| `title` | VARCHAR(100) | NO | — | 标题；未删除数据中唯一 |
| `content_type` | VARCHAR(32) | NO | — | ANNOUNCEMENT / HELP |
| `start_at` / `end_at` | DATETIME | NO | — | C 端可见期 |
| `summary` | VARCHAR(200) | YES | NULL | 内容摘要（v0.2；≤200 字符） |
| `remark` | VARCHAR(200) | YES | NULL | 内部备注 |
| `status` | VARCHAR(16) | NO | DRAFT | DRAFT / PUBLISHED / OFFLINE |
| `published_by` / `published_at` | VARCHAR(64) / DATETIME | YES | NULL | 发布审计 |
| `offline_by` / `offline_at` | VARCHAR(64) / DATETIME | YES | NULL | 下线审计 |
| `deleted_at` | DATETIME | YES | NULL | 逻辑删除 |

**索引**：`uk_uuid(uuid)` UNIQUE；`uk_title_del(title)` UNIQUE（含 `deleted_at IS NULL` 过滤的等价实现按库能力落地）；`idx_status_start(status, start_at)`。

审计（created/updated）走统一 Audit Log 策略，见 TECH §2.1。

---

## 4. `content_global_config`（NEW）

| 列名 | 类型 | 可空 | 默认 | 说明 |
|------|------|------|------|------|
| `id` | BIGINT | NO | AI | 内部主键 |
| `content_id` | BIGINT | NO | — | FK → content.id（1:1） |
| `content_template` | VARCHAR(32) | NO | — | STANDARD / GALLERY |
| `display_config` | JSON | YES | NULL | 分享文案/分享图/订阅开关等展示配置 |

**索引**：`uk_content(content_id)` UNIQUE。

---

## 5. `content_module`（NEW）

| 列名 | 类型 | 可空 | 默认 | 说明 |
|------|------|------|------|------|
| `id` | BIGINT | NO | AI | 内部主键 |
| `uuid` | CHAR(36) | NO | — | 对外唯一标识 |
| `content_id` | BIGINT | NO | — | FK → content.id |
| `module_type` | VARCHAR(48) | NO | — | RICH_TEXT / IMAGE / VIDEO |
| `module_template` | VARCHAR(48) | NO | — | 类型内模板 |
| `sort_order` | INT | NO | — | 内容内连续；升序渲染 |
| `payload` | JSON | YES | NULL | 类型相关载荷 |
| `deleted_at` | DATETIME | YES | NULL | 逻辑删除 |

**索引**：`uk_uuid(uuid)` UNIQUE；`uk_content_sort(content_id, sort_order)` UNIQUE（未删除范围内）；`idx_type(content_id, module_type)`。

**领域映射**：`payload` ↔ RichTextPayload / ImagePayload / VideoPayload（按 module_type 多态）。
