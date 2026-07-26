# Codex Control Center

[简体中文](README.md) | [English](README_EN.md)

一个面向 Windows 的本地 Codex SDK 桌面控制台。它把任务输入、模型与推理强度选择、项目管理、文件修改权限、实时状态、运行日志和最终结果放在同一个界面中；同一套后端也提供 HTTP API，方便本机脚本、IDE 插件和内部系统调用。

> [!IMPORTANT]
> Codex Control Center 是社区维护的第三方项目，不是 OpenAI 官方产品，也未获得 OpenAI 的开发、认可、背书或支持。Codex、OpenAI 及相关商标属于其各自权利人。使用本项目仍需遵守适用于你的 OpenAI/Codex 账户、API 和服务条款。

## 快速开始：作为 OpenAI 兼容 Host 使用

第三方程序通常只需修改两个连接参数：

```text
base_url = http://127.0.0.1:4310/v1
api_key  = ccc_live_由本程序生成的GatewayKey
```

- `ccc_live_...` 是本程序生成的 Gateway Key，**不是 OpenAI API Key**。
- 默认地址仅供同一台电脑调用。跨设备调用时，请先通过受控的 HTTPS 反向代理或隧道发布服务，再把 `base_url` 改成该公网地址的 `/v1`。
- 支持 `GET /v1/models`、`POST /v1/responses` 和 `POST /v1/chat/completions`，包括普通响应与 SSE 流式响应。
- 不要把真实 Key 写入源码、README、截图或聊天记录。建议为每个调用方生成独立 Key。

