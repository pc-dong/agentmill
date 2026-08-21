# 数据库表设计（模版骨架）

> 复制到 `docs/epics/<epic-id>-<slug>/tech/ddl/schema.md` 后填写。  
> 可选：同目录放置 `V__xxx.sql` 迁移脚本，并在下表引用。

## 1. 表清单

| 表名 | 说明 | 变更类型 | 迁移脚本 | 关联 PRD |
|------|------|----------|----------|----------|
| `t_example` | 示例表，请替换 | NEW | `V__example.sql`（可选） | P-xxx |

## 2. 表：`t_example`

| 列名 | 类型 | 可空 | 默认 | 说明 |
|------|------|------|------|------|
| `id` | BIGINT | NO | AI | 内部主键 |
| `uuid` | CHAR(36) | NO | — | 对外唯一标识 |
| `created_at` | DATETIME | NO | CURRENT | 创建时间 |
| `updated_at` | DATETIME | NO | CURRENT | 更新时间 |

**索引**

| 名称 | 列 | 类型 |
|------|-----|------|
| `uk_uuid` | `uuid` | UNIQUE |
| `pk` | `id` | PRIMARY |

**领域映射**

| 列 / 表 | 领域概念 |
|---------|----------|
| `t_example` | `<Aggregate>` |
| `uuid` | 对外 ID |

## 3. 变更记录

| 日期 | 变更类型 | 摘要 |
|------|----------|------|
| YYYY-MM-DD | NEW | 初稿 |
