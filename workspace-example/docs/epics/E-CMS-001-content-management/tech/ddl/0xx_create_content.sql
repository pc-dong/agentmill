-- 0xx_create_content.sql — Content Management 基线建表草稿（T-CMS-001, v0.1）
-- 说明：DDL 草稿；生产 Liquibase 脚本在实现阶段另建（见 TECH-DESIGN §10）

CREATE TABLE `content` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `uuid`          CHAR(36)     NOT NULL,
  `title`         VARCHAR(100) NOT NULL,
  `content_type`  VARCHAR(32)  NOT NULL,
  `start_at`      DATETIME     NOT NULL,
  `end_at`        DATETIME     NOT NULL,
  `remark`        VARCHAR(200) NULL,
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'DRAFT',
  `published_by`  VARCHAR(64)  NULL,
  `published_at`  DATETIME     NULL,
  `offline_by`    VARCHAR(64)  NULL,
  `offline_at`    DATETIME     NULL,
  `deleted_at`    DATETIME     NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_uuid` (`uuid`),
  KEY `idx_status_start` (`status`, `start_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `content_global_config` (
  `id`              BIGINT      NOT NULL AUTO_INCREMENT,
  `content_id`      BIGINT      NOT NULL,
  `content_template` VARCHAR(32) NOT NULL,
  `display_config`  JSON        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_content` (`content_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `content_module` (
  `id`              BIGINT      NOT NULL AUTO_INCREMENT,
  `uuid`            CHAR(36)    NOT NULL,
  `content_id`      BIGINT      NOT NULL,
  `module_type`     VARCHAR(48) NOT NULL,
  `module_template` VARCHAR(48) NOT NULL,
  `sort_order`      INT         NOT NULL,
  `payload`         JSON        NULL,
  `deleted_at`      DATETIME    NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_uuid` (`uuid`),
  KEY `idx_content_type` (`content_id`, `module_type`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
