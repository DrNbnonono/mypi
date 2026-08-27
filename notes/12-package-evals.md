# `packages/evals` 阅读笔记

## 1. 包定位

`evals` 用可重复、可隔离的方式验证 coding-agent、Agent Loop、Session 和 Extension。它不应该依赖当前用户的默认模型或真实 Provider 状态。

入口：[`src/pi-harness.ts`](../packages/evals/src/pi-harness.ts)

## 2. Model 固定

[`resolveModelSelection`](../packages/evals/src/pi-harness.ts) 要求 Provider 和 model 同时明确：显式 options 优先，否则读取 `PI_PROVIDER` 和 `PI_MODEL`。缺少任意一个值就失败，防止测试因为机器配置变化而测试不同模型。

## 3. 每个 case 的隔离

[`runPiCodingAgent`](../packages/evals/src/pi-harness.ts) 为一次评测创建独立的：

- 临时 cwd；
- 临时 agentDir；
- ModelRuntime；
- SettingsManager；
- SessionManager；
- AgentSession。

测试结束后释放 runtime 并删除临时目录。这样前一个 case 的文件、Session、Settings、Extension 和消息不会污染后一个 case。

## 4. 结果和 Artifact

评测会把 Agent 消息转换成 transcript event：

```text
user message
assistant text
tool_call
tool_result
```

同时可以保存 Session snapshot、Session 文件和自定义 artifact。评测结果不仅要检查最终文本，也可以检查 tool call、Usage、Session 状态和 cleanup。

## 5. 阅读建议

先读 [`smoke.eval.ts`](../packages/evals/src/smoke.eval.ts) 看最小流程，再读 [`extensions.eval.ts`](../packages/evals/src/extensions.eval.ts) 看扩展行为，最后读 [`vitest-evals/`](../packages/evals/src/vitest-evals) 的 reporter 和 artifacts。评测层的价值是把事件顺序、状态恢复和边界错误变成可回归契约。
