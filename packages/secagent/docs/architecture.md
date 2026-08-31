# SecAgent architecture

## 1. Boundary with Pi

SecAgent is a cybersecurity profile on top of Pi, not a fork of the low-level agent loop.

Pi continues to own generic infrastructure: model/provider abstraction, the Agent loop and tool-call lifecycle, `AgentSession` persistence and session trees, extension loading, UI requests, and coding-mode behavior.

`@earendil-works/pi-secagent` owns security-specific semantics: structured task intake, authorization scope, event-sourced security state, Candidate Generator, Planner/Replanner, Evidence Graph and Verifier, Observer supervision, P0-P3 policy, autonomous authorization, security tool adapters/gateway, specialist-agent control, MCP policy translation, audit/replay, controlled benchmarks, and reports.

Security behavior is composed through the Agent Profile, inline extensions, registered tools/hooks, and replayable Session entries. The underlying Pi Agent loop is not modified.

## 2. Coding/Sec profile boundary

`packages/coding-agent/src/core/agent-profile.ts` is the generic host boundary. A persistent session has one immutable `agentMode`:

```text
coding session
  -> Coding profile
  -> normal coding resources

sec session
  -> SecAgent profile
  -> SecAgentRuntime
  -> security extensions
  -> sec-only runtime packages
```

The default remains `coding`. Old sessions without `agentMode` are interpreted as coding sessions. `/agent-mode coding|sec` creates a new blank session in the same working directory rather than rewriting existing history.

`SecAgentRuntime` is the single stateful bridge. CLI/Web code consumes `snapshot()`, `command()`, and `subscribe()` rather than parsing custom security Session entries directly.

## 3. Sec-only generic runtime packages

SecAgent reuses mature Pi packages and pins them in `src/runtime-packages.ts`:

```text
pi-sandbox@0.6.3
pi-mcp-adapter@2.23.0
pi-subagents@0.50.0
pi-trace-extension@0.1.14
```

They are loaded only by the Sec profile and intentionally remain absent from project-global `.pi/settings.json`.

```text
SecAgent policy/scope       semantic authorization boundary
pi-sandbox                  OS/filesystem/network isolation
pi-mcp-adapter              MCP transport/discovery
pi-subagents                child-session orchestration
pi-trace-extension          generic execution trace
```

Pi trace answers what ran and where. SecAgent audit additionally records why the action was selected, which scope/risk policy applied, what evidence was produced, and how the security state changed.

## 4. Specialist agents and capability overlays

Canonical specialist definitions live in `packages/secagent/agents/`:

- `sec-recon`
- `sec-web`
- `sec-analysis`
- `sec-response`
- `sec-vuln`
- `sec-reverse`

CTF is not a separate top-level agent. Web, Pwn, Reverse, Crypto, Forensics, and Misc are capability overlays. The control plane routes bounded work to the existing specialists and `pi-subagents` enforces the child-session lifecycle. Child specialists may not widen scope, authorization, or budget.

Project `.pi/agents` is not the canonical source and must not duplicate these definitions.

## 5. Risk-aware state-space execution

The core competition loop is implemented by `AutonomousSearchLoop` and exposed as `security_autonomous`:

```text
SecurityTaskSpec
      |
      v
SecurityState
      |
      v
Candidate Generator
      |
      v
Planner / Replanner
      |
      v
deterministic action-input builder
      |
      v
SecurityExecutionGateway
      |
      +--> Scope block / autonomous warning
      +--> P0-P3 Risk Policy
      +--> Budget
      +--> adapter preconditions
      |
      v
audited Tool Adapter / MCP boundary
      |
      v
normalized Evidence + provenance
      |
      +--> Evidence Graph / Verifier
      +--> Observer sidecar
      |
      v
termination or next state-space step
```

The Candidate Generator derives runnable alternatives from scenario, stage, explicit scope, local artifacts, CTF capability profile, previous outcomes, and the audited adapter registry. Successful deterministic candidates are not repeated; capability families with repeated failures are exhausted so changing executable names cannot hide strategy stagnation.

The deterministic action-input builder converts a selected candidate into structured adapter input. It does not expose arbitrary shell arguments. FFUF, for example, requires an explicit in-workspace wordlist asset; local binary/forensic analysis requires a regular in-workspace artifact.

The Planner scores goal relevance, information gain, confidence, risk, cost, novelty, and budget pressure. Replanning is triggered by failed/contradicted decisions, repeated capability-level failure, Observer drift/stall signals, and verification contradictions.

## 6. Evidence Graph, verification, and termination

A tool result is an observation, not automatically a finding. Gateway evidence records preserve decision IDs, source/tool identity, target references, and SHA-256 provenance for local artifacts where available.

The Evidence Graph represents explicit support, contradiction, derivation, duplication, and verification relationships. The automatic verifier only reevaluates active hypotheses that already have graph links. It does not invent hypotheses and cannot bypass `verifiedFindingGate`.

