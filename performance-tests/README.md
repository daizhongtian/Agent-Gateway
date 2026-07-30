# Agent Gateway 性能测试

这套测试把 **Agent Gateway 自身开销** 与 **AI Provider 耗时** 分开。默认压测链路使用仓库内的可控 Fake AI Provider，不调用 Codex、不消耗真实额度；真实 Provider 只提供一条显式启用、单请求的发布 Smoke。

## 一条命令

```powershell
npm run performance
```

这条本地套件依次运行 Smoke、Baseline、正常负载、Spike 和故障恢复。若 `http://127.0.0.1:8088` 上有平台，会自动加入公开控制面和前端 HTTP 测试；平台未启动时会明确标记为 `skipped`，Local Gateway/Fake Provider 测试仍正常完成。

完整长测（包含 Stress 和默认 10 分钟 Soak；多个目标顺序运行，整体会更久）：

```powershell
npm run performance:all
```

开发时可用 `PERF_DURATION_SCALE=0.05` 缩短所有阶段。它只用于调试测试代码，不能作为正式基线。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run performance:smoke` | PR 用 3～5 分钟隔离 Smoke，不要求平台 |
| `npm run performance:baseline:update` | 建立/更新当前机器的 `baselines/local.json` |
| `npm run performance:regression` | 与同类机器的本地基线比较，p95 退化不得达到 20% |
| `npm run performance:normal` | 正常峰值 |
| `npm run performance:spike` | 瞬时并发提升及恢复 |
| `npm run performance:stress` | 并发阶梯，定位容量拐点 |
| `npm run performance:soak` | 长时间稳定性；`PERF_SOAK_SECONDS` 可改主阶段时长 |
| `npm run performance:fault` | 25% 确定性 Provider 错误注入，然后恢复至 0% |
| `npm run performance:desktop` | Electron 启动、空闲 RSS/CPU 和进程数 |
| `npm run performance:real-provider` | 一次真实 OpenAI-compatible 流式发布验收 |

所有普通结果写到 `artifacts/performance/`，同时生成：

- `*.json`：CI 和后续分析使用的机器可读结果；
- `*.md`：便于代码评审；
- `*.html`：可直接打开的报告；
- `latest.*`：最近一次运行的稳定文件名。

## 实际测到什么

| 目标 | 测量内容 |
|---|---|
| `fake-provider` | 可控模型基准、流式间隔和错误注入本身 |
| `gateway-health` | Local Gateway API 和事件循环/资源开销 |
| `gateway-models` | Gateway Key 认证及 OpenAI `/v1/models` |
| `full-chain-stream` | 客户端 → Local Gateway → Fake Provider 的完整 SSE |
| `platform-control` | Spring Boot health/readiness/config，其中 readiness 实际查询数据库 |
| `platform-authenticated` | Session、设备和 Host 管理的已认证 API |
| `frontend-http` | React 页面 HTML、JS、CSS 的总下载时间和字节数 |
| `frontend-browser` | Chrome/Edge 页面导航和打开注册弹窗的交互时间 |
| `relay-preview-stream` | Public Host → localhost Relay preview → Gateway → Fake Provider |
| `electron-desktop` | Renderer ready 时间、空闲资源漂移和进程树峰值 |

流式请求用唯一 prompt 关联两份计时：

```text
端到端 TTFT/总耗时 - Fake Provider TTFT/总耗时 = Gateway/Relay 附加耗时
```

同时记录吞吐量、p50/p95/p99、首 Token、SSE 间隔、错误/超时、队列、活动任务、Socket、CPU、RSS、事件循环、句柄和临时文件。取消探针要求活动槽位在 2 秒内释放。

## Fake AI Provider

独立启动：

```powershell
npm run performance:fake-provider
```

默认地址为 `http://127.0.0.1:19090`，支持：

- `GET /health`
- `GET /metrics`
- `GET /v1/models`
- `POST /v1/responses`
- `POST /v1/chat/completions`

