# 1. 项目设计思路

> 本笔记中的源码链接均以当前文件 `notes/01-project.md` 为基准，使用相对路径。点击链接即可跳转到对应源码、目录或文档。

## 1.1 Pi 本体与 SecAgent 的关系

- **Pi 本体**：通用 Agent Harness，负责多供应商 LLM 接入、Agent 运行时、工具调用、上下文管理、Session 持久化，以及交互式编码 Agent CLI。
- **SecAgent**：本项目独有的“网络安全智能层”，构建在 Pi 之上。它不重写 Pi 的通用 Agent Runtime，而是增加安全领域所需要的安全状态、授权范围、决策策略、工具注册表、审计和报告体系。
- **当前设计原则**：通用能力尽量复用 Pi，安全能力集中放在项目本地的 `.pi/` 目录中。这样既能继承 Pi 的模型、Session、Extension 和多 Agent 能力，又能保持 SecAgent 的安全策略独立、可审计、可迭代。

## 1.2 当前阶段的重点

如果时间允许，可以继续优化 Pi 的 Agent Loop。但在当前基础模型能力已经明显提高的情况下，渗透测试、Web 安全、逆向分析等场景的主要瓶颈不一定是“模型会不会推理”，而更可能是：

1. 工具是否封装得足够清晰、可组合、可校验；
2. 工具参数是否带有风险、权限、目标范围和前置条件；
3. Agent 是否能正确维护长期上下文、证据、假设和已完成工作；
4. 高风险动作是否经过授权、确认、阻断和审计；
5. 多个专业 Agent 之间是否能有效分工，而不是重复执行或互相污染上下文。

因此，SecAgent 的主要价值不是简单地“给 Pi 增加更多命令”，而是为安全任务建立一套从授权、规划、执行、证据到报告的闭环。

# 2. 项目框架

## 2.1 Pi 本身的项目理解

### 2.1.1 项目整体定位

Pi 不是单一 CLI，而是一个分层的 Agent 平台。最主要的依赖关系如下：

```text
LLM Provider
    ↓
pi-ai
    ↓
pi-agent-core
    ↓
pi-coding-agent
    ├─ Interactive TUI
    ├─ Print / JSON 模式
    ├─ RPC 模式
    ├─ Extensions / Skills
    └─ Session / Compaction / Tools

Web UI、Server、Client、SQLite Backend
    ↓
复用上述核心能力
```

包依赖流向：

```text
telemetry ← ai ← agent ← coding-agent
protocol ← client ← coding-agent
tui ────────────────────↑
ai + protocol ───────── server
ai + agent ───────────── sqlite-node
ai + agent + coding-agent + tui ─ web-ui
```

这里的“向上依赖”表示上层应用复用下层能力，而不是每一层都直接参与 Agent 推理。最重要的分层边界是：

- `pi-ai` 只关心模型、Provider、认证和流式响应；
- `pi-agent-core` 只关心 Agent 状态机和工具调用循环；
- `pi-coding-agent` 才负责把这些能力组织成一个可运行的编码 Agent；
- `pi-tui` 负责终端交互，不决定 Agent 的核心逻辑；
- Web UI、RPC Server 和 SQLite 后端都是对核心能力的不同接入方式。

### 2.1.2 包结构

| 包 | 主要职责 |
| --- | --- |
| [`packages/ai`](../packages/ai) | 统一 LLM API，支持 OpenAI、Anthropic、Google、Bedrock、OpenRouter 等 Provider |
| [`packages/agent`](../packages/agent) | 通用 Agent Runtime，负责消息、工具调用、事件、状态、队列和 Harness |
| [`packages/coding-agent`](../packages/coding-agent) | 面向用户的 `pi` CLI，是 Pi 的主要应用宿主 |
| [`packages/tui`](../packages/tui) | 终端 UI 框架、编辑器、Markdown、选择器、Overlay 和终端渲染 |
| [`packages/telemetry`](../packages/telemetry) | 与厂商无关的 Telemetry、Span 和 Schema 抽象 |
| [`packages/protocol`](../packages/protocol) | RPC 协议、CBOR 编码、消息 Schema 和帧传输 |
| [`packages/client`](../packages/client) | Pi RPC Client，连接 Agent Server |
| [`packages/server`](../packages/server) | Session Server、连接管理和 Agent 服务端能力 |
| [`packages/session-backends/sqlite-node`](../packages/session-backends/sqlite-node) | Node SQLite Session 存储和搜索后端 |
| [`packages/evals`](../packages/evals) | Agent、Extension 和 Harness 评测代码 |
| [`packages/web-ui`](../packages/web-ui) | 基于 Next.js 的浏览器 Web UI，当前作为 `@agegr/pi-web` 存在 |

