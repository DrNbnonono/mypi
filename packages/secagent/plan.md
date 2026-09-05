# SecAgent 参赛基线收口规划

> 目标：从"核心骨架已形成"推进到"稳定参赛基线"。
> 下一轮（3 项 P0）做完即可具备真实平台测试前置条件，后续靶场与自动化评测再分批落地。

## 0. 已完成基线

- 原子化安全动作入口：支持 `decisionId` + 结构化 `intent`
- Action Journal：`planned / started / succeeded / failed / unknown / cancelled`
- 服务重启后遗留 `started` → `unknown`，不自动重放
- 请求参数 / 规范化参数 / argv 三层审计哈希
- 命令超时 + 进程组强制回收 + 输出长度限制
- `SecurityTargetGraph`：host / service / identity / vulnerability / credential / attack-path
- 凭证脱敏引用与图完整性校验
- `CompetitionProvider` 抽象 + 腾讯 MCP Provider + Faux Provider
- 任务排序 / 三实例并发 / 平台调用限速
- Flag 格式校验 / 哈希 / 去重 / 证据关联
- 每个 attempt 独立工作目录
- 受控浏览器服务客户端协议 + Browser 工具适配器
- Runtime / Profile command 已接入比赛调度、目标图、诊断
- 相关定向测试与 TS 类型检查已通过

---

## 1. 实施顺序

```text
1. P0 平台操作与 Flag 崩溃恢复
2. P0 完整工具输出产物
3. P0 Web 工作区：Target Graph / Action Journal / SSE revision
4. P1 Playwright 隔离浏览器服务（sidecar）
5. P1 六类受控靶场（Web / Binary / Exploit / Killchain / Cloud / Evasion）
6. P1 工具适配器质量打磨 + 自动化评测指标
7. P2 腾讯 MCP 真实平台连接验证
8. P2 全量回归 + 参赛文档收口 + 交付包
```

---

## 2. P0 收口：执行恢复语义

### 2.1 比赛平台操作恢复

- `startChallenge` / `stopInstance` / `resumeInstance` / `restartInstance` / `requestHint` 全部纳入 Action Journal，状态机：`planned → started → succeeded / failed / unknown / cancelled`
- 重启后 `started` 状态全部转 `unknown`，**绝不自动重新执行**
- 恢复流程固定为：`查询平台状态 → 与本地期望比对 → 人工或规则确认 → 再发起动作`
- 每个平台调用必须带幂等键（`idempotencyKey = sha256(provider + op + challengeId + attemptId + inputHash + monotonicSeq)`），重复提交直接返回首次结果

### 2.2 Flag 提交事务

状态机扩展：

```text
planned
→ submitting   (持久化前置于平台调用)
→ accepted
→ rejected
→ 崩溃后 → unknown
```

约束：
- `submitting` 必须在调用平台前落盘；落盘成功才能发起 HTTP 请求
- 重启后 `submitting` → `unknown`
- `unknown` Flag **禁止直接重提**
- 恢复流程：先 `GET /challenge/{id}/flag` 查询已提交状态；状态缺失或不一致时挂起，要求人工判断
- 已接受 Flag 进入只读归档，禁止再次进入 `submitting`

### 2.3 完整输出产物

- 内存仅保留截断后的 stdout/stderr（默认 64 KiB）
- 完整输出落盘到 `<attemptDir>/outputs/<actionId>/{stdout,stderr}.bin`
- 每条产物记录：`path / size / sha256 / mime / truncationReason`
- 写入失败必须把动作标 `failed`，并保留错误原因；不允许"产物丢失但显示成功"
- attempt 目录磁盘上限可配（默认 512 MiB），超过则按 LRU 截断并记录事件

### 2.4 验收

| 指标 | 阈值 |
|---|---|
| 重启后重复平台调用次数 | 0 |
| 重复 Flag 提交次数 | 0 |
| 未知副作用动作自动执行次数 | 0 |
| 超时进程组回收率 | 100% |
| 产物 SHA-256 覆盖率 | 100%（成功/失败均留痕） |

---

## 3. P0 收口：Web 比赛工作区

### 3.1 新增面板

