# `packages/session-backends/sqlite-node` 阅读笔记

## 1. 包定位

该包是 Node.js SQLite Session backend，将 `packages/agent` 的 `SessionStorage` / `SessionRepo` 抽象映射到 `node:sqlite`。入口是 [`src/index.ts`](../packages/session-backends/sqlite-node/src/index.ts)。

```text
Agent Session abstraction
  -> sqlite repo
       -> migrations
       -> entries / records
       -> lanes / branch tips
       -> facts / stats / search
       -> writer leases
       -> node:sqlite
```

## 2. Node SQLite 适配器

`NodeSqliteStatement` 统一 `run/get/all/iterate`，同时支持位置参数和命名参数。`NodeSqliteDatabase` 只暴露上层需要的 `exec`、`prepare`、`transaction` 和 `close`。

`wrapNodeSqliteDatabase(db)` 的意义是隔离 Node 内置 SQLite 类型。Repo 和存储模块不需要直接依赖 `DatabaseSync`，测试时可以替换底层接口。

## 3. Transaction 参数

`transaction(fn)` 使用 `BEGIN IMMEDIATE` 获取写锁：

```text
BEGIN IMMEDIATE
  -> fn()
       成功 -> COMMIT
       失败 -> ROLLBACK -> rethrow
```

callback 必须同步完成。异步 callback 会被拒绝，因为数据库事务不能在 Promise 挂起期间保持不明确的写状态。

## 4. 重要模块

- [`sqlite/repo.ts`](../packages/session-backends/sqlite-node/src/sqlite/repo.ts)：创建数据库、执行迁移并组装各 storage。
- [`sqlite/migrations.ts`](../packages/session-backends/sqlite-node/src/sqlite/migrations.ts)：Schema 版本升级。
- [`sqlite/storage/entries.ts`](../packages/session-backends/sqlite-node/src/sqlite/storage/entries.ts)：会话 Entry。
- [`sqlite/storage/records.ts`](../packages/session-backends/sqlite-node/src/sqlite/storage/records.ts)：运行记录和恢复事实。
- [`sqlite/storage/lanes.ts`](../packages/session-backends/sqlite-node/src/sqlite/storage/lanes.ts)：lane 指针和分支关系。
- [`sqlite/storage/writer-leases.ts`](../packages/session-backends/sqlite-node/src/sqlite/storage/writer-leases.ts)：单写者协调。

不要把 SQLite 表结构当作 Agent Loop。表保存运行事实，`agent` 的 Session/Reducer 决定如何解释这些事实。
