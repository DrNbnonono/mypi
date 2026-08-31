import type { CandidateActionInput, SecurityState } from "./types.ts";

export interface DefaultActionInputResult {
	ok: boolean;
	input?: Record<string, unknown>;
	reason?: string;
}

function firstArtifactPath(state: SecurityState): string | undefined {
	return state.task?.assets.find((asset) => asset.path)?.path;
}

function wordlistPath(state: SecurityState): string | undefined {
	return state.task?.assets.find(
		(asset) => Boolean(asset.path) && /(?:wordlist|paths?|dirs?|content|fuzz)/i.test(asset.name),
	)?.path;
}

function normalizedNetworkTarget(action: CandidateActionInput, state: SecurityState): string | undefined {
	return action.targets?.find(Boolean) ?? state.scope.targets[0]?.value;
}

function asHttpUrl(target: string): string | undefined {
	try {
		const parsed = new URL(target);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
	} catch {
		if (!/^[A-Za-z0-9][A-Za-z0-9.:%_\-[\]]*$/.test(target)) return undefined;
		return `http://${target}/`;
	}
}

function asHostTarget(target: string): string | undefined {
	try {
		if (/^https?:\/\//i.test(target)) return new URL(target).hostname;
	} catch {
		return undefined;
	}
	return target;
}

function ffufTarget(target: string): string | undefined {
	const url = asHttpUrl(target);
	if (!url) return undefined;
	if (url.includes("FUZZ")) return url;
	const parsed = new URL(url);
	const basePath = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
	parsed.pathname = `${basePath}FUZZ`;
	return parsed.toString();
}

export function buildDefaultActionInput(state: SecurityState, action: CandidateActionInput): DefaultActionInputResult {
	const artifactPath = firstArtifactPath(state);
	const networkTarget = normalizedNetworkTarget(action, state);

	switch (action.tool.toLowerCase()) {
		case "nmap": {
			if (!networkTarget) return { ok: false, reason: "nmap requires an authorized network target" };
			const target = asHostTarget(networkTarget);
			return target
				? { ok: true, input: { target, timing: 3, serviceDetection: true } }
				: { ok: false, reason: "nmap target could not be normalized" };
		}
		case "curl":
		case "httpx":
		case "nuclei": {
			if (!networkTarget) return { ok: false, reason: `${action.tool} requires an authorized network target` };
			const target = asHttpUrl(networkTarget);
			if (!target) return { ok: false, reason: `${action.tool} requires an HTTP(S) compatible target` };
			if (action.tool === "curl") return { ok: true, input: { target, method: "GET", followRedirects: true } };
			if (action.tool === "httpx") return { ok: true, input: { target, followRedirects: true } };
			return { ok: true, input: { target, rate: 25, severities: ["medium", "high", "critical"] } };
		}
		case "ffuf": {
			if (!networkTarget) return { ok: false, reason: "ffuf requires an authorized network target" };
			const target = ffufTarget(networkTarget);
			const wordlist = wordlistPath(state);
			if (!target) return { ok: false, reason: "ffuf requires an HTTP(S) compatible target" };
			if (!wordlist) return { ok: false, reason: "ffuf requires an in-workspace wordlist asset" };
			return { ok: true, input: { target, wordlist, threads: 20, rate: 50 } };
		}
		case "file":
			return artifactPath
				? { ok: true, input: { path: artifactPath } }
				: { ok: false, reason: "file requires a local artifact" };
		case "strings":
			return artifactPath
				? { ok: true, input: { path: artifactPath, minLength: 4 } }
				: { ok: false, reason: "strings requires a local artifact" };
		case "readelf":
			return artifactPath
				? { ok: true, input: { path: artifactPath, action: "security" } }
				: { ok: false, reason: "readelf requires a local artifact" };
		case "objdump":
			return artifactPath
				? { ok: true, input: { path: artifactPath, action: "disassemble" } }
				: { ok: false, reason: "objdump requires a local artifact" };
		case "binwalk":
		case "exiftool":
			return artifactPath
				? { ok: true, input: { path: artifactPath } }
				: { ok: false, reason: `${action.tool} requires a local artifact` };
		default:
			return { ok: false, reason: `no deterministic autonomous input builder is registered for ${action.tool}` };
	}
}
