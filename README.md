# Codex Control Center

English is displayed by default. Expand **简体中文** below to read the complete Chinese documentation without leaving this page.

<details>
<summary><strong>🇨🇳 简体中文（点击展开）</strong></summary>

## 简体中文

一个面向 Windows 的本地 Codex SDK 桌面控制台。它把任务输入、模型与推理强度选择、项目管理、文件修改权限、实时状态、运行日志和最终结果放在同一个界面中；同一套后端也提供 HTTP API，方便本机脚本、IDE 插件和内部系统调用。

## 最常用：当作 OpenAI 兼容 Host 调用

第三方程序可以把本项目当成一个模拟 OpenAI 协议的兼容服务器使用，通常只需修改两个连接参数。请求始终发送到 Codex Control Center，并由本程序转换为本地 Codex SDK 任务；它不是 OpenAI API 代理，也不会把 `/v1` 请求转发到 `api.openai.com`：

```text
base_url = https://zhongtian.tail61e438.ts.net/v1
api_key  = ccc_live_由本程序生成的GatewayKey
```

- 公网调用使用上面的 Tailscale Funnel HTTPS 地址；同一台电脑上的本地调用可改用 `http://127.0.0.1:4310/v1`。
- `ccc_live_...` 由 Host 管理员在桌面应用的“API Key 与用量”中生成并分配给调用方，它是本程序的 Gateway Key，**不是 OpenAI API Key**。
- OpenAI Python SDK 在这里仅作为兼容客户端使用；真正执行任务的是 Host 电脑上的 Codex SDK 与当前 Codex 登录。
- 不要把真实 Key 写入源码、README、截图或聊天记录。每个调用方应使用独立 Key，以便分别统计和撤销。
- Host 电脑必须保持本程序与 Tailscale 运行，并在应用中开启 API Host 和公网 Host。
- 首页 `OPENAI HOST` 右侧的“检查公网”会从真实公网 HTTPS 地址验证 `/health`、OpenAI 路由、Gateway Key 鉴权和 `X-Request-Id`；检测过程不会发送或暴露任何真实 Gateway Key。

Python 程序可以继续使用官方 OpenAI SDK，只替换 `base_url` 和 `api_key`：

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://zhongtian.tail61e438.ts.net/v1",
    api_key="ccc_live_由Host管理员分配的新Key",
)

model = client.models.list().data[0].id
response = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "只回复：连接成功"}],
)
print(response.choices[0].message.content)
```

兼容端点包括 `GET /v1/models`、`POST /v1/responses` 和 `POST /v1/chat/completions`，支持普通调用与 `stream=True` 流式调用。完整示例、响应格式和原生异步任务 API 见下方的 [OpenAI 兼容 Host](#openai-兼容-host) 章节。

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

第三方程序可以把本项目当作一个模拟 OpenAI 协议的兼容服务。以 Python OpenAI SDK 作为客户端时，只需替换连接配置；请求由本程序直接转成 Codex SDK 任务，不会转发到 OpenAI API：

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

图片输入会复用本程序原有的 Codex SDK `local_image` 管线。当前兼容层接受 PNG、JPEG 或 WebP 的 Base64 Data URL：

```python
import base64
from pathlib import Path

data_url = "data:image/jpeg;base64," + base64.b64encode(
    Path("photo.jpg").read_bytes()
).decode("ascii")

vision = client.responses.create(
    model=model,
    input=[{
        "role": "user",
        "content": [
            {"type": "input_text", "text": "描述这张图片"},
            {"type": "input_image", "image_url": data_url},
        ],
    }],
)
print(vision.output_text)
```

Chat Completions 的图片部分使用 `{"type": "image_url", "image_url": {"url": data_url}}`。普通与流式调用都支持图片。

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
- 当前兼容范围是文本与图片输入：Responses 接受 `input_image`，Chat Completions 接受 `image_url`；图片在本机验证并转换为 Codex SDK `local_image`，任务结束后清理临时文件。为避免服务器端请求伪造（SSRF），目前只接受 PNG、JPEG、WebP Base64 Data URL，不抓取远程图片 URL，也不接受 OpenAI `file_id`。
- 音频、客户端函数工具、`previous_response_id` 和托管 conversation 暂不支持，并返回 OpenAI 风格的 `invalid_request_error`。
- 所有 `/v1` 成功和错误响应都带服务器生成的 `X-Request-Id: req_...`；非流式错误结构为 `{ "error": { "message", "type", "param", "code" } }`。Chat 流以 `data: [DONE]` 结束，Responses 流以 `response.completed` 或 `response.failed` 结束。
- 原有 `/api/v1/tasks` 与 `/api/v1/external/tasks` 异步任务 API 未改变，仍适合需要项目目录、附件、任务轮询、取消和完整原生事件的集成。

### V2 免费公网 Host：Tailscale Funnel

Windows 桌面版 V2 可以把仍然监听 `127.0.0.1` 的内置服务通过 Tailscale Funnel 安全地发布为公网 HTTPS 地址。Tailscale 不包含在安装包中，需要先从 [Tailscale 官方网站](https://tailscale.com/download/windows)安装并登录；Funnel 当前由 Tailscale 标记为 Beta，受其服务条款和带宽限制约束。

1. 保持固定 API 端口可用，默认是 `4310`；
2. 在“API Key 与用量”中为每个调用方生成独立的 `ccc_live_...` Key；
3. 打开“设置 → 免费公网 Host”，确认状态后连续点击两次“开启公网”；
4. 首次启用时应用会通过 Tailscale CLI 连接当前设备，并请求 Funnel/HTTPS 授权；
5. 状态变成“公网已开启”后，复制形如 `https://device.tailnet.ts.net/v1` 的 `base_url`；
6. 第三方只使用该 `base_url` 和分配给自己的 `ccc_live_...`，不要分享 OpenAI Key 或管理员令牌。