完整 Python 示例、兼容行为和原生异步任务 API 说明见下方的 [OpenAI 兼容 Host](#openai-兼容-host)。

当前实现以“单机可信用户”为默认边界：Electron 只在 `127.0.0.1` 启动随机端口，并用主进程生成的临时 HttpOnly 会话 Cookie 保护桌面管理 API；其他程序必须使用 Gateway API Key。远程监听必须显式启用令牌认证。仓库已经预留无界面服务、Docker、允许项目根目录、CORS 和反向代理配置，但在面向不可信用户公开前，仍应增加正式身份系统、租户隔离、审计、限流及每用户独立沙箱。

## 功能概览

- Windows Electron 桌面端和无界面 HTTP 服务共用同一个 server app。
- 创建 Codex 任务，选择项目、模型、Effort、Speed、沙箱模式和审批策略。
- 同时支持图片与通用附件输入：图片使用 Codex SDK 原生 `local_image`，PDF、Office、OpenDocument、文本、代码、数据和压缩包通过受控临时上传 ID 绑定任务；桌面端可分别选择“图片”和“附件”，也可混合拖放。
- 在桌面界面生成与 Model、Effort、Speed、文件权限绑定的 Codex Gateway API Key，供其他程序调用；验证哈希与加密密文分开保存，可通过眼睛按钮再次查看、复制或永久删除。
- 提供 OpenAI 兼容 Host：第三方 OpenAI 客户端只需改 `base_url` 和 API Key，即可调用 `/v1/models`、`/v1/responses` 和 `/v1/chat/completions`，支持普通响应、SSE 流、OpenAI 错误结构和 `X-Request-Id`。
- 主页可随时关闭或开启外部 API Host；关闭会取消外部任务并断开 Gateway 客户端，但保留桌面功能和现有 Key，开关状态跨重启保存。
- API Key 管理是桌面主页的首要功能；主页同时提供任务与 Token 用量 Dashboard。
- 任务状态、结构化事件、日志与最终结果实时更新。
- 可选择项目目录运行，也可使用“无项目”模式；后者为每个任务创建隔离临时目录并在结束后清理。
- 项目目录选择器与服务端真实路径校验共同限制可访问范围。
- Electron 桌面管理接口使用不可读的会话 Cookie；独立服务的本机开发可关闭认证，令牌模式为远程部署预留最小认证边界。
- Electron 使用 `contextIsolation` 和 renderer sandbox，禁用 Node integration；preload 只暴露项目选择、平台信息和受限外链三个窄接口。

## 环境要求

- Windows 10/11（桌面应用）
- Node.js 20.16 或更高版本
- npm
- 可用的 Codex 登录或 OpenAI API key

## 下载、安装与首次运行

只从本仓库的 [GitHub Releases](https://github.com/daizhongtian/codex_sdk/releases) 下载发布文件。正式发布同时提供两种 Windows 构建：

- `Codex-Control-Center-Setup-<version>-x64.exe`：推荐大多数用户使用的安装包；安装页面可选择简体中文或英文、选择安装目录，并创建开始菜单和桌面快捷方式；
- `Codex-Control-Center-Portable-<version>-x64.exe`：单文件免安装版，适合临时使用或放在自选目录中直接运行。

本项目当前不提供 Windows 代码签名。首次运行时 Windows Defender SmartScreen 可能显示“未知发布者”。请确认文件来自本仓库的 GitHub Release，并核对 Release 附带的 SHA-256；无法确认来源时不要继续运行。PowerShell 校验示例：

```powershell
Get-FileHash -Algorithm SHA256 ".\Codex-Control-Center-Setup-<version>-x64.exe"
```

将输出的 `Hash` 与同一 Release 中的校验文件逐字符比较。不要从第三方网盘、聊天附件或镜像站下载可执行文件。

首次启动会显示“运行环境检测”，用于区分内置 Codex 运行组件、可选的外部 Codex CLI、可选的 Codex 桌面 App和 Codex 登录状态。该检测只执行本地只读命令，不创建 SDK 任务，也不消耗模型用量。没有安装官方 Codex 桌面 App 或外部 CLI 并不必然阻止运行，关键是内置运行组件完整且存在可用认证；真正的服务连通性仍以实际任务结果为准。

“发布与维护”面板可以手动检查 GitHub Release 并提示下载；应用不会静默安装新版本。更新前请退出正在运行的任务。安装新版会覆盖程序文件，但不会主动删除位于用户数据目录中的 Gateway Key、用量统计和设置。面板也支持导出/恢复经过格式校验的本地备份；恢复前会先保存当前关键数据用于失败回滚。卸载程序默认同样保留用户数据，以便重新安装后继续使用；如需彻底删除，请按[隐私说明](PRIVACY.md#deleting-local-data)中的步骤操作。Windows 安全存储加密的 Gateway Key 通常绑定当前 Windows 用户与设备，复制数据目录或备份到另一台电脑并不保证能够解密。

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

桌面端默认固定使用 `127.0.0.1:4310`，等待服务监听成功后再打开窗口。可在应用的“设置 → 固定 API 端口”中选择其他端口，保存后完整重启程序生效。设置界面会先检查目标端口是否空闲。

高级用户仍可通过环境变量临时覆盖桌面设置；`0` 仅建议用于自动化测试：

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

机器可读的完整契约见 [`docs/openapi.yaml`](docs/openapi.yaml)。OpenAPI 文档是 `/api/v1` 与 OpenAI 兼容 `/v1` HTTP 接口的稳定参考；WebSocket `/ws` 的订阅消息和断线恢复约定仍以本节说明为准。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 进程与服务健康检查。 |
| `GET` | `/v1/models` | OpenAI 兼容模型列表；模型绑定 Key 只返回该 Key 的模型。 |
| `POST` | `/v1/responses` | OpenAI Responses 兼容接口；支持普通响应和 `stream=true` SSE。 |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions 兼容接口；支持普通响应和 `stream=true` SSE。 |
| `GET` | `/api/v1/models` | 读取模型、Effort 和 Speed 可选项。 |
| `GET` | `/api/v1/usage` | 管理员读取跨重启累计的任务与 Token 用量。 |
| `POST` | `/api/v1/usage/reset` | 管理员重置累计用量并开始新的统计周期。 |
| `GET` | `/api/v1/api-keys` | 管理员列出 Gateway API Key 元数据；不返回明文或哈希。 |
| `POST` | `/api/v1/api-keys` | 管理员生成模型绑定的 Gateway API Key；完整 Key 只在本次响应返回。 |
| `GET` | `/api/v1/api-keys/:id/secret` | 管理员解密并查看一枚支持安全查看的完整 Key。 |
| `DELETE` | `/api/v1/api-keys/:id` | 管理员永久删除 Gateway API Key、加密密文和该 Key 的独立用量条目。 |
| `POST` | `/api/v1/api-keys/:id/revoke` | 旧客户端兼容接口；当前行为同样是永久删除。 |
| `GET` | `/api/v1/gateway` | 管理员读取外部 API Host 的开关与连接状态。 |
| `POST` | `/api/v1/gateway` | 管理员开启或关闭外部 API Host。 |
| `GET` | `/api/v1/projects` | 列出已登记项目。 |
| `POST` | `/api/v1/projects` | 登记项目名称与本机路径。 |
| `POST` | `/api/v1/projects/select` | 选择当前主体默认使用的已登记项目。 |
| `POST` | `/api/v1/uploads/files` | 管理端上传一个任务附件或图片，返回一次性文件 ID。 |
| `DELETE` | `/api/v1/uploads/files/:id` | 删除尚未绑定任务的管理端文件上传。 |
| `POST` | `/api/v1/uploads/images` | 兼容接口：只接受 PNG、JPEG、WebP，返回一次性图片 ID。 |
| `DELETE` | `/api/v1/uploads/images/:id` | 兼容接口：删除尚未绑定任务的图片上传。 |
| `GET` | `/api/v1/tasks` | 列出任务及其当前状态。 |
| `POST` | `/api/v1/tasks` | 创建并开始一个 Codex 任务。 |
| `GET` | `/api/v1/tasks/:id` | 查询任务、最终结果与错误信息。 |
| `POST` | `/api/v1/tasks/:id/cancel` | 请求取消排队中或运行中的任务。 |
| `GET` | `/api/v1/tasks/:id/events` | 以 Server-Sent Events 持续接收该任务事件。 |
| `GET` | `/api/v1/external/profile` | 使用 Gateway API Key 读取绑定配置和可用项目。 |
| `GET` | `/api/v1/external/projects` | Gateway 调用方列出该 Key 可用的已登记项目。 |
| `POST` | `/api/v1/external/uploads/files` | Gateway 调用方上传附件或图片并取得自己专用的一次性文件 ID。 |
| `DELETE` | `/api/v1/external/uploads/files/:id` | Gateway 调用方删除自己尚未使用的文件上传。 |
| `POST` | `/api/v1/external/uploads/images` | 兼容接口：Gateway 调用方上传一张图片。 |
| `DELETE` | `/api/v1/external/uploads/images/:id` | 兼容接口：删除尚未使用的图片上传。 |
| `POST` | `/api/v1/external/tasks` | 外部程序使用 Gateway API Key 创建任务；强制应用 Key 的绑定配置。 |
| `GET` | `/api/v1/external/tasks` | 外部程序列出这枚 Gateway Key 创建的当前进程任务。 |
| `GET` | `/api/v1/external/tasks/:id` | 外部程序查询自己的任务。 |
| `GET` | `/api/v1/external/tasks/:id/events` | 外部程序读取自己的 SSE 任务事件。 |
| `POST` | `/api/v1/external/tasks/:id/cancel` | 外部程序取消自己的任务。 |
| `WS` | `/ws` | 可选的多任务实时通道；仅在服务端启用时可用。 |

令牌模式下，在每个 `/api/*` 请求中携带 Bearer token：

```powershell
curl.exe -H "Authorization: Bearer $env:API_TOKEN" http://127.0.0.1:4310/api/v1/models
```

### 模型绑定的 Gateway API Key

桌面主页顶部或左下角“API Key 与用量”可以管理密钥；也可在模型菜单中点击“为当前配置生成 API Key”。选择 Model、Effort、Speed 和文件权限后生成的 `ccc_live_...` 是本程序的访问密钥，**不是** OpenAI API Key：

- Windows 桌面版使用系统安全存储加密完整密钥，可点击密钥行中的眼睛按钮再次查看并复制；
- 磁盘分别保存用于请求验证的 SHA-256 哈希和系统加密后的密文，不保存明文；
- 旧版本只保存哈希的密钥无法恢复完整内容，需要删除后重新生成；
- 外部任务必须走 `/api/v1/external/*` 或 OpenAI 兼容 `/v1/*`，并携带 `Authorization: Bearer ...`；
- Model、Effort、Speed 和文件权限由服务端强制应用；原生 `/api/v1/external/tasks` 请求尝试改成其他配置会返回 `409 API_KEY_PRESET_CONFLICT`，OpenAI 兼容 `/v1` 则把客户端模型名映射到 Key 的绑定模型；
- 每枚 Key 只能读取和取消自己创建的任务，但可以使用创建者已在桌面端登记的项目；
- 删除后密钥记录和可恢复密文会从存储中永久移除，下一次请求立即返回 `401`；该 Key 的活动任务会被取消，现有 SSE 与 WebSocket 会被关闭，共享同一 `API_KEY_STORE_PATH` 的其他服务实例会在约 1 秒内同步失效。
- 主页关闭 Host 后，所有 `/api/v1/external/*` 与 `/v1/*` 请求返回 `503 GATEWAY_DISABLED`，活动外部任务与连接会被终止；Key 本身不会撤销，重新开启后可继续使用。

### OpenAI 兼容 Host

第三方程序可以把本项目当作一个 OpenAI 兼容服务。以 Python OpenAI SDK 为例，只需替换连接配置：

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:4310/v1",
    api_key="ccc_live_...",
)

model = client.models.list().data[0].id

response = client.responses.create(
    model=model,
    input="只回复：连接成功",
)
print(response.output_text)

chat = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "只回复：连接成功"}],
)
print(chat.choices[0].message.content)
```

流式调用沿用 OpenAI SDK 的原有写法：

```python
stream = client.responses.create(
    model=model,
    input="解释这个项目的作用",
    stream=True,
)
for event in stream:
    if event.type == "response.output_text.delta":
        print(event.delta, end="", flush=True)

