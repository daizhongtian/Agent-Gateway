# Codex Control Center

一个面向 Windows 的本地 Codex SDK 桌面控制台。它把任务输入、模型与推理强度选择、项目管理、文件修改权限、实时状态、运行日志和最终结果放在同一个界面中；同一套后端也提供 HTTP API，方便本机脚本、IDE 插件和内部系统调用。

当前实现以“单机可信用户”为默认边界：Electron 只在 `127.0.0.1` 启动随机端口，并用主进程生成的临时 HttpOnly 会话 Cookie 保护桌面管理 API；其他程序必须使用 Gateway API Key。远程监听必须显式启用令牌认证。仓库已经预留无界面服务、Docker、允许项目根目录、CORS 和反向代理配置，但在面向不可信用户公开前，仍应增加正式身份系统、租户隔离、审计、限流及每用户独立沙箱。

## 功能概览

- Windows Electron 桌面端和无界面 HTTP 服务共用同一个 server app。
- 创建 Codex 任务，选择项目、模型、Effort、Speed、沙箱模式和审批策略。
- 在桌面界面生成与 Model、Effort、Speed、文件权限绑定的 Codex Gateway API Key，供其他程序调用；支持一次性明文展示、哈希持久化和撤销。
- 任务状态、结构化事件、日志与最终结果实时更新。
- 可选择项目目录运行，也可使用“无项目”模式；后者为每个任务创建隔离临时目录并在结束后清理。
- 项目目录选择器与服务端真实路径校验共同限制可访问范围。
- Electron 桌面管理接口使用不可读的会话 Cookie；独立服务的本机开发可关闭认证，令牌模式为远程部署预留最小认证边界。
- Electron 使用 `contextIsolation` 和 renderer sandbox，禁用 Node integration；preload 只暴露项目选择、平台信息和受限外链三个窄接口。

## 环境要求

- Windows 10/11（桌面应用）
- Node.js 20 或更高版本
- npm
- 可用的 Codex 登录或 OpenAI API key

安装项目依赖：

```powershell
npm install
```

## Codex 登录

本机桌面使用 Codex CLI 已缓存的登录。先安装 CLI，然后使用 ChatGPT 登录：

```powershell
npm install --global @openai/codex
codex.cmd login
codex.cmd login status
```

`codex.cmd login` 会打开浏览器完成登录。也可使用按量计费的 API key：

```powershell
$env:OPENAI_API_KEY = "你的密钥"
$env:OPENAI_API_KEY | codex.cmd login --with-api-key
```

