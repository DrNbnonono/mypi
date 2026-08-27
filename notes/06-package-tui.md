# `packages/tui` 阅读笔记

## 1. 包定位

`tui` 是终端渲染和输入基础设施，不负责模型调用、Agent Loop 或 Session 持久化。入口是 [`src/index.ts`](../packages/tui/src/index.ts)。

```text
stdin bytes
  -> StdinBuffer
  -> Key parser / Keybindings
  -> 当前焦点组件
  -> coding-agent InteractiveMode

AgentSession state/events
  -> InteractiveMode
  -> Component tree
  -> TUI render
  -> Terminal
```

## 2. 核心抽象

- [`tui.ts`](../packages/tui/src/tui.ts)：TUI 容器、输入监听、渲染和 Overlay 协调。
- [`layout.ts`](../packages/tui/src/layout.ts)：布局节点和尺寸分配。
- [`components/`](../packages/tui/src/components/)：Text、Markdown、Editor、Loader、SelectList 等组件。
- [`terminal.ts`](../packages/tui/src/terminal.ts)：终端 I/O 抽象和进程终端实现。
- [`keys.ts`](../packages/tui/src/keys.ts)：普通键、Kitty keyboard protocol 和按键事件解析。
- [`keybindings.ts`](../packages/tui/src/keybindings.ts)：可配置快捷键。

## 3. 组件和渲染

组件通常不直接写终端，而是生成可组合的渲染行，由父容器统一计算尺寸和输出。

```text
TUI
  -> root Component
       -> VStack / HStack / Box
            -> Text / Markdown / Editor / Loader
  -> 计算 viewport
  -> 与上一帧比较
  -> 写入 Terminal
```

这样做的好处是 Overlay、滚动和终端尺寸变化可以在组件树层统一处理。

## 4. 重要函数和参数

### `detectCapabilities()`

源码：[`terminal-image.ts`](../packages/tui/src/terminal-image.ts)

该函数根据 `TERM_PROGRAM`、`TERM`、`COLORTERM`、`TMUX` 等环境判断：

- 是否支持图片；
- 是否支持真彩色；
- 是否支持 hyperlink；
- tmux/screen 是否会转发相关能力。

`tmuxForwardsHyperlink` 参数允许测试注入探测结果，避免单元测试依赖真实 tmux。

### `getCapabilities()` / `setCapabilities()`

能力探测会被缓存，`getCapabilities()` 适合正常运行时使用。测试或终端环境变化时使用 `resetCapabilitiesCache()` 或 `setCapabilities()`，不要修改全局缓存对象。

### `encodeKitty()`

该函数将 base64 图片拆成 Kitty Graphics Protocol 控制序列。`columns` 和 `rows` 控制终端布局，`imageId` 用于删除或重新定位，`moveCursor` 控制输出后的光标行为。它输出的是终端控制序列，不是可显示的普通文本。

## 5. 输入链路

`StdinBuffer` 的作用是将任意到达边界的 stdin chunk 组装为完整输入事件。键盘协议可能产生多字节 escape sequence，因此不能简单按单个字节判断快捷键。

快捷键应经 `KeybindingsManager` 和配置解析。上层不应硬编码 `ctrl+x` 对应的控制字符，否则用户无法重新配置。

## 6. 阅读建议

先读 [`tui.ts`](../packages/tui/src/tui.ts) 理解生命周期，再读 [`components/editor.ts`](../packages/tui/src/components/editor.ts) 和 [`components/markdown.ts`](../packages/tui/src/components/markdown.ts)，最后读终端图片和键盘能力。不要从单个 UI 组件推断 Agent 状态，状态来源在 `coding-agent`。
