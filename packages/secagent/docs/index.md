# SecAgent documentation

SecAgent is Pi's opt-in cybersecurity profile. Pi remains a Coding/Sec dual-mode agent harness: `coding` is the default profile, while `sec` is selected explicitly for bounded and auditable security work.

## Start here

- [Package README](../README.md) — install the Sec-only runtime packages, start CLI/Web Sessions, and understand the safety boundary.
- [Architecture](architecture.md) — profile ownership, Session persistence, runtime packages, tools, evidence, and Web integration.
- [Autonomous loop](autonomous-loop.md) — candidate generation, planning, bounded execution, verification, observation, and replanning.
- [Competition guide](competition.md) — controlled scenarios, diagnostics, deployment, test levels, deliverables, and score evidence.

## Current capability surface

The implemented profile includes structured security task intake, explicit authorization scope, three policy modes (`strict`, `competition`, and `autonomous`), a registry and gateway for structured tool adapters, bounded specialist delegation, evidence and verification records, replanning, audit/replay data, controlled Web/Pwn/Reverse/Forensics/Killchain benchmarks, and Markdown/JSON reports.

The profile coordinates external security tools; it does not reimplement scanners or provide unrestricted shell execution. A tool must be registered, available, policy-checked, scope-checked, and invoked through its adapter. A scanner signal is not automatically a confirmed vulnerability.

## Operational boundary

Attachments are task input, not authorization. Network and state-changing work requires an explicit authorized scope. Autonomous execution additionally requires verified sandbox/container isolation or an organizer-controlled isolation source and one recorded confirmation. Protected credential paths, OS/container boundaries, budgets, and audit records cannot be disabled.

Use only loopback fixtures, disposable containers, or targets explicitly authorized by the competition organizer. `/sec-doctor` and the Web diagnostics view report readiness without actively probing the model provider, so a diagnostic does not create a billable request.

## Development notes

Use Node.js `22.19.0` or newer. On WSL, place the repository and dependency tree on Linux ext4, for example under `~/src/mypi`; `/mnt/*` is a Windows-mounted filesystem and is significantly slower for dependency-heavy development. Use the Web development server for UI changes and a production build for a stable demonstration or long-running Session.

The four Sec-only runtime packages are pinned and installed by the competition container template:

```text
pi-sandbox@0.6.3
pi-mcp-adapter@2.23.0
pi-subagents@0.50.0
pi-trace-extension@0.1.14
```

Missing packages are diagnosed and do not silently enable autonomous mode. Deterministic tests use controlled executors; real-tool tests must remain inside an authorized loopback, disposable-container, or competition environment.
