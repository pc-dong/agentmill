#bin/sh
# 示例脚本：导出 user app 的 OpenAPI HTML。
# 接入新工作区：复制本文件按 app 改名（generate_<app>_api.sh），并同步
# .agents/skills/generate-api-doc/apps-reference.md 的登记表。
# 端口 / 网关前缀为占位示例，按项目实际替换。

context="$1"
appPort=8080
apiPrefix=api-user

curl "http://localhost:${appPort}/${apiPrefix}/v3/api-docs" -s -o "/tmp/${apiPrefix}.json"

fileName=user-"$context"api-$(date +%Y%m%d)

npx @redocly/cli build-docs "http://localhost:${appPort}/${apiPrefix}/v3/api-docs" -o "./$fileName.html"
