# @earendil-works/pi-agent-core

有状态代理，支持工具执行和事件流。基于 `@earendil-works/pi-ai` 构建。

## 安装

```bash
npm install @earendil-works/pi-agent-core
```

### SQLite 会话后端

SQLite 会话后端及 `node:sqlite` 适配器位于独立包 `@earendil-works/pi-session-backend-sqlite-node` 中，这样核心包默认不会引入运行时内置模块或原生 SQLite 依赖。该后端接受一个运行时特定的 SQLite 工厂函数，未来其他会话后端也可以作为独立包发布。

## 快速开始

```typescript
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

const models = createModels();
models.setProvider(anthropicProvider());
const model = models.getModel("anthropic", "claude-sonnet-4-6");
if (!model) throw new Error("Model not found");

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a helpful assistant.",
    model,
  },
  streamFn: models.streamSimple.bind(models),
});

agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    // 仅输出新增的文本片段
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await agent.prompt("Hello!");
```

## 核心概念

### AgentMessage 与 LLM 消息的区别

代理使用 `AgentMessage` 类型，这是一种灵活的类型，可以包含：
- 标准 LLM 消息（`user`、`assistant`、`toolResult`）
- 通过声明合并（declaration merging）自定义的应用特定消息类型

LLM 只识别 `user`、`assistant` 和 `toolResult`。`convertToLlm` 函数负责在每次调用 LLM 前过滤和转换消息，弥补这一差距。

### 消息流程

```
AgentMessage[] → transformContext() → AgentMessage[] → convertToLlm() → Message[] → LLM
                    （可选）                           （必需）
```

1. **transformContext**：修剪旧消息，注入外部上下文
2. **convertToLlm**：过滤掉仅用于 UI 的消息，将自定义类型转换为 LLM 可识别的格式

## 事件流

代理会发出事件以更新 UI。理解事件顺序有助于构建响应式界面。

### prompt() 事件序列

当你调用 `prompt("Hello")` 时：

```
prompt("Hello")
├─ agent_start
├─ turn_start
├─ message_start   { message: userMessage }      // 你的提示词
├─ message_end     { message: userMessage }
├─ message_start   { message: assistantMessage } // LLM 开始响应
├─ message_update  { message: partial... }       // 流式输出的增量片段
├─ message_update  { message: partial... }
├─ message_end     { message: assistantMessage } // 完整响应
├─ turn_end        { message, toolResults: [] }
└─ agent_end       { messages: [...] }
```

### 带工具调用的情况

如果助手调用了工具，循环会继续：

```
prompt("Read config.json")
├─ agent_start
├─ turn_start
├─ message_start/end  { userMessage }
├─ message_start      { assistantMessage with toolCall }
├─ message_update...
├─ message_end        { assistantMessage }
├─ tool_execution_start  { toolCallId, toolName, args }
├─ tool_execution_update { partialResult }           // 如果工具有流式输出
├─ tool_execution_end    { toolCallId, result }
├─ message_start/end  { toolResultMessage }
├─ turn_end           { message, toolResults: [toolResult] }
│
├─ turn_start                                        // 下一轮
├─ message_start      { assistantMessage }           // LLM 对工具结果进行响应
├─ message_update...
├─ message_end
├─ turn_end
└─ agent_end
```

工具执行模式是可配置的：

- `parallel`（默认）：按顺序预检工具调用，并发执行允许的工具，每个工具完成时立即发出 `tool_execution_end`，然后按助手原始顺序发出 toolResult 消息和 `turn_end.toolResults`
- `sequential`：逐个执行工具调用，与旧版行为一致

在并行模式下，工具完成事件按工具完成顺序发出，但持久化的 toolResult 消息仍按助手原始顺序排列。

模式可通过代理配置中的 `toolExecution` 全局设置，也可通过 `AgentTool` 上的 `executionMode` 按工具单独设置。如果一批工具调用中任何一个工具指定了 `executionMode: "sequential"`，则整个批次都会按顺序执行，忽略全局设置。

`beforeToolCall` 钩子在 `tool_execution_start` 和参数校验完成后执行。它可以阻止执行，并在被阻止的结果中附加 `terminate: true`。`afterToolCall` 钩子在工具执行完成后、`tool_execution_end` 和最终工具结果消息事件发出之前执行。

