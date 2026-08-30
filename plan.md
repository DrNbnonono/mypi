# SecAgent package 化与 Coding/Sec 双模式迁移计划

## 总体方案

- 新增 `packages/secagent`，包名为 `@earendil-works/pi-secagent`，版本与仓库其他包锁步。
- SecAgent 继续复用稳定的 `AgentSession`、Extension 和 ResourceLoader，不依赖目前尚未完成的 `AgentHarness`。
- `pi` 默认保持 coding 模式；SecAgent 只有在新建 sec Session 时加载。
- 模式按 Session 固定并持久化。旧 Session 缺少模式字段时按 coding 处理。
- 已有会话切换模式时，在相同 cwd 创建目标模式的空白会话，原会话保持不变。
- `.pi` 最终只保留项目配置和覆盖文件；安全内核、扩展、测试、报告和专业 Agent 定义迁入正式 package。

## 核心架构与公共接口

### Agent Profile

在 coding-agent 中增加通用 Profile 抽象：

```ts
export type AgentMode = "coding" | "sec";

export interface AgentProfileDefinition {
  mode: AgentMode;
  displayName: string;
  createExtensions(): InlineExtension[];
  createRuntime?(context: AgentProfileContext): AgentProfileRuntime;
  resourcePaths?: ProfileResourcePaths;
}
```

- coding profile 使用现有 System Prompt、工具和资源加载路径，不改变现有行为。
- sec profile 由 `@earendil-works/pi-secagent` 提供，加载安全协议、工具、专业 Agent、MCP、sandbox、subagents 和 trace。
- Profile Runtime 提供通用的 `snapshot()`、`command()` 和状态变更事件，供 CLI 和 Web 访问安全状态，不让 Web 直接解析 Session 内部条目。

### Session 与 SDK

- `CreateAgentSessionOptions`、Runtime 创建参数和 AgentSession 增加可选 `agentMode`。
- Session header 增加可选 `agentMode: "coding" | "sec"`，不升级旧格式版本。
- 新建、fork、resume、导入时保持原 Session 模式；显式参数与已存模式冲突时拒绝启动。
- AgentSession 暴露只读 `agentMode`、Profile 信息和 Profile Runtime。
- coding-agent RPC/get-state 事件增加 `agentMode` 和可选 `profileState`。
- 不修改底层 Agent Loop；所有安全能力通过 Profile、工具、Hook 和 Session entry 实现。

### CLI 行为

- 新增 `--agent-mode coding|sec`，保留现有 `--mode text|json|rpc` 含义。
- `pi`、旧脚本和旧 Session 默认继续使用 coding。
- TUI 增加 `/agent-mode coding|sec`；在已有 Session 中调用时创建同 cwd 空白会话。
- Sec 模式显示当前安全策略、scope 状态和隔离状态。
- `--continue`、`--resume` 或 `--session` 与显式模式冲突时返回明确错误，不静默改变会话模式。

## SecAgent package 迁移与比赛能力

### 迁移内容

- 将现有安全 core、planner、policy、scope、state、audit、tool registry、MCP policy、report 和测试迁入 `packages/secagent`。
- 将 `security-agent.ts` 和 `security-report.ts` 重构为 package 内 Profile 扩展，共享同一个 `SecAgentRuntime`，消除扩展各自维护状态的问题。
- 将 `sec-recon`、`sec-web`、`sec-analysis`、`sec-response` 迁入 package，并补充漏洞挖掘和逆向分析专业 Agent。
- 通过模式级本地 package 资源注册让 `pi-subagents` 发现专业 Agent，不再依赖项目 `.pi/agents`。
- 精确锁定 `pi-sandbox@0.6.3`、`pi-mcp-adapter@2.23.0`、`pi-subagents@0.50.0`、`pi-trace-extension@0.1.14`；仅 sec 模式加载。
- 删除迁移完成后的 `.pi/secagent` 和安全扩展入口；`.pi/sandbox.json`、`.mcp.json` 保留为当前项目的部署覆盖，package 同时提供可复制的默认模板。

### 任务理解

增加结构化 `SecurityTaskSpec` 和 `security_intake`：

- 接收自然语言、文本、图片、JSON、YAML、CSV、PDF、OpenAPI/Swagger 和压缩包。
- 压缩包只解压到临时隔离目录，限制文件数、总大小、嵌套深度，阻止路径穿越、符号链接逃逸和解压炸弹。
- 提取目标、场景、输入资产、约束、成功条件、用户声明的授权信息和待确认项。
- 附件中的目标不能自动视为已授权目标，scope 必须由用户或受控比赛环境明确提供。

### 决策与多场景执行

- 场景至少覆盖渗透测试、应急响应、漏洞挖掘、Web 安全和逆向分析。
- 将当前候选动作评分扩展为“任务计划—候选动作—执行—证据—重新规划”状态机。
- 每个决策记录输入证据、候选方案、风险、成本、选择原因、预期结果和实际结果。
- 工具失败、结果矛盾、前置条件变化或新增证据时自动重新规划。
- 专业 Agent 使用有界任务、工具白名单、运行时间、轮次和并发预算；主 Agent 保持最终决策权。

### 工具适配层

定义统一 `SecurityToolAdapter`：

