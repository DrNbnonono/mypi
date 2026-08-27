# `packages/telemetry` 阅读笔记

## 1. 包定位

`telemetry` 提供厂商无关的 `TelemetryContext`、`TelemetrySpan` 和 schema 类型推导。它是旁路观测系统，不应改变 Agent、Server 或 Session 的业务结果。

入口：[`src/index.ts`](../packages/telemetry/src/index.ts)

## 2. 基本 API

```text
TelemetryContext.startSpan()
  -> TelemetrySpan
       -> startSpan(child)
       -> addEvent()
       -> setAttributes()
       -> setStatus()
```

`startSpan(options, callback)` 使用 callback 界定 span 生命周期。callback 同步抛错或异步 rejection 时，span 会被标记为 error，但原始错误仍返回给业务调用方。

## 3. Schema

`TelemetrySchemaDefinition` 描述：

- span 名称；
- 父子关系；
- start/end 属性；
- 属性类型和允许值；
- 是否必填；
- 敏感性和 cardinality。

`defineTelemetrySchema()` 的作用主要是保留字面量类型，`createTypedSpanStarter()` 再将 schema 变成编译期受约束的 span starter。注释中的 `_schemas` 参数是类型推导输入，运行时不会执行完整 schema 校验。

## 4. InMemory 实现

源码：[`memory.ts`](../packages/telemetry/src/memory.ts)

`InMemoryTelemetryContext` 用于测试和诊断，记录 span 的：

- id / parentId；
- name / attributes；
- events；
- status；
- settle 顺序。

属性和结果通过复制返回，避免调用方修改已记录数据。记录失败不会反向影响业务 callback。

## 5. 阅读重点

在 `agent` 中可以看到 `startHarnessSpan`，在 `ai` 中可以看到 `pi.ai.request`。Telemetry schema 描述“发生了什么”，而不是决定“应该做什么”。安全策略、工具授权和 Session 恢复不能只依赖 Telemetry。
