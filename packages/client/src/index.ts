// client 将协议帧封装为面向应用的连接、Session Lease、快照和事件 API。
// 调用方不需要自己管理 request id、待处理 Promise、attach/detach 或断线清理。
export { PiClient } from "./client.ts";
export {
	PiClientDisposedError,
	PiDisconnectedError,
	PiServerError,
	PiSessionDetachedError,
	PiSessionOwnershipError,
} from "./errors.ts";
export type { AcquireSessionOptions, PiSessionHandle, SessionLease, SessionLeaseMode } from "./session-handle.ts";
export type { ByteTransport, ByteTransportFactory, ByteTransportHandlers } from "./transport.ts";
export type {
	ConnectionState,
	ConnectionStateChange,
	CreateSessionOptions,
	ListenerErrorHandler,
	PiClientOptions,
	Unsubscribe,
} from "./types.ts";