chat_stream = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "解释这个项目的作用"}],
    stream=True,
    stream_options={"include_usage": True},
)
for chunk in chat_stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True) if chunk.choices else None
```

兼容层遵循以下约定：

- 每次调用都会创建同一种原生异步任务，因此 Gateway 开关、Key 撤销、模型绑定、队列/并发限制、用量统计和任务监控继续生效；OpenAI 普通调用等待任务结束后返回，流式调用把任务输出转换为 OpenAI SSE。
- 兼容调用自动使用隔离的无项目临时工作区。Key 绑定的 Model、Effort、Speed 和文件权限由服务端强制应用；请求中的 `model` 字段仍须存在，以兼容 OpenAI 客户端，但无需修改第三方程序原有的模型配置，响应会返回实际执行的绑定模型。
- 当前兼容范围是文本生成：Responses 支持字符串输入和文本消息输入，Chat Completions 支持 `developer`、`system`、`user`、`assistant` 文本消息；图片、音频、客户端函数工具、`previous_response_id` 和托管 conversation 暂不支持，并返回 OpenAI 风格的 `invalid_request_error`。
- 所有 `/v1` 成功和错误响应都带服务器生成的 `X-Request-Id: req_...`；非流式错误结构为 `{ "error": { "message", "type", "param", "code" } }`。Chat 流以 `data: [DONE]` 结束，Responses 流以 `response.completed` 或 `response.failed` 结束。
- 原有 `/api/v1/tasks` 与 `/api/v1/external/tasks` 异步任务 API 未改变，仍适合需要项目目录、附件、任务轮询、取消和完整原生事件的集成。

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

带附件或图片的任务采用两步调用。先把文件二进制上传到 `/external/uploads/files`，再把响应中的 `file.id` 放进创建任务请求的 `fileIds`。文件 ID 只能由上传它的那枚 Gateway Key 使用一次，不能用于读取服务器上的任意路径：

```powershell
$headers = @{ Authorization = "Bearer $env:CODEX_GATEWAY_KEY" }
$fileHeaders = $headers.Clone()
$fileHeaders["X-File-Name"] = [Uri]::EscapeDataString("requirements.pdf")

