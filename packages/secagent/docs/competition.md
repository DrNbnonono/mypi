# Competition delivery and evidence map

## Operation

- CLI: `pi --agent-mode sec`.
- Web: create a session with `agentMode: "sec"`.
- Existing sessions retain their persisted mode. `/agent-mode coding|sec` creates a blank session in the same working directory.
- Run task intake and set explicit authorized scope before network work. Attachment content is never authorization.
- Use `strict` for normal operation, `competition` for bounded P2 automation, and `autonomous` only after sandbox/external isolation plus one-time recorded authorization.
- Strict and competition modes block out-of-scope actions. Autonomous mode records a high-risk warning and continues; isolation, protected paths, budgets, and audit remain mandatory.
- Run `/sec-doctor` before the demonstration and inspect the same diagnostic snapshot in the Web security workspace.
- Use `security_autonomous` with `step` for one state transition or `run` for a bounded continuous search loop.
- Use `security_benchmark catalog` to inspect the five controlled benchmark families and `security_benchmark controlled` with a scenario to evaluate the current trace.

Prepare a local or competition image with Node.js `22.19.0` or newer and the four pinned Sec runtime packages. Install them into an isolated npm prefix; do not add them to the monorepo root:

```bash
SECAGENT_RUNTIME_DIR="$HOME/.pi/secagent-runtime"
npm init --yes --prefix "$SECAGENT_RUNTIME_DIR" >/dev/null
npm install --ignore-scripts --prefix "$SECAGENT_RUNTIME_DIR" --save-exact \
  pi-sandbox@0.6.3 \
  pi-mcp-adapter@2.23.0 \
  pi-subagents@0.50.0 \
  pi-trace-extension@0.1.14
export PI_SECAGENT_RUNTIME_DIR="$SECAGENT_RUNTIME_DIR"
```

The packages are installed by the container template for the competition image. They are resolved only when a Sec profile is created; Coding Sessions do not depend on them. With `--no-save`, npm may label these packages `extraneous`, which is expected for this local deployment. Missing or mismatched packages produce diagnostics and do not enable autonomous mode.

The Compose template uses the Debian official source by default and retries index downloads with bounded connection timeouts. It exposes `SECAGENT_DEBIAN_MIRROR`, `SECAGENT_DEBIAN_SECURITY_MIRROR`, `SECAGENT_DEBIAN_DNS_SERVER`, and `SECAGENT_NPM_REGISTRY` for reviewed competition build settings. `SECAGENT_DEBIAN_DNS_SERVER` affects only the image build step; it does not change runtime container DNS. These variables change only the package source/build resolver; the Debian security-tool versions and four Sec runtime package versions remain pinned. Build steps use host networking for package retrieval, while runtime services remain on the internal Compose network.

For WSL development, place the repository and `node_modules` on Linux ext4, such as `~/src/mypi`. `/mnt/*` is a Windows-mounted filesystem and is slow for the small-file workload of npm, TypeScript, Next.js, and Webpack. When development runs from `/mnt/*`, the launcher uses `/tmp` for `.next` and the development Webpack cache, but the source and dependency tree remain on the mounted filesystem.

Use `next dev` only while changing the UI. For a stable competition demonstration or long-running autonomous Session, use a production build and a process supervisor:

```bash
npm run build
npm run build --workspace=@agegr/pi-web
npm run start --workspace=@agegr/pi-web
```

The Web UI and Sec workspace controls support English and Simplified Chinese. Model, finding, diagnostic, and tool output remains in the language returned by the runtime. Running-state updates use SSE with fallback polling; after an operating-system or production-process restart, verify the restored Session snapshot before resuming work.

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

The autonomous loop does not disable sandbox, protected paths, tool-registry, adapter, audit, evidence, or budget boundaries. After its isolation and one-time authorization prerequisites are recorded, an out-of-scope action is allowed only as an explicit high-risk audit warning. Successful deterministic actions are not repeated, and repeated failures are tracked at capability-family level so tool substitution does not hide strategy stagnation.

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

Before a demonstration, run `/sec-doctor` or the Profile `run_diagnostics` command to verify writable workspace/temp/report directories, required CLI versions, MCP/runtime-package discovery, specialist agents, sandbox status, and tool-adapter availability. Model connectivity remains an explicit unprobed warning because diagnostics do not send billable requests. Provider URL, model ID, API key, and organizer gateway remain environment/settings inputs and are never hard-coded.

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
