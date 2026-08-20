-- 1xx_alter_content_add_summary.sql — v0.2 内容摘要增量（T-CMS-001）
-- 关联：TECH-DESIGN-delta-v0.2-content-summary.md §4 / P-001-01
-- 校验：≤200 字符（应用层校验；DB 不加 CHECK 以便平滑回滚）

ALTER TABLE `content`
  ADD COLUMN `summary` VARCHAR(200) NULL AFTER `end_at`;