根目录的 `package.json` 使用 npm workspaces 管理这些包，同时把部分 Extension 示例作为 Workspace 纳入依赖解析。

### 2.1.2.1 `pi-ai`：模型适配层

位置：[`packages/ai`](../packages/ai)

`@earendil-works/pi-ai` 的职责不是 Agent，而是把不同 LLM 统一为相同的调用模型。它主要提供：

- Provider 集合和 Provider 工厂；
- 模型目录、模型能力和模型成本定义；
- OpenAI、Anthropic、Google、Bedrock 等 API 的适配；
- API Key、环境变量、OAuth 和 Credential Store；
- 流式文本、Thinking、Tool Call 和 Partial JSON 事件；
- Token、Cache、Cost 和 Stop Reason 统计；
- 图片输入和图片生成；
- Retry、Abort、Proxy 和 Provider Header 处理；
- 动态模型目录刷新。

核心类型位于 [`packages/ai/src/types.ts`](../packages/ai/src/types.ts)，Provider 汇总位于 [`packages/ai/src/providers/all.ts`](../packages/ai/src/providers/all.ts)，API 适配位于 [`packages/ai/src/api/`](../packages/ai/src/api/)，认证代码位于 [`packages/ai/src/auth/`](../packages/ai/src/auth/)。

对于 Agent 主路径，模型需要支持可靠的 Tool Calling，因为 Agent 需要根据模型返回的工具调用执行文件、Shell 或网络操作。不过 `pi-ai` 本身不等于编码 Agent，它也包含基础对话、图片和 Provider 级别的能力。

模型元数据由脚本和 Provider 数据生成：

```text
packages/ai/scripts/
packages/ai/src/models.generated.ts
packages/ai/src/image-models.generated.ts
packages/ai/src/providers/data/
```

生成文件不应该直接手工修改，应修改生成脚本后重新生成。

### 2.1.2.2 `pi-agent-core`：真正的 Agent Loop

位置：[`packages/agent`](../packages/agent)

`packages/agent` 是底层 Agent Runtime。它不依赖 CLI 或终端 UI，适合被 CLI、Web、Server 或其他应用复用。

它包含：

- `Agent` 状态管理；
- `agentLoop` 和 `agentLoopContinue`；
- Agent 生命周期事件；
- Assistant 流式响应处理；
- Tool Call 参数校验；
- Tool 串行或并行执行；
- `beforeToolCall` 和 `afterToolCall` Hook；
- Abort 和错误处理；
- Steering 消息和 Follow-up 消息队列；
- 自定义 Agent Message；
- 上下文转换；
- Compaction 和 Branch Summarization 基础能力；
- Harness、Session、Search 和 Telemetry。

一个典型的 Loop 如下：

```text
用户消息进入 Agent Context
    ↓
转换为 LLM Message
    ↓
pi-ai 发起流式请求
    ↓
得到 Assistant Message
    ↓
如果没有 Tool Call：结束当前轮次
    ↓
如果有 Tool Call：校验参数并执行工具
    ↓
将 Tool Result 写回上下文
    ↓
再次请求模型
    ↓
直到模型结束、工具要求终止、用户 Abort 或发生错误
```

Agent Loop 的关键复杂性并不只是“请求模型并执行工具”，还包括：

- 多个工具调用是否可以并行；
- 某些工具是否必须串行；
- 用户在模型工作期间提交的消息应该何时插入；
- 工具参数被截断时是否禁止执行；
- 工具执行失败后是否继续；
- Context Overflow 是否应该触发 Compaction 和重试；
- 扩展是否可以阻断、替换或修改工具行为。

### 2.1.2.3 `pi-coding-agent`：真正运行的 Agent 宿主

位置：[`packages/coding-agent`](../packages/coding-agent)

这是用户实际运行的 `pi` CLI，也是 Pi 中把底层能力组合起来的应用层。

启动和执行链路如下：

```text
cli.ts
  ↓
main.ts
  ↓
解析参数、认证、项目 Trust、Settings、Session
  ↓
AgentSessionRuntime
  ↓
AgentSession
  ↓
构建 System Prompt、加载 Skills/Extensions、注册 Tools
  ↓
Agent.prompt()
  ↓
pi-agent-core Agent Loop
  ↓
pi-ai Provider 流式请求
  ↓
Assistant Message
  ↓
Tool Call
  ↓
beforeToolCall
  ↓
执行 read/write/edit/bash/grep/find/ls
  ↓
afterToolCall
  ↓
Tool Result
  ↓
继续下一轮或结束
```

