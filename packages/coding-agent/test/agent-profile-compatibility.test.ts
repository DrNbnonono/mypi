import { createSecAgentProfile } from "@earendil-works/pi-secagent";
import { describe, expect, it } from "vitest";
import type { AgentProfileDefinition } from "../src/core/agent-profile.ts";

describe("SecAgent profile host compatibility", () => {
	it("is structurally compatible without a SecAgent dependency on coding-agent", () => {
		const profile: AgentProfileDefinition = createSecAgentProfile({ runtimePackageSources: [] });
		expect(profile.mode).toBe("sec");
		expect(profile.displayName).toBe("Security");
	});

	it("resolves Sec runtime packages locally without temporary npm sources", () => {
		const profile: AgentProfileDefinition = createSecAgentProfile();
		expect(profile.resourcePaths?.extensionPaths?.every((path) => !path.startsWith("npm:"))).toBe(true);
	});
});
