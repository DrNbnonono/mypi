import type { SecurityToolMetadata } from "../core/types.ts";
import type { SecurityToolAdapter, SecurityToolExecutionContext, SecurityToolExecutionResult } from "./adapter.ts";
import {
	adapterPreconditions,
	checkCommandAvailability,
	preconditionResult,
	runStandardTool,
	stringInput,
	targetValues,
} from "./standard.ts";

function normalizeNmapTarget(value: string): string | undefined {
	try {
		if (/^https?:\/\//i.test(value)) return new URL(value).hostname;
	} catch {
		return undefined;
	}
	if (!/^[A-Za-z0-9][A-Za-z0-9.:%_\-/[\]]*$/.test(value)) return undefined;
	return value;
}

function nmapTargets(input: Record<string, unknown>): string[] {
	return targetValues(input, ["target", "targets"])
		.map(normalizeNmapTarget)
		.filter((target): target is string => Boolean(target));
}

function nmapArgs(input: Record<string, unknown>, targets: readonly string[]): string[] {
	const args = ["-Pn"];
	if (input.serviceDetection !== false) args.push("-sV");
	const ports = stringInput(input, "ports");
	if (ports) {
		if (!/^[0-9,-]+$/.test(ports)) throw new Error("ports must contain only port numbers, commas, and ranges");
		args.push("-p", ports);
	}
	const timing = input.timing;
	if (timing !== undefined) {
		if (typeof timing !== "number" || !Number.isInteger(timing) || timing < 0 || timing > 5)
			throw new Error("timing must be an integer between 0 and 5");
		args.push(`-T${timing}`);
	}
	return [...args, ...targets];
}

export function createNmapAdapter(metadata: SecurityToolMetadata): SecurityToolAdapter {
	return {
		metadata,
		extractTargets: nmapTargets,
		checkAvailability: (context) => checkCommandAvailability("nmap", context),
		async checkPreconditions(
			input: Record<string, unknown>,
			_context: SecurityToolExecutionContext,
		): Promise<string[]> {
			const rawTargets = targetValues(input, ["target", "targets"]);
			if (rawTargets.length === 0) return ["a target or targets array is required"];
			if (nmapTargets(input).length !== rawTargets.length)
				return ["targets must be hostnames, IP addresses, CIDRs, or HTTP(S) URLs"];
			try {
				nmapArgs(input, nmapTargets(input));
			} catch (error) {
				return [error instanceof Error ? error.message : String(error)];
			}
			return adapterPreconditions(metadata, input);
		},
		async execute(
			input: Record<string, unknown>,
			context: SecurityToolExecutionContext,
		): Promise<SecurityToolExecutionResult> {
			const targets = nmapTargets(input);
			const checks = await this.checkPreconditions(input, context);
			if (checks.length > 0) return preconditionResult(checks.join("; "));
			let args: string[];
			try {
				args = nmapArgs(input, targets);
			} catch (error) {
				return preconditionResult(error instanceof Error ? error.message : String(error));
			}
			return runStandardTool({ metadata, command: "nmap", args, targets, input, context });
		},
	};
}
