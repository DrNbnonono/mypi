import { createHash, randomUUID } from "node:crypto";
import type {
	ChallengeHint,
	CompetitionAttempt,
	CompetitionChallenge,
	CompetitionRunState,
	FlagSubmissionResult,
} from "../core/types.ts";
import type { CompetitionProvider } from "./provider.ts";

export interface CompetitionAttemptWorkspace {
	workspaceRef: string;
	sessionId?: string;
}

export interface CompetitionSchedulerOptions {
	maxConcurrent?: number;
	callsPerSecond?: number;
	hintsAllowed?: boolean;
	initialState?: CompetitionRunState;
	createAttemptWorkspace?: (
		challenge: CompetitionChallenge,
		attemptId: string,
	) => Promise<CompetitionAttemptWorkspace>;
	onStateChange?: (state: CompetitionRunState) => void;
	now?: () => number;
	sleep?: (milliseconds: number) => Promise<void>;
}

function isoNow(now: () => number): string {
	return new Date(now()).toISOString();
}

export function rankCompetitionChallenges(challenges: readonly CompetitionChallenge[]): CompetitionChallenge[] {
	return challenges
		.filter((challenge) => challenge.status === "available" && challenge.flagsCaptured < challenge.flagCount)
		.map((challenge) => structuredClone(challenge))
		.sort((left, right) => {
			const leftValue = (left.score ?? 0) / Math.max(1, left.flagsCaptured + 1);
			const rightValue = (right.score ?? 0) / Math.max(1, right.flagsCaptured + 1);
			if (leftValue !== rightValue) return rightValue - leftValue;
			if ((left.level ?? 0) !== (right.level ?? 0)) return (left.level ?? 0) - (right.level ?? 0);
			return left.code.localeCompare(right.code);
		});
}

export class CompetitionScheduler {
	private readonly provider: CompetitionProvider;
	private readonly options: Required<
		Pick<CompetitionSchedulerOptions, "maxConcurrent" | "callsPerSecond" | "hintsAllowed">
	> &
		CompetitionSchedulerOptions;
	private state: CompetitionRunState;
	private callTimestamps: number[] = [];

	constructor(provider: CompetitionProvider, options: CompetitionSchedulerOptions = {}) {
		this.provider = provider;
		this.options = {
			...options,
			maxConcurrent: Math.max(1, options.maxConcurrent ?? 3),
			callsPerSecond: Math.max(1, options.callsPerSecond ?? 3),
			hintsAllowed: options.hintsAllowed ?? false,
		};
		this.state = options.initialState
			? structuredClone(options.initialState)
			: {
					providerId: provider.id,
					challenges: [],
					attempts: [],
					submissions: [],
					maxConcurrent: this.options.maxConcurrent,
					hintsAllowed: this.options.hintsAllowed,
					updatedAt: isoNow(this.now),
				};
	}

	snapshot(): CompetitionRunState {
		return structuredClone(this.state);
	}

	replaceState(state: CompetitionRunState | undefined): void {
		if (state?.providerId === this.provider.id) this.state = structuredClone(state);
	}

	async syncChallenges(): Promise<CompetitionRunState> {
		const challenges = await this.call(() => this.provider.listChallenges());
		this.state.challenges = challenges;
		this.publish();
		return this.snapshot();
	}

	async startNext(): Promise<CompetitionAttempt | undefined> {
		const challenge = rankCompetitionChallenges(this.state.challenges)[0];
		return challenge ? this.startChallenge(challenge.code) : undefined;
	}

	async startChallenge(code: string): Promise<CompetitionAttempt> {
		if (this.runningAttempts().length >= this.state.maxConcurrent)
			throw new Error(`Competition concurrency limit ${this.state.maxConcurrent} reached`);
		const challenge = this.requireChallenge(code);
		if (challenge.status === "locked" || challenge.status === "completed")
			throw new Error(`Challenge ${code} is ${challenge.status}`);
		const attemptId = randomUUID();
		const workspace = this.options.createAttemptWorkspace
			? await this.options.createAttemptWorkspace(structuredClone(challenge), attemptId)
			: { workspaceRef: `competition://${code}/${attemptId}` };
		const timestamp = isoNow(this.now);
		let attempt: CompetitionAttempt = {
			id: attemptId,
			challengeCode: code,
			status: "starting",
			entrypoints: [],
			workspaceRef: workspace.workspaceRef,
			sessionId: workspace.sessionId,
			startedAt: timestamp,
			updatedAt: timestamp,
		};
		this.state.attempts.push(attempt);
		this.publish();
		try {
			const instance = await this.call(() => this.provider.startChallenge(code));
			attempt = {
				...attempt,
				status: "running",
				entrypoints: [...instance.entrypoints],
				updatedAt: isoNow(this.now),
			};
			this.replaceAttempt(attempt);
			challenge.status = "running";
			this.publish();
			return structuredClone(attempt);
		} catch (error) {
			attempt = {
				...attempt,
				status: "failed",
				failureReason: error instanceof Error ? error.message : String(error),
				updatedAt: isoNow(this.now),
				completedAt: isoNow(this.now),
			};
			this.replaceAttempt(attempt);
			this.publish();
			throw error;
		}
	}

