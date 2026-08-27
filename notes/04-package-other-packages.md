# 其他 `packages/*` 阅读笔记

> 本笔记承接 [`03-package-agent.md`](./03-package-agent.md)。`03` 重点解释
> `packages/agent` 的 Agent Loop；本篇解释其他 package 如何把它接成 CLI、TUI、RPC、Server、Web UI 和持久化系统。
> 所有源码链接均以当前文件 `notes/04-package-other-packages.md` 为基准，使用相对路径。

各包独立笔记：

- [`05-package-coding-agent.md`](./05-package-coding-agent.md)
- [`06-package-tui.md`](./06-package-tui.md)
- [`07-package-protocol.md`](./07-package-protocol.md)
- [`08-package-client.md`](./08-package-client.md)
- [`09-package-server.md`](./09-package-server.md)
- [`10-package-telemetry.md`](./10-package-telemetry.md)
- [`11-package-session-backends-sqlite-node.md`](./11-package-session-backends-sqlite-node.md)
- [`12-package-evals.md`](./12-package-evals.md)
- [`13-package-web-ui.md`](./13-package-web-ui.md)

## 1. 全局调用关系

Pi 的包不是几个互相独立的工具，而是一条从模型请求到用户界面的分层链路：

```text
Provider / LLM
      |
      v
packages/ai
  统一 Model / Provider / Api / EventStream
      |
      v
packages/agent
  Agent Loop / Tool / Context / Session 抽象
      |
      +-----------------------+
      |                       |
      v                       v
packages/coding-agent     packages/server
  应用宿主、CLI、Extension    远程 Session 服务
      |                       |
      v                       v
packages/tui              packages/client
  终端交互                   RPC 客户端

packages/protocol  位于 server/client 之间，定义跨进程消息
packages/session-backends/sqlite-node 为 agent Session 提供 SQLite 存储
packages/telemetry 为 ai/agent/coding-agent 提供观测抽象
packages/web-ui 通过 HTTP/SSE 使用 server 或 coding-agent 的服务能力
packages/evals   使用可控 Provider/Harness 验证这些层的行为
```

