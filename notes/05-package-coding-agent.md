# `packages/coding-agent` 阅读笔记

## 1. 包定位

`coding-agent` 是 Pi 的应用宿主，把 [`pi-ai`](../packages/ai)、[`pi-agent-core`](../packages/agent) 和 [`pi-tui`](../packages/tui) 组装成可以直接运行的 `pi` CLI。

它主要负责应用决策：配置、工作目录、Trust、Session、模型选择、Extension、Skill、编码工具和输出模式。Agent Loop 本身仍在 [`packages/agent/src/agent-loop.ts`](../packages/agent/src/agent-loop.ts)。

```text
CLI 参数
  -> main()
  -> Settings / Trust / Credential / ModelRuntime
  -> SessionManager
  -> AgentSession
  -> Agent.prompt()
  -> pi-agent-core
```

## 2. 推荐入口

- [`src/cli.ts`](../packages/coding-agent/src/cli.ts)：Node CLI 入口。
- [`src/main.ts`](../packages/coding-agent/src/main.ts)：解析运行模式并启动应用。
- [`src/core/sdk.ts`](../packages/coding-agent/src/core/sdk.ts)：编程式创建 AgentSession 的工厂。
- [`src/core/agent-session.ts`](../packages/coding-agent/src/core/agent-session.ts)：Session 级运行宿主。
- [`src/core/agent-session-runtime.ts`](../packages/coding-agent/src/core/agent-session-runtime.ts)：运行时替换、切换和生命周期管理。
- [`src/core/session-manager.ts`](../packages/coding-agent/src/core/session-manager.ts)：JSONL Session 树和 Entry。

## 3. `createAgentSession()` 的组装顺序

源码：[`createAgentSession`](../packages/coding-agent/src/core/sdk.ts)

```text
options.cwd / agentDir
  -> ModelRuntime
  -> SettingsManager
  -> SessionManager
  -> DefaultResourceLoader.reload()
  -> 恢复 Session 中的 model / thinking level
  -> 解析初始模型和工具
  -> 创建 Agent
  -> 创建 AgentSession
  -> 加载 Extension 并注册工具
```

重要参数：

- `cwd`：项目资源、Skill、Session 默认路径的工作目录。
- `agentDir`：全局认证、模型配置和 Agent 资源目录。
- `modelRuntime`：模型目录和凭据运行时；显式传入时不会重复创建默认实例。
- `sessionManager`：Session 存储和分支上下文；内存实例适合测试。
- `resourceLoader`：负责加载项目上下文文件、Skill 和 Extension。
- `tools` / `noTools` / `excludeTools`：控制初始工具集合，不改变 Agent Loop 的执行机制。

`createAgentSession()` 会优先恢复 Session 中的模型；如果模型不存在或没有认证，再使用设置和可用模型解析初始模型。思考级别最后会通过 `clampThinkingLevel()` 限制到模型实际支持的范围。

## 4. Model Resolver

源码：[`src/core/model-resolver.ts`](../packages/coding-agent/src/core/model-resolver.ts)

[`parseModelPattern`](../packages/coding-agent/src/core/model-resolver.ts) 处理 `model:thinking-level` 形式。它先尝试完整匹配模型 ID，再从最后一个冒号拆分思考级别，避免 OpenRouter 一类本身含冒号的模型 ID 被错误拆解。

[`resolveCliModel`](../packages/coding-agent/src/core/model-resolver.ts) 的选择顺序是：

```text
显式 --provider
  -> provider/model 形式
  -> 完整 model id
  -> 精确匹配的认证 Provider
  -> 模糊匹配 / thinking level
```

如果多个 Provider 都能匹配裸模型 ID，函数会返回歧义错误，而不是依赖模型目录顺序。这是 CLI 可重复性的必要条件。

## 5. AgentSession 与 Extension

源码：[`src/core/agent-session.ts`](../packages/coding-agent/src/core/agent-session.ts)、[`src/core/extensions/`](../packages/coding-agent/src/core/extensions/)

`AgentSession` 将底层 Agent 的事件转成应用事件，同时负责：

- 保存 user、assistant、tool result 到 Session；
- 在请求前运行 Extension context hook；
- 在工具前后运行 Extension hook；
- 处理 compaction、overflow、retry 和 deferred；
- 向 TUI、Print、JSON、RPC 暴露统一状态。

Extension 可以注册 Tool、Command、Shortcut、事件监听器和 UI。Skill 则主要是 prompt 资源，两者不要混淆：Extension 执行代码，Skill 提供模型可读的能力说明。

## 6. 工具和安全边界

工具入口位于 [`src/core/tools/index.ts`](../packages/coding-agent/src/core/tools/index.ts)。编码工具通常分为：

- 读取：read、grep、find、ls；
- 修改：write、edit；
- 执行：bash。

工具参数在 `packages/agent` 中进行 schema 校验，但 cwd、文件路径、输出截断、图片处理和应用级权限由 `coding-agent` 工具实现负责。项目 Trust 由 [`trust-manager.ts`](../packages/coding-agent/src/core/trust-manager.ts) 负责，不能用 Prompt 代替。

## 7. 运行模式

源码：[`src/modes/index.ts`](../packages/coding-agent/src/modes/index.ts)

| 模式 | 关键文件 | 重点 |
| --- | --- | --- |
| Interactive | [`interactive-mode.ts`](../packages/coding-agent/src/modes/interactive/interactive-mode.ts) | TUI 输入和事件显示 |
| Print | [`print-mode.ts`](../packages/coding-agent/src/modes/print-mode.ts) | 一次性文本输出 |
| JSON | [`json-event.ts`](../packages/coding-agent/src/modes/json-event.ts) | 机器可读事件 |
| RPC | [`rpc-mode.ts`](../packages/coding-agent/src/modes/rpc/rpc-mode.ts) | 远程命令与事件 |

这些模式共享 AgentSession，不重新实现 Agent Loop。

## 8. 阅读问题

阅读本包时可以持续追踪三个问题：

1. 这个逻辑是在选择资源，还是在执行 Agent？前者通常属于 `coding-agent`，后者属于 `agent`。
2. 这个状态是当前运行状态，还是持久化 Session 状态？前者看 Agent，后者看 SessionManager。
3. 这个事件是内部 AgentEvent、应用 AgentSessionEvent，还是 UI/RPC 事件？沿着转换函数向上追踪，不要直接假设它们字段相同。
