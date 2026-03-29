# 文档总览

`couchdb-cli` 的核心价值，不只是“能调 CouchDB”，而是把 CouchDB 变成一种更接近文件系统的工作方式。

你可以把它理解成：

- 对人：
  一个能把数据库内容当目录树来浏览、编辑、上传、下载的交互工具
- 对 AI：
  一个有稳定命令面和 JSON 输出的 CouchDB 自动化接口

它最有特点的地方是：

- 普通文档库也能按虚拟目录浏览
- 专用 `fs` 库可以像远程文件系统一样操作
- shell 里同时有本地和远程命令
- `docs` / `fs` 两种模式都支持大量“文件式”命令
- 人工交互和自动化调用共用一套核心能力

适合先看的顺序：

1. [模式说明](./modes.md)
2. [交互式 shell](./shell.md)
3. [命令式 CLI](./cli.md)
4. [AI / 自动化](./ai-automation.md)

## 你应该先看哪一份

如果你主要是给人用：

- 先看 [模式说明](./modes.md)
- 再看 [交互式 shell](./shell.md)

如果你主要是给脚本、Agent、工具链用：

- 先看 [AI / 自动化](./ai-automation.md)
- 再看 [命令式 CLI](./cli.md)

如果你不确定用哪种模式：

- `docs` 模式适合直接操作现有 CouchDB 业务库
- `fs` 模式适合把数据库当专用文件系统来用

## 文档索引

### [modes.md](./modes.md)

说明：

- `root` / `docs` / `fs` 三种模式
- 虚拟目录和真实目录的区别
- JSON 文档、附件文件、fs 文件的差异

### [shell.md](./shell.md)

说明：

- shell 心智模型
- 远程命令
- 本地命令
- `rz/sz`
- `docs` 模式和 `fs` 模式下的典型操作

### [cli.md](./cli.md)

说明：

- 顶层命令结构
- `auth/profile/db/doc/attach/fs` 的命令式用法
- 常见组合命令

### [ai-automation.md](./ai-automation.md)

说明：

- 推荐给 AI 的调用方式
- `--json` 输出结构
- 退出码
- 推荐命令模式
- 自动化中的 `docs/fs` 选择建议