主要文件：

- [`src/cli.ts`](../packages/coding-agent/src/cli.ts)：Node CLI 入口；
- [`src/main.ts`](../packages/coding-agent/src/main.ts)：启动流程和模式选择；
- [`src/core/agent-session.ts`](../packages/coding-agent/src/core/agent-session.ts)：Session 级 Agent 宿主；
- [`src/core/agent-session-runtime.ts`](../packages/coding-agent/src/core/agent-session-runtime.ts)：Session 替换、切换、Fork、Import 和销毁；
- [`src/core/session-manager.ts`](../packages/coding-agent/src/core/session-manager.ts)：JSONL Session 文件和树结构；
- [`src/core/model-runtime.ts`](../packages/coding-agent/src/core/model-runtime.ts)：模型和凭据运行时；
- [`src/core/extensions/`](../packages/coding-agent/src/core/extensions/)：Extension 加载和生命周期；
- [`src/core/tools/`](../packages/coding-agent/src/core/tools/)：内置工具；
- [`src/modes/`](../packages/coding-agent/src/modes/)：Interactive、Print、JSON、RPC 等运行模式。

`AgentSession` 是连接底层 Agent 和上层应用的关键对象。它负责：

1. 维护当前 Session；
2. 构建 System Prompt；
3. 维护当前 Model 和 Thinking Level；
4. 注册内置工具和 Extension 工具；
5. 监听 Agent 事件并持久化消息；
6. 处理 Compaction、Overflow Recovery 和重试；
7. 处理 Steering、Follow-up 和 Bash 队列；
8. 对接 TUI、Print、JSON 和 RPC；
9. 提供给 Extension 使用的 API 和 UI 能力。

### 2.1.2.4 `pi-tui`：终端交互层

位置：[`packages/tui`](../packages/tui)

`pi-tui` 提供差分渲染的终端 UI 能力，包括：

- Terminal 和 Alternate Screen；
- Layout Tree；
- Editor 和 Input；
- Markdown 渲染；
- Loader；
- SelectList 和 SettingsList；
- Overlay；
- 图片显示；
- 自动补全；
- Keybinding；
- ANSI、宽度和 Unicode 处理。

它不负责 Agent 推理，只负责把 `AgentSessionEvent` 和用户键盘操作转换成可交互界面。

### 2.1.2.5 Protocol、Client、Server 和 SQLite

[`packages/protocol`](../packages/protocol) 定义 RPC 层的稳定数据模型，包括：

- Client Hello 和 Server Hello；
- Session Snapshot；
- Transcript Item；
- Prompt、Steer、Abort、Set Model、Set Thinking 等 Command；
- Response 和 Event Envelope；
- CBOR 编码；
- 4 字节长度前缀的 Frame 传输。

[`packages/client`](../packages/client) 负责把这些协议封装成 Client API 和 Session Handle。

[`packages/server`](../packages/server) 负责：

- 管理多个 Live Session；
- 建立和关闭连接；
- 处理 Client Command；
- 推送 Session Snapshot 和增量进度；
- 管理 Session Lease 和锁；
- 暴露 Unix Socket 等传输方式。

[`packages/session-backends/sqlite-node`](../packages/session-backends/sqlite-node) 为 Session 提供 SQLite 持久化扩展，用于：

- Session 和 Branch 存储；
- Entry 存储；
- Branch Tip；
- Session Stats；
- 关键事实和搜索索引；
- Writer Lease。

### 2.1.2.6 Web UI

位置：[`packages/web-ui`](../packages/web-ui)

Web UI 是基于 Next.js 的浏览器界面，复用 Pi 的本地配置和 Session 文件。主要能力包括：

- 浏览、恢复、重命名和导出 Session；
- 启动 Agent 和查看流式事件；
- 文件浏览、上传和预览；
- Git Status 和 Diff；
- Provider 登录、API Key 和 Model 配置；
- Plugins 和 Skills 管理；
- Worktree 管理；
- 中英文界面和 PWA。

Web UI 的结构：

```text
app/          Next.js 页面和 API Routes
components/   React UI 组件
hooks/        Agent、Session、模型和交互状态
lib/          RPC、Session、文件、Git、模型和安全逻辑
bin/          pi-web CLI
public/       静态资源和 PWA 文件
docs/         Web UI 文档
```

