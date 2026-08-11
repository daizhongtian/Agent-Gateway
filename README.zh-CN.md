# Agent Gateway（简体中文）

Agent Gateway 是面向 AI Coding Agent 的 Windows 桌面网关、调试工具和控制台。

[正式平台](https://platform.agentgatewayplatform.cc/) · [下载](https://github.com/daizhongtian/Agent-Gateway/releases/latest) · [API 契约](docs/openapi.yaml) · [English](README.md)

Agent Gateway 是独立的开源项目，不是 OpenAI 产品，也未得到 OpenAI 的开发、认可或支持。

## 项目简介

Agent Gateway 被设计为连接多种 Coding Agent 的统一入口，例如 ChatGPT/Codex、Claude Code 和 Gemini。它把任务、模型、项目权限、实时日志、调用结果、Gateway Key 和 Token 用量集中到一个应用中。

当前版本首先内置 Codex SDK Provider。未来接入其他 Coding Agent 时，第三方程序仍可继续使用同一个 Gateway 地址和调用方式。

## 使用场景

- **开发和调试 AI Agent 产品**：通过模拟 OpenAI API 的兼容接口测试 Agent、自动化工具、IDE 插件和内部应用。
- **跨设备和跨应用调用**：让本机程序、其他电脑、手机或内部工具调用 Host 电脑上的 Coding Agent。
- **管理访问权限**：为不同人员或应用创建独立 Gateway Key，并分别限制、设置到期时间或撤销访问。
- **监控用量**：按 Gateway Key 查看调用次数、Token、延迟、状态和模型用量，并可设置累计 Token 上限。
- **降低调用成本**：利用统一订阅降低相比按 Token API 的成本。

### Gateway Key 管理

创建绑定模型的 Gateway Key，并控制模型、推理强度、速度、文件权限、Token 上限和到期时间。

![Model API Key 创建与管理](docs/images/use-cases-model-api-keys.png)

![Gateway Key Token 上限与自动删除设置](docs/images/use-cases-api-key-advanced-settings.png)

## 快速开始

### Windows 桌面端

1. 从 [GitHub Releases](https://github.com/daizhongtian/Agent-Gateway/releases/latest) 下载最新安装包或 Portable EXE。
2. 启动 Agent Gateway，点击 **连接 ChatGPT**，并在浏览器完成登录。
3. 开启 **API Host**。
4. 打开 **API Key 与用量**，创建一个 `ccc_live_...` Gateway Key。

Host 电脑上的应用使用：

```text
base_url = http://127.0.0.1:4310/v1
api_key  = ccc_live_由本程序生成的GatewayKey
```

### 可选的 Online Host

在桌面端登录[正式平台](https://platform.agentgatewayplatform.cc/)账号，然后点击 **Online Host** 或 **Share online**。应用会自动登记并配对设备，随后显示该设备的公网 `OPENAI HOST` 地址，无需安装或配置 Tailscale。

请使用应用显示的完整 Host 专属地址：

```text
base_url = https://api.agentgatewayplatform.cc/h/你的Host标识/v1
api_key  = ccc_live_由Host管理员分配的GatewayKey
```

Online Host 是可选功能。本地 API Host 不需要平台账号即可使用。本地平台开发方式请查看 [platform/README.md](platform/README.md)。

## API 示例

安装 OpenAI 官方 Python 客户端，并将其连接到 Agent Gateway：

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
```

主要兼容接口：

```text
GET  /v1/models
POST /v1/responses
POST /v1/chat/completions
```

支持普通响应、SSE 流式响应、兼容错误、`X-Request-Id`，以及 Base64 PNG、JPEG、WebP 图片输入。任务轮询、取消、项目目录、文件上传和原生任务事件请使用 [OpenAPI 契约](docs/openapi.yaml)中的 `/api/v1/external` API。

## 核心功能

- Windows 桌面任务控制台、实时状态和日志。
- 模型、推理强度、速度、项目和文件权限控制。
- Gateway Key 创建、本地加密恢复、独立用量统计、Token 上限、到期和永久删除。
- OpenAI 兼容的 Responses 与 Chat Completions，包括 SSE 流式响应和图片输入。
- 原生异步任务、附件、取消、SSE 事件和可选 WebSocket 通道。
- 本地 API Host，以及通过正式平台和 Relay 实现的一键 Online Host。
- 平台账号、可选找回邮箱、持久登录和自动设备配对。
- 使用隔离 Fake AI Provider 和回归基线的性能测试。

## 隐私与安全

`ccc_live_...` Gateway Key 由 Agent Gateway 生成，不是 OpenAI API Key。请将其作为密钥保管；对外共享时应使用独立的最小权限 Key，并设置 Token 上限或到期时间。

Online Host 使用 HTTPS/WSS 保护传输，但它并未对平台运营者实现端到端加密：公网 Edge 或 Relay 可以处理请求正文、附件、流式数据和错误，所选模型 Provider 也会处理提交的内容。公开 Host 前请阅读 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 从源码运行

```powershell
npm ci
npm start
```

只运行无界面 HTTP 服务：

```powershell
npm run server
```

平台开发需要单独配置 Java、Node.js、PostgreSQL 或 Docker，具体请查看 [platform/README.md](platform/README.md)。

## 文档

- [HTTP API 契约](docs/openapi.yaml)
- [平台与 Relay](platform/README.md)
- [性能测试](performance-tests/README.md)
- [安全说明](SECURITY.md)
- [隐私说明](PRIVACY.md)
- [参与贡献](CONTRIBUTING.md)
- [第三方软件声明](THIRD_PARTY_NOTICES.md)
- [MIT License](LICENSE)