首页的 API Gateway 地址栏会额外显示 `OPENAI HOST`。Funnel 已开启时默认展示公网 `base_url`；点击地址右侧的“公网 Host / 本地 Host”按钮，可以随时切换查看公网地址和本地 `http://127.0.0.1:端口/v1` 地址。公网尚未开启时，该位置会明确显示离线状态，不会提供不可用的伪地址。

旁边的“检查公网”按钮会由 Electron 主进程重新读取当前渠道状态，通过公共 DNS 解析并直接检查真实公网边缘，而不是使用本机 Tailscale MagicDNS 返回的 Tailnet 内部地址。它执行两项无密钥探测：`GET /health` 必须返回健康状态，`GET /v1/models` 必须返回带有效 `X-Request-Id` 的 OpenAI 风格 `401 invalid_api_key`。后一项返回 `401` 表示公网路由与鉴权边界正确，并不是故障。应用启动后和运行期间也会定期执行同样检查；真实公网 TLS 连续失败三次时，会在 30 分钟冷却限制下自动重建当前 HTTPS 443 Funnel 映射并复查。检测器只接受主进程预先注册的渠道 ID，网页界面不能指定任意 URL；当前注册的是 `tailscale-funnel`，未来可在同一 provider 接口中加入 Cloudflare Tunnel 等渠道。

桌面端固定调用当前 Tailscale CLI 语法：

```powershell
tailscale up --timeout=60s
tailscale funnel --bg --yes --https=443 http://127.0.0.1:4310
tailscale funnel status --json
```

点击“关闭公网”会关闭由本应用验证过的 HTTPS `443` 映射。应用只管理 HTTPS `443` 的根路径映射；如果该映射已指向其他本机服务，界面会显示冲突并拒绝覆盖。Funnel 配置由 Tailscale 后台保存，但真正的 API 仍依赖本程序：电脑关机、Tailscale 断开或退出本程序后，公网 URL 将无法完成请求。建议同时开启“最小化到托盘”。

桌面会话 Cookie 绑定本地 origin，不会成为公网登录方式；`/v1/*` 与 `/api/v1/external/*` 仍强制使用 Gateway Key。公网使用者默认应采用 `read-only`，不要把包含私人文件的项目权限交给不可信调用方。管理员可随时在首页关闭 Host 或永久删除指定 Key，立即终止相应任务和连接。

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
| `TAILSCALE_PATH` | 自动发现 | 可选的 Tailscale CLI 完整路径；桌面端默认检查官方 Windows 安装目录和 `PATH`。 |
| `HOST` | `127.0.0.1` | 独立服务监听地址。 |
| `PORT` | `4310` | 独立服务监听端口。 |
| `AUTH_MODE` | `none` | `none` 仅用于独立服务的回环开发；Electron 仍使用私有桌面会话，远程使用 `token`。 |
| `API_TOKEN` | 空 | `token` 模式的 Bearer token；非回环监听时至少 32 个字符。 |
| `API_KEY_STORE_PATH` | 桌面自动设置；独立服务使用用户目录 | Gateway API Key 哈希存储文件；容器中默认 `/data/api-keys.json`。 |
| `API_KEY_ENCRYPTION_KEY` | 空 | 独立服务加密和查看完整 Gateway Key 的主密钥，至少 32 个字符；Windows 桌面版改用系统安全存储。 |
| `USAGE_STORE_PATH` | 桌面自动设置；独立服务使用用户目录 | 全量用量聚合文件；容器中默认 `/data/usage-stats.json`。 |
| `ALLOWED_PROJECT_ROOTS` | 空 | 允许的项目根目录，多个目录用逗号或分号分隔。 |
| `ALLOWED_HOSTS` | 空 | 回环服务额外接受的精确公网 Host 名称，多个值用逗号分隔；桌面端会自动加入当前 Tailscale Funnel 的 `*.ts.net` 设备名。 |
| `CORS_ORIGINS` | 空 | 允许的浏览器来源，多个来源用逗号分隔；不要用 `*` 暴露执行 API。 |
| `SCRATCH_ROOT` | 系统临时目录 | 无项目任务的一次性工作区根目录。 |
| `ATTACHMENT_UPLOAD_ROOT` | 系统临时目录 | 任务图片与附件的进程级临时存储根目录。 |
| `MAX_TASK_FILES` | `12` | 单任务允许绑定的最大文件总数（1–32）。 |
| `MAX_TASK_IMAGES` | `4` | 单任务允许绑定的最大图片数量（1–16）。 |
| `MAX_FILE_BYTES` | `26214400` | 单个图片或附件的最大字节数。 |
| `MAX_TASK_ATTACHMENT_BYTES` | `104857600` | 单任务全部附件的最大合计字节数。 |
| `ATTACHMENT_UPLOAD_TTL_MS` | `1800000` | 尚未绑定任务的上传保留时间。 |
| `OPENAI_COMPAT_BODY_LIMIT` | `36mb` | 模拟 OpenAI `/v1/responses` 与 `/v1/chat/completions` 的 JSON 请求体上限，用于容纳 Base64 图片；图片本身仍受上面的数量和字节限制。 |
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

