# dsh-qq-archive

按配置保存 DSH 消息事件。启用前选择租户、网络、机器人账号以及群或私聊对象；这些条件取交集，不是账号与群的配对列表。不同会话使用独立 SQLite 文件。本插件不注册模型工具。

## 安装

请安装到已能正常启动的 DSH profile。当前预发布版 Host 模板关闭自动安装 peer 依赖；隔离集成测试会按已安装公开包的声明补齐必要 DSH peer。本插件不负责修复不完整的 Host 安装。

```sh
dsh plugin --profile MY_PROFILE add https://github.com/Soldsix/dsh-qq-archive/releases/download/v0.2.1/dsh-qq-archive-0.2.1.tgz
```

公开的 `dsh-im-kit` 依赖自动安装。还需单独安装提供规范化事件的 IM 传输插件。适配 DSH 0.2.2-rc.1、Cordis ~4.1.0、Node ^22.19 或 >=24。bundle 默认关闭。在插件页面配置，或使用 profile 补丁：

```yaml
- id: qq-archive
  config:
    enabled: true
    tenants: [example-tenant]
    networks: [onebot11]
    accounts: [example-account]
    groups: [example-group]
    readEnabled: false
```

示例 ID 必须替换为传输插件使用的身份。仅在有权保存私聊时添加 `privatePeers`。`allowAnyTenant`、`allowAnyAccount` 只放宽对应维度。默认目录为选定 profile 的 `data/qq-archive`；自定义目录必须为绝对路径。

## 保存内容与限制

保存完整规范化消息和不透明附件引用，不下载媒体本体。重复消息保留首次原文；消息身份冲突、容量不足和超时均会报告。写入超时代表结果不确定，不自动重试。传输插件未收到的消息无法恢复。

独立写入 worker 执行 SQLite 操作，避免占用 Host 事件循环。条数和字节容量超限时拒绝写入，不截断消息。卸载等待待处理写入完成，或报告关闭超时。关闭或卸载后保留数据。不包含自动删除、历史回放、迁移或加密；请保护本地文件，并只保存有权保留的会话。

## 存储所有者查询

`qqArchive.read(request, signal)` 仅供可信 Host 代码调用，所有者开启 `readEnabled` 后才可使用。参数为选定会话、发送者筛选、Unicode 子串、排他分页位置和资源预算；不接受 SQL 或数据库路径。调用方必须先验证请求者身份和数据披露权限；独立的历史搜索插件负责该策略。此 API 不能限制任意 Host 代码访问主机。

查询 worker 由归档插件持有，与写入 worker 分开。所有者可限制并发数、扫描条数与字节、结果条数与字节、单条字节和超时；调用方更小的预算会被保留。结果不截断正文，`partial` 标识跳过的超大记录，`next` 从最后扫描位置之前继续。取消或超时只终止该次读取，Promise 在 worker 退出后结束。数据库缺失或版本不兼容时报告错误，不创建或迁移。归档侧再次校验会话选择；数据库版本仍为 1。

原生所有者页面提供配置和无正文计数，包括进行中的查询。修改前先关闭并保存归档，改完再启用；暂停期间收到的消息不会归档。查询开关独立于模型访问，不会注册模型工具。

## 开发与预览范围

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm pack --pack-destination artifacts
npm run test:native
npm run test:browser
npm run test:web
```

测试只使用合成身份与隔离 profile，不得指向生产数据。本预览提供规范化事件存储及受限 Host 查询，不包含媒体本体归档、语义记忆、带身份认证的模型历史工具或离线补收。真实 QQ 与桌面验收仍需单独进行。
