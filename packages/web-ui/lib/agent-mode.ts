export type AgentMode = "coding" | "sec";

const STORAGE_KEY = "pi-agent-mode";

export function getPreferredAgentMode(): AgentMode {
	if (typeof window === "undefined") return "coding";
	return window.localStorage.getItem(STORAGE_KEY) === "sec" ? "sec" : "coding";
}

export function setPreferredAgentMode(mode: AgentMode): void {
	if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, mode);
}
