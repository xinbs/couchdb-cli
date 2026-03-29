# 模式说明

`cdb` 有 3 个层次的语义：

- `root`
- `docs`
- `fs`

这 3 个模式共同决定了 `ls`、`cd`、`mkdir`、`cat`、`put`、`get` 这些命令到底在操作什么。

## root

prompt 形态：

```text
cdb:/>
```

它代表 CouchDB 服务器根目录。

在这里：

- `ls` 列数据库
- `dbs` 也列数据库
- `mkdir testdb` 或 `mkdb testdb` 创建数据库
- `rm testdb` 删除数据库
- `cd testdb` 进入数据库

这时“目录”不是文档目录，而是数据库名。

## docs

prompt 形态：

```text
cdb:/config_center>
cdb:/config_center/ccode/releases>
```

`docs` 模式是普通 CouchDB 数据库的默认模式。

它不是专门的文件系统，而是把文档 ID 按 `/` 显示成“虚拟目录”。

例如这些文档：

```text
ccode/ccode_config.json
ccode/releases/0.0.9/manifest
ccode/releases/0.0.9/linux-amd64
```

在 shell 里会被看成：

```text
/ccode/ccode_config.json
/ccode/releases/0.0.9/manifest
/ccode/releases/0.0.9/linux-amd64
```

### docs 模式里的对象类型

`ls` 里主要会看到 3 类：

- `dir`
  虚拟目录，来自文档 ID 前缀，或者来自隐藏目录标记文档
- `doc`
  普通 JSON 文档
- `file`
  attachment-backed 文档，也就是“文档 + 附件文件”

### docs 模式里的空目录

普通 CouchDB 本来没有“空目录”概念。

为了支持：

- `mkdir test`
- `cd test`
- `rm -r test`

CLI 会在 `docs` 模式下写一个隐藏目录标记文档。

所以你可以把 `docs` 模式理解成：

- 文档 ID 前缀负责大部分目录结构
- 隐藏 marker 文档补齐空目录能力

### docs 模式里文件怎么存

#### JSON 文档

如果本地文件是 JSON，并且适合当文档处理，CLI 会优先写成普通 JSON 文档。

这类对象在 `ls` 里显示为：

```text
doc
```

#### 附件文件

如果本地文件不是 JSON，CLI 会把它写成 attachment-backed 文档。

这类对象在 `ls` 里显示为：

```text
file
```

这意味着在 `docs` 模式里也可以：

- `cat`
- `vi`
- `get`
- `push`
- `pull`
- `rz`
- `sz`

但语义是“普通 CouchDB 文档库上的文件化视图”，不是专用文件树。

## fs

prompt 形态：

```text
cdb:/myfiles>
cdb:/myfiles/notes>
```

`fs` 模式是专门的文件树模式，需要显式初始化：

```bash
cdb --db myfiles fs init
```

或者在 shell 中：

```text
initfs
```

### fs 模式里的对象类型

`fs` 模式下数据库会有自己的数据模型：

- 目录文档
- 文件文档
- 文件内容 attachment

它和 `docs` 模式最大的区别是：

- `docs` 是在现有文档库上做“虚拟目录”
- `fs` 是专门为文件树设计的数据结构

### 什么时候用 fs

适合：

- 你要把数据库当远程文件系统
- 你要频繁做 `mkdir/put/get/push/pull`
- 你要明确的目录/文件模型

不适合：

- 你已有现成业务文档库，不想改变它的数据结构

## docs 和 fs 怎么选

### 选 docs

适合：

- 直接浏览现有 CouchDB 业务库
- 文档 ID 本来就像路径
- 你要同时操作 JSON 文档和附件

典型库：

- `config_center`
- 发布清单库
- 配置中心库

### 选 fs

适合：

- 新建一个专用数据库来存文件
- 你关心目录、文件、递归上传下载
- 你希望“像远程文件系统”而不是“像 CouchDB 文档”

典型库：

- `myfiles`
- `assets`
- `backup_store`

## 删除语义

### root

```text
rm testdb
```

删除的是数据库。

### docs

```text
rm note.txt
```

删除的是一个文档节点。

```text
rm -r releases
```

删除的是该虚拟目录下所有文档。

### fs

```text
rm note.txt
rm -r releases
```

删除的是 `fs` 数据模型里的真实文件或目录。

## `manifest` 不是内建概念

很多业务库里会有 `manifest` 文档，但它不是 CLI 自动维护的通用概念。

例如：

```text
ccode/releases/0.0.9/manifest
```

它只是一个普通文档。

CLI 不会默认把它当成每个目录都必须存在的元数据文件。

如果你要改它，直接编辑这个文档本身：

```text
vi manifest
```

或者命令式：

```bash
cdb --db config_center doc get "ccode/releases/0.0.9/manifest"
```