	async pauseChallenge(code: string): Promise<void> {
		await this.stopAttempt(code, "paused");
	}

	async cancelChallenge(code: string): Promise<void> {
		await this.stopAttempt(code, "cancelled");
	}

	async stopChallenge(code: string): Promise<void> {
		await this.stopAttempt(code, "stopped");
	}

	async resumeChallenge(code: string): Promise<CompetitionAttempt> {
		const current = this.latestAttempt(code);
		if (!current || current.status !== "paused") throw new Error(`Challenge ${code} has no paused attempt`);
		if (this.runningAttempts().length >= this.state.maxConcurrent)
			throw new Error(`Competition concurrency limit ${this.state.maxConcurrent} reached`);
		const instance = await this.call(() => this.provider.startChallenge(code));
		const resumed = {
			...current,
			status: "running" as const,
			entrypoints: [...instance.entrypoints],
			updatedAt: isoNow(this.now),
		};
		this.replaceAttempt(resumed);
		this.requireChallenge(code).status = "running";
		this.publish();
		return structuredClone(resumed);
	}

	async restartChallenge(code: string): Promise<CompetitionAttempt> {
		const current = this.latestAttempt(code);
		if (current?.status === "running") await this.stopAttempt(code, "stopped");
		return this.startChallenge(code);
	}

	async submitFlag(code: string, flag: string, evidenceIds: readonly string[] = []): Promise<FlagSubmissionResult> {
		if (!/^flag\{[^\r\n{}]{1,512}\}$/i.test(flag))
			throw new Error("Flag does not match the required flag{...} format");
		if (!this.runningAttempts().some((attempt) => attempt.challengeCode === code))
			throw new Error(`Challenge ${code} does not have a running attempt`);
		const flagHash = createHash("sha256").update(flag).digest("hex");
		if (
			this.state.submissions.some(
				(submission) => submission.challengeCode === code && submission.flagHash === flagHash,
			)
		)
			throw new Error(`Flag was already submitted for challenge ${code}`);
		const result = await this.call(() => this.provider.submitFlag(code, flag));
		this.state.submissions.push({
			id: randomUUID(),
			challengeCode: code,
			flagHash,
			correct: result.correct,
			evidenceIds: [...new Set(evidenceIds)],
			message: result.message,
			createdAt: isoNow(this.now),
		});
		const challenge = this.requireChallenge(code);
		if (result.flagCount !== undefined) challenge.flagCount = result.flagCount;
		if (result.flagsCaptured !== undefined) challenge.flagsCaptured = result.flagsCaptured;
		if (result.correct && challenge.flagsCaptured >= challenge.flagCount) {
			challenge.status = "completed";
			const attempt = this.latestAttempt(code);
			if (attempt)
				this.replaceAttempt({
					...attempt,
					status: "completed",
					completedAt: isoNow(this.now),
					updatedAt: isoNow(this.now),
				});
		}
		this.publish();
		return structuredClone(result);
	}

	async viewHint(code: string): Promise<ChallengeHint> {
		if (!this.state.hintsAllowed) throw new Error("Competition hint access is disabled by policy");
		return this.call(() => this.provider.viewHint(code));
	}

	private readonly now = (): number => this.options.now?.() ?? Date.now();

	private async call<T>(operation: () => Promise<T>): Promise<T> {
		const sleep =
			this.options.sleep ??
			((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
		while (true) {
			const timestamp = this.now();
			this.callTimestamps = this.callTimestamps.filter((item) => timestamp - item < 1_000);
			if (this.callTimestamps.length < this.options.callsPerSecond) {
				this.callTimestamps.push(timestamp);
				return operation();
			}
			await sleep(Math.max(1, 1_000 - (timestamp - (this.callTimestamps[0] ?? timestamp))));
		}
	}

	private runningAttempts(): CompetitionAttempt[] {
		return this.state.attempts.filter((attempt) => attempt.status === "running" || attempt.status === "starting");
	}

	private latestAttempt(code: string): CompetitionAttempt | undefined {
		return this.state.attempts.filter((attempt) => attempt.challengeCode === code).at(-1);
	}

	private requireChallenge(code: string): CompetitionChallenge {
		const challenge = this.state.challenges.find((item) => item.code === code);
		if (!challenge) throw new Error(`Unknown challenge ${code}`);
		return challenge;
	}

	private replaceAttempt(attempt: CompetitionAttempt): void {
		const index = this.state.attempts.findIndex((item) => item.id === attempt.id);
		if (index >= 0) this.state.attempts[index] = attempt;
	}

	private async stopAttempt(code: string, status: "paused" | "stopped" | "cancelled"): Promise<void> {
		const attempt = this.latestAttempt(code);
		if (!attempt || attempt.status !== "running")
			throw new Error(`Challenge ${code} does not have a running attempt`);
		await this.call(() => this.provider.stopChallenge(code));
		const timestamp = isoNow(this.now);
		this.replaceAttempt({
			...attempt,
			status,
			updatedAt: timestamp,
			completedAt: status === "paused" ? undefined : timestamp,
		});
		this.requireChallenge(code).status = "available";
		this.publish();
	}

	private publish(): void {
		this.state.updatedAt = isoNow(this.now);
		this.options.onStateChange?.(this.snapshot());
	}
}
