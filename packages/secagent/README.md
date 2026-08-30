# Pi SecAgent

`@earendil-works/pi-secagent` is the opt-in cybersecurity profile for Pi. It provides event-sourced task state, explicit authorization scope, strict/competition/autonomous policy modes, structured tool adapters, decision traces, and Markdown/JSON reports.

SecAgent reuses `AgentSession`, extensions, and resource loading from `@earendil-works/pi-coding-agent`. It does not depend on the experimental Agent Harness.

The four generic runtime extensions are pinned as profile resources rather than normal Node imports, so coding sessions do not load them:

- `pi-sandbox@0.6.3`
- `pi-mcp-adapter@2.23.0`
- `pi-subagents@0.50.0`
- `pi-trace-extension@0.1.14`

See `docs/competition.md` for deployment, operation, and competition evidence mapping.
