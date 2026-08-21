---
name: init-prd-docs
description: >-
  Seed the PRD docs scaffold into the current workspace from the copies this
  preset bundles: docs/README-PRD体系.md, docs/template/ (模版体系) and
  docs/api-doc/ (示例脚本). Load this FIRST when any Epic/PRD/TECH workflow or
  generate-api-doc skill references docs/template or docs/api-doc and the
  workspace does not carry them yet. Never overwrites existing files.
---

# 初始化 PRD 文档体系（播种 docs/template）

`epic-prd-tech-design-workflow`、`generate-api-doc` 等 skill 以**工作区相对路径**引用：

- 权威体系：`docs/README-PRD体系.md`
- 模版：`docs/template/`（含 `tech/` 附件骨架）
- API 文档脚本：`docs/api-doc/`

一个新工作区默认没有这些文件。本 skill 随 `prd-workflow` preset 分发它们的**权威副本**（位于本 skill 基目录的 `files/` 下），负责在缺失时播种进工作区。

## 步骤

1. 在**工作区根**（不是本 skill 目录）逐项检查以下目标是否已存在：
   - `docs/README-PRD体系.md`
   - `docs/template/`（以 `docs/template/EPIC模版.md` 为存在性标志）
   - `docs/api-doc/`（以 `docs/api-doc/README.md` 为存在性标志）
2. 三项**全部存在** → 无需播种，直接进入后续工作流 skill。
3. 对缺失项，从本 skill 基目录 `files/` 复制（`<base>` 指本 skill 的基目录，保持脚本可执行位）：

   ```bash
   mkdir -p docs
   # 缺才复制；已存在的一律跳过，绝不覆盖
   [ -f docs/README-PRD体系.md ] || cp "<base>/files/README-PRD体系.md" docs/
   [ -f docs/template/EPIC模版.md ] || cp -R "<base>/files/template" docs/template
   [ -f docs/api-doc/README.md ] || cp -Rp "<base>/files/api-doc" docs/api-doc
   chmod +x docs/api-doc/*.sh 2>/dev/null || true
   ```

4. 复制后 `ls docs/` 验证，并向用户报告播种了哪些项。
5. `docs/api-doc/generate_*.sh` 是**示例脚本**（面向 demo Spring 应用）：使用前按项目实际应用名 / 端口 / context-path 改名与修改，规则见 `generate-api-doc` skill 的 apps-reference。

## 边界

- **只播种缺失项**：任何已存在的文件 / 目录都不覆盖 —— 工作区里的是活文档，本 skill 的 `files/` 只是分发用的种子。
- 不创建 `docs/epics/`、`docs/superpowers/`：它们是项目产物与样例结构，由各工作流 skill 在写作时生成。
- 本 skill 不做业务决策；播种完成后回到调用方的工作流 skill 继续原步骤。