根目录的包依赖可先参考 [`packages/` 总体说明](./01-project.md#212-包结构) 和
[`01-project.md` 中的依赖流](./01-project.md#211-项目整体定位)。

## 2. `packages/coding-agent`：真正运行的 Pi 应用

### 2.1 它解决什么问题

`packages/agent` 只提供通用 Agent Runtime；它不会决定：

- 用户从命令行传入什么参数；
- 当前项目是否可信；
- Session 文件放在哪里；
- 默认系统提示是什么；
- `read/write/edit/bash` 等编码工具如何注册；
- Extension 和 Skill 如何加载；
- 事件应该输出到 TUI、Print、JSON 还是 RPC。

这些应用决策由 `coding-agent` 负责。公共入口是 [`src/index.ts`](../packages/coding-agent/src/index.ts)，它将核心 Session、Model、Extension、Tool、运行模式和 UI 组件重新导出。

入口层次：

```text
cli.ts
  -> main.ts
       -> 解析参数与运行模式
       -> 初始化 Settings / Trust / Credential / Model
       -> 创建 Session 和 AgentSessionRuntime
       -> 根据模式启动 Interactive / Print / JSON / RPC
```

建议先看：

- [`src/cli.ts`](../packages/coding-agent/src/cli.ts)：Node CLI 启动入口；
- [`src/main.ts`](../packages/coding-agent/src/main.ts)：初始化和模式分流；
- [`src/core/sdk.ts`](../packages/coding-agent/src/core/sdk.ts)：面向程序调用的创建工厂；
- [`src/core/agent-session.ts`](../packages/coding-agent/src/core/agent-session.ts)：Session 级 Agent 宿主；
- [`src/core/agent-session-runtime.ts`](../packages/coding-agent/src/core/agent-session-runtime.ts)：运行时替换、切换、Fork、Import；
- [`src/core/session-manager.ts`](../packages/coding-agent/src/core/session-manager.ts)：JSONL Session 树；
- [`src/core/model-runtime.ts`](../packages/coding-agent/src/core/model-runtime.ts)：模型和凭据运行时。

### 2.2 `AgentSession` 是组装层

可以将 `AgentSession` 看成 `Agent` 的应用适配器：

```text
Session 文件 / Settings / ModelRuntime / Resources
                     |
                     v
                AgentSession
                     |
          +----------+----------+
          |                     |
          v                     v
      Agent                 ExtensionRunner
  Agent Loop / Tool        hook / command / UI
          |
          v
  TUI / Print / JSON / RPC
```

它通常负责：

1. 读取和写入当前 Session；
2. 为 `Agent` 准备 system prompt、context files、skills 和 extensions；
3. 维护当前模型、思考级别、工具集合和 API key；
4. 把 Agent 事件持久化成 Session Entry；
5. 处理 overflow、compaction、retry 和 deferred response；
6. 把运行状态投影给 Interactive、Print 或 RPC。

因此遇到一个功能时，先判断它属于：

```text
通用控制流        -> packages/agent
应用策略/资源      -> packages/coding-agent
终端显示          -> packages/tui
```

### 2.3 运行模式

运行模式导出集中在 [`src/modes/index.ts`](../packages/coding-agent/src/modes/index.ts)：

| 模式 | 入口 | 作用 |
| --- | --- | --- |
| Interactive | [`interactive-mode.ts`](../packages/coding-agent/src/modes/interactive/interactive-mode.ts) | TUI 交互、输入、快捷键和实时显示 |
| Print | [`print-mode.ts`](../packages/coding-agent/src/modes/print-mode.ts) | 一次性执行并输出文本 |
| JSON | [`json-event.ts`](../packages/coding-agent/src/modes/json-event.ts) | 将 AgentSession 事件转换为机器可读 JSON |
| RPC | [`rpc-mode.ts`](../packages/coding-agent/src/modes/rpc/rpc-mode.ts) | 通过协议连接远端客户端 |

同一个 Agent Loop 可以被这些模式复用。差异在于事件如何消费、输入如何产生、运行结束如何报告，而不是重新实现模型调用。

### 2.4 Extension、Skill、Tool

- [`core/extensions/`](../packages/coding-agent/src/core/extensions/) 是代码级扩展系统，可注册命令、工具、事件和 UI。
- [`core/skills.ts`](../packages/coding-agent/src/core/skills.ts) 加载并格式化 Skill 内容，Skill 更接近 prompt 资源。
- [`core/tools/`](../packages/coding-agent/src/core/tools/) 定义编码 Agent 的 read、write、edit、grep、find、ls、bash 工具。
- [`core/messages.ts`](../packages/coding-agent/src/core/messages.ts) 负责应用消息投影到 LLM 上下文。

Extension 与 Tool 的关系可以这样看：

```text
Extension
  -> 注册 Tool / Command / Hook / UI
  -> AgentSession 收集注册结果
  -> Agent 看到 Tool 定义
  -> agent-loop 执行 Tool
  -> Extension 收到工具和生命周期事件
```

### 2.5 Trust、Settings、ModelRuntime

- [`core/trust-manager.ts`](../packages/coding-agent/src/core/trust-manager.ts) 决定当前项目资源是否可以被加载。它是应用安全边界，不等于模型鉴权。
- [`core/settings-manager.ts`](../packages/coding-agent/src/core/settings-manager.ts) 合并全局、项目和运行时设置。
- [`core/model-runtime.ts`](../packages/coding-agent/src/core/model-runtime.ts) 将模型目录、凭据和运行时覆盖组织起来。
- [`core/model-resolver.ts`](../packages/coding-agent/src/core/model-resolver.ts) 解析 CLI、配置和作用域中的模型选择。

常见误区是把“模型没有 API key”和“项目没有 Trust”当成同一种失败。前者属于 `pi-ai` 认证；后者属于 `coding-agent` 是否允许加载本地项目资源。

## 3. `packages/tui`：终端显示和输入层

### 3.1 职责边界

`packages/tui` 不知道 Agent 如何推理。它提供可组合的终端 UI 基础设施：

- Terminal 和 alternate screen；
- 组件树、布局和差分渲染；
- Editor、Input、SelectList、SettingsList；
- Markdown、代码高亮、图片和 ANSI；
- Keybinding、补全、Overlay 和滚动视图。

入口是 [`src/index.ts`](../packages/tui/src/index.ts)。它导出 TUI 核心接口、组件、键盘处理、终端能力和工具函数。

### 3.2 组件树和渲染

重点阅读 [`src/tui.ts`](../packages/tui/src/tui.ts) 和 [`src/layout.ts`](../packages/tui/src/layout.ts)：

```text
TUI
  -> root Component
       -> Container / VStack / HStack / Box
            -> Text / Markdown / Editor / Loader / SelectList
  -> render lines
  -> 与上次 frame 做差分
  -> 写入 Terminal
```

组件主要返回或生成可渲染行，容器负责布局和尺寸分配。TUI 的性能重点是减少终端写入，而不是减少 Agent 事件。

### 3.3 输入链路

```text
stdin bytes
  -> StdinBuffer
  -> keys.parseKey / Kitty protocol
  -> TUI input listener
  -> Editor / 当前焦点组件
  -> coding-agent InteractiveMode
```

相关源码：[`stdin-buffer.ts`](../packages/tui/src/stdin-buffer.ts)、[`keys.ts`](../packages/tui/src/keys.ts)、[`keybindings.ts`](../packages/tui/src/keybindings.ts)、[`components/editor.ts`](../packages/tui/src/components/editor.ts)。

快捷键应该通过 Keybindings 配置解析，不应在上层硬编码控制字符。这样用户设置和平台差异可以保留。

## 4. `packages/protocol`：跨进程数据边界

### 4.1 三层结构

入口是 [`src/index.ts`](../packages/protocol/src/index.ts)。协议分三层：

```text
schemas.ts
  ClientMessage / ServerMessage / Command / Event / Snapshot
      |
      v
codec.ts
  schema 校验 + CBOR 编解码
      |
      v
framing.ts
  4 字节大端长度 + 增量分帧
```

`protocol` 不负责创建 Session，也不负责执行 Agent。它只定义网络两端必须共同理解的稳定数据格式。

### 4.2 Frame 与 Codec 的区别

[`framing.ts`](../packages/protocol/src/framing.ts) 只处理字节流：

```text
payload bytes
  -> [4-byte unsigned big-endian length][payload]
```

网络传输可能把一个 frame 拆成多次 chunk，也可能一次带来多个 frame。`FrameDecoder.push()` 负责增量组装。

[`codec.ts`](../packages/protocol/src/codec.ts) 再处理语义：

```text
unknown value
  -> JSON-like value 检查
  -> TypeBox schema 检查
  -> CBOR
  -> frame
```

解码顺序相反。任何 frame 或消息失败后，decoder 会进入失败状态，不继续把后续字节当成可信输入。

### 4.3 Protocol 是防腐层

[`src/protocol.ts`（server 侧投影）](../packages/server/src/protocol.ts) 明确把 `pi-ai` 的内部消息转换成协议模型：

- 去掉 Provider 内部字段；
- 将 tool call 和 tool result 转为 transcript item；
- 将 Usage、Model、Thinking Level 限制为协议支持的字段；
- 将 details 清洗为可序列化 JSON；
- 对错误和 stop reason 做稳定映射。

这保证了 SDK/Provider 内部演进不会直接破坏客户端协议。

## 5. `packages/client`：面向应用的 RPC 客户端

### 5.1 客户端分层

```text
PiClient
  -> Connection
       -> ByteTransport
            -> protocol frames
  -> ClientState
       -> server snapshot / session event
  -> SessionHandle
       -> attach / prompt / steer / abort / set model
```

入口是 [`src/index.ts`](../packages/client/src/index.ts)，主要实现位于 [`client.ts`](../packages/client/src/client.ts) 和 [`connection.ts`](../packages/client/src/connection.ts)。

### 5.2 Connection 只管物理连接

[`Connection`](../packages/client/src/connection.ts) 的状态是：

```text
disconnected -> connecting -> connected -> disconnected
```

它负责：

1. 打开 ByteTransport；
2. 发送 hello；
3. 校验 server hello；
4. 将任意 chunk 交给 `ServerMessageDecoder`；
5. 将完整消息交给 PiClient；
6. 处理关闭、协议错误和迟到事件。

它不理解 Session lease、prompt 或模型。这样重连、换传输实现时不会侵入业务层。

### 5.3 PiClient 和 Session Lease

[`PiClient`](../packages/client/src/client.ts) 负责：

- 为 request 分配 id，并匹配 response；
- 维护服务端 snapshot 和 event；
- attach/create Session；
- 管理 shared/exclusive lease；
- 断线时拒绝 pending request；
- Session 被服务端删除或 detach 后使 handle 失效；
- 在释放失败时保留 cleanup 状态，下一次 acquire 时协调。

[`SessionHandle`](../packages/client/src/session-handle.ts) 是一个受 lease 保护的窄接口。调用方不直接操作底层 Connection，而是通过 handle 调用 prompt、steer、abort 和 setModel。

## 6. `packages/server`：远程 Session 服务

### 6.1 Server 的三层责任

入口是 [`src/index.ts`](../packages/server/src/index.ts)，核心对象是 [`PiServer`](../packages/server/src/server.ts)：

```text
ByteConnection
  -> PiServer.accept
       -> ClientMessageDecoder
       -> hello/version handshake
       -> Command dispatch
            -> LiveSessionManager
                 -> PiServerService
                      -> 具体 AgentSession runtime
```

三层职责分别是：

- `PiServer`：监听器、连接、握手、frame、协议错误、关闭；
- `LiveSessionManager`：live session、attach、运行中的 operation、快照广播和释放；
- `PiServerService`：由应用注入的实际 Session 创建和运行逻辑。

### 6.2 Handshake 和请求顺序

服务端要求第一个消息是 hello：

```text
client hello(version)
  -> 检查 protocol version
  -> 读取 server snapshot
  -> server hello(snapshot)
  -> connection ready
  -> 接收 command
```

在握手完成前到达的业务消息会等待握手结果；握手超时、版本不支持或首消息错误都会发送协议错误并关闭连接。源码见 [`server.ts`](../packages/server/src/server.ts) 的 `accept`、`dispatchMessage` 和 `finishHandshake`。

### 6.3 Live Session 生命周期

[`sessions.ts`](../packages/server/src/sessions.ts) 将运行时包装成 `LiveSession`：

```text
acquire session
  -> 打开 runtime
  -> 订阅 runtime event
  -> attach connection
  -> prompt / steer / abort
  -> broadcast snapshot / progress
  -> 无连接、无 operation 且 runtime idle
  -> dispose runtime
```

`openingSessions` 防止同一个 Session 被并发打开多次；`operationCount` 防止运行还未完成时释放；`connections` 决定快照和进度推送给哪些客户端。

## 7. `packages/telemetry`：可组合的观测抽象

### 7.1 API 与 schema

入口是 [`src/index.ts`](../packages/telemetry/src/index.ts)。核心概念：

- `TelemetryContext.startSpan()`：创建一个 span 并在 callback 中使用；
- `TelemetrySpan.startSpan()`：创建 child span；
- `addEvent()`：追加过程事件；
- `setAttributes()`：补充结束属性；
- `setStatus()`：显式标记成功或失败。

Schema 可以描述 span 名称、父子关系、必需属性、可选属性、类型、取值集合和敏感性。`createTypedSpanStarter()` 将 schema 转成编译期约束，但不在运行时执行完整 schema 校验。

### 7.2 为什么需要 vendor-neutral

`ai`、`agent` 和 `coding-agent` 不应直接依赖某个厂商 SDK。它们只记录：

```text
pi.ai.request
pi.agent / pi.harness run
tool / hook / compaction / session.write
```

真正的导出目标由外部注入 `TelemetryContext` 决定。测试可使用 [`InMemoryTelemetryContext`](../packages/telemetry/src/memory.ts)，生产环境可以接入其他后端。

Telemetry 是旁路能力：记录失败不能改变 Agent 的业务结果，正如 [`memory.ts`](../packages/telemetry/src/memory.ts) 中记录异常时尽量保持被观测代码继续执行。

## 8. `packages/session-backends/sqlite-node`：SQLite 持久化

### 8.1 依赖关系

入口是 [`src/index.ts`](../packages/session-backends/sqlite-node/src/index.ts)，它将 Node `DatabaseSync` 包装为 Agent Session 所需的数据库接口，再导出 SQLite Session backend。

```text
packages/agent SessionRepo / SessionStorage
              |
              v
sqlite-node repo
  -> schema migrations
  -> entries / records / lanes / branch tips
  -> facts / session stats / search index
  -> writer leases
              |
              v
        node:sqlite
```

### 8.2 为什么单独拆包

`packages/agent` 保持运行时抽象，不直接绑定 Node SQLite。这样：

- 浏览器或其他运行环境可以提供不同 Session backend；
- Agent 核心不会默认加载 Node 内置模块；
- SQLite 的事务、迁移、索引和 writer lease 可以独立演进。

值得继续阅读：

- [`sqlite/repo.ts`](../packages/session-backends/sqlite-node/src/sqlite/repo.ts)：组装数据库、迁移和各存储模块；
- [`sqlite/migrations.ts`](../packages/session-backends/sqlite-node/src/sqlite/migrations.ts)：版本升级；
- [`sqlite/storage/entries.ts`](../packages/session-backends/sqlite-node/src/sqlite/storage/entries.ts)：Entry 读写；
- [`sqlite/storage/records.ts`](../packages/session-backends/sqlite-node/src/sqlite/storage/records.ts)：Record 读写；
- [`sqlite/storage/writer-leases.ts`](../packages/session-backends/sqlite-node/src/sqlite/storage/writer-leases.ts)：单写者协调。

## 9. `packages/evals`：可重复验证层

入口之一是 [`src/pi-harness.ts`](../packages/evals/src/pi-harness.ts)。它把 coding-agent 的 Session/Model 服务包装成评测 Harness，用可控输入检查：

- prompt 到最终 assistant message 的结果；
- tool call 和 tool result 顺序；
- Session snapshot 和持久化状态；
- reload、compaction、extension 行为；
- 失败、取消和恢复语义。

评测不应依赖真实 Provider。理想路径是：

```text
faux provider / deterministic stream
  -> coding-agent service
  -> AgentSession / Agent Loop
  -> transcript / snapshot / artifacts
  -> eval assertion
```

相关文件：

- [`src/smoke.eval.ts`](../packages/evals/src/smoke.eval.ts)：基础运行验证；
- [`src/extensions.eval.ts`](../packages/evals/src/extensions.eval.ts)：Extension 行为；
- [`src/vitest-evals/`](../packages/evals/src/vitest-evals)：评测适配、报告和 artifacts。

评测层的价值是把“看起来合理的事件顺序”变成可回归的契约，特别适合验证 Agent Loop、Session 和 RPC 的边界。

## 10. `packages/web-ui`：浏览器应用层

### 10.1 浏览器不重新实现 Agent Loop

Web UI 的浏览器代码通过 HTTP API、SSE 和 Server 端 Session 交互。关键适配文件：

- [`lib/agent-client.ts`](../packages/web-ui/lib/agent-client.ts)：向 `/api/agent/[id]` 发送命令；
- [`lib/agent-event-stream.ts`](../packages/web-ui/lib/agent-event-stream.ts)：建立事件流、发送 connected 和 snapshot 补齐；
- [`lib/agent-event-wire.ts`](../packages/web-ui/lib/agent-event-wire.ts)：服务端事件到客户端事件的投影；
- [`hooks/useAgentSession.ts`](../packages/web-ui/hooks/useAgentSession.ts)：React 状态、消息、队列、模型和滚动管理。

浏览器侧链路：

```text
React action
  -> agent-client POST command
  -> Server / AgentSession
  -> SSE agent event
  -> agent-event-stream
  -> agent-event-wire
  -> useAgentSession state
  -> Chat / Tool / Status components
```

浏览器只维护显示状态和用户输入，不负责模型鉴权、工具执行或 Session 写入。

### 10.2 Snapshot 与增量事件

单纯只消费增量事件会产生竞态：浏览器打开 SSE 时，服务端可能已经产生了事件。`agent-event-stream.ts` 先等待 Session ready 和 listener 安装，再发送连接状态和 snapshot/事件补齐，避免 UI 只看到半个 assistant message。

可以把它理解为：

```text
安装监听器
  -> 捕获期间事件
  -> 读取当前 snapshot
  -> 发送 connected + snapshot
  -> 按 snapshot 过滤已包含事件
  -> 开始转发后续增量事件
```

这与 `packages/agent` 中“先更新内部 state，再通知 listener”的原则类似，都是为了避免观察者看到不一致的中间状态。

### 10.3 Next.js 生成文件

`packages/web-ui/.next/` 是构建/开发生成目录，不是理解架构的源码入口。若仓库检查扫描到其中的生成 TypeScript 文件，应先确认检查脚本是否需要排除生成目录，不要把生成文件当作业务源码修改。

## 11. 一次完整的本地 CLI 请求

以 `pi -p "读取配置"` 为例：

```text
coding-agent cli.ts
  -> main.ts
  -> Settings / Trust / Credential / ModelRuntime
  -> SessionManager 打开 Session
  -> AgentSessionRuntime 创建 AgentSession
  -> 加载 system prompt / skills / extensions
  -> 注册 coding tools
  -> Agent.prompt
  -> packages/agent agent-loop
  -> packages/ai Models.streamSimple
  -> Provider / Api adapter / LLM
  -> Assistant toolCall(read)
  -> coding-agent tool wrapper
  -> packages/agent beforeToolCall / execute / afterToolCall
  -> AgentSession 持久化 assistant / tool result
  -> Print 或 Interactive 消费事件
```

## 12. 一次完整的远程 RPC 请求

```text
Web UI / PiClient
  -> protocol Command
  -> CBOR encode
  -> 4-byte frame
  -> ByteTransport
  -> PiServer
  -> ClientMessageDecoder
  -> LiveSessionManager
  -> PiServerService / AgentSession
  -> Agent Loop
  -> Session snapshot / progress event
  -> ServerMessage
  -> protocol encode
  -> Client Connection
  -> ClientState / SSE / React state
```

本链路中各层的边界是：

| 问题 | 负责包 |
| --- | --- |
| 不同 Provider 如何请求 | `ai` |
| Tool Call 如何循环 | `agent` |
| 文件工具和 Extension 如何组织 | `coding-agent` |
| 终端如何显示 | `tui` |
| 跨进程消息长什么样 | `protocol` |
| 客户端如何保留 lease 和 pending request | `client` |
| 服务端如何管理 live Session | `server` |
| Session 如何落 SQLite | `session-backends/sqlite-node` |
| 观测如何记录 | `telemetry` |
| 浏览器如何显示远端状态 | `web-ui` |
| 行为如何回归验证 | `evals` |

## 13. 推荐跨包阅读顺序

### 第一阶段：从一次请求出发

1. [`packages/ai/src/types.ts`](../packages/ai/src/types.ts)
2. [`packages/agent/src/types.ts`](../packages/agent/src/types.ts)
3. [`packages/agent/src/agent-loop.ts`](../packages/agent/src/agent-loop.ts)
4. [`packages/coding-agent/src/core/agent-session.ts`](../packages/coding-agent/src/core/agent-session.ts)
5. [`packages/coding-agent/src/main.ts`](../packages/coding-agent/src/main.ts)

### 第二阶段：看应用输出

1. [`packages/coding-agent/src/modes/index.ts`](../packages/coding-agent/src/modes/index.ts)
2. [`packages/tui/src/index.ts`](../packages/tui/src/index.ts)
3. [`packages/tui/src/tui.ts`](../packages/tui/src/tui.ts)
4. [`packages/coding-agent/src/modes/interactive/interactive-mode.ts`](../packages/coding-agent/src/modes/interactive/interactive-mode.ts)

### 第三阶段：看远程边界

1. [`packages/protocol/src/schemas.ts`](../packages/protocol/src/schemas.ts)
2. [`packages/protocol/src/codec.ts`](../packages/protocol/src/codec.ts)
3. [`packages/protocol/src/framing.ts`](../packages/protocol/src/framing.ts)
4. [`packages/server/src/server.ts`](../packages/server/src/server.ts)
5. [`packages/server/src/sessions.ts`](../packages/server/src/sessions.ts)
6. [`packages/client/src/connection.ts`](../packages/client/src/connection.ts)
7. [`packages/client/src/client.ts`](../packages/client/src/client.ts)

### 第四阶段：看持久化和质量保障

1. [`packages/agent/src/harness/session/types.ts`](../packages/agent/src/harness/session/types.ts)
2. [`packages/session-backends/sqlite-node/src/sqlite/repo.ts`](../packages/session-backends/sqlite-node/src/sqlite/repo.ts)
3. [`packages/agent/src/harness/reducer.ts`](../packages/agent/src/harness/reducer.ts)
4. [`packages/telemetry/src/index.ts`](../packages/telemetry/src/index.ts)
5. [`packages/evals/src/pi-harness.ts`](../packages/evals/src/pi-harness.ts)
6. [`packages/web-ui/lib/agent-event-stream.ts`](../packages/web-ui/lib/agent-event-stream.ts)

## 14. 当前新增中文注释的位置

本次在其他包中优先增加的是架构边界注释，而不是给每个简单 re-export 加重复说明：

| 包 | 注释文件 | 注释重点 |
| --- | --- | --- |
| coding-agent | [`src/index.ts`](../packages/coding-agent/src/index.ts)、[`src/modes/index.ts`](../packages/coding-agent/src/modes/index.ts) | 应用宿主和运行模式分工 |
| tui | [`src/index.ts`](../packages/tui/src/index.ts) | TUI 与 Agent/Session 的边界 |
| protocol | [`src/index.ts`](../packages/protocol/src/index.ts)、[`src/framing.ts`](../packages/protocol/src/framing.ts)、[`src/codec.ts`](../packages/protocol/src/codec.ts) | frame、codec、schema 三层 |
| client | [`src/index.ts`](../packages/client/src/index.ts)、[`src/client.ts`](../packages/client/src/client.ts)、[`src/connection.ts`](../packages/client/src/connection.ts) | 连接、请求、lease 和状态 |
| server | [`src/index.ts`](../packages/server/src/index.ts)、[`src/server.ts`](../packages/server/src/server.ts)、[`src/sessions.ts`](../packages/server/src/sessions.ts)、[`src/protocol.ts`](../packages/server/src/protocol.ts) | 握手、live session 和协议投影 |
| telemetry | [`src/index.ts`](../packages/telemetry/src/index.ts) | 旁路观测和 schema 类型 |
| SQLite backend | [`src/index.ts`](../packages/session-backends/sqlite-node/src/index.ts) | Agent 存储抽象到 Node SQLite |
| evals | [`src/pi-harness.ts`](../packages/evals/src/pi-harness.ts) | 可控运行时评测 |
| web-ui | [`lib/agent-client.ts`](../packages/web-ui/lib/agent-client.ts)、[`lib/agent-event-stream.ts`](../packages/web-ui/lib/agent-event-stream.ts) | 浏览器命令和事件同步 |

`packages/agent` 的注释和详细笔记仍集中在 [`03-package-agent.md`](./03-package-agent.md)，避免把低层循环说明分散到应用层文件中。