$upload = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4310/api/v1/external/uploads/files" `
  -Headers $fileHeaders `
  -ContentType "application/pdf" `
  -InFile "C:\documents\requirements.pdf"

$body = @{
  prompt = "阅读附件，按需求实现并验证项目"
  projectless = $true
  fileIds = @($upload.file.id)
} | ConvertTo-Json

$task = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4310/api/v1/external/tasks" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

`/uploads/files` 同时接受图片；识别到 PNG、JPEG 或 WebP 后，会自动作为 SDK 原生图片输入交给 Codex。旧调用方仍可使用 `/uploads/images` 与 `imageIds`，但新程序建议统一使用 `/uploads/files` 与 `fileIds`。

服务会为带文本层的 PDF、DOCX、XLSX、PPTX、ODT、ODS、ODP、RTF、文本、代码和常见数据文件生成只供本次任务使用的安全文本副本，同时保留原文件供 Codex 检查结构与格式。压缩包和其他非可执行二进制可作为原文件附件；EXE、DLL、安装程序、快捷方式和磁盘镜像会被拒绝。扫描版 PDF 如果没有文本层，仍会保留原 PDF，但文字识别取决于运行环境可用的 PDF/OCR 工具。

默认每个任务最多 12 个文件，其中最多 4 张图片；单文件最多 25 MiB，合计最多 100 MiB。未使用上传默认 30 分钟过期；任务完成、失败、取消或服务关闭时，已绑定的临时文件都会清理。调用 `/api/v1/external/profile` 或 `/api/v1/models` 可读取当前 `fileLimits` 和兼容的 `imageLimits`。

