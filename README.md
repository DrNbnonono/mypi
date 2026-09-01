<p align="center">
  <a href="https://pi.dev">
    <img alt="pi logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@earendil-works/pi-coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@earendil-works/pi-coding-agent?style=flat-square" /></a>
</p>

> New issues and PRs from new contributors are auto-closed by default. Maintainers review auto-closed issues daily. See [CONTRIBUTING.md](CONTRIBUTING.md).

# Pi Agent Harness

Pi is a self-extensible agent harness with two session profiles: `coding` for software development and the opt-in `sec` profile for controlled cybersecurity work. Coding remains the default, so existing commands and sessions keep their existing behavior.

* **[@earendil-works/pi-coding-agent](packages/coding-agent)**: Interactive coding agent CLI
* **[@earendil-works/pi-agent-core](packages/agent)**: Agent runtime with tool calling and state management
* **[@earendil-works/pi-ai](packages/ai)**: Unified multi-provider LLM API (OpenAI, Anthropic, Google, …)
* **[@earendil-works/pi-secagent](packages/secagent)**: Opt-in security profile, policy runtime, evidence model, controlled benchmarks, and auditable reports

## Coding and Sec modes

Use the normal `pi` command for coding, or explicitly create a security session:

```bash
pi                         # coding mode (default)
pi --agent-mode sec        # security mode
```

The mode is persisted in the Session and cannot be changed in place. `/agent-mode coding|sec` creates a new blank Session in the same working directory; it does not copy the old conversation. Sessions created before mode support are treated as coding Sessions.

SecAgent currently provides structured task intake, explicit authorization scope, `strict`/`competition`/`autonomous` policy modes, bounded tool adapters, planning and replanning, evidence verification, specialist-agent delegation, audit trails, controlled Web/Pwn/Reverse/Forensics/Killchain benchmarks, and Markdown/JSON reports. See [the SecAgent package](packages/secagent) and its [documentation index](packages/secagent/docs/index.md).

Sec mode is deliberately opt-in. Runtime packages for sandboxing, MCP, specialist sessions, and tracing are loaded only for Sec Sessions:

```bash
npm install --ignore-scripts --no-save \
  pi-sandbox@0.6.3 \
  pi-mcp-adapter@2.23.0 \
  pi-subagents@0.50.0 \
  pi-trace-extension@0.1.14
```

These packages are deployment prerequisites, not coding-mode prerequisites. The `--no-save` form makes `npm ls` report them as `extraneous`; that is expected for a local deployment. A missing or mismatched package is reported by `/sec-doctor`, and does not silently enable autonomous execution.

To learn more about Pi:

* [Visit pi.dev](https://pi.dev), the project website with demos
* [Read the documentation](https://pi.dev/docs/latest), but you can also ask the agent to explain itself

## All Packages

| Package | Description |
|---------|-------------|
| **[@earendil-works/pi-telemetry](packages/telemetry)** | Vendor-neutral telemetry contracts, reference adapter, conformance tests, and typed schemas |
| **[@earendil-works/pi-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@earendil-works/pi-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@earendil-works/pi-coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@earendil-works/pi-secagent](packages/secagent)** | Controlled cybersecurity profile and competition runtime |
| **[@earendil-works/pi-tui](packages/tui)** | Terminal UI library with differential rendering |

## WSL and runtime guidance

For WSL development, keep the repository and `node_modules` on the Linux ext4 filesystem, for example under `~/src/mypi`. Linux tools that operate on `/mnt/c`, `/mnt/d`, or `/mnt/e` use the Windows-mounted 9P filesystem and can be substantially slower for the many small file operations performed by npm, TypeScript, Next.js, and Webpack. When Pi Web development must run from `/mnt/*`, its launcher moves `.next` and the development Webpack cache to `/tmp`; source and dependency reads remain limited by the mounted filesystem.

Use `next dev` only for development. For a demonstration or a long-running Coding/Sec session, build first and run the production server:

```bash
npm run build
npm run build --workspace=@agegr/pi-web
npm run start --workspace=@agegr/pi-web
```

Production mode avoids the development compiler and hot-reload workload. The Web UI still uses the same Session files and profile APIs in both modes. See [Pi Web](packages/web-ui/README.md) for WSL, browser, and deployment details.

For Slack/chat automation and workflows see [earendil-works/pi-chat](https://github.com/earendil-works/pi-chat).

## Permissions & Containerization

Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

SecAgent adds security workflow controls, not an OS boundary. Attachments are input data and never authorization. Before network or state-changing work, provide an explicit authorized scope. `autonomous` requires controlled sandbox/container isolation and one recorded confirmation; protected credential paths, OS/container boundaries, budgets, and audit records remain mandatory. Use only loopback, disposable fixtures, or targets explicitly authorized by the competition organizer.

If you need stronger boundaries, containerize or sandbox Pi. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns:

- **Gondolin extension**: keep `pi` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
- **Plain Docker**: run the whole `pi` process in a local container for simple isolation.
- **OpenShell**: run the whole `pi` process in a policy-controlled sandbox.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).  Longer term plans for Pi can also be found in [RFCs](https://rfc.earendil.com/keyword/pi/).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build         # Refresh model data, then build all packages
npm run build:offline # Rebuild using existing model data without network access
npm run check         # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./pi-test.sh         # Run pi from sources (can be run from any directory)
```

## Building standalone binaries from release source

GitHub releases include a versioned source archive covered by the release's `SHA256SUMS` file. Extract it and run the same build script used for the official standalone binaries:

```bash
VERSION="<release-version>"
tar -xzf "pi-${VERSION}-source.tar.gz"
cd "pi-${VERSION}"
./scripts/build-binaries.sh --offline-model-data --platform linux-x64 --out "$PWD/out"
```

The source archive includes the generated provider model data used for the release. `--offline-model-data` builds with that snapshot instead of refreshing it from live provider catalogs. The script still installs dependencies, builds the monorepo, compiles the Bun executable, and stages its runtime assets. Package maintainers who provide dependencies separately can pass `--skip-install --skip-deps`.

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `PI_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent shrinkwrap.
- The published CLI package includes `packages/coding-agent/npm-shrinkwrap.json`, generated from the root lockfile, to pin transitive deps for npm users.
- Release smoke tests use `npm run release:local` to build, pack, and create isolated npm and Bun installs outside the repo before tagging a release.
- Local release installs, documented npm installs, and `pi update --self` use `--ignore-scripts` where supported.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow runs `npm audit --omit=dev` plus `npm audit signatures --omit=dev`.
- Shrinkwrap generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## Share your OSS coding agent sessions

If you use Pi or other coding agents for open source work, please share your sessions.

Public OSS session data helps improve coding agents with real-world tasks, tool use, failures, and fixes instead of toy benchmarks.

For the full explanation, see [this post on X](https://x.com/badlogicgames/status/2037811643774652911).

To publish sessions, use [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf). Read its README.md for setup instructions. All you need is a Hugging Face account, the Hugging Face CLI, and `pi-share-hf`.

You can also watch [this video](https://x.com/badlogicgames/status/2041151967695634619), where I show how I publish my `pi-mono` sessions.

I regularly publish my own `pi-mono` work sessions here:

- [badlogicgames/pi-mono on Hugging Face](https://huggingface.co/datasets/badlogicgames/pi-mono)

## License

MIT

<p align="center">
  <a href="https://pi.dev">pi.dev</a> domain graciously donated by
  <br /><br />
  <a href="https://exe.dev"><img src="packages/coding-agent/docs/images/exy.png" alt="Exy mascot" width="48" /><br />exe.dev</a>
</p>
