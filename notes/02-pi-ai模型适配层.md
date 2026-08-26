位置：[`packages/ai`](../packages/ai)

## 1. 解决的问题

`@earendil-works/pi-ai` 的职责不是 Agent，而是把不同 LLM 统一为相同的调用模型，输出为统一的消息格式，事件流：Message、UserMessage、AssistantMessage、ToolResultMessage 等，对外稳定

它主要提供：

- Provider 集合和 Provider 工厂；
- 模型目录、模型能力和模型成本定义；
- OpenAI、Anthropic、Google、Bedrock 等 API 的适配；
- API Key、环境变量、OAuth 和 Credential Store；
- 流式文本、Thinking、Tool Call 和 Partial JSON 事件；
- Token、Cache、Cost 和 Stop Reason 统计；
- 图片输入和图片生成；
- Retry、Abort、Proxy 和 Provider Header 处理；
- 动态模型目录刷新。

> 把任意 LLM Provider 的请求 / 响应 / 流 / 鉴权 / 模型元数据，统一成同一组 TypeScript 类型 + 同一种 stream() / complete() 调用方式。

## 2. 分层架构

<img src="./figures/02-01-整体框架.png" alt="02-01-整体框架.png" style="zoom: 25%;" />

- 核心类型位于 [`packages/ai/src/types.ts`](../packages/ai/src/types.ts)，其故意只导出类型+通用工具。这样上层的agent/coding agenty要拿到provider必须显式：[agent-treeshake-smoke-entry.ts:L1-L13](../scripts/agent-treeshake-smoke-entry.ts#L1-L13) 
- Provider 汇总位于 [`packages/ai/src/providers/all.ts`](../packages/ai/src/providers/all.ts)
- API 适配位于 [`packages/ai/src/api/`](../packages/ai/src/api/)
- 认证代码位于 [`packages/ai/src/auth/`](../packages/ai/src/auth/)。

## 3. 核心概念逐一拆解

### 3.1 Model / Provider / Api

- `Model<Api>`：核心类型，描述一个具体的模型。`Api` 是字面量联合（`"anthropic-messages"` / `"openai-completions"` / `"openai-responses"` / `"openai-codex-responses"` / `"google-generative-ai"` / `"google-vertex"` / `"bedrock-converse"` / `"mistral-conversations"` / `"azure-openai-responses"` / `"openrouter"` …）。每个 `Api` 对应 `api/<name>.ts`。
- `Provider<Api>`：一个 provider 工厂，输出 `getModel / listModels / streamSimple / completeSimple`，并持有 API endpoint + 鉴权细节。
- 同一 provider 可能支持多种 `Api`（比如 OpenAI 同时有 `openai-completions` / `openai-responses` / `openai-codex-responses`），用 `Provider<Api>` 的泛型区分。

对于 Agent 主路径，模型需要支持可靠的 Tool Calling，因为 Agent 需要根据模型返回的工具调用执行文件、Shell 或网络操作。不过 `pi-ai` 本身不等于编码 Agent，它也包含基础对话、图片和 Provider 级别的能力。

### 3.2 消息 / 内容 [types.ts:L358-L507](../packages/ai/src/types.ts#L358-L507)

- 通用 `Message` = `UserMessage | AssistantMessage | ToolResultMessage`。

- 内容块（

  ```
  Content
  ```

  ）包括：

  - 文本（`text`）、思考（`thinking`），
  - 图像（`image` — 输入侧 base64 / URL，输出侧按 provider 不同会回到 tool call 或 image-model result），
  - tool call（`toolCall` — id / name / arguments），
  - tool result（`toolResult` — toolCallId / content / isError）。

- 顶层还有 `SimpleStreamOptions` / `PiMessagesOptions`，把 `temperature` / `maxTokens` / `reasoning`（thinking budget / level）/ `cacheRetention` / `signal` 等收口。

### 3.3 流（Stream）

调用方式统一是 `stream(model, context, options): AssistantMessageEventStream`：

ts

Copy

```
type AssistantMessageEventStream = AsyncIterable<AssistantMessageEvent>;
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text"; delta: string; partial: AssistantMessage }
  | { type: "thinking"; delta: string; partial: AssistantMessage }
  | { type: "tool_call"; delta: ToolCallDelta; partial: AssistantMessage }
  | { type: "done"; message: AssistantMessage; reason: ... }
  | { type: "error"; error: ... };
```

这是上层 agent 循环真正消费的协议——`agent-loop.ts` 直接 `for await (const ev of stream)`。

### 3.4 模型元数据 / Models Store

- `Model` 上的字段：`name / id / api / provider / baseUrl / reasoning / input / cost / contextWindow / maxTokens / headers / compat` …
- `models.ts` 暴露类型；`models-store.ts` 提供 `getModel(provider, id)`、`searchModels()` 等。
- 模型快照在构建时生成到 `src/providers/data/*.json`；运行时通过 `*.models.ts` 静态 import 或动态 `getModel` 查询。

### 3.5 鉴权（`src/auth/`）

- `auth/types.ts`：鉴权相关 discriminated union（API Key / OAuth / NoAuth / Custom）。
- `auth/context.ts`：把"用户在哪里提供 key"（env、settings、keychain 等）抽象成 `AuthContext`。
- `auth/credential-store.ts`：跨进程持久化的 key store。
- `auth/helpers.ts`：常用 helper，比如 `resolveApiKey`。
- 单独入口 `@earendil-works/pi-ai/oauth` 与 `./bun-oauth`：OAuth + Bun 专用实现（因为 Bun 自带 fetch 和 WebSocket，OAuth 流程可省依赖）。
- `./bedrock-provider`：Amazon Bedrock 走的是 AWS SigV4 + Converse Runtime，单独包出来避免主 bundle 引入 AWS SDK。

### 3.6 图片生成（`./compat/extension-oauth-types.ts` 与 `images-models.ts`）

- `images-models.ts`：列出图片生成模型清单（不同 provider）。
- 走的是 `Models` 里带 `output: ["image"]` 的子集；上层用 `getImageModel()` + `generateImage()` 一类函数。
- 注意：图片生成跟文本生成走的是**不同的 Api**（如 `"openai-image"`、`"google-image"`），但都遵守同一个 `ImageModel` 接口。

### 3.7 Faux Provider（`./providers/faux`）

测试 / fake 用的假 provider：固定返回编排好的文本与 tool call，`agent-loop` 的回归测试靠它跑而不打真实 API。`packages/coding-agent/test/suite/` 走的就是这个。

### 3.8 兼容层 `./compat`

老式全局 API（无 provider 工厂、直接根据 model 自动路由）。新代码**不要**用，应该显式 `import` provider。新代码用 `./api/*` + `./providers/*`。

### 3.9 公用工具（`utils/`）

`event-stream`（SSE / NDJSON 解析与自适应）、`json-parse`（含 partial JSON，兼容 Anthropic streaming）、`overflow`（参数超限自动截断）、`retry`（带指数回退）、`validation`（基于 TypeBox 的入参校验）、`typebox-helpers`（TS ↔ JSON Schema 转换）、`uuid`（v7 生成）。`contentText` 是从混合 content 数组里快速抽 text 的工具函数。

模型元数据由脚本和 Provider 数据生成：

```text
packages/ai/scripts/
packages/ai/src/models.generated.ts
packages/ai/src/image-models.generated.ts
packages/ai/src/providers/data/
```

生成文件不应该直接手工修改，应修改生成脚本后重新生成。