桌面端默认固定使用端口 `4310`，界面会显示当前完整地址。端口可在设置中修改，重启后保持不变；也可以通过 `CODEX_DESKTOP_PORT` 覆盖，或单独运行无界面服务。

`/api/v1/external/*` 始终强制 Bearer Key。独立服务使用 `AUTH_MODE=none` 时，普通 `/api/v1/*` 仍是仅供回环开发的管理员接口；需要真实访问边界时应使用桌面应用的私有会话，或把独立服务设置为 `AUTH_MODE=token`。

### 用量 Dashboard

桌面主页会汇总 Codex SDK 为任务返回的用量字段：

- 总 Token = 输入 Token + 输出 Token；
- 缓存 Token 是输入 Token 的子集；
- 推理 Token 是输出 Token 的子集；
- 同时显示任务数、成功率、运行中任务和按模型统计的 Token 排名；
- API Key 列表会显示每枚 Key 自上次 Reset 以来的累计调用次数和 Token 合计。
- 模型用量会显示全部有任务记录的模型，不再限制为 Top 5；运行中的任务和暂时没有 Token 数据的失败/取消任务也会立即进入对应模型的任务数。

统计会持久化累计所有任务，不受 `TASK_HISTORY_LIMIT` 影响，程序重启后继续累加。点击 Dashboard 右上角 `Reset` 并再次确认后，任务、状态、模型、Key 和 Token 聚合都会归零；重置前已经启动但尚未结束的任务不会写入新的统计周期。这里展示的是 SDK 返回的 Token 用量，不是 OpenAI 账单或费用估算。

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

### API 兼容性、错误和限制

