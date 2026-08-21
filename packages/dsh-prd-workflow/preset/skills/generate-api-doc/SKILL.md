---
name: generate-api-doc
description: >-
  Export Spring app OpenAPI HTML via workspace-root docs/api-doc scripts.
  Use when the user asks to generate API docs, OpenAPI HTML, export springdoc
  docs, or run api-doc generate_*_api.sh for a local Spring app.
---

# Generate API Doc (local SpringDoc → HTML)

Generate interface docs by scoping SpringDoc paths in `application-LOCAL.properties`, ensuring the local app is up, then running the matching shell under **工作区根** `docs/api-doc/`（与 Epic/PRD 同仓，不在后端仓内）。

> [preset] api-doc 示例脚本种子随本 preset 分发：本 skill 基目录 `api-doc/`。工作区缺 `docs/api-doc/` 时，先把 `<base>/api-doc` 复制到工作区 `docs/api-doc`（保持可执行位），再按工作区 `docs/api-doc/` 路径执行；脚本按项目实际应用改名/改端口。

## Defaults (do not change unless user overrides)

- Artifact: **HTML only** via `generate_<app>_api.sh` (not PDF, not Postman)
- After export: **keep** LOCAL `paths-to-match` / `paths-to-exclude` (do not restore)
- Service: if port already serves api-docs → generate; else start with `bootRun`
- Working dir for scripts: `docs/api-doc/`（工作区根）
- App map: see [apps-reference.md](apps-reference.md)

## Checklist

```
API doc export:
- [ ] 1. Confirm app, path scope, context
- [ ] 2. Update application-LOCAL.properties
- [ ] 3. Ensure service (restart if config changed while running)
- [ ] 4. Run generate_*_api.sh
- [ ] 5. Report output files
```

### 1. Confirm inputs

Ask if missing:

| Input | Example |
|-------|---------|
| App key | `<app>`（登记于 apps-reference.md，示例：`user`、`order`） |
| `springdoc.paths-to-match` | `/api-<app>/api/v1/<resource>/**`（网关前缀按项目实际，示例：`/api-user/api/v1/users/**`） |
| `springdoc.paths-to-exclude` | empty, or comma-separated paths |
| `context` filename prefix | `<context>-` → `<app>-<context>api-YYYYMMDD.html`（精确命名模式按脚本实际，示例：`profile-`） |

Resolve Gradle module, port, api-docs URL, and script from [apps-reference.md](apps-reference.md). If the app has no local `*_api.sh`, stop and tell the user.

### 2. Update LOCAL SpringDoc scope

Edit only that app's (under `<backend-repo>` 按项目实际):

`<backend-repo>/modules/<app>-app/src/main/resources/application-LOCAL.properties`

Set (uncomment/adjust; leave historical commented examples alone when possible):

```properties
springdoc.paths-to-match=<paths>
springdoc.paths-to-exclude=<paths or empty>
```

- Prefer Ant-style patterns the project already uses (`/**`, concrete paths).
- Do **not** change non-LOCAL profiles or commit LOCAL secrets.
- Do **not** revert these keys after generation.

### 3. Ensure local service

Probe (replace from reference):

```bash
curl -sf -o /dev/null "http://localhost:<port><api-docs-path>"
```

| Result | Action |
|--------|--------|
| OK | Proceed to step 4 |
| Fail / connection refused | Start app (below), wait until probe succeeds |
| OK but paths were just changed | **Restart** the running process, then re-probe (SpringDoc filters load at startup) |

Start (from `<backend-repo>` 按项目实际，LOCAL profile as used for local boot):

```bash
./gradlew :<app>-app:bootRun
```

Run bootRun in background; poll the api-docs URL until HTTP 200 or timeout (~3–5 min cold start). If boot fails (DB/Compose/credentials), surface the error and stop—do not invent a fake OpenAPI file.

### 4. Run the generator

```bash
cd docs/api-doc
chmod +x generate_<app>_api.sh   # if needed
./generate_<app>_api.sh "<context>"
```

- Requires Node tools used by the scripts (`npx @redocly/cli`).
- Outputs land in `docs/api-doc/` as `<app>-<context>api-YYYYMMDD.html` (exact naming pattern varies by script).
- **Do not** generate PDF (`openapi2pdf` has been removed from these scripts).

### 5. Report

Return:

- Paths written (html)
- Match/exclude used
- Whether the app was already up, started, or restarted

Do not commit or push generated docs unless the user asks.

## Postman (only if user explicitly asks)

`generate_*_postman.sh` often target a **shared env**（脚本内占位 URL）, not localhost—LOCAL `paths-to-match` will not apply. Warn first; prefer switching those curls to localhost only when the user wants a scoped local collection.

## Related

- SpringDoc annotation rule：项目内约定文档（如 `.cursor/rules/springdoc-openapi.mdc`，按项目实际）
- Design: `docs/superpowers/specs/<date>-<topic>-design.md`（按项目实际填写）
