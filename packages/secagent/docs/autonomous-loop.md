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
  -> automatic verification of already-linked hypotheses
  -> Observer sidecar
  -> termination check
  -> next state-space step
```

`security_autonomous` exposes `step`, `run`, and `inspect`. `run` is bounded to at most 50 steps and defaults to eight. The loop refuses to start without a task, refuses to create a second unresolved decision, and never widens authorization scope.

## Deterministic execution inputs

The model does not invent arbitrary command lines inside the autonomous loop. Candidate actions are converted to structured adapter input by `core/action-input.ts`. Only tools with an explicit autonomous input builder are eligible. Examples include bounded Nmap discovery, HTTP requests/fingerprinting, signed Nuclei templates, and read-only local artifact analysis.

FFUF is only eligible when the task includes an in-workspace wordlist asset. Local analysis remains confined to regular files inside the session working directory, including symlink resolution checks in the adapter layer.

## Strategy progression

Successful candidate/action identities are not repeatedly selected by the generator. Repeated failures are tracked at the capability level, not only by executable name, so switching from one HTTP enumerator to another does not hide a stalled strategy. Observer signals and failed/contradicted decisions feed the Replanner on the next step.

## Evidence and verification

Gateway execution creates normalized evidence records carrying decision IDs, target references, tool source, and artifact SHA-256 when available. The autonomous verifier only evaluates hypotheses that already have explicit Evidence Graph links; it does not invent hypotheses or auto-promote arbitrary tool output into findings. Confirmed findings still require the normal verification gate.

## Controlled competition benchmarks

The canonical benchmark matrix is defined in `src/scenarios/controlled.ts` and covers:

- Web security;
- Pwn/ELF triage;
- reverse engineering;
- forensics/incident artifact triage;
- multi-stage penetration-test killchain recovery.

The package test suite executes these scenarios with deterministic controlled executors while exercising the real candidate generator, planner, policy/scope checks, execution gateway, adapters, state replay, evidence capture, observer, and replanner. External-tool smoke tests remain opt-in because CI runners are not guaranteed to provide Nmap, httpx, Nuclei, binwalk, or other competition tools.

For the final competition environment, run the same scenario matrix against loopback/container fixtures with the real tools installed. This preserves benchmark logic while replacing only the command executor.