### V2 一键配置：Docker + Tailscale Funnel

Windows 上推荐使用仓库内的在线 Host 配置。它会生成本机专用管理令牌和 `ccc_live_...` Gateway Key、启动容器、验证 `/v1/models`，并把客户端所需的两项配置写入 Git 忽略的文件。Docker 端口只绑定到 `127.0.0.1:4311`，不会直接暴露到局域网或互联网。

先在本机 PowerShell 设置模型服务凭据（不要把真实 Key 发到聊天、截图或 GitHub）：

```powershell
$env:OPENAI_API_KEY = "你的 OpenAI API Key"
```

然后从仓库根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-online-host.ps1 -EnableFunnel
```

脚本生成但不会提交以下文件：

- `.env.docker.local`：容器管理员令牌、Gateway Key 加密主密钥和模型服务凭据；只留在 Host 电脑。
- `.env.client.local`：可交给受信任客户端的 `OPENAI_BASE_URL` 与 `OPENAI_API_KEY`。这里的 API Key 是 `ccc_live_...` Gateway Key，不是上游 OpenAI Key。

本配置使用 `compose.online.yaml`，容器名为 `codex-control-center-v2`，持久数据卷为 `codex-control-data-v2`，隔离工作区卷为 `codex-control-workspaces-v2`。重复运行脚本会复用已有令牌和 Gateway Key。只启动或更新本地 Host、不开放公网时，省略 `-EnableFunnel`；已有镜像无需重建时可再加 `-SkipBuild`。

常用维护命令：

```powershell
docker compose -f compose.online.yaml ps
docker compose -f compose.online.yaml logs --tail 100 api
docker compose -f compose.online.yaml restart api
docker compose -f compose.online.yaml down
tailscale funnel --https=443 http://127.0.0.1:4311 off
```

最后一条命令只关闭该 V2 Host 的公网 Funnel。`down` 不会删除持久卷。不要添加 `-v`，除非明确需要永久删除已生成的 Gateway Key 和用量数据。配置脚本在开启前会读取当前 Funnel；如果 HTTPS 443 已指向其他本地服务，它会拒绝覆盖。

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

若 Tailscale 运行在 Docker 主机上，可在容器健康检查通过后创建免费公网入口：

```powershell
tailscale up --timeout=60s
tailscale funnel --bg --yes --https=443 http://127.0.0.1:4310
tailscale funnel status --json
```

第三方随后使用 `https://<设备名>.<tailnet>.ts.net/v1` 和容器管理员创建的 `ccc_live_...`。停止该映射时使用：

```powershell
tailscale funnel --https=443 http://127.0.0.1:4310 off
```

不要把 Docker 端口改成 `-p 4310:4310`；保留 `127.0.0.1:4310:4310`，让 Funnel 成为唯一公网入口。Docker 模式的 `API_TOKEN` 仅用于本机管理 API，不能交给第三方；`API_KEY_ENCRYPTION_KEY`、`OPENAI_API_KEY` 和数据卷同样需要单独保护。

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

</details>

## English

Codex Control Center is a Windows desktop console for the Codex SDK. It brings task input, model and reasoning controls, project management, file permissions, live status, logs, results, API keys, and usage monitoring into one application. The same backend also exposes HTTP APIs for scripts, IDE extensions, and internal tools.

## Quick start: use it as an OpenAI-compatible Host

