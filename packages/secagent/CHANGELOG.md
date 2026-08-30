# Changelog

## [Unreleased]

### Added

- Added the SecAgent workspace package, security profile runtime, policy controls, evidence model, tool adapters, intake validation, and reports.
- Added package architecture documentation and centralized Sec-only runtime package sources.
- Added explicit runtime re-planning signals for failed or contradicted decisions.

### Changed

- Made `packages/secagent` the canonical source for SecAgent code and specialist agents.
- Removed project-global SecAgent runtime package loading so coding sessions remain unaffected.
- Updated SecAgent CI to test the workspace package, Coding/Sec mode integration, and Web mode surfaces.
- `SecurityExecutionGateway` now completes authorized decisions automatically after adapter execution and marks blocked/unavailable selected actions as failed so the next planning cycle can react deterministically.