工具、被阻止的 `beforeToolCall` 结果以及 `afterToolCall` 覆盖都可以返回 `terminate: true`，以提示跳过自动的后续 LLM 调用。只有当该批次中所有最终确定的工具结果都设置了 `terminate: true` 时，循环才会提前停止。混合批次则正常继续。

`Agent` 类在 `AgentOptions` 中接受 `shouldStopAfterTurn`。底层循环调用者也可以在 `AgentLoopConfig` 中设置相同的钩子：

```typescript
const stream = agentLoop(
  prompts,
  context,
  {
    model,
    convertToLlm,
    shouldStopAfterTurn: async ({ message, toolResults, context, newMessages }) => {
      return shouldCompactBeforeNextTurn(context.messages);
    },
  },
  undefined,
  models.streamSimple.bind(models),
);
```

`shouldStopAfterTurn` 在 `turn_end` 发出之后、助手响应和所有工具执行正常完成后执行。如果返回 `true`，循环会在轮询转向或后续队列之前发出 `agent_end` 并退出，不会中止提供者流，不会取消正在运行的工具，也不会更改助手中止原因。`AgentOptions` 中的回调还会接收当前运行的 `AbortSignal` 作为第二个参数。

当你使用 `Agent` 类时，助手的 `message_end` 处理会被视为工具预检开始前的屏障。这意味着 `beforeToolCall` 看到的代理状态已经包含了请求该工具调用的助手消息。

### continue() 事件序列

`continue()` 从现有上下文继续，不添加新消息。用于出错后的重试。

```typescript
// 出错后，从当前状态重试
await agent.continue();
```

上下文中的最后一条消息必须是 `user` 或 `toolResult`（不能是 `assistant`）。

### 事件类型

| 事件 | 描述 |
|------|------|
| `agent_start` | 代理开始处理 |
| `agent_end` | 本次运行的最终事件。订阅者对该事件的等待仍计入完成 |
| `turn_start` | 新的一轮开始（一次 LLM 调用 + 工具执行） |
| `turn_end` | 本轮完成，包含助手消息和工具结果 |
| `message_start` | 任何消息开始（user、assistant、toolResult） |
| `message_update` | **仅限助手**。包含 `assistantMessageEvent` 及其增量 |
| `message_end` | 消息完成 |
| `tool_execution_start` | 工具开始 |
| `tool_execution_update` | 工具流式输出进度 |
| `tool_execution_end` | 工具完成 |

`Agent.subscribe()` 的监听器按注册顺序等待执行。`agent_end` 表示不会再发出更多循环事件，但 `await agent.waitForIdle()` 和 `await agent.prompt(...)` 只有在所有 `agent_end` 监听器完成后才会结束。

## Agent选项

```typescript
const agent = new Agent({
  // 初始状态
  initialState: {
    systemPrompt: string,
    model: Model<any>,
    thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
    tools: AgentTool<any>[],
    messages: AgentMessage[],
  },

  // 将 AgentMessage[] 转换为 LLM Message[]（自定义消息类型必需）
  convertToLlm: (messages) => messages.filter(...),

  // 在 convertToLlm 之前转换上下文（用于修剪、压缩）
  transformContext: async (messages, signal) => pruneOldMessages(messages),

  // 转向模式："one-at-a-time"（默认）或 "all"
  steeringMode: "one-at-a-time",

  // 后续模式："one-at-a-time"（默认）或 "all"
  followUpMode: "one-at-a-time",

  // 必需的流函数
  streamFn: models.streamSimple.bind(models),

  // 提供者缓存的会话 ID
  sessionId: "session-123",

  // 动态 API 密钥解析（用于过期的 OAuth 令牌）
  getApiKey: async (provider) => refreshToken(),

  // 工具执行模式："parallel"（默认）或 "sequential"
  toolExecution: "parallel",

  // 在参数校验后对每个工具调用进行预检。可以阻止执行。
  beforeToolCall: async ({ toolCall, args, context }) => {
    if (toolCall.name === "bash") {
      return { block: true, reason: "bash is disabled", terminate: true };
    }
  },

  // 在最终工具事件发出之前，对每个工具结果进行后处理。
  afterToolCall: async ({ toolCall, result, isError, context }) => {
    if (toolCall.name === "notify_done" && !isError) {
      return { terminate: true };
    }
    if (!isError) {
      return { details: { ...result.details, audited: true } };
    }
  },

  // 在完成一轮后、轮询排队消息之前，优雅地停止。
  shouldStopAfterTurn: async ({ context }, signal) => {
    return shouldCompactBeforeNextTurn(context.messages, signal);
  },

  // 基于令牌的提供者的自定义思考预算
  thinkingBudgets: {
    minimal: 128,
    low: 512,
    medium: 1024,
    high: 2048,
  },
});
```

