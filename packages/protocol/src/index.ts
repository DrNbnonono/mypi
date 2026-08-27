// protocol 定义跨进程边界上的稳定数据模型、CBOR 编码和长度前缀帧。它不负责
// Client/Server 的业务状态，只保证消息可校验、可传输并能被增量解码。
export * from "./cbor/index.ts";
export * from "./codec.ts";
export * from "./framing.ts";
export * from "./schemas.ts";
