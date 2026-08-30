# Competition delivery and evidence map

## Operation

- CLI: `pi --agent-mode sec`.
- Web: create a session with `agentMode: "sec"`.
- Existing sessions retain their persisted mode. `/agent-mode coding|sec` creates a blank session in the same working directory.
- Run task intake and set explicit authorized scope before network work. Attachment content is never authorization.
- Use `strict` for normal operation, `competition` for bounded P2 automation, and `autonomous` only after sandbox/external isolation plus one-time recorded authorization.
- Use `security_autonomous` with `step` for one state transition or `run` for a bounded continuous search loop.
- Use `security_benchmark catalog` to inspect the five controlled benchmark families and `security_benchmark controlled` with a scenario to evaluate the current trace.

## Autonomous competition loop

The implemented execution path is:

```text
Candidate Generator
  -> Planner / Replanner
  -> deterministic structured input
  -> SecurityExecutionGateway
  -> Scope + Risk + Budget
  -> bounded CLI/MCP adapter
  -> Evidence + provenance
  -> Verifier + Observer
  -> termination / next step
```

The autonomous loop does not grant new privileges. It reuses the same scope, policy, sandbox, tool-registry, adapter, audit, evidence, and budget boundaries as manually selected security actions. Successful deterministic actions are not repeated, and repeated failures are tracked at capability-family level so tool substitution does not hide strategy stagnation.

## Controlled scenario matrix

The competition regression surface is organized by capability rather than by creating a separate CTF agent:

| Scenario | Main capability path | Core invariants |
| --- | --- | --- |
| Web | HTTP fingerprinting, request analysis, bounded discovery/verification | scope, bounded adapters, evidence, no repeat after success |
| Pwn | artifact triage, ELF mitigations, static reverse reasoning | SHA-256 provenance, no binary execution, mitigation triage |
| Reverse | artifact identification, strings, ELF/static analysis | read-only path, provenance, strategy progression |
| Forensics | metadata and embedded-signature triage | metadata, signature scan, provenance, no automatic extraction |
| Killchain | network discovery -> Web enumeration -> request/verification strategies | failure-driven replanning, capability diversity, scope, budget |

These are controlled project benchmarks, not official organizer scores. Deterministic CI runs use controlled executors but exercise the real SecAgent decision kernel and adapters. Competition/release smoke tests replace the controlled executor with real installed tools against explicitly authorized loopback/container fixtures.

## Deployment diagnostics

Before a demonstration, verify model/gateway connectivity, writable workspace/report directory, required CLI versions, MCP discovery, specialist agents, sandbox status, trace output, tool-adapter availability, and benchmark configuration. Provider URL, model ID, API key, and organizer gateway remain environment/settings inputs and are never hard-coded.

A recommended demo sequence is:

```text
create sec session
-> security_intake
-> security_scope
-> configure isolation/policy
-> security_candidates or security_autonomous inspect
-> security_autonomous run
-> inspect Evidence Graph / Observer / Replan trace
-> security_benchmark controlled
-> export Markdown + JSON report
```

## Test levels

Default package tests are deterministic and do not require external security binaries. The suite verifies command construction, target normalization, failure handling, scope, policy, decision completion, evidence provenance, verification gates, Observer signals, replanning, deterministic candidate progression, and the Web/Pwn/Reverse/Forensics/Killchain autonomous traces.

Real executable smoke tests remain opt-in and must run only in an explicitly authorized controlled environment with the required tools installed:

```bash
SECAGENT_REAL_TOOL_SMOKE=1 npm run test --workspace=@earendil-works/pi-secagent -- test/tools-local.test.ts
```

The current real-tool smoke suite is constrained to temporary local fixtures and loopback targets. Final competition preparation should additionally run the five scenario families in disposable containers with the exact tool versions shipped for the demo.

## Deliverables

- Deployment manual: this file plus `templates/`.
- Developer documentation: package README, architecture/autonomous-loop documents, and exported TypeScript APIs.
- User manual: CLI/Web mode, task intake, scope, policy, autonomy, audit, benchmark, and report commands.
- Test report: SecAgent package regressions, coding-agent mode tests, Web tests, stable typecheck, and controlled real-tool/container smoke logs.
- Technical report: Risk-aware State-Space Security Agent, Candidate Generator, Planner/Replanner, Evidence Graph, Verifier, Observer, Scope/Budget, adapters, replay format, and controlled benchmark metrics.
- PPT: problem, architecture, state-space loop, five scenario traces, safety boundary, explainable decision/evidence graph, live demo, measured benchmark results.
- Demo: show one successful path and one injected failure path that visibly causes Observer/Replanner strategy change before exporting the final audit/report.

## Score mapping

| Dimension | Implementation | Test/evidence |
| --- | --- | --- |
| Task understanding | `SecurityTaskSpec`, multi-format intake, archive limits | intake and malicious archive tests |
| Autonomous decision | state-aware candidates, utility Planner, continuous autonomous loop, capability-level Replanner | autonomous-loop and Killchain regressions |
| Explainability | Evidence Graph, verification records, Observer signals, decision/replan/audit traces | Evidence/Verifier, report and controlled scenario tests |
| Tool orchestration | structured registry/gateway, bounded Web/static/forensic adapters, MCP and six specialists | adapter, MCP, subagent, Web/Pwn/Reverse/Forensics tests |
| Security and control | immutable agent mode, explicit scope, P0-P3 policy, isolation authorization, budgets | mode conflict, scope, task-boundary and autonomous prerequisite tests |
| Innovation/value | risk-aware state-space search with verified evidence promotion and external termination guard | benchmark scoring plus five controlled scenario invariants |

Container image builds, organizer-gateway validation, and real provider/tool smoke tests remain final release gates and must run only in the authorized competition environment.
