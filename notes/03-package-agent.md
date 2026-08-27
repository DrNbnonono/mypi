# `packages/agent` 阅读笔记

> 本笔记的目标不是罗列所有导出，而是建立阅读 `packages/agent` 时所需的心智模型：
> `pi-ai` 负责“如何请求模型”，`packages/agent` 负责“如何围绕模型持续运行、执行工具、维护上下文和保存会话”。
> 文中的源码链接均从本文件所在的 `notes/` 目录出发，点击后可回到对应源码文件。

## 1. 先建立整体定位

### 1.1 `agent` 与 `ai` 的职责边界

阅读本包前，建议先看 `pi-ai` 的几个中文注释：

- [`pi-ai` 类型定义：Api、Provider、Model、Context](../packages/ai/src/types.ts)
- [`pi-ai` Models：模型目录与请求入口](../packages/ai/src/models.ts)
- [`pi-ai` 消息转换：目标 API 能力决定消息如何改写](../packages/ai/src/api/transform-messages.ts)
- [`pi-ai` 兼容入口：旧的全局 API 注册方式](../packages/ai/src/compat.ts)
- [`pi-ai` 事件流：统一的异步事件队列](../packages/ai/src/utils/event-stream.ts)
- [`pi-ai` overflow：识别上下文溢出，不负责上层恢复](../packages/ai/src/utils/overflow.ts)

可以把两层职责简化为：

```text
用户输入 / AgentMessage
        |
        v
packages/agent: Agent / agent-loop
  - 维护 transcript
  - 决定何时请求下一轮
  - 执行 Tool Call
  - 处理 steering / follow-up
  - 产生生命周期事件
        |
        | StreamFn(model, Context, options)
        v
packages/ai: Models / Provider / Api adapter
  - 解析模型和 Provider
  - 解析 apiKey、OAuth、baseUrl
  - 把统一 Context 转成上游协议
  - 把上游响应转成 AssistantMessageEventStream
        |
        v
LLM Provider
```

重要区分：

- `Api` 是上游协议适配器，例如 OpenAI Completions、Anthropic Messages；它不是 Agent。
- `Provider` 是模型、认证和 API 选择的运行时入口；它也不是模型集合。
- `Models` 负责找到模型并调用 Provider；`agent` 通过 `StreamFn` 使用这个能力，但不直接处理 OpenAI 或 Anthropic 协议。
- `EventStream` 只是异步事件容器。`agent-loop` 在它之上定义 Agent 生命周期事件、回合和工具执行语义。

### 1.2 包的核心问题

一个单次 LLM 请求并不等于一个 Agent。真实 Agent 至少需要处理：

1. 把用户消息、模型消息、工具结果组织成下一次请求的上下文。
2. 模型返回 Tool Call 后，找到工具、校验参数、执行副作用、把结果送回模型。
3. 在流式响应期间对 UI 暴露状态变化。
4. 在运行中接收 steering，在本轮本应结束后接收 follow-up。
5. 处理取消、失败、重试、上下文压缩、会话持久化和恢复。

`packages/agent` 正是围绕这些问题组织的运行时层。

## 2. 目录地图

入口文件是 [`src/index.ts`](../packages/agent/src/index.ts)。它把低层 loop、`Agent`、Harness、Session、Compaction、工具、搜索、代理流和类型统一导出。

