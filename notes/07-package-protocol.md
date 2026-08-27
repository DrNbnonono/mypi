# `packages/protocol` 阅读笔记

## 1. 包定位

`protocol` 是 Client/Server 的跨进程数据边界，负责消息 schema、CBOR 编码和长度前缀分帧，不负责 Session 业务和 Agent 执行。

入口：[`src/index.ts`](../packages/protocol/src/index.ts)

```text
schemas.ts  定义消息形状
    ↓
codec.ts    校验 + CBOR 编解码
    ↓
framing.ts  4 字节长度前缀 + 增量分帧
```

## 2. Schema

源码：[`schemas.ts`](../packages/protocol/src/schemas.ts)

Schema 描述 ClientMessage、ServerMessage、Command、Response、Event 和 Snapshot。协议层只暴露跨进程需要的字段，内部 `pi-ai` 消息中的 Provider 诊断、缓存细节和运行时对象不会直接穿过协议边界。

## 3. Frame

源码：[`framing.ts`](../packages/protocol/src/framing.ts)

`encodeFrame(payload)` 在 payload 前写入 4 字节无符号大端长度。`FrameDecoder.push(chunk)` 允许：

- 一个 header 被拆成多个 chunk；
- 一个 payload 被拆成多个 chunk；
- 一个 chunk 中包含多个 frame。

`maxFrameLength` 是资源保护参数，防止恶意长度头触发超大内存分配。`end()` 用于确认输入流没有残留半个 frame。

## 4. Codec

源码：[`codec.ts`](../packages/protocol/src/codec.ts)

编码顺序：

```text
ClientMessage / ServerMessage
  -> JSON-like value 检查
  -> TypeBox schema 检查
  -> CBOR 编码
  -> encodeFrame
```

解码执行相反顺序。`ClientMessageDecoder` 和 `ServerMessageDecoder` 通过 `push()` 增量接收数据；任意 frame、CBOR 或 schema 错误都会让 decoder 进入失败状态，必须重新建立连接。

`maxFrameLength` 会同时限制 CBOR 和 frame，避免一层允许而另一层拒绝。

## 5. 版本和错误

`PROTOCOL_VERSION` 用于 hello 握手。服务端首先验证客户端版本，版本不支持时返回 `hello_error`。

`ProtocolValidationError` 表示输入或输出不符合协议；它不是 Agent 运行失败。Server 会把它转换为稳定的 protocol error，Client 则将 response error 转成客户端错误类型。

## 6. 阅读重点

阅读时不要把 frame、codec、schema 混为一层：

- frame 只知道 bytes；
- codec 知道 CBOR 和边界大小；
- schema 知道业务消息字段；
- server/client 才知道消息应该如何驱动 Session。
