# Pi SecAgent

`@earendil-works/pi-secagent` is the opt-in cybersecurity profile for Pi. It provides event-sourced security state, explicit authorization scope, risk-aware policy, deterministic security tool adapters, evidence verification, autonomous state-space search, specialist delegation, controlled scenario benchmarks, and auditable Markdown/JSON reports.

SecAgent is a profile, not a second agent loop. `@earendil-works/pi-coding-agent` selects it when a Session is created with `agentMode: "sec"`; the default `coding` profile and existing coding Sessions do not load SecAgent resources.

## Quick start

Use Node.js `22.19.0` or newer. From the repository root, install the Sec-only runtime packages when local security execution or the competition demonstration requires them:

```bash
npm install --ignore-scripts --no-save \
  pi-sandbox@0.6.3 \
  pi-mcp-adapter@2.23.0 \
  pi-subagents@0.50.0 \
  pi-trace-extension@0.1.14
```

The packages are intentionally not loaded or installed during Session startup. Because this command uses `--no-save`, `npm ls --depth=0` labels them `extraneous`; that is expected for a local deployment. `/sec-doctor` reports missing, unresolvable, or version-mismatched packages. Autonomous and demo readiness remain false until their prerequisites are satisfied.

Start a security Session in the CLI:

```bash
pi --agent-mode sec
```

In Pi Web, choose `Sec` when creating a new Session, or send `agentMode: "sec"` to the new-session API. A Session has one immutable profile mode. `/agent-mode coding|sec` creates a new blank Session in the same working directory; it does not rewrite or copy the existing history.

The Web security workspace exposes the current task and stage, explicit scope, policy and isolation state, evidence and findings, decisions, tool audit, diagnostics, and Markdown/JSON report output. Its controls and structured statuses support English and Simplified Chinese; model, finding, and tool output remains in the language returned by the runtime.

SecAgent reuses `AgentSession`, extensions, resource loading, and mature Pi runtime packages from the existing ecosystem rather than forking the low-level Agent loop. The generic runtime extensions are loaded only for `sec` sessions:

- `pi-sandbox@0.6.3` — OS/filesystem/network isolation;
- `pi-mcp-adapter@2.23.0` — MCP transport and discovery;
- `pi-subagents@0.50.0` — bounded specialist child sessions;
- `pi-trace-extension@0.1.14` — generic execution tracing.

These packages are resolved only from the controlled deployment's local Node installation. SecAgent never installs them during Session startup. A missing package is omitted and reported by `/sec-doctor`; install the exact versions above with lifecycle scripts disabled when preparing the competition image.

The package also includes six bounded specialist definitions in `agents/`, deployment templates in `templates/`, controlled fixtures, and deterministic regression tests. Specialist definitions are discovered from the package resource path and are not copied from project `.pi/agents`.

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

`autonomous` is available only after controlled sandbox/container isolation or an explicitly recorded organizer-controlled isolation source, plus one risk confirmation. `strict` and `competition` block out-of-scope actions. Autonomous mode records out-of-scope attempts as high-risk audit warnings, but it never disables OS/container boundaries, protected credential paths, budgets, or audit. Attachment content never grants authorization.

## Development and deployment

For WSL, keep the repository and `node_modules` on the Linux ext4 filesystem, such as `~/src/mypi`. Repositories under `/mnt/c`, `/mnt/d`, or `/mnt/e` use a Windows-mounted filesystem that is slow for the many small reads and writes performed by npm, TypeScript, and Next.js. When development runs from `/mnt/*`, the Web launcher moves `.next` and its development Webpack cache to `/tmp`, but that does not make the source tree or dependency tree fast.

Use the Web development server for UI work only. For a stable demonstration or long-running Session, run the following from the repository root:

```bash
npm run build
npm run build --workspace=@agegr/pi-web
npm run start --workspace=@agegr/pi-web
```

The container template provides the same CLI/Web entry points and installs the four pinned runtime packages with lifecycle scripts disabled. Real tool smoke tests must target only loopback, disposable fixtures, or an explicitly authorized competition environment; deterministic tests use controlled executors and do not require external targets or paid model calls.

## Competition benchmarks

`security_benchmark` supports the general readiness score plus a controlled benchmark matrix for `web`, `pwn`, `reverse`, `forensics`, and `killchain`. The deterministic CI regressions exercise the real Candidate Generator, Planner, Gateway, adapters, state replay, Evidence Graph, Observer, Verifier, and Replanner with controlled executors. The same loop can be run against real loopback/container fixtures when competition tools are installed.

Documentation:

- `docs/index.md` — entry point and supported capability summary;
- `docs/architecture.md` — package boundaries, runtime flow, persistence, and extension/plugin ownership;
- `docs/autonomous-loop.md` — continuous search-loop semantics and controlled benchmark design;
- `docs/competition.md` — deployment, operation, deliverables, tests, and competition evidence mapping.
