# SecAgent autonomous search loop

SecAgent's competition runtime treats security work as bounded state-space search rather than a free-form sequence of shell commands.

## Closed loop

```text
SecurityState
  -> Candidate Generator
  -> Planner/Replanner
  -> deterministic action-input builder
  -> SecurityExecutionGateway
  -> scope + risk + budget gates
  -> audited adapter execution
  -> normalized evidence with provenance
  -> operational evidence promotion
  -> Verifier
  -> Observer sidecar
  -> termination check
  -> next state-space step
```

`security_autonomous` exposes `step`, `run`, and `inspect`. `run` is bounded to at most 50 steps and defaults to eight. Execution remains serial because Runtime `append` is not concurrent-safe. Search is branched by Intent: the same Intent cannot have two pending decisions, and the global pending limit is `maxBranches` (default 2, still bounded by the decision budget). A failed Intent is marked dead-end; sibling Intents stay open. Strict and competition modes block targets outside explicit scope. Autonomous mode may continue outside scope only after controlled isolation and one-time authorization, with a high-risk warning attached to the audit record.

`inspect` returns compact operational memory, a `searchBoard` summary (fact/intent/path counts plus the same projection injected into `before_agent_start`), and the external termination assessment. A model saying it is finished is not a stop condition.

The autonomous loop is a Sec profile capability, not a replacement for the generic Coding Agent loop. It is available only in a `sec` Session and does not install missing runtime packages or security tools. `/sec-doctor` reports readiness; a warning or missing prerequisite must be resolved in the controlled deployment before enabling autonomous execution.

## Deterministic execution inputs

The model does not invent arbitrary command lines inside the autonomous loop. Candidate actions are converted to structured adapter input by `core/action-input.ts`. Only tools with an explicit autonomous input builder are eligible. Examples include bounded Nmap discovery, HTTP requests/fingerprinting, signed Nuclei templates, and read-only local artifact analysis.

FFUF is only eligible when the task includes an in-workspace wordlist asset. Local analysis remains confined to regular files inside the session working directory, including symlink resolution checks in the adapter layer.

## Search board and candidate source

`SecurityState.searchBoard` is the in-session Fact / Intent / Hint / Path blackboard (`SecurityState.version` 7). Successful gateway execution records a structured Fact and derives the next Intents; failures record a Hint and mark that path dead-end without closing sibling Intents.

The Candidate Generator uses open Intents when any exist. The static `TEMPLATES` list is only the bootstrap source when the board has no open Intent (and still withholds Nmap until explicit scope). `pathKey` is `sha256(tool|capability|canonicalTarget|normalizedInput)`. Paths already `explored` or `dead-end` on the board or in the knowledge store are not proposed again.

## Cross-session knowledge

Durable memory is SQLite at `$PI_CODING_AGENT_DIR/secagent/knowledge.sqlite` (`node:sqlite`, no extra npm dependency). Spaces are isolated:

- competition: `challenge:${providerId}:${challengeCode}`
- pentest: `scope:${sha256(canonical sorted scope targets)}`

A new Session hydrates `origin: knowledge` Facts and dead-end Hints after intake/scope/start. It does not replay old decisions or actions. Attempt `workspaceRef` is not stored. Statements are redacted; plaintext flags, credentials, and raw tool stdout are not persisted.

## Strategy progression

Successful candidate/action identities are not repeatedly selected by the generator. Repeated failures are tracked at the capability level, not only by executable name, so switching from one HTTP enumerator to another does not hide a stalled strategy. Observer `repeated-path` signals fire when the same `pathKey` is selected again. Failed/contradicted decisions feed the Replanner on the next step.

Termination is external: an accepted competition flag (when submissions exist), verified findings that meet the task criteria, or no remaining open Intent and no bootstrap candidate, or budget exhaustion.

## Evidence and verification

Gateway execution creates normalized evidence records carrying decision IDs, target references, tool source, and artifact SHA-256 when available. `core/evidence-promoter.ts` converts successful execution evidence into narrow operational hypotheses such as "an HTTP service is reproducibly observable" or "the supplied artifact has reproducible static properties". Evidence from different tools can converge on the same target-scoped hypothesis, allowing the existing Verifier to measure independent-source support.

Operational promotion deliberately does not claim that a vulnerability is confirmed. Nuclei and similar signals are represented as candidate-vulnerability signals that still require finding-level confirmation. Confirmed findings continue to pass through the normal verification gate. Search-board Facts are written beside promotion; scanner output is never upgraded into a confirmed vulnerability.

## Controlled competition benchmarks

The canonical benchmark matrix is defined in `src/scenarios/controlled.ts` and covers Web security, Pwn/ELF triage, reverse engineering, forensics/incident artifact triage, and multi-stage penetration-test killchain recovery.

`src/scenarios/harness.ts` executes each benchmark in an isolated temporary fixture with the real Candidate Generator, Planner/Replanner, policy/scope gates, SecurityExecutionGateway, registered adapters, Evidence Graph, Verifier, Observer and audit path. Only the external command executor is deterministic, so CI does not depend on Nmap, httpx, Nuclei, binwalk or other competition binaries being installed.

Use `security_benchmark` with `action=run-controlled` to execute one isolated end-to-end harness. The benchmark score now combines invariant checks with successful capability coverage; a trace cannot receive a perfect score merely because safety properties pass while required capability families were never completed.

For the final competition environment, run the same scenario matrix against disposable loopback/container fixtures with the real tools installed. This preserves benchmark logic while replacing only the deterministic command executor.

Do not use the Next.js development server as the runtime supervisor for a long autonomous run. Development compilation, hot reload, or a process restart can interrupt the Web SSE connection and an in-flight operation. Use the production Web server behind a process supervisor, keep the Session directory persistent, and verify the restored snapshot and audit records before resuming.
