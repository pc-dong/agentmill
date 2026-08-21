# dsh-prd-workflow

DSH（DeepSeek Harness）插件包：把 `workspace-example` 的技能集打包成一个可选的 agent preset —— **PRD 工作流模式**（preset id：`prd-workflow`），基于随部署发布的 `standard`（标准模式），在其之上启用 workspace-example 目录下的全部 skill，并把它们依赖的 `docs/template` 模版体系**随声明依赖的 skill 一同分发**。

## 结构

```
packages/dsh-prd-workflow/
├── index.js              # 安装器：把 preset/ 复制并持续同步到 $DSH_HOME/.agent-presets/prd-workflow/
├── cordis.patch.yml      # bundle 层：挂载安装器行
├── skills-lock.json      # 上游 skill 来源锁定（provenance）
└── preset/
    ├── preset.yml        # 展示元信息（名称 / 描述）
    ├── agent.cordis.yml  # standard 副本 + 两处差异（见下）
    └── skills/           # workspace-example/.agents/skills 全量副本 + init-prd-docs
        ├── epic-prd-tech-design-workflow/
        │   ├── SKILL.md          # 头部带一行 [preset] 注记
        │   ├── template/         # ← docs/template 全量模版（13 个文件，含 tech/ 附件骨架）
        │   ├── README-PRD体系.md  # ← 权威体系文档
        │   └── …（7 个嵌套子 skill，各带 [preset] 注记）
        ├── generate-api-doc/
        │   ├── SKILL.md          # 头部带一行 [preset] 注记
        │   └── api-doc/          # ← docs/api-doc 示例脚本（generate_*_api.sh 等）
        ├── init-prd-docs/
        │   └── files/            # 全量种子（template/ + README-PRD体系.md + api-doc/），一次性播种用
        └── …（其余 superpowers skill 原样）
```

`agent.cordis.yml` 与标准模式只有两处不同：

1. **skill 来源**：`skill-filesystem` 行通过 `customSkillDirs` 把 preset 自带的 `skills/` 目录注册为自定义 skill 根（与随部署 `cordis` preset 携带 `editing-cordis-compositions` 的机制相同）。项目根（`.agents/skills`）优先级更高，因此在 workspace-example 本仓内工作时，仓库里的副本会遮蔽 preset 副本。
2. **persona 追加一段**：提示 agent 在任何引用 `docs/template/`、`docs/api-doc/` 的 skill 前先检查工作区，缺失时从 skill 自带种子播种（见各 skill 的 `[preset]` 注记，或加载 `init-prd-docs`）。

## skill 对 template 的依赖（如何打包）

workspace-example 的 skill（`epic-prd-tech-design-workflow` 全家桶、`generate-api-doc`）以**工作区相对路径**引用 `docs/README-PRD体系.md`、`docs/template/`、`docs/api-doc/`。本包处理这条依赖的方式：

- **模版跟随声明依赖的 skill 一起分发**：`epic-prd-tech-design-workflow/template/`（13 个文件）+ `README-PRD体系.md`；`generate-api-doc/api-doc/`（4 个文件）。skill 加载器会给模型提供 skill 基目录，因此模型可直接从基目录读模版。
- **打包副本的 skill 头部各加一行 `[preset]` 注记**：说明种子位置与播种动作（`cp -R <base>/template docs/template` 等）。**workspace-example 源文件保持原样**，注记只存在于打包副本；重新打包时若想更新，从 workspace-example 重新复制后重加注记即可（或直接保留本包内已注记的副本）。
- **`init-prd-docs` 提供一次性全量播种**：把 `files/` 下种子复制进缺失的工作区 —— 只补缺失项，绝不覆盖已有文件。workspace-example 自身已初始化，在其中使用时播种步骤自动为空操作。
- 工作区播种完成后，所有 skill 里的 `docs/...` 路径照常按工作区相对路径执行；skill 包内副本只是种子，不是活文档。

## 安装

方式 A（本仓库开发位，推荐）：复制或链接本目录到 profile 的 plugins 工作区，并加入 bundles：

```bash
cp -R packages/dsh-prd-workflow ~/.dsh/profiles/web/plugins/dsh-prd-workflow
# ~/.dsh/profiles/web/package.json:
#   dependencies 增加 "dsh-prd-workflow": "workspace:*"
#   dsh.profile.bundles 数组增加 "dsh-prd-workflow"
cd ~/.dsh/profiles/web && pnpm install
```

方式 B（发布后）：`dsh plugin --profile web add <source>`。

安装器在启动时把 `preset/` 同步到 `$DSH_HOME/.agent-presets/prd-workflow/`，通过目录内 `.preset-manifest.json` 记录每个文件的安装哈希：

- 缺文件 → 写入（保留脚本可执行位）；内容一致 → 跳过；
- **我们安装且未被手改的文件 → 插件升级时自动更新为新版本**；
- 与安装哈希不符的文件 → 视为本地手改：保留 + 告警，永不被覆盖；
- 我们安装但新版本已移除的文件 → 自动删除（手改过的保留）。

卸载插件不会删除已安装的 preset，需要时手动删除 `~/.dsh/.agent-presets/prd-workflow/`。

## 使用

新会话的预设选择器中选择「PRD 工作流模式」。要在工作区 `.agents/skills` 与 preset 副本之间做本地定制，直接改工作区副本（优先级更高）；要改所有会话的默认值，可在 settings 中设置 `agent-presets.default: prd-workflow`。

## skill 清单

- 上游（obra/superpowers，见 `skills-lock.json`）：brainstorming、dispatching-parallel-agents、executing-plans、finishing-a-development-branch、receiving-code-review、requesting-code-review、subagent-driven-development、systematic-debugging、test-driven-development、using-git-worktrees、using-superpowers、verification-before-completion、writing-plans、writing-skills
- workspace-example 自有：epic-prd-tech-design-workflow（编排器 + 7 个嵌套子 skill）、generate-api-doc、grilling
- 本包新增：init-prd-docs（docs/template 播种）
