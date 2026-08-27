# `packages/server` 阅读笔记

## 1. 包定位

`server` 将任意 `ByteConnection` 接入 Pi Server，并把 protocol command 路由到注入的 `PiServerService`。它负责网络和 live Session 管理，不绑定具体的 AgentSession 实现。

## 2. PiServer

源码：[`server.ts`](../packages/server/src/server.ts)

```text
ByteConnection
  -> accept()
  -> ClientMessageDecoder
  -> hello/version handshake
  -> dispatchMessage()
  -> handleRequest()
  -> encodeServerMessage()
```

重要状态：

- `listeners`：监听不同传输方式；
- `connections`：当前连接集合；
- `maxFrameLength`：单帧大小保护；
- `handshakeTimeoutMs`：握手超时；
- `closing` / `started`：Server 生命周期。

`accept()` 为每条连接创建独立 decoder、握手计时器和 `sessionIds`。连接关闭时必须同时清理这些状态。

## 3. Handshake

客户端第一条消息必须是 hello。服务端检查：

1. 消息类型是否正确；
2. protocol version 是否支持；
3. 当前 Server 是否仍在运行；
4. snapshot 是否可读取。

握手完成后才进入 `ready`。握手期间收到的业务请求会等待 handshake Promise，不能绕过版本和 snapshot 初始化。

## 4. LiveSessionManager

源码：[`sessions.ts`](../packages/server/src/sessions.ts)

`LiveSession` 是服务端内存中的运行时包装：

```text
stored Session
  -> acquire/open runtime
  -> liveSessions
  -> 多连接 attach
  -> prompt / steer / abort / set_model
  -> progress / snapshot broadcast
  -> 无连接 + 无 operation + runtime idle
  -> dispose
```

重要参数和状态：

- `connections`：哪些客户端需要接收快照和进度；
- `operationCount`：防止运行未结束时释放 runtime；
- `openingSessions`：合并同一 Session 的并发打开请求；
- `terminal`：Session runtime 正在终止，拒绝新的请求；
- `disposing`：保证释放过程只执行一次。

`requireAttached()` 是业务操作的前置边界，除 list/create/attach 外，其他 command 都必须确认当前连接已 attach 目标 Session。

## 5. 协议投影

源码：[`protocol.ts`](../packages/server/src/protocol.ts)

Server 不能把内部 `Model`、`AssistantMessage` 和 Tool details 原样传给客户端。转换函数会：

- 只保留协议支持的 Model 字段；
- 将 AI message 投影为 transcript item；
- 清洗 details 为 JSON；
- 映射 stop reason、Usage 和错误。

这层是 `ai` 内部类型与客户端稳定协议之间的防腐层。

## 6. 错误处理

`handleRequest()` 将业务错误转换成 response envelope，将未知异常隐藏为稳定的 internal error，同时通过 `onError` 记录诊断。协议错误、Session 业务拒绝和内部故障不应让客户端看到相同的错误语义。
