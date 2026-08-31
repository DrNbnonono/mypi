export interface RunStartEvent {
	type: "run_start";
	lane: string;
	runId: string;
}

export interface RunEndEvent {
	type: "run_end";
	lane: string;
	runId: string;
	outcome: "completed" | "aborted" | "failed";
	leafId: string;
}

export type HarnessEvent = RunStartEvent | RunEndEvent;
export type HarnessEventType = HarnessEvent["type"];
export type HarnessEventOfType<TType extends HarnessEventType> = Extract<HarnessEvent, { type: TType }>;
export type HarnessEventListener<TEvent extends HarnessEvent = HarnessEvent> = (event: TEvent) => void | Promise<void>;

// 事件类型
export interface Events {
	/**
	 * Register a passive listener for future events and return its unsubscribe function.
	 * Earlier events are not replayed and no current-state snapshot is provided; use a lane or session watch for both.
	 * 登记一个被动的事件监听器，返回取消订阅函数。不会重放早期事件，也不会提供当前状态快照；使用 lane 或 session watch 来获取两者。
	 */
	on<TType extends HarnessEventType>(
		type: TType,
		listener: HarnessEventListener<HarnessEventOfType<TType>>,
	): () => void;
}

// 事件总线
export interface WatchHandle<TSnapshot> {
	snapshot: TSnapshot;
	start(listener: HarnessEventListener): void;
	unsubscribe(): void;
}

// harness 事件总线实现
export class HarnessEventBus implements Events {
	private readonly listeners = new Map<HarnessEventType, Set<HarnessEventListener>>();
	private readonly watchListeners = new Set<(event: HarnessEvent) => void>();

	/**
	 * Register a listener for future events of one type and return its unsubscribe function.
	 * Earlier events are not replayed, and no snapshot or event buffer is provided.
	 * 注册一个监听器，用于未来的某一类型事件，并返回其取消订阅函数。不会重放早期事件，也不会提供快照或事件缓冲区。
	 */
	on<TType extends HarnessEventType>(
		type: TType,
		listener: HarnessEventListener<HarnessEventOfType<TType>>,
	): () => void {
		// Reuse this event type's listener set, or create its first set.
		const listeners = this.listeners.get(type) ?? new Set<HarnessEventListener>();
		this.listeners.set(type, listeners);

		// Wrap this event-specific callback so it can be stored as a general HarnessEvent listener.
		// Keep the wrapper reference so unsubscribe can remove that exact function from the set.
		const receive: HarnessEventListener = (event) => {
			if (event.type === type) return listener(event as HarnessEventOfType<TType>);
		};
		listeners.add(receive);
		return () => {
			listeners.delete(receive);
			if (listeners.size === 0) this.listeners.delete(type);
		};
	}

	/** Publish an event to current event subscriptions and watch subscriptions. */
	// 将事件发布到当前事件订阅和观察订阅。
	emit(event: HarnessEvent): void {
		// Deliver only to direct listeners registered for this event type.
		// Async results are not awaited because emit() is synchronous.
		for (const listener of this.listeners.get(event.type) ?? []) void listener(event);

		// Deliver every event to each watcher; watch() handles buffering until start().
		for (const listener of this.watchListeners) listener(event);
	}

	watch<TSnapshot>(captureSnapshot: () => TSnapshot): WatchHandle<TSnapshot> {
		let listener: HarnessEventListener | undefined;
		let buffered: HarnessEvent[] = [];
		const receive = (event: HarnessEvent): void => {
			if (listener) void listener(event);
			else buffered.push(event);
		};
		this.watchListeners.add(receive);
		const snapshot = captureSnapshot();

		return {
			snapshot,
			start: (nextListener) => {
				// Stay in buffering mode while flushing so reentrant emissions preserve order.
				while (buffered.length > 0) {
					const pending = buffered;
					buffered = [];
					for (const event of pending) void nextListener(event);
				}
				listener = nextListener;
			},
			unsubscribe: () => {
				this.watchListeners.delete(receive);
				buffered = [];
			},
		};
	}
}