每个请求可通过 `x-fake-initial-delay-ms`、`x-fake-chunk-interval-ms`、`x-fake-chunks`、`x-fake-error-rate`、`x-fake-jitter-ms`、`x-fake-output-bytes` 控制行为。错误和 jitter 由固定种子与请求序号计算，便于重复运行。

## 平台、认证和 Relay preview

默认只探测平台公开端点，不会在已有数据库里创建账号。若是在一次性 Compose 环境中运行完整控制面/Relay 测试：

```powershell
$env:PERFORMANCE_PLATFORM_URL = 'http://127.0.0.1:8088'
$env:PERFORMANCE_ALLOW_PLATFORM_REGISTRATION = '1'
$env:PERFORMANCE_RELAY_PREVIEW = '1'
$env:PERFORMANCE_GATEWAY_HOST = '0.0.0.0'
$env:PERFORMANCE_GATEWAY_PORT = '4310'
npm run performance:normal
```

也可提供已有专用测试账号：

```powershell
$env:PERFORMANCE_PLATFORM_USERNAME = 'perf_user'
$env:PERFORMANCE_PLATFORM_PASSWORD = '专用测试密码'
```

报告不会写入密码、Bearer token 或 Gateway Key；运行结束前还会用实际生成的凭据检查报告内容。

需要判断流式延迟来自 Spring Relay 还是 Nginx 时，可以额外加载
`performance-tests/compose.backend-port.yml`，并设置
`PERFORMANCE_RELAY_ORIGIN_OVERRIDE=http://127.0.0.1:18089`。测试会保留同一个
Host 路径，但临时绕过 Nginx。普通平台部署不会暴露这个诊断端口。

## 基线和门槛

初始门槛位于 [`config/thresholds.json`](config/thresholds.json)：

- 正常错误率 `< 1%`；
- 控制面 p95 `< 300 ms`、p99 `< 800 ms`；
- Gateway/Relay 附加 p95 `< 250 ms`；
- 正常流量下 Gateway/Relay 附加首 Token p95 `< 100 ms`；
- 连续 Token 间隔 p50 `> 1 ms`，用于阻止 SSE 在响应末尾成批返回；
- SSE 丢失/乱序 `0`；
- 取消释放 `< 2 s`；
- 同类机器 p95 退化 `< 20%`；低于 5 ms 的绝对变化按计时噪声处理，避免 1 ms 级接口误报；
- Soak 热身后 RSS 漂移 `< 10%`；
- 正常/Soak 整机 CPU `< 70%`；压测器与 Gateway 同进程的单核 CPU 另行记录，只作诊断。

基线包含 `platform/arch/Node 主版本/逻辑 CPU 数` 指纹。机器类别不同会显示 `not-evaluated`，不会拿 Windows 笔记本基线错误阻断 Linux CI。

数据库连接池和生产 Relay 重连/Socket 指标只有部署暴露受保护的指标端点后才能采集；未配置时报告会明确显示 `not-evaluated`，不会编造数值。

## 真实 Provider 发布 Smoke

它被环境开关保护，且只发一个小请求：

```powershell
$env:PERFORMANCE_REAL_PROVIDER = '1'
$env:PERFORMANCE_REAL_PROVIDER_BASE_URL = 'https://provider.example/v1'
$env:PERFORMANCE_REAL_PROVIDER_API_KEY = '...'
$env:PERFORMANCE_REAL_PROVIDER_MODEL = '明确指定的模型 ID'
npm run performance:real-provider
```

模型必须显式指定，避免发布流程因默认模型变化而静默改变成本或结果。

## 范围说明

当前仓库尚未实现生产 Relay 的 WebSocket 多路复用数据面，因此本套件只对已有的 localhost Relay preview 做真实负载，对生产 Relay 的背压、重连和多路复用只保留待接指标，不会把预览代理结果冒充生产 Relay 容量。

前端浏览器探针需要 `platform/frontend` 依赖以及 Chrome/Edge；缺少浏览器时 HTTP 静态资源测试照常运行，并把交互探针标记为跳过。Electron 长测通过 `PERFORMANCE_DESKTOP_DURATION_SECONDS` 调整，Weekly CI 可设置为数小时。