它有自己的 `package.json`、`package-lock.json`、`bun.lock` 和 Next.js 构建流程，不完全等同于核心 Pi 包的构建流程。

## 2.2 Pi 的核心运行机制

### 2.2.1 启动阶段

`main.ts` 启动时大致完成以下步骤：

1. 解析 CLI 参数；
2. 判断 Interactive、Print、JSON 或 RPC 模式；
3. 解析当前工作目录和 Agent 配置目录；
4. 读取全局和项目 Settings；
5. 检查项目 Trust；
6. 加载 Credential Store；
7. 初始化模型目录和 Model Runtime；
8. 打开或创建 Session；
9. 加载上下文文件、Prompt、Skills 和 Extensions；
10. 构造 `AgentSessionRuntime`；
11. 创建 `AgentSession`；
12. 根据运行模式交给 TUI、Print 或 RPC 层。

### 2.2.2 工具调用阶段

工具调用不是直接执行，而是经过多层包装：

```text
模型生成 Tool Call
    ↓
Tool 名称查找
    ↓
参数解析和 Schema 校验
    ↓
beforeToolCall Hook
    ↓
工具执行
    ↓
执行过程中的增量事件
    ↓
afterToolCall Hook
    ↓
Tool Execution End
    ↓
Tool Result Message
    ↓
写回 Session 和 LLM Context
```

这套机制为 SecAgent 提供了插入安全策略的接口：SecAgent 可以在 `beforeToolCall` 或 Pi 的 `tool_call` 事件阶段检查工具、参数、目标范围和风险，决定允许、确认或阻断。

### 2.2.3 Session、Branch 和 Compaction

Pi 的 Session 不是简单的线性聊天记录，而是带树结构的 JSONL 文件：

```text
Session Header
    ↓
User Message
    ↓
Assistant Message
    ↓
Tool Result
    ├─ Branch A
    └─ Branch B
```

每条 Entry 通常通过 `id` 和 `parentId` 连接。这样可以：

- 在 `/tree` 中从历史节点切换分支；
- 从旧 User Message 执行 `/fork`；
- 使用 `/clone` 复制当前分支；
- 保留完整历史，而不是直接覆盖旧记录。

当 Context 接近模型限制时，Pi 会执行 Compaction：

1. 选择需要保留的历史边界；
2. 使用模型生成摘要；
3. 将摘要作为特殊 Compaction Entry 写入 Session；
4. 保留较新的消息；
5. 继续后续 Agent 工作。

Context Overflow 时还可能执行“压缩后重试”。这说明 Context 管理是 Agent 正确性的组成部分，而不是单纯的性能优化。

### 2.2.4 Extension、Skill 和 Prompt Template

三者职责不同：

- **Extension**：代码级扩展，可以注册工具、命令、快捷键、事件处理器和 UI；
- **Skill**：能力说明和操作规范，按照需要被模型加载；
- **Prompt Template**：可复用的提示词模板，用于快速生成标准任务指令。

Pi 的 Extension 生命周期包括 Session Start、Before Agent Start、Tool Call、Tool Result、Session Switch、Compaction、Tree Navigation 和 Shutdown 等阶段。

# 3. 加入 SecAgent 的总体架构

## 3.1 设计边界

SecAgent 的定位不是替换 Pi，而是向 Pi 增加安全任务所需的控制平面：

```text
Pi：通用 Agent 执行能力
    ├─ 模型调用
    ├─ Agent Loop
    ├─ 工具执行
    ├─ Session
    ├─ Extension
    └─ 多 Agent / RPC / Web UI

SecAgent：安全任务控制平面
    ├─ Security State
    ├─ Authorization Scope
    ├─ Policy Mode
    ├─ Tool Registry
    ├─ Candidate Action Ranking
    ├─ Risk Assessment
    ├─ Audit Trail
    ├─ Evidence / Finding
    └─ Security Report
```

通用能力复用 Pi，安全语义由 SecAgent 自己负责。这样可以避免把网络安全规则散落在每个工具、每个 Agent 或每个 UI 组件中。

## 3.2 SecAgent 文件结构

