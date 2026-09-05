# Sec Web

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

<p align="center"><img src="./public/logo.png" alt="Sec Web logo" width="96"></p>

Local browser UI for the [Pi agent harness](https://github.com/earendil-works/pi). Sec Web uses the same local configuration and Session files as `pi`, so you can browse and resume conversations, run Coding or Sec agent turns, configure models and resources, inspect project files, and view controlled security state from a browser.

![Sec Web displaying a pi session with structured Markdown, tool calls, and project navigation](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

## Features

- **Session workspace**: browse, resume, rename, export, and delete conversations grouped by project, with running state, context usage, cost, and compaction details.
- **Two ways to branch**: **New session** creates an independent session file from an earlier message; **Edit from here** creates a branch inside the current session.
- **Project file tools**: browse and upload files, inspect Git diffs, and preview source, Markdown, images, audio, PDFs, and DOCX files with automatic refresh.
- **Git worktrees**: switch checkouts from the sidebar while keeping sessions from the same repository grouped together.
- **Web-based configuration**: manage provider login and API keys, models, model tests, plugin packages, and skills without leaving Sec Web.
- **Coding/Sec profiles**: choose the default Coding profile or the opt-in SecAgent profile when creating a Session. Session mode is persisted; switching mode creates a new blank Session in the same working directory.
- **Security workspace**: Sec Sessions expose task intake state, authorization scope, policy/isolation status, evidence, findings, decisions, tool audit, diagnostics, and Markdown/JSON report output.
- **English and Simplified Chinese UI**: Sec Web follows the browser language initially and provides a language switcher in the top bar. Sec workspace controls and structured statuses switch with the selected language; model/tool output remains in the language returned by the runtime.

## Quick Start

Sec Web requires Node.js 22.19.0 or newer. Check your version with `node --version`, then run:

```bash
npx @agegr/pi-web@latest
```

The CLI opens a browser after the server is ready. If it does not, open [http://127.0.0.1:30141](http://127.0.0.1:30141). Sec Web listens only on `127.0.0.1` by default.

If no model provider is configured yet, open the **Models** panel to sign in or add an API key.

To install the `pi-web` command globally:

```bash
npm install -g @agegr/pi-web@latest
pi-web
```

To update, stop the running process with `Ctrl+C` and run the same install command again. To uninstall, run `npm uninstall -g @agegr/pi-web`.

## Configuration

For port and hostname, command-line options override the corresponding environment variables. Either `--no-open` or `PI_WEB_NO_OPEN=1` disables automatic browser opening.

| Option or environment variable | Purpose | Default |
| --- | --- | --- |
| `--port <port>`, `-p <port>`, or `PORT` | Server port | `30141` |
| `--hostname <host>`, `-H <host>`, or `PI_WEB_HOSTNAME` | Bind hostname | `127.0.0.1` |
| `--no-open` or `PI_WEB_NO_OPEN=1` | Do not open a browser automatically | Browser opens |
| `PI_WEB_ALLOWED_HOSTS` | Additional exact proxy or custom hostnames, comma-separated | Unset |
| `PI_WEB_PASSWORD` | Enable HTTP Basic Auth; the username is always `pi` | Authentication disabled |

For example:

```bash
pi-web -p 8080 -H 0.0.0.0 --no-open
```

### Remote Access

Binding to a non-loopback address exposes an agent that can execute high-privilege actions. On a trusted LAN, require a long random password:

```bash
PI_WEB_PASSWORD='a-long-random-password' pi-web --hostname 0.0.0.0
```

Basic Auth does not encrypt the password in transit. Do not expose Sec Web over plain HTTP to the internet; use HTTPS through a trusted reverse proxy or a trusted VPN. If a reverse proxy sends an external hostname, add that exact name to `PI_WEB_ALLOWED_HOSTS`. This allow-list does not change the address Sec Web binds to.

Security Sessions still require an explicit authorized scope. Attachment contents do not grant authorization. SecAgent's `autonomous` policy additionally requires controlled sandbox/container isolation or a recorded organizer-controlled isolation source and one confirmation. Do not expose a Sec Session or its credentials to an untrusted network.

### HTTP Proxy

Server-side model and API requests honor the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables.

On macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

On Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## Notes

- **Agent data**: Sec Web reads pi data from `~/.pi/agent` by default, including session files under `sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`. Set `PI_CODING_AGENT_DIR` to use another pi agent directory.
- **Filesystem access**: Sec Web must be able to read the agent data directory and the working directories recorded by its sessions. Run Sec Web in the same filesystem environment as pi when sharing existing sessions.
- **Shared configuration**: the Models panel uses pi's model, settings, and credential storage, so changes are visible to both interfaces.
- **File access boundary**: the file browser is limited to working directories selected in Sec Web and project or session roots it already knows about; it is not a general filesystem browser.
- **Git worktrees**: see [Worktrees in Sec Web](./docs/worktrees.md) for switcher visibility, worktree creation, and removal behavior.

### Downstream Session Context Menu

Electron wrappers and other downstream integrations can provide a session-row
context menu without patching `SessionSidebar`. Listen for the cancelable
`pi-web:session-row-contextmenu` browser event and call `preventDefault()`
synchronously when the integration will handle it:

```js
window.addEventListener("pi-web:session-row-contextmenu", (event) => {
  event.preventDefault();
  const { id, path, cwd, name, clientX, clientY, refresh } = event.detail;

  void openSessionMenu({ id, path, cwd, name, clientX, clientY }).then((changed) => {
    if (changed) refresh();
  });
});
```

The detail object contains `id`, `path`, `cwd`, optional `name`, pointer
coordinates, and a `refresh()` callback for actions that change the session
list. If no listener cancels the extension event, Sec Web preserves the
browser's native context menu. This hook is browser-side and independent of
Pi agent extensions.

## Development

```bash
npm install
npm run dev
```

The development server runs at [http://127.0.0.1:30141](http://127.0.0.1:30141). Use it for UI changes. For a stable demonstration or long-running Coding/Sec Session, run the following from the repository root:

```bash
npm run build
npm run build --workspace=@agegr/pi-web
npm run start --workspace=@agegr/pi-web
```

On WSL, keep the repository and `node_modules` on the Linux ext4 filesystem, for example under `~/src/mypi`. A repository under `/mnt/c`, `/mnt/d`, or `/mnt/e` uses the Windows-mounted filesystem and can be substantially slower for Next.js, Webpack, TypeScript, and file browsing. When development must run from `/mnt/*`, the launcher moves `.next` and the development Webpack cache to `/tmp`; this reduces generated-file I/O but cannot remove source and dependency I/O cost. The client uses SSE with fallback polling for running-state updates. Production mode remains the recommended choice for demonstrations and long-running work because it has no development compiler lifecycle.

Run the common checks with:

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

Do not run the production build concurrently with `next dev`; it writes to `.next/` and can interfere with the development server. Stop the development server before building, then use the production start command for a demonstration.

Contributor guides: [Internationalization](./docs/i18n.md) and [Release process](./docs/release.md).

## Repository Layout

```text
app/             Next.js UI and API routes
components/      React UI components
hooks/           Client state and interaction hooks
lib/             Session, agent, model, file, Git, and security logic
public/          Static assets and PWA files
bin/             npm CLI entrypoint and launch option parsing
docs/            Focused user and contributor guides
```

See [AGENTS.md](./AGENTS.md) for the architecture notes and detailed file map.

## License

[MIT](./LICENSE)
