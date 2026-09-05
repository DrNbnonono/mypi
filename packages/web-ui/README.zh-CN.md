# Sec Web

[English](./README.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

<p align="center"><img src="./public/logo.png" alt="Sec Web logo" width="96"></p>

[Pi Agent Harness](https://github.com/earendil-works/pi) 的本地浏览器界面。Sec Web 与 pi 共用本机配置和会话文件，可在浏览器中查找和继续对话、运行 Coding 或 Sec 智能体、配置模型与资源，并查看项目文件和受控安全状态。

中文微信群：请查看 [GitHub Discussions 帖子](https://github.com/agegr/pi-web/discussions/271)。

![Sec Web 展示包含结构化 Markdown、工具调用和项目导航的 pi 会话](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

## 功能

- **会话工作区**：按项目查找、继续、重命名、导出和删除对话，并查看运行状态、上下文占用、花费和压缩信息。
- **两种分支方式**：**新会话**会从较早的消息创建独立会话文件；**从此处编辑**会在当前会话内创建分支。
- **项目文件工具**：浏览和上传文件、查看 Git Diff，并预览源码、Markdown、图片、音频、PDF 和 DOCX；文件变化后会自动刷新。
- **Git worktree**：从侧边栏切换 checkout，同时把同一仓库不同 worktree 的会话归在一起。
- **网页配置**：无需离开 Sec Web，即可管理 Provider 登录和 API Key、模型、模型测试、插件包及技能。
- **Coding/Sec 双模式**：创建会话时可选择默认的 Coding 模式或显式启用的 SecAgent 模式。模式会持久化；切换模式会在同一工作目录创建空白会话。
- **安全工作区**：Sec 会话显示任务状态、授权范围、策略与隔离状态、证据、发现、决策、工具审计、诊断和 Markdown/JSON 报告。
- **英文和简体中文界面**：Sec Web 首次打开时跟随浏览器语言，也可从顶部栏切换语言。Sec 工作区控件和结构化状态会随语言切换；模型与工具输出保留运行时返回的语言。

## 快速开始

Sec Web 要求 Node.js 22.19.0 或更高版本。先用 `node --version` 检查版本，然后运行：

```bash
npx @agegr/pi-web@latest
```

服务就绪后，命令行会尝试自动打开浏览器。如果没有打开，请访问 [http://127.0.0.1:30141](http://127.0.0.1:30141)。Sec Web 默认仅监听 `127.0.0.1`。

如果尚未配置模型 Provider，请打开**模型（Models）**面板登录或添加 API Key。

如需全局安装 `pi-web` 命令：

```bash
npm install -g @agegr/pi-web@latest
pi-web
```

更新前先用 `Ctrl+C` 停止正在运行的进程，再次执行同一条安装命令。卸载时运行 `npm uninstall -g @agegr/pi-web`。

## 配置

端口和主机名以命令行参数为准，优先于对应的环境变量。`--no-open` 与 `PI_WEB_NO_OPEN=1` 中任意一个都会关闭自动打开浏览器。

| 参数或环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `--port <端口>`、`-p <端口>` 或 `PORT` | 服务端口 | `30141` |
| `--hostname <主机>`、`-H <主机>` 或 `PI_WEB_HOSTNAME` | 监听主机名 | `127.0.0.1` |
| `--no-open` 或 `PI_WEB_NO_OPEN=1` | 不自动打开浏览器 | 自动打开 |
| `PI_WEB_ALLOWED_HOSTS` | 额外允许的代理或自定义主机名，多个值用逗号分隔，必须精确匹配 | 未设置 |
| `PI_WEB_PASSWORD` | 启用 HTTP Basic Auth，用户名固定为 `pi` | 不启用认证 |

例如：

```bash
pi-web -p 8080 -H 0.0.0.0 --no-open
```

### 远程访问

监听非回环地址会暴露一个可执行高权限操作的智能体。在可信局域网中使用时，请设置足够长的随机密码：

```bash
PI_WEB_PASSWORD='足够长的随机密码' pi-web --hostname 0.0.0.0
```

Basic Auth 不会加密传输中的密码。不要通过明文 HTTP 将 Sec Web 暴露到互联网；远程访问应使用可信反向代理提供 HTTPS，或通过可信 VPN。如果反向代理传递外部主机名，请把该名称精确加入 `PI_WEB_ALLOWED_HOSTS`。这个白名单不会改变 Sec Web 的监听地址。

安全会话仍必须显式设置授权范围，附件内容不会自动授予授权。SecAgent 的 `autonomous` 策略还要求受控 sandbox/container 隔离或已记录的主办方受控隔离来源，并完成一次确认。不要将安全会话或凭据暴露给不受信任的网络。

### HTTP 代理

服务端的模型和 API 请求会读取标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。

macOS 或 Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## 注意事项

- **智能体数据**：Sec Web 默认读取 `~/.pi/agent` 下的 pi 数据，包括 `sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl` 中的会话文件。可通过 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录。
- **文件系统访问**：Sec Web 必须能读取智能体数据目录及会话记录中的工作目录。与现有 pi 会话共用数据时，请让 Sec Web 运行在与 pi 相同的文件系统环境中。
- **共享配置**：模型面板使用 pi 的模型、设置和凭据存储，因此两种界面都能看到相关更改。
- **文件访问边界**：文件浏览器仅能访问在 Sec Web 中选择过的工作目录，以及它已识别的项目或会话根目录；它不是通用的文件系统浏览器。
- **Git worktree**：切换器何时显示、如何创建 worktree，以及删除会产生什么影响，见 [Sec Web 里的 Worktree](./docs/worktrees.zh-CN.md)。

## 开发

```bash
npm install
npm run dev
```

开发服务器运行在 [http://127.0.0.1:30141](http://127.0.0.1:30141)，用于界面开发。稳定演示或长时间运行 Coding/Sec 会话时，请在仓库根目录执行：

```bash
npm run build
npm run build --workspace=@agegr/pi-web
npm run start --workspace=@agegr/pi-web
```

在 WSL 中，请将仓库和 `node_modules` 放在 Linux ext4 文件系统中，例如 `~/src/mypi`。位于 `/mnt/c`、`/mnt/d` 或 `/mnt/e` 的仓库使用 Windows 挂载文件系统，Next.js、Webpack、TypeScript 和文件浏览的大量小文件操作会明显变慢。如果必须从 `/mnt/*` 开发，启动器会把 `.next` 和开发 Webpack 缓存移到 `/tmp`；这能减少生成文件 I/O，但不能消除源码和依赖树的 I/O 开销。客户端通过 SSE 接收运行状态，并保留轮询降级。演示和长时间任务仍建议使用没有开发编译器生命周期的生产模式。

常用检查命令：

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

不要在 `next dev` 运行时并行执行生产构建；构建会写入 `.next/` 并可能干扰开发服务器。请先停止开发服务器，再构建并使用生产启动命令进行演示。

贡献者文档：[国际化](./docs/i18n.md)和[发布流程](./docs/release.md)。

## 仓库结构

```text
app/             Next.js 界面和 API 路由
components/      React 界面组件
hooks/           客户端状态和交互 hooks
lib/             会话、智能体、模型、文件、Git 和安全逻辑
public/          静态资源和 PWA 文件
bin/             npm CLI 入口及启动参数解析
docs/            面向用户和贡献者的专题文档
```

架构说明和详细文件地图见 [AGENTS.md](./AGENTS.md)。

## 许可证

[MIT](./LICENSE)