```text
.pi/
├── SECAGENT.md                 # 当前项目的安全层架构说明
├── settings.json               # 项目级 Pi 包和运行时依赖
├── sandbox.json                # Sandbox 文件系统和网络策略
├── agents/                     # 安全领域专业 Agent 定义
│   ├── sec-recon.md
│   ├── sec-web.md
│   ├── sec-analysis.md
│   └── sec-response.md
├── extensions/                 # Pi Extension 入口
│   ├── security-agent.ts       # 安全控制平面
│   ├── security-report.ts      # 报告生成
│   ├── project-trust.ts
│   ├── protected-paths.ts
│   ├── questionnaire.ts
│   ├── plan-mode.ts
│   └── tools.ts
└── secagent/
    ├── core/
    │   ├── types.ts            # SecurityState、Risk、Scope、Audit 类型
    │   ├── state.ts            # 状态创建、事件追加、状态重放
    │   ├── planner.ts          # 候选动作评分和排序
    │   ├── policy.ts           # 风险判断和权限决策
    │   ├── scope.ts            # 目标范围提取和匹配
    │   └── audit.ts            # 审计记录读取和格式化
    ├── tools/
    │   ├── catalog.ts          # 安全工具元数据
    │   └── registry.ts         # 工具解析、别名和风险归并
    ├── integrations/
    │   └── mcp-policy.ts       # MCP 调用到 SecAgent 策略的桥接
    ├── report/
    │   └── generator.ts        # Markdown / JSON 报告
    └── tests/                  # 安全内核和集成测试
```

对应源码跳转：

| 模块 | 源码链接 | 理解重点 |
| --- | --- | --- |
| 安全 Extension 入口 | [`security-agent.ts`](../.pi/extensions/security-agent.ts) | 注册安全工具、监听 Agent 生命周期和拦截 Tool Call |
| 报告 Extension | [`security-report.ts`](../.pi/extensions/security-report.ts) | 注册 `security_report` 和 `/sec-report` |
| 安全类型 | [`types.ts`](../.pi/secagent/core/types.ts) | SecurityState、Risk、Scope、Evidence、Finding 和 Audit 类型 |
| 状态事件 | [`state.ts`](../.pi/secagent/core/state.ts) | 创建状态、追加事件、从 Session 重放状态 |
| 动作规划 | [`planner.ts`](../.pi/secagent/core/planner.ts) | 候选动作评分、排序和风险等级映射 |
| 风险策略 | [`policy.ts`](../.pi/secagent/core/policy.ts) | 工具风险分析和 allow/confirm/deny 决策 |
| Scope 判断 | [`scope.ts`](../.pi/secagent/core/scope.ts) | URL、域名、IPv4、CIDR 和工具参数的范围检查 |
| 工具目录 | [`catalog.ts`](../.pi/secagent/tools/catalog.ts) | 工具元数据、能力、前置条件和推荐 Agent |
| 工具注册表 | [`registry.ts`](../.pi/secagent/tools/registry.ts) | 工具解析、别名、Shell 嵌套命令和风险归并 |
| MCP 策略桥 | [`mcp-policy.ts`](../.pi/secagent/integrations/mcp-policy.ts) | 将 MCP Proxy 调用转换为 SecAgent 风险和 Scope 判断 |
| 审计 | [`audit.ts`](../.pi/secagent/core/audit.ts) | 读取、摘要和格式化工具审计记录 |
| 报告生成 | [`generator.ts`](../.pi/secagent/report/generator.ts) | 生成 Markdown 和 JSON 安全报告 |
| Recon Agent | [`sec-recon.md`](../.pi/agents/sec-recon.md) | 授权范围内的资产和服务发现规范 |
| Web Agent | [`sec-web.md`](../.pi/agents/sec-web.md) | Web 暴露面分析和受控验证规范 |
| Analysis Agent | [`sec-analysis.md`](../.pi/agents/sec-analysis.md) | 本地文件、源码、日志和证据分析规范 |
| Response Agent | [`sec-response.md`](../.pi/agents/sec-response.md) | 修复、遏制、验证和恢复规范 |

配置和运行时边界：

- [`settings.json`](../.pi/settings.json)：项目固定的 Sandbox、MCP、Subagent 和 Trace 包；
- [`sandbox.json`](../.pi/sandbox.json)：文件系统、网络和敏感路径限制；
- [`.mcp.json`](../.mcp.json)：MCP 发现、直接工具和认证策略；
- [`SECAGENT.md`](../.pi/SECAGENT.md)：项目安全层的设计说明。

## 3.3 Security State

SecAgent 不应只依赖模型上下文记住任务状态，而是维护结构化状态：

