# SecAgent architecture

## 1. Boundary with Pi

SecAgent is a cybersecurity profile on top of Pi, not a fork of the low-level agent loop.

Pi continues to own generic infrastructure:

- model/provider abstraction through `pi-ai`;
- the Agent loop and tool-call lifecycle;
- `AgentSession` persistence and session trees;
- extension loading and UI requests;
- coding-mode behavior.

`@earendil-works/pi-secagent` owns security-specific semantics:

- structured task intake;
- explicit authorization scope;
- security state and evidence;
- candidate decision scoring and re-planning state;
- P0-P3 policy and autonomous authorization;
- security tool metadata/adapters/gateway;
- specialist-agent definitions;
- MCP policy translation;
- audit, replay, and reports.

The package deliberately does not modify the underlying Agent loop. Security behavior is composed through the Agent Profile, inline extensions, tools, hooks, and replayable Session entries.

## 2. Coding/Sec profile boundary

`packages/coding-agent/src/core/agent-profile.ts` is the generic host boundary. A persistent session has one immutable `agentMode`:

```text
coding session
  -> Coding profile
  -> normal coding resources

sec session
  -> SecAgent profile
  -> SecAgentRuntime
  -> SecAgent extension
  -> sec-only runtime packages
```

The default remains `coding`. Old sessions without an `agentMode` are interpreted as coding sessions. Requesting a mode that conflicts with the persisted Session mode is an error; `/agent-mode coding|sec` creates a new blank session in the same working directory instead of rewriting history.

`SecAgentRuntime` is the single stateful bridge used by the profile extension and external clients. CLI/Web code consumes `snapshot()`, `command()`, and `subscribe()` instead of parsing security Session entries directly.

## 3. Sec-only generic runtime packages

SecAgent reuses mature Pi packages rather than reimplementing generic infrastructure. The pinned package sources are defined in `src/runtime-packages.ts` and loaded by the Sec profile through ResourceLoader temporary extension sources:

```text
pi-sandbox@0.6.3
pi-mcp-adapter@2.23.0
pi-subagents@0.50.0
pi-trace-extension@0.1.14
```

They are intentionally absent from project `.pi/settings.json`. This is important: if they were normal project packages, coding sessions would load them too.

Responsibilities remain separated:

```text
SecAgent policy/scope       decides whether an action is acceptable
pi-sandbox                  enforces OS/filesystem/network isolation
pi-mcp-adapter              provides MCP transport/discovery
pi-subagents                provides child-session orchestration
pi-trace-extension          records generic execution traces
```

SecAgent audit is not replaced by Pi trace. Pi trace answers what ran and where; SecAgent audit answers why it was selected, which policy/scope applied, and what evidence or state changed.

## 4. Specialist agents

Canonical specialist definitions live in `packages/secagent/agents/`:

- `sec-recon`
- `sec-web`
- `sec-analysis`
- `sec-response`
- `sec-vuln`
- `sec-reverse`

The monorepo root exposes `./packages/secagent/agents` through the `pi-subagents.agents` package manifest contract. Because `pi-subagents` itself is loaded only by the Sec profile, these specialists do not alter coding-mode behavior.

Project `.pi/agents` is no longer the canonical source and must not contain duplicated SecAgent specialists.

## 5. Security execution flow

The intended closed loop is:

```text
User input / artifact
  -> security_intake
  -> SecurityTaskSpec
  -> SecurityState
  -> explicit authorized scope
  -> plan / candidate actions
  -> structured tool registry + adapter
  -> risk + scope + precondition evaluation
  -> ALLOW / CONFIRM / WARN / DENY
  -> sandbox / MCP / CLI execution
  -> normalized observation
  -> audit + evidence
  -> decision completion
  -> re-plan when evidence, preconditions, or execution status changed
  -> verification
  -> confirmed finding
  -> Markdown / JSON report
```

The LLM proposes actions, but it is not the sole authority for risk or scope. Registry metadata provides risk floors; scope authorization is external to attachment content; policy and isolation prerequisites are deterministic runtime checks.

## 6. Persisted security model

Security state is rebuilt from custom Session entries. The current state contains:

```text
SecurityTaskSpec
stage
policyMode
isolation
autonomousAuthorization
scope
evidence
hypotheses
rejectedHypotheses
findings
decisions
```

Important distinctions:

- an observation is not automatically a confirmed finding;
- attachment targets are not automatically authorized targets;
- a scanner result is evidence/hypothesis input until verified;
- a decision records candidate alternatives, evidence inputs, expected result, actual result, and completion status;
- tool audit records retain risk, scope, approval/warning state, inputs, results, and block reasons.

This event-sourced design allows Session resume, branch replay, report reconstruction, and later benchmark/export tooling without depending on hidden model reasoning.

## 7. Policy modes

The policy mode is independent of the Coding/Sec Agent mode:

- `strict`: P2 and P3 require per-action confirmation.
- `competition`: P2 may proceed automatically; P3 still requires confirmation.
- `autonomous`: one recorded authorization replaces per-tool confirmation after isolation prerequisites are satisfied.

Autonomous mode does not disable OS/container boundaries, protected credential paths, or audit. If isolation is neither verified `pi-sandbox` nor an explicitly declared controlled external environment, autonomous mode cannot be enabled.

## 8. Tool adapter boundary

Security tools are represented by structured metadata and adapters instead of being treated as arbitrary shell strings. An adapter can define:

- canonical name and aliases;
- category and capabilities;
- risk floor;
- target extraction and scope behavior;
- preconditions and postconditions;
- execution/availability diagnostics;
- normalized evidence output.

External scanners remain external dependencies. SecAgent coordinates and audits them; it does not reimplement Nmap, curl, MCP servers, or other mature security tooling.

Unknown tools use conservative defaults, and compound shell execution inherits the highest relevant nested risk.

## 9. Repository ownership after migration

The package is now the source of truth:

```text
packages/secagent/
  agents/
  docs/
  src/
    core/
    intake/
    integrations/
    report/
    tools/
  templates/
  test/
```

The repository-level `.pi` directory may keep deployment/development configuration such as `.pi/sandbox.json` and general project extensions, but it must not duplicate:

- `.pi/secagent/**`;
- `.pi/extensions/security-agent.ts`;
- `.pi/extensions/security-report.ts`;
- `.pi/agents/sec-*.md`;
- project-global SecAgent runtime packages in `.pi/settings.json`.

`.mcp.json` and `.pi/sandbox.json` remain project deployment overrides; equivalent default templates are shipped under `packages/secagent/templates/`.

## 10. Next capability work

After the package boundary is stable, development should move upward into competition-specific intelligence rather than more runtime plumbing:

1. finish task-intake normalization for supported artifact types;
2. evolve the current candidate scorer into an explicit plan/execute/observe/re-plan state machine;
3. add evidence relationships and verification gates so findings are supported by traceable evidence;
4. finish standard CLI/MCP adapter diagnostics and failure recovery;
5. build controlled faux-provider scenario regressions for penetration testing, incident response, vulnerability research, Web security, and reverse engineering;
6. expose the same Profile Runtime state and commands in CLI and Web without duplicating security logic.

The architectural rule is simple: generic Agent infrastructure belongs to Pi or a mature Pi package; cybersecurity decision semantics belong to `@earendil-works/pi-secagent`.
