# `packages/client` 阅读笔记

## 1. 包定位

`client` 将 [`protocol`](../packages/protocol) 的字节消息封装成应用可以使用的 `PiClient` 和 `SessionHandle`。它不执行 Agent，只负责连接、请求匹配、Session lease、快照和事件。

## 2. 连接层

源码：[`connection.ts`](../packages/client/src/connection.ts)

```text
disconnected
  -> connecting
       -> send hello
       -> receive server hello
  -> connected
  -> disconnected
```

`Connection` 的职责：

- 打开 `ByteTransport`；
- 用 `ServerMessageDecoder` 处理任意 chunk；
- 验证 hello 必须是第一条服务端消息；
- 将业务消息交给 `PiClient`；
- 在断线或协议错误时关闭当前 transport。

每次 `connect()` 都生成新的 connection id。迟到的旧连接事件如果 id 不匹配，会被忽略，防止旧连接修改新连接状态。

## 3. PiClient 请求管理

源码：[`client.ts`](../packages/client/src/client.ts)

`#request(command)` 做四件事：

1. 检查 Client 未 dispose 且已经 connected；
2. 生成 request id；
3. 把 resolver 存入 `pendingRequests`；
4. 编码并发送 request frame。

服务端返回 response 后，Client 按 id 找到 pending request，并额外验证 response command 与原 command 一致。断线时所有 pending Promise 都会被拒绝。

## 4. Session Lease

`acquireSession(sessionId, { mode })` 支持：

- `shared`：多个客户端可以观察同一 Session；
- `exclusive`：独占 Session，防止并发控制写操作。

本地先预留 lease，再发送 attach。`SessionHandle` 中的 generation 用于识别断线、session_removed 或重新连接后的旧引用。旧 handle 失效后，不能继续操作新一代连接。

源码：[`session-handle.ts`](../packages/client/src/session-handle.ts)

## 5. Snapshot 和 Event

`ClientState` 保存全局 ServerSnapshot、SessionSnapshot 和事件订阅。调用方可以：

- 订阅全局 snapshot；
- 订阅全局 event；
- 从 SessionHandle 订阅指定 Session；
- 通过 `snapshot` 读取最近状态。

事件是增量通知，snapshot 是当前完整状态。断线重连后应优先使用新 snapshot，而不是假设本地事件序列仍连续。

## 6. 阅读路径

建议顺序：[`transport.ts`](../packages/client/src/transport.ts) → [`connection.ts`](../packages/client/src/connection.ts) → [`state.ts`](../packages/client/src/state.ts) → [`client.ts`](../packages/client/src/client.ts) → [`session-handle.ts`](../packages/client/src/session-handle.ts)。