| 面板 | 内容 |
|---|---|
| 比赛任务队列 | 题目列表、当前分数、状态、优先级、可领取性 |
| 实例面板 | 当前 attempt / 三实例配额 / 剩余预算 / 累计耗时 |
| Target Graph | 节点 / 边 / 当前攻击路径（高亮） |
| 证据时间线 | verified / hypothesis / failed / disproved 四态可视区分 |
| Action Journal | 状态、argv、超时、错误原因、幂等键 |
| Flag 面板 | 候选 Flag、提交状态、关联证据、平台响应摘要 |
| 运行时健康 | 浏览器 / MCP / sandbox / 工具版本探测 |
| 恢复面板 | 最近检查点、Session revision、SSE 重连来源 |

### 3.2 稳定性

- Profile command 全部增加 `idempotencyKey`
- 按钮按下后立即进入 disabled 态，直到 Profile 回写 `acknowledged` 才解除；网络抖动期间禁止二次点击
- SSE 重连后客户端先 `GET /session/revision`；revision 相同则续传，revision 跳跃则全量重拉 snapshot
- 事件携带 `(revision, monotonicSeq)`；过期事件不得覆盖新状态
- 显示断线、重连、恢复状态徽标

### 3.3 边界

- Web 不解析原始 Session entry
- Web 只读 Profile Runtime 的 `SecurityProfileSnapshot` 与命令结果
- 反序列化使用 strict schema，字段缺失即拒收

### 3.4 验收

- 刷新页面不丢失比赛状态（snapshot 持久化）
- SSE 断开后自动恢复，事件不重不漏
- 重复点击不产生重复 start / submit
- 关闭重开浏览器后看到的 Action Journal 与平台真实状态一致

---

## 4. P1：Playwright 隔离浏览器服务

### 4.1 Sidecar

- 独立容器或独立 Node 进程；只绑定 `127.0.0.1` 或 Docker 私网
- bearer token 鉴权；每次启动随机生成，注入 Runtime 不下盘
- 请求大小 / 并发 / 单 attempt 超时硬限

### 4.2 隔离

- 每个 attempt 一个独立 BrowserContext（独立 cookie / cache / storage）
- 下载目录隔离到 `<attemptDir>/browser/`
- 下载文件计算 SHA-256 + MIME，落盘登记

### 4.3 能力

- 打开 / 点击 / 输入 / 提交表单
- DOM、Cookie、LocalStorage / SessionStorage 检查
- 网络、控制台、WebSocket 记录
- 截图、HAR、下载文件取证
- 所有 URL 必须通过 Scope 校验；非授权 URL 一律拒绝

### 4.4 禁用

- 不暴露任意 `page.evaluate`
- 不允许 inline `<script>` 注入
- 不允许跨 attempt 引用任何持久化

### 4.5 版本与许可证

| 项 | 待锁定 |
|---|---|
| Playwright | 版本号（精确） |
| Chromium | 镜像来源 / 浏览器版本 / 镜像 SHA-256 |
| 许可证 | Playwright + Chromium 对应许可证 + 镜像再分发条款 |

锁定后写入 `runtime-packages.ts` 与 `templates/Dockerfile`，并记录在交付包 SBOM。

### 4.6 验收

- 自主完成 DOM XSS / 客户端状态 / WebSocket 三类场景
- 不同赛题 Cookie / 缓存 / 下载目录 100% 隔离
- 任意 attempt 崩溃不污染其他 attempt

---

## 5. P1：六类受控靶场

> 已有：Web / Pwn / Reverse / Forensics / Killchain。
> 需要新增：Cloud（MinIO/IAM、K8s RBAC）、Evasion（WAF / 编码 / 速率限制）。
> 已有的需要按比赛能力重新整理。

### 5.1 场景矩阵

| 类别 | 范围 | 受控目标 |
|---|---|---|
| Web | 浏览器 / DOM XSS / WebSocket / 认证状态 | loopback 容器 |
| Binary | readelf / objdump / file / strings / radare2 | 受控 fixture 二进制 |
| Exploit | GDB / checksec / pwntools | 受控 pwn 容器 |
| Killchain | 双节点 / 凭证引用 / 横向 / 重复分支取消 | docker compose |
| Cloud | MinIO + IAM / 容器配置 / K8s RBAC | docker compose |
| Evasion | WAF / 编码变体 / 速率限制 | loopback 中间件 |