A third-party application normally needs only two connection settings. Requests go to Codex Control Center and are converted into local Codex SDK tasks. This is a simulated OpenAI-compatible protocol surface, not an OpenAI API proxy, and `/v1` requests are never forwarded to `api.openai.com`:

```text
base_url = https://zhongtian.tail61e438.ts.net/v1
api_key  = ccc_live_GatewayKeyGeneratedByThisApp
```

- Use the HTTPS address above for public access. On the Host computer, use `http://127.0.0.1:4310/v1` instead.
- A `ccc_live_...` value is a Codex Control Center Gateway key created by the Host administrator. It is **not an OpenAI API key**.
- The OpenAI Python SDK is used only as a compatible client. Tasks are executed by the Codex SDK and Codex login on the Host computer.
- Never put a real key in source code, a README, screenshots, or chat. Give each caller a separate key so usage and revocation remain independent.
- The Host computer, Codex Control Center, Tailscale, API Host, and public Host must remain online.
- The **Check online** button next to `OPENAI HOST` verifies the real public HTTPS route, OpenAI authentication behavior, and `X-Request-Id` without sending a real Gateway key.

Existing programs can keep using the official OpenAI Python SDK and replace only `base_url` and `api_key`:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://zhongtian.tail61e438.ts.net/v1",
    api_key="ccc_live_a_new_key_from_the_host_admin",
)

