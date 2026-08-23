# SecAgent on Pi

SecAgent is the project-local cybersecurity intelligence layer built on top of Pi. Pi remains the generic agent harness; SecAgent owns security state, authorization scope, decision policy, tool metadata, audit, reporting, and specialist-agent behavior.

Generic runtime capabilities are reused from pinned Pi packages instead of being forked into this repository.

## Repository layout

```text
.mcp.json                         # conservative project MCP config
.pi/
├── SECAGENT.md                   # this architecture guide
├── settings.json                 # pinned project-local Pi packages
├── sandbox.json                  # fail-closed sandbox policy
├── agents/                       # project specialist definitions
│   ├── sec-recon.md
│   ├── sec-web.md
│   ├── sec-analysis.md
│   └── sec-response.md
├── extensions/                   # thin project extension entrypoints
│   ├── security-agent.ts         # SecAgent state/policy/scope control plane
│   ├── security-report.ts        # reproducible Markdown/JSON reports
│   ├── plan-mode.ts              # maintained Pi example wrapper
│   ├── questionnaire.ts          # maintained Pi example wrapper
│   ├── tools.ts                  # maintained Pi example wrapper
│   ├── protected-paths.ts        # maintained Pi example wrapper
│   └── project-trust.ts          # maintained Pi example wrapper
└── secagent/
    ├── core/                     # security decision kernel
    │   ├── types.ts
    │   ├── state.ts
    │   ├── planner.ts
    │   ├── policy.ts
    │   ├── scope.ts
    │   └── audit.ts
    ├── integrations/             # thin bridges to packaged runtimes
    │   ├── README.md
    │   └── mcp-policy.ts
    ├── tools/                    # structured security-tool registry
    │   ├── catalog.ts
    │   └── registry.ts
    ├── report/                   # report/export logic without Pi UI coupling
    │   └── generator.ts
    └── tests/                    # deterministic kernel/integration tests
        ├── scope.test.ts
        ├── tool-registry.test.ts
        ├── mcp-integration.test.ts
        ├── runtime-config.test.ts
        └── report.test.ts
```

The extension entrypoints are deliberately thin relative to Pi core. Reusable SecAgent-specific logic lives under `.pi/secagent/`. Third-party Pi packages are installed through project settings instead of copied or forked.

## Runtime packages

`.pi/settings.json` pins:

- `pi-sandbox@0.6.3` — OS-level filesystem/network sandboxing.
- `pi-mcp-adapter@2.23.0` — MCP discovery and lazy proxy execution.
- `pi-subagents@0.50.0` — child-agent orchestration, parallel/chain/background workflows.
- `pi-trace-extension@0.1.14` — local execution traces, including nested child-agent traces.

Pi installs missing project packages after the project is trusted. Generic package skills/prompts are disabled where SecAgent already supplies its own operating protocol and specialist definitions.

## Runtime control flow

```text
User task
  -> security_state start_task
  -> security_scope set
  -> SecurityState / evidence
  -> candidate actions
  -> security_decide
  -> structured tool registry
  -> risk policy + scope policy
  -> package runtime (MCP / subagent / sandbox)
  -> ALLOW / CONFIRM / BLOCK
  -> Pi tool execution
  -> audit record + Pi execution trace
  -> evidence / state update
  -> re-plan
  -> security_report
```

## Policy model

- P0: read-only or internal state operations.
- P1: low-impact local/network interaction.
- P2: intrusive probing or local modification.
- P3: high-risk verification or destructive behavior.

`strict` mode requires confirmation for P2 and P3. `competition` mode may automatically allow P2, but P3 still requires confirmation. Target-scope checks are independent of policy mode and cannot be bypassed by switching modes.

## Structured tool registry

The registry gives native security tools explicit metadata rather than relying primarily on command-name heuristics:

- canonical name and aliases
- category
- base risk
- target-scope behavior
- capabilities
- preconditions
- postconditions
- recommended specialist agents

`security_decide` uses registry risk as a hard lower bound, so an LLM cannot lower a P3 tool to P0 by supplying an optimistic risk score. Shell calls are resolved into nested known executables and inherit the highest relevant registry risk.

MCP transport is not reimplemented. The single `mcp` proxy tool is interpreted by `.pi/secagent/integrations/mcp-policy.ts`: discovery is low risk, delegated mutations receive P2/P3 floors, and nested network targets are checked against `security_scope` before execution.

## Sandbox boundary

`pi-sandbox` is enabled through `.pi/sandbox.json`. Network access starts fail-closed with no pre-authorized domains, while project files are writable except protected Git/environment/key material.

A target therefore must pass two independent boundaries:

1. SecAgent scope/policy authorization.
2. OS-level sandbox permission.

This keeps SecAgent from pretending that an application-level target check is equivalent to process isolation.

## Multi-agent and delegation trace

`pi-subagents` replaces the earlier repository wrapper around Pi's example subagent implementation. SecAgent continues to own the project specialist definitions under `.pi/agents/`.

`pi-trace-extension` captures runtime execution trees, nested child sessions, timing, model/tool activity, token usage, and errors. This complements the SecAgent decision audit rather than replacing it:

- Pi trace answers: what executed, where, when, and in which child session?
- SecAgent audit answers: why was it allowed, what scope/risk applied, what evidence changed, and what decision followed?

Trace artifacts may contain sensitive prompts/tool arguments and must be reviewed before sharing.

## Audit and reports

Security state is event-sourced through Pi session entries. Tool execution writes structured audit entries containing registry resolution, risk, scope decisions, approval state, input summaries, results, and block reasons.

`security_report` and `/sec-report` build reproducible output directly from the current session branch. Markdown is intended for review and competition demonstrations; JSON is intended for replay, evaluation, and later report-processing pipelines.

Useful commands:

```text
/sec-state
/sec-scope
/sec-tools
/sec-audit [limit]
/sec-mode strict|competition
/sec-report [markdown|json]
/mcp
/sandbox
/trace
```

The generic Pi `permission-gate` extension remains disabled because SecAgent owns P0-P3 classification and approval. Third-party package versions are pinned and should be source-reviewed before upgrades.