| 目录/文件 | 主要职责 | 阅读入口 |
| --- | --- | --- |
| `src/types.ts` | Agent 的类型契约：消息、上下文、工具、配置、事件 | [`types.ts`](../packages/agent/src/types.ts) |
| `src/agent-loop.ts` | 一次运行的控制流：LLM → Tool → LLM | [`agent-loop.ts`](../packages/agent/src/agent-loop.ts) |
| `src/agent.ts` | 有状态的 Agent 外壳，持有 transcript 和队列 | [`agent.ts`](../packages/agent/src/agent.ts) |
| `src/stream-fn.ts` | 默认 `StreamFn` 注册点 | [`stream-fn.ts`](../packages/agent/src/stream-fn.ts) |
| `src/proxy.ts` | 通过服务端转发流式模型请求 | [`proxy.ts`](../packages/agent/src/proxy.ts) |
| `src/harness/` | 面向持久化会话、lane、压缩、恢复的更高层协议 | [`harness/agent-harness.ts`](../packages/agent/src/harness/agent-harness.ts) |
| `src/harness/session/` | 会话树、记录、存储接口和 JSONL/内存实现 | [`session/types.ts`](../packages/agent/src/harness/session/types.ts) |
| `src/harness/compaction/` | 上下文估算、切点选择、摘要和文件操作记录 | [`compaction.ts`](../packages/agent/src/harness/compaction/compaction.ts) |
| `src/harness/tools/` | bash、read、write、edit 等执行工具 | [`tools/index.ts`](../packages/agent/src/harness/tools/index.ts) |
| `src/harness/env/` | 执行环境抽象和 Node.js 文件/进程实现 | [`env/nodejs.ts`](../packages/agent/src/harness/env/nodejs.ts) |
| `src/harness/reducer.ts` | 根据持久化记录重建 lane 有效状态 | [`reducer.ts`](../packages/agent/src/harness/reducer.ts) |
| `src/harness/telemetry.ts` | AI、Harness、Session 的遥测 schema 和 span | [`telemetry.ts`](../packages/agent/src/harness/telemetry.ts) |
| `src/search/` | 对会话条目提供可取消的异步搜索 | [`search/index.ts`](../packages/agent/src/search/index.ts) |

包的设计可以分为两条线：

```text
实时运行线：types -> agent-loop -> Agent
持久化运行线：session types -> reducer -> Harness
                         ^          |
                         |          v
                    compaction / navigation / recovery
```

第一条线适合先理解 Agent 如何调用模型和工具；第二条线适合在理解单次运行之后，再研究如何把运行变成可恢复的持久化操作。

## 3. 第一阅读入口：`types.ts`

### 3.1 `StreamFn`：Agent 与 `pi-ai` 的唯一主要运行边界

