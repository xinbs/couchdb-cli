# 命令式 CLI

## 安装和更新

安装：

```bash
npm i -g @xinbs/couchdb-cli
```

更新：

```bash
npm i -g @xinbs/couchdb-cli@latest
```

或者：

```bash
npm update -g @xinbs/couchdb-cli
```

查看版本：

```bash
cdb --version
```

## 全局参数

所有命令都支持这些全局参数：

```text
--profile <profile>
--url <url>
--user <user>
--password <password>
--db <db>
--json
--quiet
--yes
--timeout <ms>
```

推荐理解为：

- `--url --user --password`
  当前命令直接连 CouchDB
- `--db`
  当前命令默认数据库
- `--json`
  机器可读输出
- `--yes`
  跳过删除确认

## 顶层命令

```text
cdb profile ...
cdb auth ...
cdb db ...
cdb doc ...
cdb attach ...
cdb fs ...
cdb shell
```

## auth

### 登录

交互式：

```bash
cdb auth login
```

无提示：

```bash
cdb auth login --url "https://host:5984" --user admin --password secret
```

记住 cookie：

```bash
cdb auth login --remember-cookie
```

### 查看身份

```bash
cdb auth whoami
```

### 登出

```bash
cdb auth logout
```

## profile

新增 profile：

```bash
cdb profile add prod --url "https://host:5984" --user admin --db mydb --current
```

列出 profile：

```bash
cdb profile list
```

切换：

```bash
cdb profile use prod
cdb profile switch prod
```

查看当前 profile：

```bash
cdb profile current
```

测试 profile：

```bash
cdb profile test prod
```

## db

列数据库：

```bash
cdb db list
```

创建数据库：

```bash
cdb db create mydb
```

删除数据库：

```bash
cdb --yes db delete mydb
```

查看数据库信息：

```bash
cdb db info mydb
```

## doc

列文档：

```bash
cdb --db config_center doc list
cdb --db config_center doc list --include-docs
```

读取文档：

```bash
cdb --db config_center doc get "ccode/ccode_config.json"
```

写入文档：

```bash
cdb --db mydb doc put mydoc --data '{"hello":"world"}'
```

从文件写入：

```bash
cdb --db mydb doc put mydoc --file ./mydoc.json
```

patch 文档：

```bash
cdb --db mydb doc patch mydoc --data '{"hello":"new"}'
```

删除文档：

```bash
cdb --db mydb doc delete mydoc
```

## attach

列附件：

```bash
cdb --db config_center attach list "ccode/releases/0.0.14/linux-amd64"
```

下载附件：

```bash
cdb --db config_center attach get "ccode/releases/0.0.14/linux-amd64" linux-amd64 --output ./linux-amd64
```

上传附件：

```bash
cdb --db mydb attach put mydoc ./a.txt
```

删除附件：

```bash
cdb --db mydb attach delete mydoc a.txt
```

## fs

初始化数据库为 `fs` 模式：

```bash
cdb --db myfiles fs init
```

列目录：

```bash
cdb --db myfiles fs ls /
cdb --db myfiles fs ls /bundle --recursive
```

查看元信息：

```bash
cdb --db myfiles fs stat /hello.txt
```

创建目录：

```bash
cdb --db myfiles fs mkdir /notes
```

读取文本文件：

```bash
cdb --db myfiles fs cat /notes/hello.txt
```

编辑文件：

```bash
cdb --db myfiles fs edit /notes/hello.txt
```

上传单文件：

```bash
cdb --db myfiles fs put ./hello.txt /notes/hello.txt
```

下载单文件：

```bash
cdb --db myfiles fs get /notes/hello.txt ./hello.txt
```

上传目录：

```bash
cdb --db myfiles fs push ./bundle /bundle
```

下载目录：

```bash
cdb --db myfiles fs pull /bundle ./downloaded
```

删除：

```bash
cdb --db myfiles fs rm /bundle --recursive
```

## shell

启动 shell：

```bash
cdb shell
cdb --db mydb shell
```

如果你更关心 shell，用 [shell.md](./shell.md)。

## 推荐用法

### 你在维护普通业务文档库

优先：

- `doc`
- `attach`
- `shell`

### 你在维护专用文件数据库

优先：

- `fs`
- `shell`

### 你在做自动化

优先：

- 命令式 CLI
- `--json`
- 显式传 `--url --user --password --db`
