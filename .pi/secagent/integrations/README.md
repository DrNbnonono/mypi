# SecAgent Runtime Integrations

SecAgent reuses mature Pi packages for generic runtime capabilities and keeps only the cybersecurity-specific policy bridge in this repository.

## Project-pinned packages

The project-level `.pi/settings.json` pins reviewed versions so Pi can install missing packages automatically after the project is trusted.

| Capability | Package | SecAgent responsibility |
| --- | --- | --- |
| OS sandbox | `pi-sandbox@0.6.3` | Security scope remains authoritative; sandbox provides a second filesystem/network boundary. |
| MCP client | `pi-mcp-adapter@2.23.0` | MCP transport/discovery is reused; SecAgent classifies delegated calls and applies risk/scope policy. |
| Multi-agent runtime | `pi-subagents@0.50.0` | Child-session orchestration is reused; SecAgent supplies project specialist definitions and policy tools. |
| Delegation/runtime trace | `pi-trace-extension@0.1.14` | Pi lifecycle capture is reused; SecAgent keeps its separate decision/audit trail for security explainability. |

The packages are intentionally installed project-locally instead of copied into `.pi/extensions/`. This avoids forking third-party code while keeping the repository reproducible.

## Sandbox contract

`.pi/sandbox.json` starts fail-closed for network access: `allowedDomains` is empty. A network target must therefore pass both boundaries:

1. SecAgent `security_scope` / `assessToolScope` authorization.
2. `pi-sandbox` network permission for the current session/project.

The sandbox also denies writes to `.git`, environment files, and common key/certificate formats. The sandbox is not a replacement for SecAgent scope checks, and SecAgent scope checks are not an OS isolation boundary.

## MCP contract

`.mcp.json` keeps MCP conservative by default:

- host-specific config discovery is disabled;
- direct MCP tools are disabled, so calls flow through the single `mcp` proxy surface;
- direct-tool registration is frozen;
- automatic authentication is disabled;
- no MCP server is enabled by default.

`mcp-policy.ts` is deliberately small. It does not implement MCP transport. It only translates the proxy call into SecAgent concepts:

- metadata/search/describe operations: P0;
- connection/authentication control: P1;
- read-like delegated tools: P1;
- mutating delegated tools: P2;
- destructive/execution-like delegated tools: P3;
- nested URL/IP/domain target arguments: checked against `security_scope`.

When a real MCP server is added, keep proxy mode unless there is a specific reason to expose a small reviewed direct-tool set.

## Multi-agent and trace contract

`pi-subagents` replaces the repository's previous wrapper around Pi's example subagent extension. Project specialists remain in `.pi/agents/` and are discovered as project agents.

`pi-trace-extension` complements, rather than replaces, SecAgent audit data:

- Pi trace: execution tree, child sessions, model/tool timing, token/cost information.
- SecAgent audit: security risk, scope decision, approval state, evidence, finding, and decision trace.

Trace artifacts can contain raw prompts, arguments, and outputs. Treat them as sensitive local artifacts and review/redact them before sharing outside the competition team.
