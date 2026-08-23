# SecAgent on Pi

SecAgent is the project-local cybersecurity intelligence layer built on top of Pi. Pi remains the generic agent harness; SecAgent owns security state, authorization scope, decision policy, tool metadata, audit, and specialist-agent behavior.

## Repository layout

```text
.pi/
├── SECAGENT.md                     # this architecture guide
├── agents/                         # project specialist definitions
│   ├── sec-recon.md
│   ├── sec-web.md
│   ├── sec-analysis.md
│   └── sec-response.md
├── extensions/                     # Pi extension entrypoints
│   ├── security-agent.ts           # SecAgent control-plane extension
│   ├── plan-mode.ts                # maintained Pi extension wrapper
│   ├── subagent.ts                 # maintained Pi extension wrapper
│   ├── questionnaire.ts            # maintained Pi extension wrapper
│   ├── tools.ts                    # maintained Pi extension wrapper
│   ├── protected-paths.ts          # maintained Pi extension wrapper
│   └── project-trust.ts            # maintained Pi extension wrapper
└── secagent/
    ├── core/                       # security decision kernel
    │   ├── types.ts
    │   ├── state.ts
    │   ├── planner.ts
    │   ├── policy.ts
    │   ├── scope.ts
    │   └── audit.ts
    ├── tools/                      # structured security-tool registry
    │   ├── catalog.ts
    │   └── registry.ts
    └── tests/                      # deterministic kernel tests
        ├── scope.test.ts
        └── tool-registry.test.ts
```

The extension entrypoint is deliberately thin relative to Pi core: all SecAgent-specific reusable logic lives under `.pi/secagent/`. Maintained Pi plugins are referenced through small project-local wrappers instead of copied forks.

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
  -> ALLOW / CONFIRM / BLOCK
  -> Pi tool execution
  -> audit record
  -> evidence / state update
  -> re-plan
```

## Policy model

- P0: read-only or internal state operations.
- P1: low-impact local/network interaction.
- P2: intrusive probing or local modification.
- P3: high-risk verification or destructive behavior.

`strict` mode requires confirmation for P2 and P3. `competition` mode may automatically allow P2, but P3 still requires confirmation. Target-scope checks are independent of policy mode and cannot be bypassed by switching modes.

## Structured tool registry

The registry gives tools explicit metadata rather than relying primarily on command-name heuristics:

- canonical name and aliases
- category
- base risk
- target-scope behavior
- capabilities
- preconditions
- postconditions
- recommended specialist agents

`security_decide` uses registry risk as a hard lower bound, so an LLM cannot lower a P3 tool to P0 by supplying an optimistic risk score. Shell calls are resolved into nested known executables and inherit the highest relevant registry risk.

## Reused Pi extensions

Enabled project-locally:

- plan mode
- subagent delegation
- questionnaire
- interactive tool selector
- protected paths
- project trust

The generic Pi `permission-gate` extension is intentionally not enabled because SecAgent owns P0-P3 risk classification and approval. Sandbox/Gondolin integration is the next isolated runtime layer and will be enabled only after deployment behavior is validated.