- `/api/v1` 是当前稳定主版本。兼容更新可以增加可选字段、枚举值、事件类型和新端点；客户端必须忽略未知 JSON 字段与未知 SSE/WS 事件类型。删除字段、改变既有字段含义或修改认证语义需要新的 API 主版本。
- 人类可读的 `message` 和日志文本不是稳定协议。自动化应判断 HTTP 状态、`error.code`、任务 `status`、结构化事件及最终 `result`。
- 所有 JSON 错误使用 `{ "error": { "code": "...", "message": "...", "details": ... } }`。常见状态包括：`400` 参数无效、`401` 缺少/无效令牌、`403` scope 或安全策略拒绝、`404` 资源不可见、`409` 状态或 Key 预设冲突、`413` 请求/文件过大、`415` 文件类型或内容不支持、`422` 文档无法处理、`429` 队列/连接/上传上限、`503` Host 关闭或服务暂不可用。
- `POST /tasks` 返回 `202 Accepted`，表示任务已进入队列，不代表任务完成。轮询任务或订阅 SSE，直到 `status` 为 `completed`、`failed` 或 `cancelled`。
- 任务列表只反映当前进程内存，默认最多返回 50 条、可通过 `limit` 调整到 1–200；历史任务默认仅保留最近 200 个已结束任务。累计用量不受此历史上限影响。
- 默认限制为：JSON 请求体 1 MiB、提示词 200,000 字符、并发任务 2、未完成任务 50、SSE/WS 连接 100、单 WebSocket 最多订阅 32 个任务。附件限制见上文或运行时返回的 `fileLimits`。部署者可以用环境变量收紧或放宽部分限制，因此客户端应优先读取运行时值并正确处理 `413`/`429`。
- SSE 使用递增事件 ID。重连时发送 `Last-Event-ID`，或使用 `?after=<id>`；事件历史受条数和字节预算限制，因此断线后仍应查询任务快照。
- 创建任务没有幂等键；网络重试 `POST /tasks` 可能创建多个任务。客户端应记录成功响应中的任务 ID，并在不确定时先检查自己的任务列表。

远程 `AUTH_MODE=token` 当前面向程序化 API 客户端。仓库中的网页 UI 不会把 Bearer token 写入 URL 或 `localStorage`，因此尚不作为远程登录页面使用；在线多用户 UI 应接入 OIDC/OAuth2，并由服务端签发 `HttpOnly`、`SameSite` 会话 Cookie，同时启用 CSRF 防护。

## 配置

`.env.example` 是变量清单，不会被应用自动载入。PowerShell 中可通过 `$env:NAME = "value"` 注入；Docker 可使用 `--env-file`。不要提交包含密钥的 `.env`。

| 变量 | 默认/示例 | 说明 |
| --- | --- | --- |
| `CODEX_DESKTOP_PORT` | 未设置（桌面设置默认 `4310`） | 覆盖 Electron 内置服务端口；显式使用 `0` 可自动选择，仅建议用于测试。 |
| `HOST` | `127.0.0.1` | 独立服务监听地址。 |
| `PORT` | `4310` | 独立服务监听端口。 |
| `AUTH_MODE` | `none` | `none` 仅用于独立服务的回环开发；Electron 仍使用私有桌面会话，远程使用 `token`。 |
| `API_TOKEN` | 空 | `token` 模式的 Bearer token；非回环监听时至少 32 个字符。 |
| `API_KEY_STORE_PATH` | 桌面自动设置；独立服务使用用户目录 | Gateway API Key 哈希存储文件；容器中默认 `/data/api-keys.json`。 |
| `API_KEY_ENCRYPTION_KEY` | 空 | 独立服务加密和查看完整 Gateway Key 的主密钥，至少 32 个字符；Windows 桌面版改用系统安全存储。 |
| `USAGE_STORE_PATH` | 桌面自动设置；独立服务使用用户目录 | 全量用量聚合文件；容器中默认 `/data/usage-stats.json`。 |
| `ALLOWED_PROJECT_ROOTS` | 空 | 允许的项目根目录，多个目录用逗号或分号分隔。 |
| `CORS_ORIGINS` | 空 | 允许的浏览器来源，多个来源用逗号分隔；不要用 `*` 暴露执行 API。 |
| `SCRATCH_ROOT` | 系统临时目录 | 无项目任务的一次性工作区根目录。 |
| `ATTACHMENT_UPLOAD_ROOT` | 系统临时目录 | 任务图片与附件的进程级临时存储根目录。 |
| `MAX_TASK_FILES` | `12` | 单任务允许绑定的最大文件总数（1–32）。 |
| `MAX_TASK_IMAGES` | `4` | 单任务允许绑定的最大图片数量（1–16）。 |
| `MAX_FILE_BYTES` | `26214400` | 单个图片或附件的最大字节数。 |
| `MAX_TASK_ATTACHMENT_BYTES` | `104857600` | 单任务全部附件的最大合计字节数。 |
| `ATTACHMENT_UPLOAD_TTL_MS` | `1800000` | 尚未绑定任务的上传保留时间。 |
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

