# Pi SecAgent

`@earendil-works/pi-secagent` is the opt-in cybersecurity profile for Pi. It provides event-sourced task state, explicit authorization scope, strict/competition/autonomous policy modes, structured tool adapters, decision traces, and Markdown/JSON reports.

SecAgent reuses `AgentSession`, extensions, and resource loading from `@earendil-works/pi-coding-agent`. It does not depend on the experimental Agent Harness.

The generic runtime extensions are owned by the SecAgent profile and loaded only for `sec` sessions:

- `pi-sandbox@0.6.3`
- `pi-mcp-adapter@2.23.0`
- `pi-subagents@0.50.0`
- `pi-trace-extension@0.1.14`

`packages/secagent` is the canonical source for the security kernel, profile extension, specialist agents, integration policy, reports, templates, and tests. Project `.pi` files are deployment/configuration overrides only; no SecAgent implementation should live there after migration.

Documentation:

- `docs/architecture.md` — package boundaries, runtime flow, persistence, and extension/plugin ownership.
- `docs/competition.md` — deployment, operation, deliverables, and competition evidence mapping.