model = client.models.list().data[0].id
response = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "Reply with exactly: connected"}],
)
print(response.choices[0].message.content)
```

Supported compatibility routes:

```text
GET  /v1/models
POST /v1/responses
POST /v1/chat/completions
```

Both normal JSON responses and `stream=True` SSE streams are supported. The original asynchronous task API remains available under `/api/v1/tasks` and `/api/v1/external/tasks`.

## Highlights

- Windows Electron desktop application and headless HTTP service share the same server implementation.
- Run Codex tasks with explicit Model, Effort, Speed, sandbox, and approval settings.
- Work with registered projects or isolated projectless temporary workspaces.
- Upload images and general attachments through owner-bound, one-time upload IDs.
- Generate model-bound `ccc_live_...` Gateway keys for third-party applications.
- Use OpenAI-compatible Models, Responses, and Chat Completions APIs, including streaming, compatible errors, and Request IDs.
- Publish the loopback-only service through Tailscale Funnel without directly exposing the local port.
- Verify the public Host from the dashboard with a provider-aware checker designed to support additional tunnel providers later.
- Monitor active calls, latency, status, token usage, model usage, and per-key usage.
- Disable the external API Host without disabling the desktop application or deleting existing keys.
- Protect desktop administration with a private HttpOnly session and Electron context isolation.

## Requirements

- Windows 10 or Windows 11 for the desktop application
- Node.js 20.16 or newer for development
- npm
- A working Codex login or an OpenAI API key for the Codex SDK runtime
- Tailscale, only when using the built-in public Host feature

## Download and first launch

Download Windows artifacts only from this repository's [GitHub Releases](https://github.com/daizhongtian/codex_sdk/releases):

- `Codex-Control-Center-Setup-<version>-x64.exe`: an NSIS installer with an installation directory selector and shortcuts.
- `Codex-Control-Center-Portable-<version>-x64.exe`: a single-file portable build.

The current Windows builds are not code-signed, so SmartScreen may display an unknown-publisher warning. Verify that the file came from this repository and compare its SHA-256 value with the checksum published for the same release:

```powershell
Get-FileHash -Algorithm SHA256 ".\Codex-Control-Center-Setup-<version>-x64.exe"
```

The first-launch readiness screen checks the bundled Codex runtime, optional external CLI, optional desktop application, and login status. This readiness check is local and does not start a model task.

For development, install dependencies:

```powershell
npm install
```

## Codex authentication

The desktop application can reuse the login cached by Codex CLI:

```powershell
npm install --global @openai/codex
codex.cmd login
codex.cmd login status
```

You can also authenticate the Codex runtime with a metered OpenAI API key:

```powershell
$env:OPENAI_API_KEY = "your-key"
$env:OPENAI_API_KEY | codex.cmd login --with-api-key
```

Do not commit credentials or send them to browser code. Server automation should inject secrets through process environment variables, container secrets, or a managed secret store. See the [Codex authentication documentation](https://developers.openai.com/codex/auth) and [Codex SDK documentation](https://developers.openai.com/codex/sdk).

## Run the desktop application

Development mode:

```powershell
npm run dev
```

Normal start:

```powershell
npm start
```

The desktop service listens on `127.0.0.1:4310` by default. You can choose another fixed port under **Settings → Fixed API port** and restart the application. Advanced users can temporarily override the saved value:

```powershell
$env:CODEX_DESKTOP_PORT = "4310"
npm start
```

The application uses a single-instance lock. A second launch focuses the existing window. Enable **Minimize to tray** if the API should continue running after the main window is closed.

## Run the headless HTTP service

```powershell
$env:HOST = "127.0.0.1"
$env:PORT = "4310"
npm run server
```

Health check:

```powershell
curl.exe http://127.0.0.1:4310/health
```

The machine-readable API contract is [`docs/openapi.yaml`](docs/openapi.yaml).

## HTTP API overview

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Process and service health. |
| `GET` | `/v1/models` | OpenAI-compatible model list for the current Gateway key. |
| `POST` | `/v1/responses` | OpenAI-compatible Responses API, normal or streaming. |
| `POST` | `/v1/chat/completions` | OpenAI-compatible Chat Completions API, normal or streaming. |
| `GET` | `/api/v1/models` | Model, Effort, Speed, and upload-limit catalog. |
| `GET` | `/api/v1/usage` | Persistent administrator usage summary. |
| `POST` | `/api/v1/usage/reset` | Start a new usage statistics generation. |
| `GET/POST` | `/api/v1/api-keys` | List metadata or generate a Gateway key. |
| `GET` | `/api/v1/api-keys/:id/secret` | Reveal a recoverable encrypted Gateway key. |
| `DELETE` | `/api/v1/api-keys/:id` | Permanently delete a Gateway key and its encrypted secret. |
| `GET/POST` | `/api/v1/gateway` | Read or change the external API Host switch. |
| `GET/POST` | `/api/v1/projects` | List or register project directories. |
| `POST` | `/api/v1/uploads/files` | Upload an administrator task file or image. |
| `GET/POST` | `/api/v1/tasks` | List tasks or create an asynchronous Codex task. |
| `GET` | `/api/v1/tasks/:id` | Read task status, result, or error. |
| `POST` | `/api/v1/tasks/:id/cancel` | Cancel a queued or running task. |
| `GET` | `/api/v1/tasks/:id/events` | Replay and stream task events with SSE. |
| `GET` | `/api/v1/external/profile` | Read the current Gateway key profile. |
| `POST` | `/api/v1/external/uploads/files` | Upload a caller-owned attachment or image. |
| `GET/POST` | `/api/v1/external/tasks` | List or create tasks owned by the current Gateway key. |
| `GET` | `/api/v1/external/tasks/:id/events` | Stream the caller's task events. |
| `POST` | `/api/v1/external/tasks/:id/cancel` | Cancel the caller's task. |
| `WS` | `/ws` | Optional multi-task real-time channel. |

In headless `AUTH_MODE=token`, administrator `/api/*` calls use:

```powershell
curl.exe -H "Authorization: Bearer $env:API_TOKEN" http://127.0.0.1:4310/api/v1/models
```

## Model-bound Gateway keys

Create keys from **API Keys & Usage** or from the model menu. A key binds Model, Effort, Speed, and file permission settings on the server:

- Windows uses system secure storage to encrypt the recoverable secret.
- Disk storage keeps a SHA-256 verification hash and encrypted ciphertext separately, not plaintext.
- External calls must use `/api/v1/external/*` or `/v1/*` with `Authorization: Bearer ccc_live_...`.
- Native API requests cannot override the key preset. Conflicts return `409 API_KEY_PRESET_CONFLICT`.
- OpenAI-compatible requests require a `model` field for client compatibility, but execution uses the model bound to the key.
- Each key can read and cancel only its own tasks.
- Deleting a key permanently removes its record and encrypted secret, invalidates subsequent calls, cancels its active tasks, and closes its streams.
- Disabling API Host makes external routes return `503 GATEWAY_DISABLED` while preserving keys for later use.

Use a separate key for every client. Never give callers the administrator token or the server-side OpenAI credential.

## OpenAI-compatible calls

Normal Responses and Chat Completions calls are translated directly into Codex SDK tasks; they are not forwarded to the OpenAI API:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:4310/v1",
    api_key="ccc_live_...",
)

model = client.models.list().data[0].id

response = client.responses.create(
    model=model,
    input="Reply with exactly: connected",
)
print(response.output_text)

chat = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "Reply with exactly: connected"}],
)
print(chat.choices[0].message.content)
```

Image input reuses this application's existing Codex SDK `local_image` pipeline. The compatibility layer accepts PNG, JPEG, or WebP Base64 data URLs:

```python
import base64
from pathlib import Path

data_url = "data:image/jpeg;base64," + base64.b64encode(
    Path("photo.jpg").read_bytes()
).decode("ascii")

vision = client.responses.create(
    model=model,
    input=[{
        "role": "user",
        "content": [
            {"type": "input_text", "text": "Describe this image"},
            {"type": "input_image", "image_url": data_url},
        ],
    }],
)
print(vision.output_text)
```

For Chat Completions, use `{"type": "image_url", "image_url": {"url": data_url}}`. Images work in both normal and streaming calls.

Streaming calls use the standard OpenAI SDK interface:

```python
stream = client.responses.create(
    model=model,
    input="Explain what this project does",
    stream=True,
)
for event in stream:
    if event.type == "response.output_text.delta":
        print(event.delta, end="", flush=True)

chat_stream = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "Explain what this project does"}],
    stream=True,
    stream_options={"include_usage": True},
)
for chunk in chat_stream:
    if chunk.choices:
        print(chunk.choices[0].delta.content or "", end="", flush=True)
```

Compatibility behavior:

- Every OpenAI-compatible request creates the same native asynchronous task used by the desktop application.
- Non-streaming calls wait for completion. Streaming calls translate native events to OpenAI SSE.
- Compatible calls use an isolated projectless temporary workspace.
- Text and image input are supported. Responses accepts `input_image`; Chat Completions accepts `image_url`. Images are validated locally, converted to Codex SDK `local_image` inputs, and removed from temporary storage when the task ends.
- To prevent server-side request forgery (SSRF), image input currently accepts only PNG, JPEG, or WebP Base64 data URLs. Remote image URLs and OpenAI `file_id` values are not fetched or accepted.
- Audio, client-defined function tools, `previous_response_id`, and hosted conversations are not currently supported.
- Every `/v1` success or error response includes `X-Request-Id: req_...`.
- Non-streaming errors use `{ "error": { "message", "type", "param", "code" } }`.
- Chat streams end with `data: [DONE]`. Responses streams end with `response.completed` or `response.failed`.

## Public Host with Tailscale Funnel

V2 can publish the loopback-only desktop service as a public HTTPS endpoint through Tailscale Funnel. Tailscale is not bundled with the application. Install it from the [official Tailscale download page](https://tailscale.com/download/windows), sign in, and keep it running.

1. Keep the fixed API port available; the default is `4310`.
2. Create a separate `ccc_live_...` key for every caller.
3. Open **Settings → Free public Host**.
4. Click **Go online**, then confirm public access.
5. Complete Tailscale Funnel/HTTPS authorization if prompted.
6. Copy the resulting `https://device.tailnet.ts.net/v1` base URL.

The dashboard displays both the local and public OpenAI Host addresses. Use the **Local Host / Public Host** control to switch the visible address.

### Check online

The **Check online** button asks the Electron main process to refresh the active provider, resolve it through public DNS, and probe the real public edge instead of the Tailnet-only address returned by local Tailscale MagicDNS:

1. `GET /health` must return a healthy response.
2. `GET /v1/models` without a key must return an OpenAI-shaped `401 invalid_api_key` with a valid `X-Request-Id`.

The expected `401` proves that public routing works and authentication is still enforced. The checker never sends a real Gateway key. The app runs the same check at startup and periodically while Funnel is active. After three consecutive real-public TLS failures, it rebuilds the verified HTTPS 443 mapping once, observes a 30-minute repair cooldown, and verifies the recovered public route. Renderer code supplies only a registered provider ID, not an arbitrary URL, which prevents the button from becoming a general-purpose request proxy.

The current provider ID is `tailscale-funnel`. The generic checker and provider resolver are designed so Cloudflare Tunnel or another public Host channel can be added later without rewriting the dashboard or probe logic.

The desktop application uses these fixed Tailscale operations:

```powershell
tailscale up --timeout=60s
tailscale funnel --bg --yes --https=443 http://127.0.0.1:4310
tailscale funnel status --json
```

Turning the public Host off removes only the verified HTTPS 443 mapping for the current local API. The application refuses to overwrite a Funnel route owned by another local service.

Tailscale stores the Funnel configuration, but Codex Control Center still serves the API. Public calls fail when the computer is off, Tailscale is disconnected, or the application exits. Enable **Minimize to tray** if the Host should survive closing the window.

## Native asynchronous task example

Gateway callers do not need to repeat model settings because the key preset is enforced by the server:

```powershell
$headers = @{ Authorization = "Bearer $env:CODEX_GATEWAY_KEY" }
$body = @{
  prompt = "Inspect this project and explain the result"
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

For attachments, upload the binary to `/api/v1/external/uploads/files` first, then place the returned `file.id` in `fileIds`. Upload IDs are owner-bound and single-use. Executables, installers, shortcuts, libraries, and disk images are rejected.

Default attachment limits are 12 files per task, up to 4 images, 25 MiB per file, and 100 MiB total. Unused uploads expire after 30 minutes. Bound temporary files are cleaned when a task completes, fails, is cancelled, or the service stops.

## Usage dashboard

The desktop dashboard aggregates usage returned by the Codex SDK:

- Total tokens = input tokens + output tokens.
- Cached tokens are a subset of input tokens.
- Reasoning tokens are a subset of output tokens.
- Statistics include task counts, success rate, active tasks, model totals, and per-key totals.
- Statistics persist independently of the in-memory task history limit.

Reset starts a new statistics generation. Tasks started before the reset do not write into the new generation. Dashboard values are SDK usage data, not OpenAI billing or cost estimates.

## API behavior, errors, and limits

- `/api/v1` is the current stable native API version. Clients must ignore unknown optional JSON fields and event types.
- Human-readable messages and logs are not stable protocol fields. Automations should inspect HTTP status, `error.code`, task `status`, structured events, and final results.
- Native JSON errors use `{ "error": { "code": "...", "message": "...", "details": ... } }`.
- `POST /tasks` returns `202 Accepted`; poll or stream until `completed`, `failed`, or `cancelled`.
- Default limits include a 1 MiB JSON body, 200,000 prompt characters, 2 concurrent tasks, 50 unfinished tasks, 100 SSE/WebSocket connections, and 32 task subscriptions per WebSocket.
- SSE uses increasing event IDs. Reconnect with `Last-Event-ID` or `?after=<id>`, then read the task snapshot to cover gaps.
- Task creation has no idempotency key. Retrying an uncertain `POST /tasks` can create duplicate tasks.

Common HTTP statuses include `400`, `401`, `403`, `404`, `409`, `413`, `415`, `422`, `429`, and `503`.

## Configuration

`.env.example` documents available variables; the application does not automatically load it. Set variables in the process environment or use Docker `--env-file`. Never commit a secret-bearing `.env` file.

| Variable | Default/example | Description |
| --- | --- | --- |
| `CODEX_DESKTOP_PORT` | saved setting, default `4310` | Override the Electron embedded service port. Use `0` only for automated tests. |
| `TAILSCALE_PATH` | auto-discovered | Optional full path to Tailscale CLI. |
| `HOST` | `127.0.0.1` | Headless service listen address. |
| `PORT` | `4310` | Headless service listen port. |
| `AUTH_MODE` | `none` | Loopback development may use `none`; non-loopback deployments must use `token`. |
| `API_TOKEN` | empty | Administrator Bearer token; at least 32 characters for non-loopback use. |
| `API_KEY_STORE_PATH` | automatic | Persistent Gateway key hash and encrypted-secret store. |
| `API_KEY_ENCRYPTION_KEY` | empty | Headless-service key encryption secret, at least 32 characters. Desktop uses Windows secure storage. |
| `USAGE_STORE_PATH` | automatic | Persistent aggregate usage store. |
| `ALLOWED_PROJECT_ROOTS` | empty | Comma- or semicolon-separated project root allowlist. |
| `ALLOWED_HOSTS` | empty | Exact additional Host names accepted by a loopback service. |
| `CORS_ORIGINS` | empty | Explicit browser origins; do not expose execution APIs with `*`. |
| `SCRATCH_ROOT` | system temporary directory | Root for isolated projectless workspaces. |
| `ATTACHMENT_UPLOAD_ROOT` | system temporary directory | Temporary attachment storage root. |
| `MAX_TASK_FILES` | `12` | Maximum files per task. |
| `MAX_TASK_IMAGES` | `4` | Maximum images per task. |
| `MAX_FILE_BYTES` | `26214400` | Maximum bytes per file. |
| `MAX_TASK_ATTACHMENT_BYTES` | `104857600` | Maximum total attachment bytes per task. |
| `ATTACHMENT_UPLOAD_TTL_MS` | `1800000` | Lifetime of an unbound upload. |
| `OPENAI_COMPAT_BODY_LIMIT` | `36mb` | JSON body limit for the simulated `/v1/responses` and `/v1/chat/completions` routes so Base64 images fit; image count and byte limits still apply. |
| `TRUST_PROXY` | `false` | Enable only behind a trusted reverse proxy. |
| `MAX_CONCURRENT_TASKS` | `2` | Maximum running tasks per process. |
| `MAX_QUEUED_TASKS` | `50` | Maximum unfinished tasks. |
| `MAX_SSE_CONNECTIONS` | `100` | SSE and WebSocket connection limit. |
| `TASK_TIMEOUT_MS` | `1800000` | Task timeout in milliseconds. |
| `TASK_HISTORY_LIMIT` | `200` | Completed tasks retained in process memory. |
| `EVENT_HISTORY_LIMIT` | `500` | Events retained per task. |
| `EVENT_HISTORY_BYTES` | `2097152` | Event byte budget per task. |
| `LOG_LEVEL` | `info` | Server log level. |
| `ALLOW_DANGEROUS_TASKS` | `false` | Permit specially scoped full-access tasks outside loopback. |
| `ALLOW_TASK_NETWORK` | `false` | Permit specially scoped task network access outside loopback. |
| `OPENAI_API_KEY` | empty | Optional server-side credential used by the Codex SDK runtime. |

Generate a local administrator token:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:API_TOKEN = [Convert]::ToHexString($bytes)
```

Projects, tasks, events, and final results are currently stored in process memory and are cleared on restart. Gateway keys and aggregate usage persist in their configured stores. A multi-writer or multi-host deployment must move identity, revocation, usage, audit, and task state into transactional infrastructure.

## Data, privacy, and permissions

Desktop persistent data normally lives under `%APPDATA%\codex-control-center\`. Temporary attachments and projectless workspaces use the system temporary directory. Prompts, selected project content, attachments, and results are passed to the Codex SDK and may be sent to OpenAI/Codex services.

A `ccc_live_...` key authenticates only this project's external API. It cannot call the OpenAI API directly. The project does not include product analytics, advertising trackers, or third-party crash telemetry. See [`PRIVACY.md`](PRIVACY.md) and [`SECURITY.md`](SECURITY.md).

Task permissions:

- `read-only`: analyze, explain, and review without writing files.
- `workspace-write`: write inside the workspace and explicit writable roots.
- `danger-full-access`: disable the filesystem sandbox; use only in an isolated, fully trusted environment.

`ALLOWED_PROJECT_ROOTS` is the service-entry path allowlist. The Codex sandbox is a separate execution-time boundary. Remote multi-user deployments should use separate containers or virtual machines, credentials, work volumes, and network policies per tenant.

## Docker headless deployment

### V2 guided Docker + Tailscale setup

On Windows, set the server-side model credential without posting it to chat, screenshots, or GitHub:

```powershell
$env:OPENAI_API_KEY = "your OpenAI API key"
```

Then run from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-online-host.ps1 -EnableFunnel
```

The script generates ignored local files:

- `.env.docker.local`: administrator token, Gateway-key encryption secret, and model-service credential. Keep it only on the Host.
- `.env.client.local`: `OPENAI_BASE_URL` and a generated `OPENAI_API_KEY`. In this client file, the value is a `ccc_live_...` Gateway key, not the upstream OpenAI key.

The compose file binds Docker only to `127.0.0.1:4311`; Tailscale Funnel is the public entry point. Re-running the script reuses existing secrets. Omit `-EnableFunnel` for local-only startup and use `-SkipBuild` when the image is already current.

Maintenance commands:

```powershell
docker compose -f compose.online.yaml ps
docker compose -f compose.online.yaml logs --tail 100 api
docker compose -f compose.online.yaml restart api
docker compose -f compose.online.yaml down
tailscale funnel --https=443 http://127.0.0.1:4311 off
```

`docker compose down` preserves volumes. Do not add `-v` unless permanent deletion of Gateway keys and usage data is intended.

Manual build:

```powershell
docker build -t codex-control-center .
```

Safe loopback-only test run:

```powershell
docker run --rm --name codex-control-center `
  -p 127.0.0.1:4310:4310 `
  -e API_TOKEN="$env:API_TOKEN" `
  -e OPENAI_API_KEY="$env:OPENAI_API_KEY" `
  -v "C:\work:/workspaces:rw" `
  -v "codex-control-data:/data" `
  codex-control-center
```

Do not publish the container as `-p 4310:4310`. Keep the loopback binding and use a controlled HTTPS tunnel or reverse proxy. The included token mode is deployment scaffolding, not a complete internet multi-tenant identity system.

## Build Windows artifacts

```powershell
npm run check
npm test
npm run dist:portable
npm run dist:setup
```

Both executables are written to `release/`. The build enables ASAR integrity validation and disables `NODE_OPTIONS`, CLI inspection, and extra file-protocol privileges. The current artifacts are unsigned; published release notes must retain the SmartScreen warning and SHA-256 values.

## Contributing and project documents

- License: [`LICENSE`](LICENSE)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)
- Contributing guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Code of Conduct: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- Security policy: [`SECURITY.md`](SECURITY.md)
- Privacy notice: [`PRIVACY.md`](PRIVACY.md)
- OpenAPI 3.1 contract: [`docs/openapi.yaml`](docs/openapi.yaml)

## Troubleshooting

- **Codex is not signed in:** run `codex.cmd login status`, then `codex.cmd login` if necessary.
- **Port already in use:** close the conflicting process or choose another fixed desktop port. Use `PORT` for the headless service.
- **Project rejected:** verify that the resolved project path is inside `ALLOWED_PROJECT_ROOTS`.
- **Container cannot write:** give the container's non-root `node` user permission to the mounted workspace and select `workspace-write`.
- **Public Host check returns `HOST_FORBIDDEN`:** refresh the tunnel provider status, then run **Check online** again. The provider refresh registers the exact public hostname without allowing arbitrary Host headers.
- **Remote request is unauthorized:** verify that the caller uses `Authorization: Bearer ccc_live_...` for `/v1/*` and `/api/v1/external/*`. Never give a third party `API_TOKEN`.
