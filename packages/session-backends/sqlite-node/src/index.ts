import type { SQLInputValue } from "node:sqlite";
import { DatabaseSync } from "node:sqlite";
import { sql } from "./sqlite/sql.ts";
import type { SqliteDatabase, SqliteDatabaseFactory, SqliteRunResult, SqliteStatement } from "./sqlite/types.ts";

function isNamedParameters(value: unknown): value is Record<string, SQLInputValue> {
	if (value === null || typeof value !== "object") return false;
	if (Array.isArray(value) || ArrayBuffer.isView(value)) return false;
	return true;
}

function isAsyncResult(value: unknown): boolean {
	return value !== null && (typeof value === "object" || typeof value === "function") && "then" in value;
}

class NodeSqliteStatement implements SqliteStatement {
	private readonly statement: ReturnType<DatabaseSync["prepare"]>;

	constructor(statement: ReturnType<DatabaseSync["prepare"]>) {
		this.statement = statement;
	}

	run(...params: unknown[]): SqliteRunResult {
		const [first, ...rest] = params;
		const result = isNamedParameters(first)
			? this.statement.run(first, ...(rest as SQLInputValue[]))
			: this.statement.run(...(params as SQLInputValue[]));
		return {
			changes: Number(result.changes),
			lastInsertRowid: result.lastInsertRowid === undefined ? undefined : Number(result.lastInsertRowid),
		};
	}

	get<TRow extends object>(...params: unknown[]): TRow | undefined {
		const [first, ...rest] = params;
		return (
			isNamedParameters(first)
				? this.statement.get(first, ...(rest as SQLInputValue[]))
				: this.statement.get(...(params as SQLInputValue[]))
		) as TRow | undefined;
	}

	all<TRow extends object>(...params: unknown[]): TRow[] {
		const [first, ...rest] = params;
		return (
			isNamedParameters(first)
				? this.statement.all(first, ...(rest as SQLInputValue[]))
				: this.statement.all(...(params as SQLInputValue[]))
		) as TRow[];
	}

	iterate<TRow extends object>(...params: unknown[]): Iterable<TRow> {
		const [first, ...rest] = params;
		return (
			isNamedParameters(first)
				? this.statement.iterate(first, ...(rest as SQLInputValue[]))
				: this.statement.iterate(...(params as SQLInputValue[]))
		) as Iterable<TRow>;
	}
}

class NodeSqliteDatabase implements SqliteDatabase {
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	exec(sql: string): void {
		this.db.exec(sql);
	}

	prepare(sql: string): SqliteStatement {
		return new NodeSqliteStatement(this.db.prepare(sql));
	}

	transaction<T>(fn: () => T): T {
		// Agent 的 Session mutation 必须是同步、原子的数据库操作；BEGIN IMMEDIATE
		// 先取得写锁，成功提交，失败回滚，异步 callback 会被拒绝以免事务悬挂。
		sql`BEGIN IMMEDIATE`.exec(this);
		try {
			const result = fn();
			if (isAsyncResult(result)) {
				throw new TypeError("SQLite transaction callbacks must be synchronous");
			}
			sql`COMMIT`.exec(this);
			return result;
		} catch (error) {
			try {
				sql`ROLLBACK`.exec(this);
			} catch {
				// Ignore rollback errors to rethrow original error.
			}
			throw error;
		}
	}

	close(): void {
		this.db.close();
	}
}

export function wrapNodeSqliteDatabase(db: DatabaseSync): SqliteDatabase {
	// 将 node:sqlite 的 DatabaseSync 隔离在适配器内，其他 backend 代码只依赖
	// SqliteDatabase 接口，从而可以在测试中替换为内存或模拟实现。
	return new NodeSqliteDatabase(db);
}

export function createNodeSqliteFactory(): SqliteDatabaseFactory {
	// 工厂延迟到 open(path) 才打开数据库，便于 SessionRepo 控制生命周期和路径。
	return {
		async open(path: string): Promise<SqliteDatabase> {
			return new NodeSqliteDatabase(new DatabaseSync(path));
		},
	};
}

// sqlite-node 负责把 agent 的 SessionStorage/SessionRepo 映射到 Node SQLite；Entry、
// Record、lane、branch、事实和搜索索引都在这里落盘，上层仍通过抽象接口访问。
// Re-export the SQLite session backend and types so this package is a complete node-sqlite backend.
export * from "./sqlite/index.ts";
