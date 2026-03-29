# AI / 自动化调用说明

这份文档面向：

- Agent
- 脚本
- CI
- MCP 包装器
- 任何不适合用交互式 shell 的调用方

## 推荐原则

推荐始终这样调用：

- 显式传 `--url`
- 显式传 `--user`
- 显式传 `--password`
- 显式传 `--db`
- 始终加 `--json`

例如：

```bash
cdb --url "$COUCH_URL" --user "$COUCH_USER" --password "$COUCH_PASSWORD" db list --json
```

这样做的好处是：

- 不依赖本机 profile 状态
- 不依赖交互式登录
- 不依赖 shell 会话上下文
- 结果稳定、可复现

## 成功输出格式

成功时：

```json
{
  "ok": true,
  "command": "db list",
  "data": [...],
  "meta": {}
}
```

这个结构来自 [src/core/output/index.ts](/home/moltbot/code/couchdb-cli/src/core/output/index.ts)。

## 失败输出格式

失败时：

```json
{
  "ok": false,
  "command": "doc get",
  "error": {
    "code": "NOT_FOUND",
    "message": "Document foo does not exist.",
    "details": null
  }
}
```

## 退出码

当前退出码定义在 [src/core/errors.ts](/home/moltbot/code/couchdb-cli/src/core/errors.ts)：

- `0`
  成功
- `2`
  输入错误
- `3`
  认证错误
- `4`
  资源不存在
- `5`
  冲突
- `10`
  网络或非预期错误

## 连接策略建议

### 最稳妥

每次命令显式传连接参数：

```bash
cdb --url "$COUCH_URL" --user "$COUCH_USER" --password "$COUCH_PASSWORD" --db mydb ...
```

### 可接受

先加载环境变量：

```bash
set -a; source ./.env; set +a
cdb --db mydb ...
```

### 不推荐给自动化

- 依赖交互式 `auth login`
- 依赖当前 shell 会话状态
- 依赖手工切换的 profile

## docs 和 fs 怎么选

### 用 docs

适合：

- 读写现有业务文档
- 文档 ID 天然像路径
- 需要同时处理 JSON 文档和附件

推荐命令：

- `doc get`
- `doc put`
- `doc patch`
- `attach list`
- `attach get`
- `attach put`

### 用 fs

适合：

- 明确是远程文件树
- 需要递归上传下载
- 需要强目录语义

推荐命令：

- `fs ls`
- `fs stat`
- `fs mkdir`
- `fs put`
- `fs get`
- `fs push`
- `fs pull`
- `fs rm`

## 常见调用模板

### 列数据库

```bash
cdb --url "$COUCH_URL" --user "$COUCH_USER" --password "$COUCH_PASSWORD" db list --json
```

### 读一个文档

```bash
cdb --url "$COUCH_URL" --user "$COUCH_USER" --password "$COUCH_PASSWORD" --db config_center doc get "ccode/ccode_config.json" --json
```

### 改一个文档

```bash
cdb --url "$COUCH_URL" --user "$COUCH_USER" --password "$COUCH_PASSWORD" --db config_center doc patch "ccode/ccode_config.json" --data '{"enabled":true}' --json
```

### 下载附件

```bash
cdb --url "$COUCH_URL" --user "$COUCH_USER" --password "$COUCH_PASSWORD" --db config_center attach get "ccode/releases/0.0.14/linux-amd64" linux-amd64 --output ./linux-amd64 --json
```

### 列文件树

```bash
cdb --url "$COUCH_URL" --user "$COUCH_USER" --password "$COUCH_PASSWORD" --db myfiles fs ls / --recursive --json
```

### 上传文件到 fs

```bash
cdb --url "$COUCH_URL" --user "$COUCH_USER" --password "$COUCH_PASSWORD" --db myfiles fs put ./hello.txt /notes/hello.txt --json
```

### 拉整个目录

```bash
cdb --url "$COUCH_URL" --user "$COUCH_USER" --password "$COUCH_PASSWORD" --db myfiles fs pull /bundle ./downloaded --json
```

## 给 AI 的调用建议

### 读场景

优先：

- `db list`
- `db info`
- `doc get`
- `attach list`
- `attach get`
- `fs ls`
- `fs stat`
- `fs cat`

### 写场景

优先：

- `doc put`
- `doc patch`
- `attach put`
- `fs put`
- `fs push`

### 删场景

显式加：

- `--yes`

例如：

```bash
cdb --url "$COUCH_URL" --user "$COUCH_USER" --password "$COUCH_PASSWORD" --db myfiles --yes fs rm /bundle --recursive --json
```

## 不建议 AI 做什么

不建议 Agent 在无人值守时依赖：

- `shell`
- `vim`
- `vi`
- `rz`
- `sz`

这些更适合人类交互式终端。

如果必须操作 `docs` 模式下的“像文件一样”的内容，优先考虑：

- `doc`
- `attach`
- 以及必要时进入 `shell` 做人工辅助

## 自动化最佳实践

建议：

- 固定传入连接参数
- 统一捕获 stdout
- 解析 JSON 输出
- 检查退出码
- 对删除命令显式传 `--yes`
- 不要假设本地 profile、cookie、cwd 一定存在

## 一个最小调用示例

```bash
result="$(cdb \
  --url \"$COUCH_URL\" \
  --user \"$COUCH_USER\" \
  --password \"$COUCH_PASSWORD\" \
  --db config_center \
  doc get \"ccode/ccode_config.json\" \
  --json)"

echo "$result"
```