源码：[ `StreamFn`，约第 30 行](../packages/agent/src/types.ts#L30)

```ts
type StreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;
```

它表达了一个关键设计：Agent 不需要知道具体 Provider 的请求格式，只需要：

- 给出当前 `Model`；
- 给出 `Context`，其中包含 system prompt、LLM Message 和 tools；
- 读取统一的 `AssistantMessageEventStream`。

默认情况下，调用方可以传入 `models.streamSimple.bind(models)`。如果使用服务端代理，也可以传入 [`streamProxy`](../packages/agent/src/proxy.ts)。只要两者满足同一个 `StreamFn` 契约，Agent Loop 的控制流无需变化。

### 3.2 `AgentMessage` 与 `Message`

源码：[ `AgentMessage` 和 `CustomAgentMessages`](../packages/agent/src/types.ts#L330)

`AgentMessage` 是 Agent 内部保存的消息类型，除了标准的：

- `user`
- `assistant`
- `toolResult`

还可以通过声明合并加入应用自己的消息，例如本包在 [`harness/messages.ts`](../packages/agent/src/harness/messages.ts) 中加入了：

- `bashExecution`
- `custom`
- `branchSummary`
- `compactionSummary`

但上游 LLM 通常只理解标准消息。因此每次模型请求前都会经过：

```text
AgentMessage[]
    -> transformContext（可选：裁剪/注入上下文）
AgentMessage[]
    -> convertToLlm（必需：过滤或转换自定义消息）
Message[]
    -> StreamFn / pi-ai
```

这不是简单的数据复制，而是两个不同的扩展点：

- `transformContext` 改变“本次请求看见哪些 Agent 消息”。
- `convertToLlm` 改变“这些 Agent 消息如何表达为模型消息”。

### 3.3 `AgentContext`、`AgentState` 和 `AgentLoopConfig`

- [`AgentContext`](../packages/agent/src/types.ts#L435) 是一次低层 Loop 使用的最小输入：system prompt、消息和工具。
- [`AgentState`](../packages/agent/src/types.ts#L350) 是有状态 Agent 对外暴露的运行状态：当前模型、消息、是否流式、正在执行的 Tool Call 等。
- [`AgentLoopConfig`](../packages/agent/src/types.ts#L157) 是低层 Loop 的行为配置：消息转换、动态 API key、队列读取、工具 hook、回合结束策略和工具并发模式。

可以这样区分：

```text
Agent.state          = 长期持有的可观察状态
AgentContext         = 某次 loop 的上下文快照
AgentLoopConfig      = 某次 loop 的行为依赖和策略
```

### 3.4 `AgentTool`：副作用的受控边界

源码：[ `AgentTool`](../packages/agent/src/types.ts#L404)

模型只能提出一个 Tool Call，真正执行要经过：

```text
assistant toolCall
  -> 找到工具
  -> prepareArguments（可选）
  -> validateToolArguments
  -> beforeToolCall（可阻止）
  -> execute
  -> afterToolCall（可修改结果）
  -> ToolResultMessage
```

`execute` 是副作用发生的位置。工具可以通过 `executionMode: "sequential"` 声明自己不能与同一批次的其他工具并发执行。

## 4. `agent-loop.ts`：真正的 Agent Loop

### 4.1 三个公开函数

- [`agentLoop`](../packages/agent/src/agent-loop.ts#L31)：带新 prompt 启动运行。
- [`agentLoopContinue`](../packages/agent/src/agent-loop.ts#L66)：复用已有上下文继续请求，不能从 assistant 结尾直接重复继续。
- [`runAgentLoop` / `runAgentLoopContinue`](../packages/agent/src/agent-loop.ts#L91)：异步执行版本，通过 `emit` 接收事件。

前两个函数返回 `EventStream<AgentEvent, AgentMessage[]>`。调用它们会创建事件流并异步启动运行；流结束时，最终值是本次运行新增的消息。

### 4.2 外层循环和内层循环

核心函数是 [`runLoop`](../packages/agent/src/agent-loop.ts#L159)。它有两层循环：

```text
外层循环：处理 follow-up
  内层循环：
    注入 steering
    请求 assistant
    如果有 Tool Call，执行工具
    写入 Tool Result
    判断是否停止
  Agent 本来要结束时，读取 follow-up
```

为什么要分两层：

- steering 是对当前运行的即时干预，应该在下一次 assistant 请求前进入内层循环。
- follow-up 是“如果 Agent 正常结束后还有新任务，再开一轮”，因此要在内层循环结束后由外层检查。

### 4.3 一次普通文本请求

以 `await agent.prompt("你好")` 为例：

```text
Agent.prompt
  -> normalizePromptInput
  -> runWithLifecycle
  -> runAgentLoop
  -> agent_start
  -> turn_start
  -> message_start/end(user)
  -> streamAssistantResponse
       -> transformContext
       -> convertToLlm
       -> streamFunction(model, context, options)
       -> message_start/update/end(assistant)
  -> turn_end
  -> 检查 steering / follow-up
  -> agent_end
  -> Agent.processEvents 折叠状态
```

`streamAssistantResponse` 是 Agent 和 `pi-ai` 最重要的交界点，源码在 [`agent-loop.ts`](../packages/agent/src/agent-loop.ts#L287)。它负责把内部消息转成 LLM 消息，也负责把 `pi-ai` 的流式事件变成 Agent 的 `message_start`、`message_update` 和 `message_end`。

### 4.4 一次带工具调用的请求

```text
assistant message(toolCall)
  -> tool_execution_start
  -> prepareToolCall
       -> 查找工具
       -> 参数预处理
       -> schema 校验
       -> beforeToolCall
  -> execute
       -> tool_execution_update（工具有流式输出时）
  -> afterToolCall
  -> tool_execution_end
  -> message_start/end(toolResult)
  -> turn_end
  -> 下一轮 LLM 请求，把 toolResult 放回 Context
```

相关源码：

- [`prepareToolCall`](../packages/agent/src/agent-loop.ts#L614)
- [`executeToolCalls`](../packages/agent/src/agent-loop.ts#L421)
- [`executeToolCallsParallel`](../packages/agent/src/agent-loop.ts#L501)

并行模式有一个容易忽略的顺序规则：

- 工具准备按 assistant 调用顺序执行；
- 允许执行的工具可以并发；
- `tool_execution_end` 按工具完成顺序发出；
- 最终 `ToolResultMessage` 按 assistant 原始调用顺序写入上下文。

这样 UI 可以及时看到先完成的工具，同时模型仍收到稳定、可复现的结果顺序。

### 4.5 截断和终止策略

如果 assistant 的 `stopReason` 是 `length`，工具参数可能只是“看起来可解析”的残缺 JSON。源码 [`failToolCallsFromTruncatedMessage`](../packages/agent/src/agent-loop.ts#L389) 会把所有工具调用转成错误结果，不执行任何副作用，让模型下一轮重新生成完整调用。

工具、`beforeToolCall` 和 `afterToolCall` 都可以返回 `terminate: true`。但一个批次只有在所有已完成结果都要求终止时才会提前结束，避免并行批次中一个工具的意图错误地阻断其他工具。

## 5. `agent.ts`：低层 Loop 的有状态封装

源码入口：[ `Agent` 类](../packages/agent/src/agent.ts#L182)

### 5.1 `Agent` 持有什么

```text
_state
  - systemPrompt
  - model / thinkingLevel
  - tools
  - messages（transcript）
  - isStreaming / streamingMessage
  - pendingToolCalls / errorMessage

steeringQueue
followUpQueue
listeners
activeRun
streamFunction
hooks / context transform / apiKey resolver
```

低层 `agent-loop` 每次只接收一个上下文并执行一次运行；`Agent` 负责把多次运行串起来，因此它才是常规应用更适合直接持有的对象。

### 5.2 `prompt()`、`continue()`、`steer()`、`followUp()`

- [`prompt`](../packages/agent/src/agent.ts#L362) 开始一个新的运行，并把新消息放到本次运行的 `newMessages` 中。
- [`continue`](../packages/agent/src/agent.ts#L374) 不添加新用户消息，从当前最后一个 `user` 或 `toolResult` 消息继续请求；常用于错误后的重试。
- [`steer`](../packages/agent/src/agent.ts#L303) 将消息放入当前运行下一轮请求之前。
- [`followUp`](../packages/agent/src/agent.ts#L308) 将消息放入 Agent 原本准备停止之后的下一轮。

当 Agent 正在运行时再次调用 `prompt` 或 `continue` 会被拒绝。此时应使用 `steer` 或 `followUp`，这也是 `activeRun` 并发闸门的意义。

队列模式默认为 `one-at-a-time`，也可以设为 `all`。对应实现是 [`PendingMessageQueue`](../packages/agent/src/agent.ts#L132)。

### 5.3 状态快照和事件折叠

[`createContextSnapshot`](../packages/agent/src/agent.ts#L452) 复制顶层消息、工具数组，然后交给低层 loop。Loop 会在自己的上下文中追加消息，事件再由 [`processEvents`](../packages/agent/src/agent.ts#L564) 折叠回 Agent 状态。

因此监听器看到的顺序是：

```text
收到 event
  -> Agent 先更新内部 state
  -> 再按注册顺序 await listeners
```

`agent_end` 表示 loop 不会再发事件，但监听器仍属于这次运行；只有 `agent_end` 的监听器完成，`waitForIdle()` 和 `prompt()` 才真正结束。

### 5.4 动态配置

[`createLoopConfig`](../packages/agent/src/agent.ts#L462) 把 Agent 的当前状态转成低层 Loop 配置，并通过闭包接回：

- steering / follow-up 队列；
- `beforeToolCall`、`afterToolCall`；
- `shouldStopAfterTurn`、`prepareNextTurn`；
- 每次请求动态解析的 API key。

这意味着应用可以在一个 Agent 实例上改变模型、工具、思考级别和策略，而低层 Loop 仍然只依赖当前这次配置。

## 6. Harness：从“运行一次”到“持久化操作”

### 6.1 Harness 的定位

[`AgentHarness`](../packages/agent/src/harness/agent-harness.ts#L308) 是比 `Agent` 更高的一层协议。它希望把以下能力统一到一个 `AgentLane`：

- prompt、skill、prompt template；
- steering、follow-up、nextRun 队列；
- compact、navigateTree、resume；
- 模型、思考级别、工具配置；
- action、watch、telemetry；
- session 持久化和崩溃恢复。

`lane` 可以理解为一条会话分支上的单写者执行通道。`Session` 保存历史，`Harness` 驱动当前操作，`reducer` 从 durable records 推导当前有效状态。

### 6.2 当前代码的重要现实状态

当前 [`AgentHarness.create`](../packages/agent/src/harness/agent-harness.ts#L352) 如果发现已有 record，会以 `HarnessNotImplemented("create.restore")` 拒绝恢复；`prompt`、`compact`、`resume`、队列操作、watch 等多个公共方法也仍会通过 [`unavailable`](../packages/agent/src/harness/agent-harness.ts#L362) 返回 `HarnessNotImplemented`。

因此阅读时要区分：

```text
AgentLane 接口：描述目标中的完整能力
AgentHarness 当前实现：先完成类型、配置和 Session 连接，部分驱动尚未接入
```

这不是调用方式上的小差异，而是当前项目状态的关键结论。不要仅凭接口声明推断 Harness 已经能够驱动完整 Agent Loop。

### 6.3 Result 和拒绝错误

Harness 使用 [`result.ts`](../packages/agent/src/harness/result.ts) 中的 `Result` 和带标签的错误类型，区分：

- 操作被拒绝，例如 `LaneBusy`、`InvalidMessage`、`NothingToCompact`；
- 操作运行失败，例如 `RunOutcome.kind === "failed"`；
- 操作正常完成，例如 `RunOutcome.kind === "completed"`；
- 操作暂停等待外部 Deferred，例如 `RunOutcome.kind === "suspended"`。

这种设计比所有路径直接 `throw Error` 更适合持久化操作，因为调用方可以根据稳定的 `kind` 和 error code 决定 UI、恢复或重试行为。

## 7. Session：会话树和持久化边界

### 7.1 `SessionStorage`、`Session`、`SessionTree`

先看类型：[ `session/types.ts`](../packages/agent/src/harness/session/types.ts)。

- `SessionStorage` 定义底层存储需要提供什么操作。
- `Session` 是存储无关的适配层，实现 `SessionTree`。
- `SessionTree` 是 Harness 和上层应用使用的只读/追加接口。
- [`memory.ts`](../packages/agent/src/harness/session/memory.ts) 提供内存实现，适合测试。
- [`jsonl/`](../packages/agent/src/harness/session/jsonl) 提供 JSONL 实现。
- [`testing/conformance.ts`](../packages/agent/src/harness/session/testing/conformance.ts) 用同一组契约测试验证不同后端。

Session 不是一条简单的线性数组，而是带 parent/leaf 的树：

```text
root
  |
  +-- user -> assistant -> toolResult
  |
  +-- branch A
  |
  +-- branch B
```

`view(lane)` 为某个 lane 提供分支视图，不复制整棵会话树。导航可以改变当前 leaf，分支摘要则把离开的分支压缩为可供模型理解的消息。

### 7.2 Entry 和 Record 的区别

`Entry` 是对话树中可被读取的内容，例如 message、compaction、branch summary、custom entry。

`LaneRecord` 是操作日志，例如：

- `operation_started` / `operation_finished`；
- step attempt；
- tool started；
- queue enqueued / cancelled；
- usage；
- deferred fetch 或写入状态。

可以用下面的关系理解：

```text
Entry  = 用户/模型最终看到或会话树需要保留的内容
Record = 驱动操作、崩溃恢复和审计所需的事实日志
```

### 7.3 JSON 持久化约束

[`assertJsonSerializable`](../packages/agent/src/harness/session/session.ts#L44) 会在写入 Entry 或 Record 前拒绝：

- 循环引用；
- `NaN`、`Infinity` 等非有限数字；
- 稀疏数组；
- 数组或对象上的访问器和不支持的属性；
- 非普通对象；
- symbol 属性。

原因是 durable 数据必须能被稳定地写入、读取和恢复，不能依赖 `JSON.stringify` 静默丢字段或改变结构。

## 8. Reducer：从日志重建有效状态

源码：[ `reducer.ts`](../packages/agent/src/harness/reducer.ts)

持久化恢复不能只读取最后一条消息，因为一个操作可能在任意步骤崩溃。例如：

```text
operation_started
  -> assistant step started
  -> tool_started
  -> 进程崩溃
```

Reducer 要判断当前状态是：

- 正常完成；
- 可恢复的未完成操作；
- 等待 Deferred；
- 存在不可解释的日志矛盾。

`RecordLogCorruption` 表示协议不可能产生的状态，例如多个 open operation、未知 operation、重复 tool invocation、tool call 与结果不匹配等。此类状态应拒绝恢复，不能随意“修复”后继续运行，否则会把持久化事实改写成猜测。

`LaneState` 中值得重点观察的字段：

- 当前 `leafId`；
- 当前 operation 的 kind/id/status；
- step 的类型和 attempt 次数；
- tool batch 是否存在未完成调用；
- pending steer/follow-up/nextRun；
- deferred handle；
- overflow recovery 是否已经使用。

## 9. Compaction：上下文压缩不是单纯截断字符串

源码：[ `compaction.ts`](../packages/agent/src/harness/compaction/compaction.ts)

### 9.1 触发判断

[`estimateContextTokens`](../packages/agent/src/harness/compaction/compaction.ts#L218) 优先使用最近一次 assistant 的真实 usage，再估算其后追加的消息。没有 usage 时，才对全部消息做启发式估算。

[`shouldCompact`](../packages/agent/src/harness/compaction/compaction.ts#L274) 的核心判断是：

```text
当前上下文 token > contextWindow - reserveTokens
```

`reserveTokens` 为摘要请求和摘要输出预留空间，`keepRecentTokens` 控制压缩后保留多少近期内容。

### 9.2 安全切点

[`findCutPoint`](../packages/agent/src/harness/compaction/compaction.ts#L378) 不会任意从消息中间截断，而是寻找合法边界。如果切点落在一个未完成 turn 中，会得到：

```text
messagesToSummarize  = 较早历史
turnPrefixMessages   = 当前大 turn 的前缀
retainedTail         = 最近内容/当前 turn 的后缀
```

当前 turn 的前缀需要单独摘要，否则保留下来的后缀可能只包含工具结果或 assistant 后半段，模型无法知道它属于哪个请求。

### 9.3 Preparation 与 LLM 摘要分离

- [`prepareCompaction`](../packages/agent/src/harness/compaction/compaction.ts#L624) 只进行确定性的边界计算、历史收集、文件操作收集，不调用模型。
- [`generateSummaryWithUsage`](../packages/agent/src/harness/compaction/compaction.ts#L535) 把待摘要消息转换为 LLM 消息并发起独立请求。
- [`compact`](../packages/agent/src/harness/compaction/compaction.ts#L717) 组合普通历史摘要、split-turn 前缀摘要、保留尾部和 usage，返回可持久化的数据。

摘要请求关闭 `cacheRetention`，使用独立 `sessionId`，避免摘要请求污染主对话的缓存链路。

### 9.4 文件操作信息

压缩不仅保留文本摘要，还通过 [`compaction/utils.ts`](../packages/agent/src/harness/compaction/utils.ts) 汇总历史中读取和修改过的文件。这样摘要后的上下文仍可以告诉后续模型：哪些文件已经看过，哪些文件已经发生修改。

## 10. Harness 中的辅助能力

### 10.1 消息转换和自定义消息

[`harness/messages.ts`](../packages/agent/src/harness/messages.ts) 将 bash 执行记录、普通 custom 消息、分支摘要和压缩摘要注册为 `AgentMessage` 扩展，并提供 `convertToLlm`。

这里可以具体看到“Agent 内部消息”和“模型消息”的差异：

- `bashExecution` 可以转成用户可读的文本，也可以通过 `excludeFromContext` 排除；
- `custom` 可以只显示给 UI，或转换为模型可读的 user message；
- `compactionSummary` 和 `branchSummary` 把持久化结构重新投影为模型可读上下文。

### 10.2 Skills 和 Prompt Templates

- [`skills.ts`](../packages/agent/src/harness/skills.ts) 递归加载 `SKILL.md`、解析 frontmatter、尊重 ignore 文件并返回 diagnostics。
- [`prompt-templates.ts`](../packages/agent/src/harness/prompt-templates.ts) 负责模板发现和参数替换。
- [`system-prompt.ts`](../packages/agent/src/harness/system-prompt.ts) 提供系统提示相关的拼装能力。

Skill 本身不是特殊的模型 API，而是被格式化为带路径和内容的 prompt。它的作用是把外部知识/操作规范注入 Agent 上下文。

### 10.3 执行环境和工具

`ExecutionEnv` 把文件系统、进程执行、目录遍历等能力抽象出来，Node.js 版本在 [`env/nodejs.ts`](../packages/agent/src/harness/env/nodejs.ts)。工具再依赖这个抽象：

- [`bash.ts`](../packages/agent/src/harness/tools/bash.ts)：执行命令并处理超时、取消和输出截断；
- [`read.ts`](../packages/agent/src/harness/tools/read.ts)：读取文件/目录，并处理图片和大文件；
- [`write.ts`](../packages/agent/src/harness/tools/write.ts)：写入文件；
- [`edit.ts`](../packages/agent/src/harness/tools/edit.ts)：基于 diff 或精确替换编辑文件；
- [`file-mutation-queue.ts`](../packages/agent/src/harness/tools/file-mutation-queue.ts)：串行化文件变更，降低并发写冲突。

### 10.4 Telemetry、Proxy 和 Search

- [`harness/telemetry.ts`](../packages/agent/src/harness/telemetry.ts) 定义 `pi.ai.request`、Harness run/step/tool/hook 等 span 的稳定 schema，具体导出到哪个厂商由外部 TelemetryContext 决定。
- [`proxy.ts`](../packages/agent/src/proxy.ts) 把模型请求序列化后发给服务端，再把服务端事件重建为本地 `AssistantMessageEventStream`；它改变请求路径，不改变 Agent Loop 语义。
- [`search/index.ts`](../packages/agent/src/search/index.ts) 定义可取消的异步会话搜索接口，扫描实现位于 [`search/scanning.ts`](../packages/agent/src/search/scanning.ts)。

## 11. 推荐阅读顺序

### 第一遍：只理解实时 Agent

1. [包入口](../packages/agent/src/index.ts)
2. [`types.ts`：读 `StreamFn`、`AgentMessage`、`AgentContext`、`AgentTool`、`AgentEvent`](../packages/agent/src/types.ts)
3. [`agent-loop.ts`：从 `runAgentLoop` 读到 `runLoop`](../packages/agent/src/agent-loop.ts#L91)
4. [`streamAssistantResponse`](../packages/agent/src/agent-loop.ts#L287)
5. [`executeToolCalls` 和 `prepareToolCall`](../packages/agent/src/agent-loop.ts#L421)
6. [`agent.ts`：再看 `Agent.prompt`、`continue` 和 `processEvents`](../packages/agent/src/agent.ts#L362)

第一遍的目标是能够回答：

> 用户输入后，消息如何到达 LLM？Tool Call 如何执行？Tool Result 如何回到下一轮？Agent 何时结束？

### 第二遍：理解持久化

1. [`harness/session/types.ts`](../packages/agent/src/harness/session/types.ts)
2. [`harness/session/session.ts`](../packages/agent/src/harness/session/session.ts)
3. [`harness/session/memory.ts`](../packages/agent/src/harness/session/memory.ts)
4. [`harness/session/jsonl/storage.ts`](../packages/agent/src/harness/session/jsonl/storage.ts)
5. [`harness/reducer.ts`](../packages/agent/src/harness/reducer.ts)
6. [`harness/agent-harness.ts`](../packages/agent/src/harness/agent-harness.ts)

第二遍的目标是理解：

> 一次运行如何记录成 Entry/Record？崩溃后如何从日志恢复？为什么需要 lane 和 reducer？

### 第三遍：理解压缩和应用能力

1. [`harness/compaction/compaction.ts`](../packages/agent/src/harness/compaction/compaction.ts)
2. [`harness/compaction/branch-summarization.ts`](../packages/agent/src/harness/compaction/branch-summarization.ts)
3. [`harness/messages.ts`](../packages/agent/src/harness/messages.ts)
4. [`harness/skills.ts`](../packages/agent/src/harness/skills.ts)
5. [`harness/tools/`](../packages/agent/src/harness/tools/index.ts)
6. [`harness/telemetry.ts`](../packages/agent/src/harness/telemetry.ts)

## 12. 一个完整的端到端示例

假设用户要求“读取 `config.json` 并说明内容”：

```text
1. Agent.prompt(text)
2. Agent 创建 activeRun 和 AbortController
3. agent-loop 发出 agent_start / turn_start
4. user AgentMessage 写入 currentContext
5. transformContext 处理上下文
6. convertToLlm 丢弃 UI-only 消息，生成 Message[]
7. StreamFn 通过 pi-ai 请求 Provider
8. pi-ai 返回 assistant toolCall(read, {path: "config.json"})
9. agent-loop 发出 message_end(assistant)
10. 查找 read 工具并校验 path
11. beforeToolCall 可在此阻止越权路径
12. read 工具经 ExecutionEnv 读取文件
13. 发出 tool_execution_end 和 toolResult Message
14. 下一轮请求带上 assistant toolCall + toolResult
15. 模型生成最终文本 assistant message
16. Agent 折叠所有事件，更新 state.messages
17. 没有 steering/follow-up 后发出 agent_end
18. Agent 等待 agent_end listeners 完成后变为 idle
```

如果运行在 Harness 中，还会多出一层：

```text
operation_started record
  -> assistant step / tool started records
  -> message entries / tool result entries
  -> operation_finished record
```

这样进程即使在第 12 步崩溃，也可以由 reducer 根据日志判断是可恢复的未完成工具调用，而不是只剩下一段无法解释的聊天文本。

## 13. 当前理解的关键结论

1. `agent-loop.ts` 是行为核心，`agent.ts` 是状态和生命周期外壳。
2. `types.ts` 中 `StreamFn`、`AgentMessage`、`AgentContext` 和 `AgentEvent` 是阅读全包时最重要的四组契约。
3. `transformContext` 与 `convertToLlm` 必须分开理解：前者调整 Agent 上下文，后者适配 LLM 消息。
4. 工具执行不是模型返回后直接调用函数，而是经过查找、参数准备、校验和 hook 的安全链。
5. 并行工具的事件完成顺序与持久化消息顺序不同，这是 UI 和上下文稳定性之间的明确折中。
6. `Session` 解决存储抽象，`reducer` 解决从日志恢复有效状态，`Harness` 解决如何驱动持久化操作。
7. Compaction 的重点是安全选择语义边界并保留足够上下文，而不是简单删除旧消息。
8. 当前 Harness 有完整的目标型接口，但多个操作仍是 `HarnessNotImplemented`；理解当前源码时必须把“设计协议”和“已接入实现”分开。

## 14. 建议下一步调试路径

如果要继续深入源码，建议按以下顺序设置断点或打印事件：

```text
Agent.prompt
  -> Agent.runPromptMessages
  -> runAgentLoop
  -> runLoop
  -> streamAssistantResponse
  -> executeToolCalls
  -> processEvents
```

观察以下数据最有价值：

- 每次 `streamAssistantResponse` 发送给 `convertToLlm` 的消息数量和最后一条消息角色；
- `currentContext.messages` 与 `Agent.state.messages` 的差异；
- `tool_execution_end` 的完成顺序与 `toolResult` 写回顺序；
- `steeringQueue`、`followUpQueue` 的 drain 时机；
- `agent_end` 发出时与 `waitForIdle()` 返回时的时间差；
- Harness 场景下 Entry 与 Record 的先后关系。

这些观察点能把“类型上看起来正确”的设计，连接到实际运行时行为。

完成本包后，可继续阅读 [其他 package 的跨层说明](./04-package-other-packages.md)，
了解 `coding-agent`、TUI、RPC、Server、SQLite 和 Web UI 如何接入这里的 Agent Runtime。
