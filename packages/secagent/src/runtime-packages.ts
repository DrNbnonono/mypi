export const SECAGENT_RUNTIME_PACKAGE_SOURCES = [
	"npm:pi-sandbox@0.6.3",
	"npm:pi-mcp-adapter@2.23.0",
	"npm:pi-subagents@0.50.0",
	"npm:pi-trace-extension@0.1.14",
] as const;

export type SecAgentRuntimePackageSource = (typeof SECAGENT_RUNTIME_PACKAGE_SOURCES)[number];
