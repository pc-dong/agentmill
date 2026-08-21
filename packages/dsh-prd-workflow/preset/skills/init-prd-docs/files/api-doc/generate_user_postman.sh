#bin/sh
# 示例脚本：从共享环境导出 user app 的 Postman collection（默认流程不使用）。
# 环境 URL 为占位示例，按项目实际替换；LOCAL paths-to-match 对共享环境不生效。

context="$1"
envBaseUrl=https://api.sit.example.com   # 占位；按项目环境替换
apiPrefix=api-user

curl "${envBaseUrl}/${apiPrefix}/v3/api-docs" -s -o "/tmp/${apiPrefix}.json"

npx openapi2postmanv2 -s "/tmp/${apiPrefix}.json" -o 'Demo-User UAT.postman_collection.json' -p -O folderStrategy=Tags,includeAuthInfoInExample=true
