# 交互式 Shell

## 启动

最简单：

```bash
cdb shell
```

指定数据库启动：

```bash
cdb --db mydb shell
```

如果连接信息不足，shell 会在启动时提示输入：

- URL
- 用户名
- 密码
- 是否记住 `url + cookie`

## prompt 语义

根目录：

```text
cdb:/>
```

数据库根目录：

```text
cdb:/config_center>
```

数据库子路径：

```text
cdb:/config_center/ccode/releases>
```

## 常用命令

### 通用命令

```text
help
quit
exit
target
mode
whoami
```

### 数据库相关

```text
ls
dbs
db
cd <db>
use <db>
mkdir <db>
mkdb <db>
rm <db>
```

### 远程路径命令

```text
pwd
cd <path>
mkdir <path>
ls
stat <path>
cat <path>
vi <path>
vim <path>
put <local> [remote]
cp <local> [remote]
get <remote> [local]
push <localDir> [remote]
pull [remote] <localDir>
rz [options] [remote]
sz [options] <remote>
rm [-r] <path>
```

### 本地命令

统一加 `l` 前缀：

```text
lpwd
lcd ~/Downloads
lls -la
lcp a.txt b.txt
lmkdir tmp
```

## 本地路径和远程路径怎么区分

本地路径：

```text
./a.txt
~/Downloads/a.txt
/tmp/a.txt
```

远程路径：

```text
a.txt
notes/a.txt
/notes/a.txt
```

例子：

```text
cp ./a.txt
```

表示：

- 从本地当前目录读取 `./a.txt`
- 上传到当前远程目录

```text
get a.txt ./local-a.txt
```

表示：

- 从当前远程目录下载 `a.txt`
- 保存到本地 `./local-a.txt`

## docs 模式下的典型流程

进入一个普通业务库：

```text
cdb shell
cd config_center
ls
cd ccode
ls
cat ccode_config.json
```

编辑 JSON 文档：

```text
vi ccode_config.json
```

浏览发布目录：

```text
cd releases
cd 0.0.14
ls
cat manifest
```

下载附件文件：

```text
sz -bey linux-amd64
```

上传一个本地文件到当前虚拟目录：

```text
lcd ~/Downloads
cp ./new-binary linux-amd64
```

上传整个本地目录：

```text
push ./artifacts uploads
```

递归下载一个虚拟目录：

```text
pull uploads ./downloads
```

## fs 模式下的典型流程

新建并初始化：

```text
cdb shell
mkdir myfiles
cd myfiles
initfs
```

创建目录并上传文件：

```text
mkdir notes
cd notes
lcd ~/Downloads
cp ./hello.txt
ls
cat hello.txt
```

整目录同步：

```text
push ./assets bundle
pull bundle ./downloaded
```

## `rz` / `sz`

### `rz`

作用：

- 用本地 `rz` 接收 zmodem 文件
- 先落到临时目录
- 再自动上传到当前远程路径

例子：

```text
rz -bey
rz -bey /test/uploads
rz -bey note.txt
```

### `sz`

作用：

- 先把远程文件或目录暂存到临时目录
- 再调用本地 `sz`

例子：

```text
sz -bey manifest
sz -bey linux-amd64
sz -bey releases
```

注意：

- 是否真的能传 zmodem，取决于你当前终端/SSH 客户端支持
- CLI 负责的是命令链路，不替代终端本身的 zmodem 能力

## 自动补全

shell 支持 Tab 补全。

支持这些类型：

- 命令名补全
- 数据库名补全
- 远程路径补全
- 本地路径补全

例如：

```text
cd con<Tab>
cp ./a<Tab>
rz -bey /te<Tab>
```

## 删除

删除数据库：

```text
cdb:/> rm testdb
```

删除文档或文件：

```text
rm note.txt
```

删除目录：

```text
rm -r releases
```

shell 会二次确认，除非你启动时用了全局 `--yes`。

## 建议

如果是“浏览、编辑、上传、下载”这类交互工作，优先用 shell。

如果是：

- 脚本
- CI
- Agent
- 批量自动化

优先用命令式 CLI，并加 `--json`。