## Agent状态

```typescript
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];
  messages: AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
}
```

通过 `agent.state` 访问状态。

赋值 `agent.state.tools = [...]` 或 `agent.state.messages = [...]` 时，会在存储前复制顶层数组。直接修改返回的数组会改变当前代理状态。

在流式传输期间，`agent.state.streamingMessage` 包含当前的部分Agent消息。

`agent.state.isStreaming` 会保持 `true`，直到本次运行完全结束（包括所有 `agent_end` 订阅者完成）。

## 方法

### 提示

```typescript
// 文本提示
await agent.prompt("Hello");

// 带图片
await agent.prompt("What's in this image?", [
  { type: "image", data: base64Data, mimeType: "image/jpeg" }
]);

// 直接使用 AgentMessage
await agent.prompt({ role: "user", content: "Hello", timestamp: Date.now() });

// 从当前上下文继续（最后一条消息必须是 user 或 toolResult）
await agent.continue();
```

### 状态管理

```typescript
agent.state.systemPrompt = "New prompt";
agent.state.model = getModel("openai", "gpt-4o");
agent.state.thinkingLevel = "medium";
agent.state.tools = [myTool];
agent.toolExecution = "sequential";
agent.beforeToolCall = async ({ toolCall }) => undefined;
agent.afterToolCall = async ({ toolCall, result }) => undefined;
agent.shouldStopAfterTurn = async ({ context }) => shouldCompactBeforeNextTurn(context.messages);
agent.state.messages = newMessages; // 顶层数组会被复制
agent.state.messages.push(message);
agent.reset();
```

### 会话和思考预算

```typescript
agent.sessionId = "session-123";

agent.thinkingBudgets = {
  minimal: 128,
  low: 512,
  medium: 1024,
  high: 2048,
};
```

### 控制

```typescript
agent.abort();           // 取消当前操作
await agent.waitForIdle(); // 等待完成
```

### 事件

```typescript
const unsubscribe = agent.subscribe(async (event, signal) => {
  if (event.type === "agent_end") {
    // 本次运行的最终屏障工作
    await flushSessionState(signal);
  }
});
unsubscribe();
```

## 转向和后续

转向消息允许你在工具运行时中断Agent。后续消息允许你在Agent原本要停止时排队追加工作。

```typescript
agent.steeringMode = "one-at-a-time";
agent.followUpMode = "one-at-a-time";

// Agent正在运行工具时
agent.steer({
  role: "user",
  content: "Stop! Do this instead.",
  timestamp: Date.now(),
});

// Agent完成当前工作后
agent.followUp({
  role: "user",
  content: "Also summarize the result.",
  timestamp: Date.now(),
});

const steeringMode = agent.steeringMode;
const followUpMode = agent.followUpMode;

agent.clearSteeringQueue();
agent.clearFollowUpQueue();
agent.clearAllQueues();
```

使用 `clearSteeringQueue`、`clearFollowUpQueue` 或 `clearAllQueues` 丢弃排队中的消息。

当一轮完成后检测到转向消息时：
1. 当前助手消息中的所有工具调用均已结束
2. 注入转向消息
3. LLM 在下一轮进行响应

后续消息仅在不再有工具调用且没有转向消息时检查。如果有排队消息，则注入并再运行一轮。

## 自定义消息类型

通过声明合并扩展 `AgentMessage`：

```typescript
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    notification: { role: "notification"; text: string; timestamp: number };
  }
}

// 现在可以这样使用
const msg: AgentMessage = { role: "notification", text: "Info", timestamp: Date.now() };
```

