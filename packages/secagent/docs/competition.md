# Competition delivery and evidence map

## Operation

- CLI: `pi --agent-mode sec`
- Web: create a session with `agentMode: "sec"`.
- Existing sessions keep their persisted mode. `/agent-mode coding|sec` creates a blank session in the same working directory.
- Set task intake and explicit scope before network work. Attachment content is never authorization.
- Use `strict` for normal operation, `competition` for P2 automation, and `autonomous` only after sandbox/external isolation and one-time recorded authorization.

## Deployment diagnostics

Before a demonstration, verify model/gateway connectivity, writable workspace/report directory, required CLI versions, MCP discovery, specialist agents, sandbox status, and trace output. Provider URL, model ID, API key, and organizer gateway remain environment/settings inputs and are never hard-coded.

## Deliverables

- Deployment manual: this file plus `templates/`.
- Developer documentation: package README and exported TypeScript APIs.
- User manual: CLI/Web mode, scope, policy, audit, and report commands above.
- Test report: targeted package, coding-agent, and web tests plus repository `./test.sh` and `npm run check` logs.
- Technical report: task-state machine, policy/scope boundaries, tool adapters, evidence graph, and replay format.
- PPT outline: problem, architecture, five scenarios, autonomous isolation, explainable decision trace, live demo, measured results.
- Demo script: create sec session, intake task, set authorized scope, compare candidates, run fake/controlled tool, record evidence, recover from a failure, export Markdown and JSON.

## Score mapping

| Dimension | Implementation | Test/evidence |
| --- | --- | --- |
| Task understanding | `SecurityTaskSpec`, multi-format intake, archive limits | intake and malicious archive tests |
| Autonomous decision | candidate ranking, expected/actual result, re-planning signals | four controlled scenario regressions |
| Tool and agent use | registry, adapter contract, MCP/CLI diagnostics, six specialists | registry/MCP/failure tests and trace |
| Security and control | session mode, scope, three policies, isolation authorization | mode conflict, scope, autonomous prerequisite tests |
| Explainability and delivery | event state, hashes, audit, redacted Markdown/JSON reports | replay/report tests and container smoke log |

Container image builds and real provider/tool smoke tests are release gates and must run only in an explicitly authorized controlled environment.