```text
SecurityState
├─ goal
├─ stage
├─ policyMode
├─ scope
├─ evidence
├─ hypotheses
├─ findings
└─ decisions
```

当前阶段包括：

```text
understanding
recon
analysis
verification
response
report
```

状态通过 Pi Session Entry 事件化保存。程序可以从 Session 事件重放出当前状态，而不是依赖一个不可追踪的内存对象。

这样做的意义是：

- 可以恢复任务；
- 可以回溯状态变化；
- 可以解释 Agent 为什么选择某个动作；
- 可以在报告中引用证据和决策；
- 可以让后续评测检查行为是否符合安全流程。

## 3.4 Scope：授权目标边界

`security_scope` 负责维护当前任务明确授权的目标范围，例如：

- Host；
- Domain；
- IPv4；
- CIDR；
- URL。

网络工具执行前，SecAgent 会从工具参数中提取目标，并判断目标是否落在当前 Scope 内。

目标检查必须独立于风险策略：

- 即使当前模式允许 P2，也不能访问 Scope 外的目标；
- 切换到 `competition` 模式不能扩大授权范围；
- 无法证明目标属于授权范围时，应停止并要求澄清。

## 3.5 Tool Registry：工具不是普通命令

SecAgent 为工具维护结构化元数据：

```text
SecurityToolMetadata
├─ name
├─ aliases
├─ category
├─ baseRisk
├─ scopeMode
├─ capabilities
├─ preconditions
├─ postconditions
├─ recommendedAgents
└─ description
```

目前工具大致分为：

- internal：安全状态、Scope、决策和注册表；
- local：read、grep、find、ls；
- response：edit、write；
- shell：bash；
- network：curl、wget、ssh、scp、nc；
- recon：httpx、nmap、masscan；
- web：nuclei、ffuf、gobuster、dirsearch、nikto、wpscan、sqlmap；
- high-risk：hydra、msfconsole 等。

工具注册表的价值在于，安全策略不必完全依赖模型对命令名的猜测。模型提供的风险提示只能作为输入，不能降低注册表规定的最低风险。

## 3.6 风险策略

SecAgent 使用 P0-P3 风险等级：

| 等级 | 含义 | 典型行为 |
| --- | --- | --- |
| P0 | 只读或内部状态操作 | 读取文件、查看状态、查询工具信息 |
| P1 | 低影响本地或网络交互 | 普通 HTTP 请求、低风险信息收集 |
| P2 | 入侵性探测或本地修改 | 端口扫描、内容发现、修改文件 |
| P3 | 高风险验证或破坏性行为 | Exploit 验证、高速认证测试、破坏性命令 |

当前策略模式：

- `strict`：P0/P1 自动允许，P2/P3 需要确认；
- `competition`：允许部分 P2，但 P3 仍然需要确认。

此外，Shell 命令还会进行二次分析，例如：

- 递归删除；
- 文件系统格式化；
- 直接写入块设备；
- 关闭或重启主机；
- 清空防火墙；
- 将远程内容直接 Pipe 给 Shell。

即使命令名本身风险不明显，嵌套命令也可能把整体动作提升到 P3。

## 3.7 安全执行闭环

SecAgent 的完整控制流是：

```text
用户任务
  ↓
security_state start_task
  ↓
security_scope 设置授权目标
  ↓
记录证据和假设
  ↓
提出候选动作
  ↓
security_decide 对候选动作排序
  ↓
查询 security_tools
  ↓
工具注册表解析
  ↓
风险策略判断
  ↓
Scope 判断
  ↓
ALLOW / CONFIRM / BLOCK
  ↓
Pi 工具执行
  ↓
写入审计记录和 Trace
  ↓
更新证据、Finding 和状态
  ↓
重新规划
  ↓
security_report
```

关键点是：安全控制不能只出现在 System Prompt 中。Prompt 可以约束模型，但真正的阻断必须出现在工具执行前的程序逻辑中。

## 3.8 MCP、Sandbox、Subagent 和 Trace

当前项目通过 `.pi/settings.json` 固定以下项目级运行时包：

- `pi-sandbox`：提供操作系统级文件和网络边界；
- `pi-mcp-adapter`：提供 MCP 发现和代理调用；
- `pi-subagents`：提供子 Agent 编排；
- `pi-trace-extension`：记录执行树、子 Session、模型和工具活动。

这些能力与 SecAgent 的职责不同：

```text
pi-sandbox        负责 OS 级隔离
SecAgent Scope    负责授权目标判断
SecAgent Policy   负责风险与确认
Pi Trace          负责记录执行了什么
SecAgent Audit    负责解释为什么允许、阻断或确认
```