在 `convertToLlm` 中处理自定义类型：

```typescript
const agent = new Agent({
  streamFn: models.streamSimple.bind(models),
  convertToLlm: (messages) => messages.flatMap(m => {
    if (m.role === "notification") return []; // 过滤掉
    return [m];
  }),
});
```

## 工具

使用 `AgentTool` 定义工具：

```typescript
import { Type } from "typebox";

const readFileTool: AgentTool = {
  name: "read_file",
  label: "Read File",  // 用于 UI 显示
  description: "Read a file's contents",
  parameters: Type.Object({
    path: Type.String({ description: "File path" }),
  }),
  // 覆盖此工具的执行模式（可选）。
  // "sequential" 强制整个批次逐个执行。
  // "parallel" 允许与其他工具调用并发执行。
  // 如果省略，则使用全局 toolExecution 配置。
  executionMode: "sequential",
  execute: async (toolCallId, params, signal, onUpdate) => {
    const content = await fs.readFile(params.path, "utf-8");

    // 可选：流式输出进度
    onUpdate?.({ content: [{ type: "text", text: "Reading..." }], details: {} });

    // 可选：在此处返回 `terminate: true`，当该批次中所有最终确定的工具结果都这样做时，跳过自动后续 LLM 调用。
    return {
      content: [{ type: "text", text: content }],
      details: { path: params.path, size: content.length },
    };
  },
};

agent.state.tools = [readFileTool];
```

### 错误处理

**工具失败时应抛出错误**。不要将错误消息作为内容返回。

```typescript
execute: async (toolCallId, params, signal, onUpdate) => {
  if (!fs.existsSync(params.path)) {
    throw new Error(`File not found: ${params.path}`);
  }
  // 仅在成功时返回内容
  return { content: [{ type: "text", text: "..." }] };
}
```

抛出的错误会被代理捕获，并以 `isError: true` 的形式报告给 LLM 作为工具错误。

从 `execute()`、被阻止的 `beforeToolCall` 或 `afterToolCall` 返回 `terminate: true`，可以提示代理在当前工具批次结束后停止。只有当该批次中所有最终确定的工具结果都是终止状态时，才会生效。该提示仅影响运行时行为；发出的 `toolResult` 转录消息仍然是标准的 LLM 工具结果。

## Agent使用（通过后端代理）

对于通过后端代理的浏览器应用：

```typescript
import { Agent, streamProxy } from "@earendil-works/pi-agent-core";

const agent = new Agent({
  streamFn: (model, context, options) =>
    streamProxy(model, context, {
      ...options,
      authToken: "...",
      proxyUrl: "https://your-server.com",
    }),
});
```

## 低级 API

如需不通过 `Agent` 类直接控制：

```typescript
import { agentLoop, agentLoopContinue } from "@earendil-works/pi-agent-core";

const context: AgentContext = {
  systemPrompt: "You are helpful.",
  messages: [],
  tools: [],
};

const config: AgentLoopConfig = {
  model: getModel("openai", "gpt-4o"),
  convertToLlm: (msgs) => msgs.filter(m => ["user", "assistant", "toolResult"].includes(m.role)),
  toolExecution: "parallel",  // 如果设置了 per-tool executionMode，则会被覆盖
  beforeToolCall: async ({ toolCall, args, context }) => undefined,
  afterToolCall: async ({ toolCall, result, isError, context }) => undefined,
};

const userMessage = { role: "user", content: "Hello", timestamp: Date.now() };

const streamFn = models.streamSimple.bind(models);
for await (const event of agentLoop([userMessage], context, config, undefined, streamFn)) {
  console.log(event.type);
}

// 从现有上下文继续
for await (const event of agentLoopContinue(context, config, undefined, streamFn)) {
  console.log(event.type);
}
```

这些低级流是观察性的。它们保持事件顺序，但不会等待你的异步事件处理完成后才进行后续的生产者阶段。如果你需要将消息处理作为工具预检前的屏障，请使用 `Agent` 类，而不是原始的 `agentLoop()` 或 `agentLoopContinue()`。

## 许可证

MIT