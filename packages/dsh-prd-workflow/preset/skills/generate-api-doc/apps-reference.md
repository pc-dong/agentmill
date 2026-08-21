# App → script / port / module map

按项目维护的 **app → 脚本 / 端口 / 模块** 映射表。接入新工作区时：先删示例行，再按本项目实际的 SpringDoc app 逐行登记，并同步维护 `docs/api-doc/generate_*_api.sh` 脚本。

事实源：各 app 的 `application-LOCAL.properties` 与对应 `docs/api-doc/generate_*_api.sh`；表与脚本漂移时以文件为准并回填本表。

后端模块根目录：`<backend-repo>/modules/`（按项目实际路径替换，如 `<my-backend>/modules/`）  
脚本目录：`docs/api-doc/`（工作区根，不在后端仓内）

## Local HTML (`generate_*_api.sh`)

> 下表两行为**示例**（app 名、端口、网关前缀均为占位），请整体替换为本项目实情。

| App key | Gradle module | LOCAL port | api-docs path | Script | Notes |
|---------|---------------|------------|---------------|--------|-------|
| user | `<app>-app`（按项目实际模块名） | `<port>` | `<gateway>/v3/api-docs`（按项目实际） | `generate_user_api.sh` | 示例行 |
| order | `<app>-app`（按项目实际模块名） | `<port>` | `<gateway>/v3/api-docs`（按项目实际） | `generate_order_api.sh` | 示例行 |

约定：

- 端口与 api-docs path 以各 app LOCAL 配置为准，勿凭记忆填。
- 脚本内环境 URL（如 `https://api.sit.example.com`）为占位，按项目环境替换。
- 某 app 无本地 `*_api.sh` 时先补脚本再登记，或在 Notes 标明「仅 Postman」。

## Probe one-liner

```bash
curl -sf "http://localhost:<port><api-docs-path>" | head -c 200
```

Healthy OpenAPI JSON should start with `{` and include `"openapi"`.

## LOCAL properties path

```text
<backend-repo>/modules/<app>-app/src/main/resources/application-LOCAL.properties
```

Keys:

```properties
springdoc.paths-to-match=...
springdoc.paths-to-exclude=...
```

## bootRun

From `<backend-repo>`（按项目本地启动方式替换，不限于 gradle）:

```bash
./gradlew :<app>-app:bootRun
```

Use the same LOCAL profile the developer uses for day-to-day boot（见项目本地环境说明文档）. Do not start test-only stacks unless the user asks.

## Postman scripts (not default)

Present under `docs/api-doc/generate_*_postman.sh`. They target a shared env（脚本内占位 URL）, not localhost—out of scope for the default local HTML flow.
