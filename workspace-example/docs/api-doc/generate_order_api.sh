#bin/sh
# 示例脚本：导出 order app 的 OpenAPI HTML（说明见 generate_user_api.sh）。

context="$1"
appPort=8081
apiPrefix=api-order

curl "http://localhost:${appPort}/${apiPrefix}/v3/api-docs" -s -o "/tmp/${apiPrefix}.json"

fileName=order-"$context"api-$(date +%Y%m%d)

npx @redocly/cli build-docs "http://localhost:${appPort}/${apiPrefix}/v3/api-docs" -o "./$fileName.html"
