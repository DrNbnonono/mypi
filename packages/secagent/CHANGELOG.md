# Changelog

## [Unreleased]

### Added

- Added the SecAgent workspace package, security profile runtime, policy controls, evidence model, tool adapters, intake validation, and reports.
- Added package architecture documentation and centralized Sec-only runtime package sources.
- Added explicit runtime re-planning signals for failed or contradicted decisions.
- Added an in-session search board (`Fact` / `Intent` / `Hint` / `Path`) on `SecurityState` version 7, with SQLite knowledge spaces keyed by competition challenge or authorized pentest scope.
- Added a compressed search-board projection to `before_agent_start` and `security_autonomous inspect` so each turn sees structured target memory instead of raw tool transcripts.

### Changed

- Made `packages/secagent` the canonical source for SecAgent code and specialist agents.
- Removed project-global SecAgent runtime package loading so coding sessions remain unaffected.
- Updated SecAgent CI to test the workspace package, Coding/Sec mode integration, and Web mode surfaces.
- `SecurityExecutionGateway` now completes authorized decisions automatically after adapter execution and marks blocked/unavailable selected actions as failed so the next planning cycle can react deterministically.
- Autonomous candidates now come from open search Intents; static templates are bootstrap-only, and already explored or dead-end `pathKey`s are skipped across Sessions in the same knowledge space.
- The autonomous loop no longer holds a single global pending decision. It serializes tool execution while allowing up to `maxBranches` Intent branches so one failure does not stall the whole task. Termination is an external oracle (accepted flag, exhausted Intents/candidates, or budget), not model self-report.