- 包含工具元数据、风险、能力、目标提取、前置/后置条件、执行入口和证据规范化。
- 支持受控环境中的 CLI 工具和 MCP 工具，不在仓库中重新实现扫描器。
- 工具缺失、版本不兼容或前置条件不满足时返回结构化诊断，不退化为未经审计的 shell 调用。
- 所有调用统一经过 registry 解析、scope/policy 判定、执行、结果归一化和审计。
- 未知工具采用保守风险下限；shell 管道继承其中最高风险工具的等级。

### 策略模式

提供三档独立于 coding/sec 的安全策略：

- `strict`：P2/P3 逐次确认。
- `competition`：P2 自动放行，P3 确认。
- `autonomous`：启动时一次授权，之后不逐工具确认；scope 越界记录高危告警但不在应用层阻断。

`autonomous` 必须满足：

- 成功启用 `pi-sandbox`，或显式声明主办方受控外部隔离环境。
- CLI/Web 完成一次风险确认并写入 Session 审计。
- 非交互运行必须同时提供隔离环境标记和固定确认值，否则拒绝启动。
- OS/container 边界、受保护凭证路径和审计不可关闭。
- 策略变更记录操作者、时间、隔离来源和变更原因。

### 可解释性与报告

- Session 中持久化任务状态、scope、证据、假设、发现、决策、审批和工具审计。
- 证据记录来源、摘要、哈希、时间、置信度及关联决策。
- 报告支持 Markdown 和 JSON，包含任务目标、授权范围、执行时间线、证据、确认发现、被否定假设、决策依据、工具结果、失败和修复建议。
- 对导出的 prompt、工具参数、凭证和 trace 提供脱敏步骤。
- 增加可重放评测格式，用于证明相同输入和配置可产生可追踪的执行路径。

### 比赛环境与部署

- 提供 CLI 和 Web 的一键容器化部署，挂载最小工作目录和工具目录。
- 支持通过配置接入国内备案模型 API 和主办方 AI 安全网关，不硬编码供应商或密钥。
- 增加启动诊断：模型连通性、网关、工具版本、MCP、专业 Agent、sandbox、可写目录和报告目录。
- 提供离线依赖清单、工具镜像版本、部署手册、开发文档、测试报告、用户手册、技术报告、PPT 提纲和演示脚本。
- 文档按比赛五个评分维度建立需求—实现—测试—证据映射。

## Web UI 同步

- 新会话区域增加 Coding/Sec 选择器，首次默认 coding，后续记住浏览器最近选择。
- Session 列表和聊天标题显示模式徽标；旧 Session 显示 coding。
- 已有会话切换模式时创建同 cwd 空白会话，不复制历史消息。
- `/api/agent/new`、Session API、running snapshot 和 SSE 增加 `agentMode`。
- 新增通用 Profile API，由 AgentSession Profile Runtime 处理查询和命令。
- Sec 模式显示安全工作区：
  - 任务和阶段；
  - 授权 scope；
  - 当前策略和隔离状态；
  - 证据、假设和确认发现；
  - 决策候选及选择依据；
  - 工具审计时间线；
  - Markdown/JSON 报告预览和下载。
- scope、策略和 autonomous 授权通过结构化 API 修改，不通过模型聊天间接修改。
- P2/P3 确认继续复用现有 Extension UI 请求机制。
- coding 模式不加载安全面板、SecAgent 扩展或第三方安全运行包，现有布局和交互保持不变。

## 测试与验收

- 迁移并扩展 SecAgent 单元测试：scope、策略三模式、planner、registry、MCP、报告、状态重放和审计。
- 增加输入安全测试：恶意压缩包、路径穿越、超限文件、无效 OpenAPI、损坏结构化文件。
- coding-agent 测试覆盖参数解析、Session 模式持久化、fork/resume、模式冲突、Profile 资源隔离和 `/agent-mode`。
- Web 测试覆盖模式选择、API 传递、Session 徽标、同 cwd 新会话、安全面板、SSE 更新和报告下载。
- 使用 faux provider 和假工具适配器建立四类受控场景回归：渗透测试、应急响应、漏洞分析、逆向分析；不调用真实付费模型或外部目标。
- 增加故障场景：模型超时、工具缺失、工具失败、MCP 断线、Agent 中止、Session 恢复、并发子 Agent 和报告重建。
- 回归验收要求：
  - 无参数启动、旧 CLI 参数、旧 Session、coding 工具集和 Web coding 会话行为不变；
  - coding 模式不加载任何 SecAgent 资源；
  - sec Session 从 CLI 和 Web 恢复后仍保持 sec；
  - autonomous 未满足隔离前置条件时无法启用；
  - 每次安全工具调用均能关联到策略、scope、决策和审计记录。
- 实现后运行所有新增/修改的定向测试、`./test.sh` 和 `npm run check`；正式 build、容器 smoke test和发布流程在用户明确授权后执行。

## 默认假设

- coding 是全局默认模式，sec 必须显式选择。
- 模式不可在同一持久化 Session 内改变。
- 模式切换不迁移或总结旧上下文。
- SecAgent 是正式 workspace library/Profile，不新增独立 `pi-sec` 二进制。
- 外部安全工具由受控环境提供，仓库只维护标准适配器、版本检查和调用策略。
- 当前工作区已有修改均保留；迁移只处理明确属于 SecAgent 的文件和必要的共享接口。
