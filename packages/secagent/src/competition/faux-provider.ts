import type { ChallengeHint, ChallengeInstance, CompetitionChallenge, FlagSubmissionResult } from "../core/types.ts";
import type { CompetitionProvider } from "./provider.ts";

export interface FauxCompetitionChallenge extends CompetitionChallenge {
	acceptedFlag: string;
	entrypoints: string[];
	hint?: string;
}

export class FauxCompetitionProvider implements CompetitionProvider {
	readonly id = "faux";
	private readonly challenges: FauxCompetitionChallenge[];

	constructor(challenges: FauxCompetitionChallenge[]) {
		this.challenges = structuredClone(challenges);
	}

	listChallenges(): Promise<CompetitionChallenge[]> {
		return Promise.resolve(
			this.challenges.map(({ acceptedFlag: _acceptedFlag, entrypoints: _entrypoints, hint: _hint, ...challenge }) =>
				structuredClone(challenge),
			),
		);
	}

	startChallenge(code: string): Promise<ChallengeInstance> {
		const challenge = this.requireChallenge(code);
		if (challenge.status === "locked") return Promise.reject(new Error(`Challenge ${code} is locked`));
		challenge.status = "running";
		return Promise.resolve({ code, entrypoints: [...challenge.entrypoints], startedAt: new Date().toISOString() });
	}

	stopChallenge(code: string): Promise<void> {
		const challenge = this.requireChallenge(code);
		if (challenge.status === "running") challenge.status = "available";
		return Promise.resolve();
	}

	submitFlag(code: string, flag: string): Promise<FlagSubmissionResult> {
		const challenge = this.requireChallenge(code);
		const correct = flag === challenge.acceptedFlag;
		if (correct) {
			challenge.flagsCaptured = challenge.flagCount;
			challenge.status = "completed";
		}
		return Promise.resolve({
			correct,
			message: correct ? "correct" : "incorrect",
			flagCount: challenge.flagCount,
			flagsCaptured: challenge.flagsCaptured,
		});
	}

	viewHint(code: string): Promise<ChallengeHint> {
		const challenge = this.requireChallenge(code);
		return Promise.resolve({ code, content: challenge.hint ?? "No hint", penaltyPercent: 10 });
	}

	private requireChallenge(code: string): FauxCompetitionChallenge {
		const challenge = this.challenges.find((item) => item.code === code);
		if (!challenge) throw new Error(`Unknown challenge ${code}`);
		return challenge;
	}
}