项目、任务、事件和最终结果当前只保存在进程内存中，服务重启后会清空；Gateway API Key 和用量聚合分别持久化到 `API_KEY_STORE_PATH` 与 `USAGE_STORE_PATH`，桌面端自动使用 Electron `userData`。文件存储包含常规跨进程写锁和异常锁恢复，适合桌面单实例或单个服务进程。若多个服务实例共享文件，应只指定一个实例负责管理写操作；严格的多写者或跨主机高可用部署必须把 Key、用量、撤销事件、审计和任务数据迁移到事务数据库、消息系统或密钥管理服务。桌面 UI 的少量偏好使用浏览器存储，但随机端口可能形成新的 origin。生产环境还应为每个租户设置存储配额与保留策略。

### 数据与隐私摘要

桌面模式下，持久数据通常位于 `%APPDATA%\codex-control-center\`，临时附件和“无项目”工作区位于系统临时目录。提示词、所选项目内容、附件以及任务结果会由本程序交给 Codex SDK，并可能发送到 OpenAI/Codex 服务；远程部署时还会经过你选择的服务器、代理和日志设施。`ccc_live_...` Gateway Key 只验证本程序的外部 API，不是 OpenAI API Key，也不能直接调用 OpenAI API。

当前项目代码不集成产品分析、广告追踪或第三方崩溃遥测。更新检查会访问 GitHub Release；真实 SDK 连接测试和任务执行会访问 Codex/OpenAI。服务器运营者能够接触经过其主机的提示词、附件、项目路径、事件和结果，因此不要把不可信的公共实例视为端到端加密服务。完整的数据类别、保存期限、删除方法和远程部署责任见 [`PRIVACY.md`](PRIVACY.md)；安全报告流程见 [`SECURITY.md`](SECURITY.md)。

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

## 构建 Windows 发布版

```powershell
npm run check
npm test
npm run dist:portable
npm run dist:setup
```

两个 EXE 都输出到 `release/`。`dist:portable` 生成免安装单文件，`dist:setup` 生成 NSIS 安装包；完整发布命令可按仓库脚本执行。构建已关闭 `NODE_OPTIONS`、CLI inspector 和 file 协议额外权限，并启用 ASAR 完整性校验；`runAsNode` fuse 因隔离 Codex worker 仍需保留。当前产物未签名，公开分发时必须在 Release Notes 中保留 SmartScreen 提示和 SHA-256 校验值。

创建 Git Tag 后，GitHub 发布流程会运行检查与测试、构建两个 Windows 产物、生成 SHA-256 并附加到对应 GitHub Release。不要手工覆盖同一 Tag 下已发布的二进制；需要修复时发布新的语义化版本。

## 开源协作与发布资料

- 许可证：[`LICENSE`](LICENSE)
- 版本记录：[`CHANGELOG.md`](CHANGELOG.md)
- 贡献指南：[`CONTRIBUTING.md`](CONTRIBUTING.md)
- 行为准则：[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- 安全政策：[`SECURITY.md`](SECURITY.md)
- 隐私说明：[`PRIVACY.md`](PRIVACY.md)
- OpenAPI 3.1：[`docs/openapi.yaml`](docs/openapi.yaml)

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
- **端口占用**：关闭占用程序，或临时设置 `CODEX_DESKTOP_PORT` 为其他空闲端口启动桌面端，再在设置中保存新端口；独立服务更换 `PORT`。
- **项目被拒绝**：确认项目真实路径位于 `ALLOWED_PROJECT_ROOTS` 中，并检查挂载目录权限。
- **容器内无权写文件**：确认宿主目录已授予容器的 `node` 用户写权限，且任务使用 `workspace-write`。
- **远程请求返回未认证**：确认 `AUTH_MODE=token`，请求头为 `Authorization: Bearer <token>`，且反向代理没有移除该请求头。
