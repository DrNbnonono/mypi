# Pi SecAgent

`@earendil-works/pi-secagent` is the opt-in cybersecurity profile for Pi. It provides event-sourced security state, explicit authorization scope, risk-aware policy, deterministic security tool adapters, evidence verification, autonomous state-space search, specialist delegation, controlled scenario benchmarks, and auditable Markdown/JSON reports.

SecAgent reuses `AgentSession`, extensions, resource loading, and mature Pi runtime packages from the existing ecosystem rather than forking the low-level Agent loop. The generic runtime extensions are loaded only for `sec` sessions:

- `pi-sandbox@0.6.3` — OS/filesystem/network isolation;
- `pi-mcp-adapter@2.23.0` — MCP transport and discovery;
- `pi-subagents@0.50.0` — bounded specialist child sessions;
- `pi-trace-extension@0.1.14` — generic execution tracing.

These packages are resolved only from the controlled deployment's local Node installation. SecAgent never installs them during Session startup. A missing package is omitted and reported by `/sec-doctor`; install the exact versions above with lifecycle scripts disabled when preparing the competition image.

`packages/secagent` is the canonical source for the security kernel, profile extensions, specialist agents, integrations, reports, templates, benchmarks, and tests. Project `.pi` files are deployment/configuration overrides only; SecAgent implementation must not be duplicated there.

## Autonomous decision loop

The competition runtime exposes `security_autonomous` with `step`, `run`, and `inspect`. It executes the closed loop:

```text
SecurityState
  -> Candidate Generator
  -> Planner / Replanner
  -> deterministic action input
  -> SecurityExecutionGateway
  -> Scope + Risk + Budget
  -> audited adapter execution
  -> Evidence + provenance
  -> Verifier + Observer
  -> next SecurityState
```

The model can propose hypotheses and goals, but it cannot use the autonomous loop to invent arbitrary command lines, bypass isolation/audit/protected paths, or directly promote scanner output into a confirmed finding. Strict and competition modes block out-of-scope targets. Autonomous mode may continue only after controlled isolation and one-time authorization, and every out-of-scope action is retained as a high-risk audit warning.

Run `/sec-doctor` in the CLI or send `{ "type": "run_diagnostics" }` to the Profile command API to inspect isolation, Sec-only runtime packages, specialist definitions, external tool versions, and writable workspace/temp/report directories. Model connectivity is not actively probed because a diagnostic must not create a billable provider request.

## Competition benchmarks

`security_benchmark` supports the general readiness score plus a controlled benchmark matrix for `web`, `pwn`, `reverse`, `forensics`, and `killchain`. The deterministic CI regressions exercise the real Candidate Generator, Planner, Gateway, adapters, state replay, Evidence Graph, Observer, Verifier, and Replanner with controlled executors. The same loop can be run against real loopback/container fixtures when competition tools are installed.

Documentation:

- `docs/architecture.md` — package boundaries, runtime flow, persistence, and extension/plugin ownership;
- `docs/autonomous-loop.md` — continuous search-loop semantics and controlled benchmark design;
- `docs/competition.md` — deployment, operation, deliverables, tests, and competition evidence mapping.