### 5.2 每个场景统一闭环

```text
任务输入
→ scope
→ 计划
→ 工具执行
→ Target Graph
→ Evidence Graph
→ Flag / Finding 验证
→ 报告
```

### 5.3 验收

- 六类场景各至少有 1 个完全自主闭环案例
- 闭环报告哈希稳定（同一 fixture 同输入产生同报告哈希）

---

## 6. P1：工具适配器与自动化评测

### 6.1 适配器质量

- Nmap / Curl：参数覆盖与结果结构化
- Nuclei / FFUF / HTTPX：模板 / 字典 / 目标严格校验
- file / strings / readelf / objdump / radare2：二进制证据统一 schema
- GDB / checksec / pwntools：仅限隔离靶场
- MCP 工具：断线 / 超时 / 版本不兼容诊断
- 全部记录发现方式与精确版本
- 不支持参数必须失败，不得静默忽略
- shell 管道风险取最高等级
- 子 Agent 工具白名单**不可扩大**（除非新能力走完整 PR 评审）

### 6.2 评测指标

每次评测绑定：Git commit / Docker 镜像摘要 / 模型与参数 / 输入哈希 / Session ID / 工具版本 / 报告哈希。

指标列表：
- 自主得分、操作员辅助得分
- 首个 Flag 时间
- 每小时得分
- Token / 解题数、费用 / 解题数
- 工具成功率
- 参数一致率
- Decision 前置拒绝率
- 重规划成功率
- 重复动作比例
- 错误 / 重复 Flag 率
- scope 控制准确率
- 重启恢复成功率
- 报告重建一致性

输出：Markdown + JSON 评测报告，直接喂给 PPT。

---

## 7. P2：腾讯 MCP 真实平台连接

> Provider 抽象已就位，本轮需要真实链路。

- 配置真实 MCP Client
- OAuth / Token 从环境变量或受保护凭证引用读取（**不进 git、不进日志**）
- 验证五个工具（start / stop / resume / restart / hint / submit）的实际响应结构
- MCP 初始化 / 重连 / 限流
- 实例状态核对
- Hint 扣分确认流程
- Flag 提交幂等性实测

CI 继续只跑 Faux Provider。真实平台验证只在本机或显式授权环境执行。

---

## 8. P2：文档与交付包

冻结前必须更新：
- 架构设计
- 开发文档
- 部署手册
- 用户手册
- 测试报告
- 六类靶场报告
- 技术报告
- PPT 提纲
- 演示脚本
- 在线地址说明
- 离线依赖清单
- SBOM + 第三方许可证
- 镜像 SHA-256
- 原创性与保密性声明
- 脱敏运行日志

占位符（镜像摘要、在线 URL、最终成绩等）在冻结前替换；不允许文档内自造数据。

---

## 9. 当前一轮（P0 三项）任务拆分

```text
T1. 平台操作恢复（start/stop/resume/restart/hint）
  ├─ Action Journal 接入所有平台调用
  ├─ 幂等键生成与去重
  ├─ 重启 → unknown 状态机
  └─ 恢复流程：先查询再决策
T2. Flag 提交事务
  ├─ submitting 持久化前置
  ├─ 崩溃恢复 → unknown，禁止重提
  └─ 已接受 Flag 只读归档
T3. 完整输出产物
  ├─ 截断 stdout/stderr 内存保留
  ├─ 完整输出落盘 + SHA-256/MIME
  ├─ attempt 目录 LRU 配额
  └─ 写入失败 → 动作 failed
T4. Web 工作区面板（Target Graph / Action Journal / 队列 / 实例 / 证据 / Flag / 健康 / 恢复）
T5. Web 稳定性（幂等键 / 防重复点击 / SSE revision / 过期事件丢弃）
```

每项独立 PR，独立测试，独立 changelog 条目。

---

## 10. 风险与红线

- 任何绕过 Scope / Policy / Budget 的改动都不允许合入
- 任何扩大子 Agent 工具白名单的改动需要单独评审
- 任何破坏"重启后零副作用重放"的改动直接回退
- 任何凭据相关字段必须脱敏引用，不允许明文落日志
- 真实平台测试只在显式授权环境执行，缺一不可