不要把密钥写入源码、提交到 Git，或从前端发送给浏览器。服务端自动化优先通过进程环境、容器 secret 或受控密钥管理服务注入。退出登录可运行 `codex.cmd logout`。更多信息见 [Codex 认证文档](https://developers.openai.com/codex/auth) 和 [Codex SDK 文档](https://developers.openai.com/codex/sdk)。

## 启动桌面应用

开发模式：

```powershell
npm run dev
```

普通启动：

```powershell
npm start
```

桌面端会自动调用 `startServer({ host: "127.0.0.1", port: 0, mode: "desktop" })`，等待服务监听成功后再打开窗口。`0` 让操作系统选择空闲端口；如需固定本机端口，可设置：

```powershell
$env:CODEX_DESKTOP_PORT = "4310"
npm start
```

应用启用单实例锁。第二次启动会聚焦现有窗口；关闭最后一个 Windows 窗口时，本地 HTTP 服务会一并停止。服务启动、页面载入或渲染进程失败时会显示错误并保留终端日志。

## 启动独立 HTTP 服务

仅启动服务，不打开 Electron：

```powershell
$env:HOST = "127.0.0.1"
$env:PORT = "4310"
npm run server
```

健康检查：

```powershell
curl.exe http://127.0.0.1:4310/health
```

### HTTP API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 进程与服务健康检查。 |
| `GET` | `/api/v1/models` | 读取模型、Effort 和 Speed 可选项。 |
| `GET` | `/api/v1/api-keys` | 管理员列出 Gateway API Key 元数据；不返回明文或哈希。 |
| `POST` | `/api/v1/api-keys` | 管理员生成模型绑定的 Gateway API Key；完整 Key 只在本次响应返回。 |
| `POST` | `/api/v1/api-keys/:id/revoke` | 管理员撤销 Gateway API Key。 |
| `GET` | `/api/v1/projects` | 列出已登记项目。 |
| `POST` | `/api/v1/projects` | 登记项目名称与本机路径。 |
| `GET` | `/api/v1/tasks` | 列出任务及其当前状态。 |
| `POST` | `/api/v1/tasks` | 创建并开始一个 Codex 任务。 |
| `GET` | `/api/v1/tasks/:id` | 查询任务、最终结果与错误信息。 |
| `POST` | `/api/v1/tasks/:id/cancel` | 请求取消排队中或运行中的任务。 |
| `GET` | `/api/v1/tasks/:id/events` | 以 Server-Sent Events 持续接收该任务事件。 |
| `GET` | `/api/v1/external/profile` | 使用 Gateway API Key 读取绑定配置和可用项目。 |
| `POST` | `/api/v1/external/tasks` | 外部程序使用 Gateway API Key 创建任务；强制应用 Key 的绑定配置。 |
| `GET` | `/api/v1/external/tasks/:id` | 外部程序查询自己的任务。 |
| `GET` | `/api/v1/external/tasks/:id/events` | 外部程序读取自己的 SSE 任务事件。 |
| `POST` | `/api/v1/external/tasks/:id/cancel` | 外部程序取消自己的任务。 |
| `WS` | `/ws` | 可选的多任务实时通道；仅在服务端启用时可用。 |

令牌模式下，在每个 `/api/*` 请求中携带 Bearer token：

```powershell
curl.exe -H "Authorization: Bearer $env:API_TOKEN" http://127.0.0.1:4310/api/v1/models
```

### 模型绑定的 Gateway API Key

桌面应用左下角打开“API 与部署”，或在模型菜单中点击“为当前配置生成 API Key”。选择 Model、Effort、Speed 和文件权限后生成的 `ccc_live_...` 是本程序的访问密钥，**不是** OpenAI API Key：

- 完整密钥只显示一次，关闭窗口后无法再次读取；
- 磁盘只保存 SHA-256 哈希、掩码和绑定配置；
- 外部任务必须走 `/api/v1/external/*` 并携带 `Authorization: Bearer ...`；
- Model、Effort、Speed 和文件权限由服务端强制应用；请求尝试改成其他配置会返回 `409 API_KEY_PRESET_CONFLICT`；
- 每枚 Key 只能读取和取消自己创建的任务，但可以使用创建者已在桌面端登记的项目；
- 撤销后下一次请求立即返回 `401`，该 Key 的活动任务会被取消，现有 SSE 与 WebSocket 会被关闭；共享同一 `API_KEY_STORE_PATH` 的其他服务实例会在约 1 秒内同步撤销。

外部程序不需要再发送模型配置：

```powershell
$headers = @{ Authorization = "Bearer $env:CODEX_GATEWAY_KEY" }
$body = @{
  prompt = "检查并修复这个项目"
  projectless = $true
} | ConvertTo-Json

$task = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4310/api/v1/external/tasks" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body

Invoke-RestMethod `
  -Uri "http://127.0.0.1:4310/api/v1/external/tasks/$($task.id)" `
  -Headers $headers
```

桌面端默认使用随机端口，界面会显示当前完整地址。需要让其他程序长期使用固定地址时，设置 `CODEX_DESKTOP_PORT=4310`，或单独运行无界面服务。

`/api/v1/external/*` 始终强制 Bearer Key。独立服务使用 `AUTH_MODE=none` 时，普通 `/api/v1/*` 仍是仅供回环开发的管理员接口；需要真实访问边界时应使用桌面应用的私有会话，或把独立服务设置为 `AUTH_MODE=token`。

登记项目与创建任务的典型请求如下。`model` 应取自 `/api/v1/models`，项目路径还必须通过服务端 `ALLOWED_PROJECT_ROOTS` 校验：

```powershell
$headers = @{ Authorization = "Bearer $env:API_TOKEN" }

$project = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4310/api/v1/projects" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{ name = "demo"; path = "C:\work\demo" } | ConvertTo-Json)

$task = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4310/api/v1/tasks" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{
    prompt = "检查测试失败的原因并给出修复"
    projectId = $project.id
    model = "<从 /api/v1/models 取得的 id>"
    effort = "high"
    speed = "standard"
    sandboxMode = "workspace-write"
    approvalPolicy = "untrusted"
  } | ConvertTo-Json)
```

不需要项目上下文时无需登记目录，显式发送 `projectless = $true` 即可。服务端会创建一次性临时工作区，任务结束后自动清理：

```powershell
$task = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4310/api/v1/tasks" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{
    prompt = "用三句话解释 REST API"
    projectless = $true
    model = "<从 /api/v1/models 取得的 id>"
    sandboxMode = "read-only"
    approvalPolicy = "never"
  } | ConvertTo-Json)
```

SSE 会依次发送状态、日志、结构化事件和完成/失败消息：

```powershell
curl.exe -N `
  -H "Authorization: Bearer $env:API_TOKEN" `
  "http://127.0.0.1:4310/api/v1/tasks/$($task.id)/events"
```

取消任务：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4310/api/v1/tasks/$($task.id)/cancel" `
  -Headers $headers
```

客户端应处理 SSE/WS 断线重连，并在重连后调用 `GET /api/v1/tasks/:id` 补齐可能遗漏的状态。不要把面向人的日志文本当作稳定协议，自动化应读取结构化事件与最终结果字段。

远程 `AUTH_MODE=token` 当前面向程序化 API 客户端。仓库中的网页 UI 不会把 Bearer token 写入 URL 或 `localStorage`，因此尚不作为远程登录页面使用；在线多用户 UI 应接入 OIDC/OAuth2，并由服务端签发 `HttpOnly`、`SameSite` 会话 Cookie，同时启用 CSRF 防护。

## 配置

`.env.example` 是变量清单，不会被应用自动载入。PowerShell 中可通过 `$env:NAME = "value"` 注入；Docker 可使用 `--env-file`。不要提交包含密钥的 `.env`。

| 变量 | 默认/示例 | 说明 |
| --- | --- | --- |
| `CODEX_DESKTOP_PORT` | `0` | Electron 内置服务端口，`0` 为自动选择。 |
| `HOST` | `127.0.0.1` | 独立服务监听地址。 |
| `PORT` | `4310` | 独立服务监听端口。 |
| `AUTH_MODE` | `none` | `none` 仅用于独立服务的回环开发；Electron 仍使用私有桌面会话，远程使用 `token`。 |
| `API_TOKEN` | 空 | `token` 模式的 Bearer token；非回环监听时至少 32 个字符。 |
| `API_KEY_STORE_PATH` | 桌面自动设置；独立服务使用用户目录 | Gateway API Key 哈希存储文件；容器中默认 `/data/api-keys.json`。 |
| `ALLOWED_PROJECT_ROOTS` | 空 | 允许的项目根目录，多个目录用逗号或分号分隔。 |
| `CORS_ORIGINS` | 空 | 允许的浏览器来源，多个来源用逗号分隔；不要用 `*` 暴露执行 API。 |
| `SCRATCH_ROOT` | 系统临时目录 | 无项目任务的一次性工作区根目录。 |
| `TRUST_PROXY` | `false` | 位于可信反向代理后时才启用。 |
| `MAX_CONCURRENT_TASKS` | `2` | 单进程最大并发任务数。 |
| `MAX_QUEUED_TASKS` | `50` | 单进程及单主体允许的最大未完成任务数。 |
| `MAX_SSE_CONNECTIONS` | `100` | SSE 与 WebSocket 的连接上限。 |
| `TASK_TIMEOUT_MS` | `1800000` | 单任务超时时间，单位毫秒。 |
| `TASK_HISTORY_LIMIT` | `200` | 当前进程保留的已结束任务数量。 |
| `EVENT_HISTORY_LIMIT` | `500` | 每个任务在内存中保留的事件条数。 |
| `EVENT_HISTORY_BYTES` | `2097152` | 每个任务保留事件的总字节预算。 |
| `LOG_LEVEL` | `info` | 服务日志级别。 |
| `ALLOW_DANGEROUS_TASKS` | `false` | 非回环部署是否允许具备专门 scope 的完全访问任务。 |
| `ALLOW_TASK_NETWORK` | `false` | 非回环部署是否允许具备专门 scope 的任务网络访问。 |
| `OPENAI_API_KEY` | 空 | 可选的服务端 OpenAI API key。 |

生成本地令牌的一个做法：

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:API_TOKEN = [Convert]::ToHexString($bytes)
```

项目、任务、事件和最终结果当前只保存在进程内存中，服务重启后会清空；Gateway API Key 独立持久化，桌面端保存到 Electron `userData`，独立服务保存到 `API_KEY_STORE_PATH`。共享文件存储包含常规跨进程写锁、异常锁恢复和撤销轮询，适合桌面单实例或单个服务进程。若多个服务实例共享该文件，应只指定一个实例负责创建和撤销 Key；严格的多写者或跨主机高可用部署必须把 Key、撤销事件、审计和任务数据迁移到事务数据库、消息系统或密钥管理服务。桌面 UI 的少量偏好使用浏览器存储，但随机端口可能形成新的 origin。生产环境还应为每个租户设置存储配额与保留策略。

## 文件权限边界

权限选择必须在创建任务时明确传给后端，不能只依赖 UI 文案：

- `read-only`：适合分析、解释和代码审查，不允许写文件。
- `workspace-write`：允许读取项目并在工作区及明确的 writable roots 内写入。
- `danger-full-access`：取消文件系统沙箱，仅适合已隔离、完全可信的环境。

“无项目”只表示不读取已登记项目；Codex 仍会获得一个空白临时工作目录。`workspace-write` 仅可修改该临时目录，任务结束后目录会被清理。

SDK 任务是非交互执行流，不提供“暂停后点击批准”的通道。`approvalPolicy=untrusted` 会拒绝需要人工批准的操作；`never` 不请求批准，但仍受所选 sandbox 约束。服务端拒绝 `on-request` 和 `on-failure`，避免任务假装等待一个不存在的批准入口。

`ALLOWED_PROJECT_ROOTS` 是服务入口的第一层路径白名单，Codex sandbox 是任务执行时的第二层约束。两者不能互相替代。服务端必须解析真实路径、阻止 `..`/符号链接绕过，并拒绝白名单外的工作目录。远程多用户场景还应为每个用户使用独立容器或虚拟机、独立工作卷与独立凭据；仅靠 Bearer token 不能提供租户隔离。

## Docker 无界面部署

Docker 镜像只运行 `src/server/standalone.js`，不包含 Electron GUI。镜像默认：

- 监听 `0.0.0.0:4310`；
- 要求 `AUTH_MODE=token`；
- 以非 root 的 `node` 用户运行；
- 仅允许 `/workspaces` 下的项目；
- 将 Gateway API Key 哈希保存到 `/data/api-keys.json`，部署时应挂载持久卷。

构建：

```powershell
docker build -t codex-control-center .
```

本机安全试运行（只把端口发布到回环地址）：

```powershell
docker run --rm --name codex-control-center `
  -p 127.0.0.1:4310:4310 `
  -e API_TOKEN="$env:API_TOKEN" `
  -e OPENAI_API_KEY="$env:OPENAI_API_KEY" `
  -v "C:\work:/workspaces:rw" `
  -v "codex-control-data:/data" `
  codex-control-center
```

生产环境不要直接把容器端口暴露到互联网。建议在服务前放置受支持的反向代理或 API gateway，并至少落实：

1. TLS 与安全响应头；
2. OIDC/OAuth2 或企业 SSO，将外部身份映射到服务端用户；
3. 每用户/团队的项目白名单和任务配额；
4. 请求体大小限制、并发限制、超时、速率限制和审计日志；
5. 每租户独立执行容器、临时凭据、网络出口策略与工作卷；
6. secret manager 注入和定期轮换，不把凭据烘焙进镜像。

仓库中的 `token` 模式是部署脚手架，不等于完整的互联网多租户认证系统。OIDC、RBAC、审计存储和任务队列应在对外开放前实现。

## 构建 Windows 安装包

```powershell
npm run check
npm run dist
```

安装包输出到 `release/`，并使用项目自带的应用图标。构建已关闭 `NODE_OPTIONS`、CLI inspector 和 file 协议额外权限，并启用 ASAR 完整性校验；`runAsNode` fuse 因隔离 Codex worker 仍需保留。面向公众正式分发前，还应配置可验证的 Windows 发布者身份与代码签名证书。

## 服务端嵌入约定

Electron 动态导入 `src/server/app.js`，该模块需要导出：

```js
export async function startServer(options = {}) {
  // options: { host, port, mode }
  return {
    app,
    server,
    host,
    port,
    url,
    taskManager,
    projectRegistry,
    close: async () => {},
  };
}
```

`url` 必须是服务已开始监听后的完整 HTTP(S) 地址；桌面模式必须返回回环地址。`close()` 应停止接收请求、关闭 WebSocket、取消或收尾活动任务并释放监听端口。若没有 `close()`，Electron 会退回调用 Node HTTP server 的 `close(callback)`。

## 常见问题

- **启动提示 Codex 未登录**：在 Windows PowerShell 中运行 `codex.cmd login status`，必要时重新执行 `codex.cmd login`。
- **端口占用**：桌面端保留 `CODEX_DESKTOP_PORT=0`；独立服务更换 `PORT`。
- **项目被拒绝**：确认项目真实路径位于 `ALLOWED_PROJECT_ROOTS` 中，并检查挂载目录权限。
- **容器内无权写文件**：确认宿主目录已授予容器的 `node` 用户写权限，且任务使用 `workspace-write`。
- **远程请求返回未认证**：确认 `AUTH_MODE=token`，请求头为 `Authorization: Bearer <token>`，且反向代理没有移除该请求头。