网络访问需要同时满足两层条件：

1. SecAgent Scope 和 Policy 允许；
2. Sandbox 允许目标和网络访问。

MCP 不应被视为天然可信边界。MCP 的代理调用仍需经过工具风险判断和目标 Scope 检查。

## 3.9 专业 Agent

当前项目定义了四类专业 Agent：

- `sec-recon`：授权范围内的资产、服务、DNS 和暴露面发现；
- `sec-web`：Web 面分析、端点发现、配置检查和受控验证；
- `sec-analysis`：文件、源码、日志、指标和其他本地证据分析；
- `sec-response`：遏制、修复、验证和恢复动作设计。

专业 Agent 负责领域工作，但不拥有扩大 Scope 或绕过安全策略的权限。协调 Agent 仍然需要维护任务状态、决定授权范围和选择下一步动作。

## 3.10 Audit 和 Report

每次安全工具执行都会尽量记录：

- 工具名称和工具调用 ID；
- Registry 解析结果；
- 风险等级和风险原因；
- Scope 检查结果；
- Policy Mode；
- allow、confirm 或 deny 决策；
- 用户是否批准；
- 是否被阻断；
- 输入摘要；
- 执行结果摘要；
- 错误信息和完成时间。

报告可以输出为：

- Markdown：适合人工审阅、演示和竞赛提交；
- JSON：适合重放、评测和后续流水线处理。

# 4. Pi 与 SecAgent 的组合架构

```text
┌─────────────────────────────────────────────┐
│                 User / Web UI / RPC          │
└──────────────────────┬──────────────────────┘
                       ↓
┌─────────────────────────────────────────────┐
│              pi-coding-agent                 │
│  Session / Settings / Extensions / Tools     │
└───────────────┬─────────────────────────────┘
                ↓
┌─────────────────────────────────────────────┐
│              pi-agent-core                   │
│  Agent Loop / State / Tool Call / Events     │
└───────────────┬─────────────────────────────┘
                ↓
┌─────────────────────────────────────────────┐
│                  pi-ai                       │
│  Provider / Auth / Stream / Usage / Models   │
└───────────────┬─────────────────────────────┘
                ↓
┌─────────────────────────────────────────────┐
│          OpenAI / Anthropic / Google ...     │
└─────────────────────────────────────────────┘

              Security Control Plane
┌─────────────────────────────────────────────┐
│ SecurityState / Scope / Policy / Registry    │
│ Planner / Audit / Evidence / Report          │
└───────────────┬─────────────────────────────┘
                ↓
       beforeToolCall / tool_call Hook
                ↓
       ALLOW / CONFIRM / BLOCK
```

## 4.1 责任边界

### Pi 负责

- 如何调用模型；
- 如何运行 Agent Loop；
- 如何执行通用工具；
- 如何保存 Session；
- 如何加载 Extension 和 Skill；
- 如何显示终端、JSON、RPC 和 Web 事件。

### SecAgent 负责

- 任务处于哪个安全阶段；
- 用户授权了哪些目标；
- 当前工具风险是多少；
- 是否需要确认；
- 是否需要阻断；
- 哪些证据可以成为 Finding；
- 为什么选择某个动作；
- 如何生成安全报告。

# 5. 对项目的进一步理解

## 5.1 Agent Loop 不是唯一核心问题

Pi 的 Agent Loop 已经具备比较完整的流式请求、Tool Call、事件、队列、Abort、重试和 Compaction 能力。继续优化 Loop 当然有价值，但对安全任务而言，单纯提高循环速度并不能解决主要问题。

更典型的问题是：

```text
模型发现一个可能的攻击面
  ↓
选择一个命令
  ↓
命令需要目标、权限、速率和前置条件
  ↓
如果工具描述不完整，模型可能参数错误或越权
  ↓
如果上下文没有记录证据，后续 Agent 可能重复扫描
  ↓
如果没有审计，最终报告无法解释动作来源
```

因此，工具封装和 Context 管理直接影响安全 Agent 的可靠性。

## 5.2 工具封装的改进方向

安全工具不应只暴露一个类似 `bash(command)` 的黑盒接口。更可靠的工具定义应至少包含：

- 目标参数；
- 目标类型；
- 风险等级；
- Scope 模式；
- 速率限制；
- 是否有副作用；
- 前置条件；
- 后置验证；
- 输出格式；
- 证据类型；
- 推荐使用的专业 Agent。

