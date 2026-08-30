import type { RiskLevel, SecurityToolMetadata, ToolCategory, ToolScopeMode } from "../core/types.ts";

function tool(
	name: string,
	category: ToolCategory,
	baseRisk: RiskLevel,
	scopeMode: ToolScopeMode,
	capabilities: string[],
	description: string,
	options: { aliases?: string[]; agents?: string[]; preconditions?: string[]; postconditions?: string[] } = {},
): SecurityToolMetadata {
	return {
		name,
		aliases: options.aliases ?? [],
		category,
		baseRisk,
		scopeMode,
		capabilities,
		preconditions: options.preconditions ?? [],
		postconditions: options.postconditions ?? [],
		recommendedAgents: options.agents ?? ["coordinator"],
		description,
	};
}

const NETWORK_SCOPE = ["target is within authorized scope"];

export const SECURITY_TOOL_CATALOG: readonly SecurityToolMetadata[] = [
	tool(
		"security_intake",
		"internal",
		"P0",
		"none",
		["task.parse", "artifact.classify"],
		"Create a structured security task from bounded inputs.",
	),
	tool(
		"security_state",
		"internal",
		"P0",
		"none",
		["state.read", "state.write", "evidence.record"],
		"Maintain replayable SecAgent state.",
	),
	tool(
		"security_scope",
		"internal",
		"P0",
		"none",
		["scope.read", "scope.write"],
		"Maintain explicit authorized targets.",
	),
	tool(
		"security_decide",
		"internal",
		"P0",
		"none",
		["decision.rank", "decision.record"],
		"Rank and record candidate actions.",
	),
	tool("security_tools", "internal", "P0", "none", ["tool.registry.read"], "Inspect the security tool registry."),
	tool("security_report", "internal", "P0", "none", ["report.generate"], "Generate Markdown or JSON reports."),
	tool("read", "local", "P0", "none", ["filesystem.read"], "Read local files.", {
		agents: ["sec-analysis", "sec-reverse", "sec-response"],
	}),
	tool("grep", "local", "P0", "none", ["filesystem.search"], "Search local text.", {
		agents: ["sec-analysis", "sec-reverse"],
	}),
	tool("find", "local", "P0", "none", ["filesystem.enumerate"], "Enumerate local paths.", {
		agents: ["sec-analysis", "sec-reverse"],
	}),
	tool("ls", "local", "P0", "none", ["filesystem.enumerate"], "List local paths.", {
		agents: ["sec-analysis", "sec-reverse"],
	}),
	tool("edit", "response", "P2", "none", ["filesystem.modify"], "Modify an existing file.", {
		agents: ["sec-response"],
		preconditions: ["change is authorized", "rollback path is understood"],
	}),
	tool("write", "response", "P2", "none", ["filesystem.modify"], "Create or replace a file.", {
		agents: ["sec-response"],
		preconditions: ["change is authorized"],
	}),
	tool(
		"bash",
		"shell",
		"P1",
		"dynamic",
		["process.execute"],
		"Execute a shell command; nested tools determine effective risk.",
	),
	tool("curl", "network", "P1", "network-target", ["network.http.request"], "Issue an HTTP request.", {
		agents: ["sec-recon", "sec-web"],
		preconditions: NETWORK_SCOPE,
	}),
	tool(
		"wget",
		"network",
		"P1",
		"network-target",
		["network.http.request", "artifact.download"],
		"Download an authorized resource.",
		{ agents: ["sec-recon", "sec-web", "sec-analysis"], preconditions: NETWORK_SCOPE },
	),
	tool(
		"httpx",
		"recon",
		"P1",
		"network-target",
		["network.http.probe", "service.fingerprint"],
		"Probe HTTP services.",
		{ agents: ["sec-recon", "sec-web"], preconditions: NETWORK_SCOPE },
	),
	tool(
		"nmap",
		"recon",
		"P2",
		"network-target",
		["network.port_scan", "service.fingerprint"],
		"Enumerate ports and services.",
		{ agents: ["sec-recon"], preconditions: NETWORK_SCOPE },
	),
	tool(
		"masscan",
		"recon",
		"P2",
		"network-target",
		["network.port_scan.high_rate"],
		"Perform rate-bounded port discovery.",
		{ agents: ["sec-recon"], preconditions: [...NETWORK_SCOPE, "rate limit is appropriate"] },
	),
	tool("nuclei", "web", "P2", "network-target", ["vulnerability.template_probe"], "Run template-based checks.", {
		agents: ["sec-web", "sec-vuln"],
		preconditions: NETWORK_SCOPE,
	}),
	tool("ffuf", "web", "P2", "network-target", ["web.content_discovery"], "Perform bounded content discovery.", {
		agents: ["sec-web"],
		preconditions: NETWORK_SCOPE,
	}),
	tool(
		"gobuster",
		"web",
		"P2",
		"network-target",
		["web.content_discovery", "dns.enumeration"],
		"Enumerate web paths or DNS names.",
		{ agents: ["sec-web", "sec-recon"], preconditions: NETWORK_SCOPE },
	),
	tool("nikto", "web", "P2", "network-target", ["web.vulnerability_probe"], "Probe web configuration and exposures.", {
		agents: ["sec-web", "sec-vuln"],
		preconditions: NETWORK_SCOPE,
	}),
	tool(
		"sqlmap",
		"web",
		"P3",
		"network-target",
		["web.injection.verify"],
		"Perform intrusive SQL injection verification.",
		{ agents: ["sec-web", "sec-vuln"], preconditions: [...NETWORK_SCOPE, "intrusive verification is justified"] },
	),
	tool(
		"hydra",
		"network",
		"P3",
		"network-target",
		["authentication.verify.high_rate"],
		"Perform credential verification.",
		{ agents: ["sec-recon"], preconditions: [...NETWORK_SCOPE, "credential testing is authorized"] },
	),
	tool("ssh", "network", "P2", "network-target", ["network.remote_session"], "Open a remote session.", {
		agents: ["sec-response", "sec-analysis"],
		preconditions: NETWORK_SCOPE,
	}),
	tool(
		"scp",
		"network",
		"P2",
		"network-target",
		["network.remote_file_transfer"],
		"Transfer files to or from a target.",
		{ aliases: ["sftp"], agents: ["sec-analysis", "sec-response"], preconditions: NETWORK_SCOPE },
	),
	tool("nc", "network", "P2", "network-target", ["network.raw_connection"], "Create a raw network connection.", {
		aliases: ["netcat"],
		agents: ["sec-recon", "sec-analysis"],
		preconditions: NETWORK_SCOPE,
	}),
	tool(
		"msfconsole",
		"network",
		"P3",
		"network-target",
		["vulnerability.exploit.verify"],
		"Run exploit verification.",
		{
			aliases: ["metasploit"],
			agents: ["sec-vuln"],
			preconditions: [...NETWORK_SCOPE, "exploit verification is explicitly authorized"],
		},
	),
	tool("file", "reverse", "P0", "none", ["binary.identify"], "Identify artifact format.", { agents: ["sec-reverse"] }),
	tool("strings", "reverse", "P0", "none", ["binary.strings"], "Extract printable strings.", {
		agents: ["sec-reverse"],
	}),
	tool("readelf", "reverse", "P0", "none", ["binary.elf.inspect", "binary.mitigations.inspect"], "Inspect ELF headers, sections, symbols, dynamic metadata, notes and relocations without executing the artifact.", {
		agents: ["sec-reverse", "sec-vuln"],
	}),
	tool("objdump", "reverse", "P1", "none", ["binary.disassemble"], "Inspect binary sections, symbols and disassembly without executing the artifact.", {
		agents: ["sec-reverse", "sec-vuln"],
	}),
	tool("radare2", "reverse", "P1", "none", ["binary.analyze"], "Analyze a binary.", {
		aliases: ["r2"],
		agents: ["sec-reverse"],
	}),
] as const;
