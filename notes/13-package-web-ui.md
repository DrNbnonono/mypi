# `packages/web-ui` 阅读笔记

## 1. 包定位

`web-ui` 是浏览器应用层，通过 HTTP API、SSE 和 Server Session 使用 Pi。浏览器不重新实现 Provider、Tool 执行或 Agent Loop。

## 2. 命令适配

源码：[`lib/agent-client.ts`](../packages/web-ui/lib/agent-client.ts)

`sendAgentCommand(sessionId, command)` 统一：

1. URL encode Session id；
2. 发送 POST JSON；
3. 解析 `{ success, data }` 或错误 envelope；
4. 将非 2xx 和服务端业务错误转换为 `AgentCommandError`。

`isPromptRejectedError()` 只把服务端明确标记为“未接受”的 prompt 当成可恢复草稿的拒绝。网络失败可能发生在服务端已经接受命令之后，不能盲目恢复草稿并导致重复提交。

## 3. SSE 事件同步

源码：[`lib/agent-event-stream.ts`](../packages/web-ui/lib/agent-event-stream.ts)

```text
打开 SSE
  -> 等待 sessionPromise
  -> 安装 Session listener
  -> 读取 streaming snapshot
  -> 发送 connected
  -> 补发 listener 安装期间缓存的事件
  -> 过滤 snapshot 已包含的事件
  -> 转发后续事件
```

这套顺序解决了连接建立时的竞态：如果先读 snapshot 再装 listener，中间产生的 Agent event 会丢失；如果只转发 event，浏览器可能从半个 assistant message 开始显示。

SSE 使用 heartbeat 保持连接，Request abort 或 stream cancel 时清理 timer、listener 和 controller。

## 4. React Session Hook

[`hooks/useAgentSession.ts`](../packages/web-ui/hooks/useAgentSession.ts) 负责把 Session snapshot、Agent event、消息、模型、thinking level、队列、compaction 和滚动状态映射为 React state。它是显示层状态，不是 Session 的权威存储。

发送 prompt 时，Hook 将输入交给服务端；服务端是否把它作为新 prompt、steer 或 follow-up 解释，由服务端 AgentSession 决定。浏览器只显示结果和处理明确的错误恢复。

## 5. 阅读重点

建议顺序：[`agent-client.ts`](../packages/web-ui/lib/agent-client.ts) → [`agent-event-wire.ts`](../packages/web-ui/lib/agent-event-wire.ts) → [`agent-event-stream.ts`](../packages/web-ui/lib/agent-event-stream.ts) → [`useAgentSession.ts`](../packages/web-ui/hooks/useAgentSession.ts)。

`.next/` 是生成目录，不是业务源码入口；检查命令扫描到其中的 validator 文件时，应调整检查范围，而不是修改生成文件。