例如，`nmap` 的工具定义不能只告诉模型“执行端口扫描”，还应描述扫描目标、端口范围、扫描强度、授权要求、输出如何转成 Observation，以及何时需要进一步验证。

## 5.3 Context 管理的改进方向

安全任务的上下文不应只是一长串对话。更适合拆成：

```text
任务目标
授权范围
当前阶段
已知资产
已验证服务
观察结果
假设
候选动作
已执行动作
被阻断动作
确认 Findings
剩余问题
```

普通对话历史适合语言理解，结构化 SecurityState 适合任务控制。两者应同时存在：

- 对话历史提供模型语境；
- SecurityState 提供可恢复、可审计和可重放的任务状态。

## 5.4 安全策略不能只依赖 Prompt

Prompt 可以要求模型“不要越权”，但不能作为最终安全边界。真正的策略必须在代码路径中实现：

```text
模型提出 Tool Call
  ↓
程序解析工具和参数
  ↓
程序检查风险
  ↓
程序检查目标 Scope
  ↓
程序决定允许、确认或阻断
```

这也是当前 SecAgent 将策略放在 `tool_call` Hook、Registry 和 Policy 模块中的原因。

# 6. 建议的源码阅读顺序

如果要继续深入源码，建议按照下面的顺序阅读：

1. 根目录 [`README.md`](../README.md) 和 [`package.json`](../package.json)；
2. [`packages/ai/src/types.ts`](../packages/ai/src/types.ts)；
3. [`packages/ai/src/models.ts`](../packages/ai/src/models.ts)；
4. [`packages/agent/src/types.ts`](../packages/agent/src/types.ts)；
5. [`packages/agent/src/agent-loop.ts`](../packages/agent/src/agent-loop.ts)；
6. [`packages/agent/src/agent.ts`](../packages/agent/src/agent.ts)；
7. [`packages/coding-agent/src/main.ts`](../packages/coding-agent/src/main.ts)；
8. [`packages/coding-agent/src/core/agent-session.ts`](../packages/coding-agent/src/core/agent-session.ts)；
9. [`packages/coding-agent/src/core/session-manager.ts`](../packages/coding-agent/src/core/session-manager.ts)；
10. [`packages/coding-agent/src/core/extensions/runner.ts`](../packages/coding-agent/src/core/extensions/runner.ts)；
11. [`packages/coding-agent/src/core/tools/index.ts`](../packages/coding-agent/src/core/tools/index.ts)；
12. [`.pi/extensions/security-agent.ts`](../.pi/extensions/security-agent.ts)；
13. [`.pi/secagent/core/policy.ts`](../.pi/secagent/core/policy.ts)、[`.pi/secagent/core/scope.ts`](../.pi/secagent/core/scope.ts)、[`.pi/secagent/core/state.ts`](../.pi/secagent/core/state.ts)；
14. [`.pi/secagent/tools/registry.ts`](../.pi/secagent/tools/registry.ts)；
15. [`.pi/secagent/report/generator.ts`](../.pi/secagent/report/generator.ts)；
16. [`packages/web-ui/lib/rpc-manager.ts`](../packages/web-ui/lib/rpc-manager.ts) 和 [`packages/web-ui/hooks/useAgentSession.ts`](../packages/web-ui/hooks/useAgentSession.ts)。

推荐的阅读顺序是“先理解调用链，再理解安全控制”，不要一开始就从大量 TUI 组件或 Provider 文件进入，否则容易陷入实现细节而看不清主架构。

# 7. 当前项目状态和常用命令

核心 Pi 包当前版本为 `0.84.2`，Web UI 当前版本为 `0.8.9`。核心入口是 `packages/coding-agent`，当前项目特有逻辑主要位于 `.pi/`。

常用命令：

```bash
npm install --ignore-scripts
npm run build
npm run build:offline
npm run check
./test.sh
./pi-test.sh
```

核心包构建顺序大致为：

```text
tui
→ telemetry
→ ai
→ agent
→ protocol
→ client
→ server
→ coding-agent
```

`coding-agent` 最终会生成 Node CLI Bundle，也可以生成 Bun 独立二进制。Web UI 有自己的 Next.js 开发和测试命令。

当前工作区的 Git 分支为 `feat/secagent-security-kernel`，最近的提交加入了 Web UI 源码。工作区中另有一个未跟踪文件 `diag-sandbox.mjs`，它不属于本笔记的架构内容。