A finding is promoted only through a verified hypothesis record. The termination guard separately checks whether verified completion evidence satisfies the task objective; model prose alone cannot terminate the run as successful.

## 7. Persisted security model

Security state is rebuilt from custom Session entries. It includes:

```text
SecurityTaskSpec
stage
policyMode
isolation
autonomousAuthorization
scope
evidence + Evidence Graph
hypotheses + verifications
findings
decisions + replans
observerSignals
delegations
budget
ctfProfile
```

A decision records candidate alternatives, selected strategy, evidence inputs, expected result, actual result, status, plan revision, retry/replan relation, and budget snapshot. Tool audit records retain risk, scope, approval state, inputs, results, warnings, and block reasons.

This event-sourced model supports resume, branch replay, report reconstruction, regression evaluation, and judge-facing decision traces without persisting hidden model chain-of-thought.

## 8. Policy and autonomy boundary

Policy mode is independent of Coding/Sec Agent mode:

- `strict`: P2/P3 require per-action confirmation;
- `competition`: P2 may proceed automatically, P3 still confirms;
- `autonomous`: one recorded authorization replaces per-tool confirmation after isolation prerequisites are satisfied.

Strict and competition modes block execution outside explicit scope. Autonomous mode replaces that application-level block with a high-risk audit warning only after controlled isolation and one-time authorization are recorded. It does not disable OS/container isolation, protected credential paths, budgets, or audit. A new security task resets task-specific scope and autonomous authorization so authorization cannot leak across tasks.

`/sec-doctor` and the Profile `run_diagnostics` command share one diagnostic service. It checks isolation, Sec-only runtime packages, specialist definitions, installed tool versions, and writable workspace/temp/report directories. Model connectivity is reported as an explicit unprobed warning so diagnostics never spend provider tokens.

## 9. Tool adapter boundary

Security tools use structured metadata and adapters rather than arbitrary shell strings. Metadata defines canonical name/aliases, category, capabilities, risk floor, scope mode, preconditions/postconditions, and recommended specialist roles. Adapters define target extraction, availability diagnostics, deterministic argv construction, precondition validation, execution, and normalized evidence.

The current bounded execution surface includes network/Web discovery and verification (`nmap`, `curl`, `httpx`, `ffuf`, `nuclei`) and local artifact analysis (`file`, `strings`, `readelf`, `objdump`, `binwalk`, `exiftool`). External scanners remain external dependencies; SecAgent coordinates, constrains, and audits them rather than reimplementing them.

Unknown tools use conservative policy fallbacks. Compound shell calls inherit the highest relevant nested risk.

## 10. Controlled competition benchmarks

`src/scenarios/controlled.ts` defines five canonical scenario families:

```text
Web         -> bounded HTTP discovery and verification
Pwn         -> hash-backed ELF/mitigation/static-analysis path
Reverse     -> artifact triage and disassembly progression
Forensics   -> metadata and embedded-signature analysis
Killchain   -> multi-stage network/Web search with failure-driven replanning
```

`security_benchmark` can list the matrix and evaluate the current run against scenario-specific invariants such as scope enforcement, no repeated successful action, hash-backed artifact provenance, read-only binary analysis, no automatic extraction, capability diversity, failure-triggered replanning, and budget bounds.

Deterministic CI regressions replace only the external command executor; the actual Candidate Generator, Planner, Gateway, policy/scope checks, adapters, state replay, Evidence Graph, Observer, Verifier, and Replanner are exercised. In the competition environment, the same loop can use real tools against explicitly authorized loopback/container fixtures.

## 11. Repository ownership

```text
packages/secagent/
  agents/                 specialist definitions
  docs/                   architecture/competition/autonomy docs
  src/
    agents/               control plane
    core/                 state-space decision kernel
    ctf/                  capability profiling
    intake/               task/artifact normalization
    integrations/         MCP/subagent policy bridges
    report/               report/replay output
    scenarios/            benchmark definitions/evaluators
    tools/                registry, gateway, adapters
  templates/              deployment defaults
  test/                   deterministic regression suite
```

Repository `.pi` files may keep deployment/development overrides such as sandbox settings, but must not duplicate SecAgent implementation or specialist definitions.

## 12. Next competition work

The architecture and closed loop are now implemented. Remaining work should concentrate on measured capability rather than another orchestration layer: calibrate planner weights/budgets against repeated benchmark runs, add real loopback/container fixtures with installed competition tools, expand structured MCP capability acquisition, strengthen artifact and protocol-specific adapters where scenarios expose gaps, and export reproducible benchmark summaries for the final report/PPT.

The architectural rule remains: generic Agent infrastructure belongs to Pi or mature Pi packages; cybersecurity decision semantics and evidence-driven autonomy belong to `@earendil-works/pi-secagent`.
