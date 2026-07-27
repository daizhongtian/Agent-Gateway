# Coding Agent Gateway

Coding Agent Gateway is a Windows desktop gateway, debugging tool, and control console for AI coding agents.

English is displayed by default. Expand **简体中文** below to read the Chinese version without leaving this page.

<details>
<summary><strong>🇨🇳 简体中文（点击展开）</strong></summary>

## 项目简介

Coding Agent Gateway 被设计为连接多种 Coding Agent 的统一入口，例如 ChatGPT/Codex、Claude Code 和 Gemini。它把任务、模型、项目权限、实时日志、调用结果、Gateway Key 和 Token 用量集中到一个应用中。

当前版本首先内置 Codex SDK Provider。未来接入其他 Coding Agent 时，第三方程序仍可继续使用同一个 Gateway 地址和调用方式。

## 使用场景

- **开发和调试 AI Agent 产品**：通过模拟 OpenAI API 的兼容接口测试 Agent、自动化工具、IDE 插件和内部应用。
- **跨设备和跨应用调用**：让本机程序、其他电脑、手机或团队内部工具通过统一 HTTP API 调用 Host 电脑上的 Coding Agent。
- **团队集中管理**：为不同成员或产品创建独立 Gateway Key，并分别查看、限制或撤销访问。
- **管理 Token 消耗**：按 Gateway Key 查看调用次数、Token、延迟、状态和模型用量，并设置累计 Token 上限。
- **临时访问控制**：为每枚 Gateway Key 设置自动销毁时间，到期后永久删除 Key 并停止其任务和连接。
- **降低调用成本**：利用统一订阅降低相比按 Token API 的成本。
- **测试兼容性**：使用普通响应、SSE 流式响应、图片输入和兼容错误测试 AI Agent 产品。

## 如何调用

### 1. 在 Host 电脑上准备服务

1. 启动 Coding Agent Gateway。
2. 新用户点击 **连接 ChatGPT**，在浏览器完成登录，并确认运行环境检测通过。
3. 开启 **API Host**。
4. 在 **API Key 与用量** 中创建一个 `ccc_live_...` Gateway Key。
5. 为该 Key 选择模型、推理强度、速度和文件权限。

### 2. 配置第三方程序

本机调用：

```text
base_url = http://127.0.0.1:4310/v1
api_key  = ccc_live_由本程序生成的GatewayKey
```

跨设备或公网调用：

```text
base_url = https://你的公网Host/v1
api_key  = ccc_live_由Host管理员分配的GatewayKey
```

`ccc_live_...` 是本程序生成的 Gateway Key。公网地址以应用首页 `OPENAI HOST` 显示的地址为准。

### 3. 先获取模型，再发送任务

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

Chat Completions 调用：

```python
chat = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "解释这个项目的用途"}],
)

print(chat.choices[0].message.content)
```

流式调用：

```python
stream = client.responses.create(
    model=model,
    input="用三句话介绍这个项目",
    stream=True,
)

for event in stream:
    if event.type == "response.output_text.delta":
        print(event.delta, end="", flush=True)
```

主要兼容接口：

```text
GET  /v1/models
POST /v1/responses
POST /v1/chat/completions
```

普通响应、SSE 流式响应、兼容错误、`X-Request-Id` 和图片输入均受支持。需要任务轮询、取消、项目目录和完整原生事件时，可以使用保留的 `/api/v1/external/tasks` 异步任务 API。

## 程序功能

- Windows 桌面任务控制台与实时任务状态。
- 模型、推理强度、速度、项目和文件权限配置。
- Gateway Key 创建、查看、独立统计、累计 Token 限额、到期自动销毁和永久删除。
- 调用次数、Token、延迟、成功率和模型用量监控。
- 文本、PNG、JPEG、WebP 图片以及通用附件输入。
- OpenAI 兼容的 Responses 与 Chat Completions 普通和流式调用。
- 原生异步任务、SSE 事件和可选 WebSocket 通道。
- 本地 API Host 开关。
- V2 公网 Host、在线检查和 Tailscale Funnel 自动修复。
- 公网 Host Provider 扩展接口，可继续增加其他发布渠道。

## 安装与启动

### Windows 用户

1. 从本项目的 [GitHub Releases](https://github.com/daizhongtian/Coding-Agent-Gateway/releases) 下载最新版安装包或 Portable EXE。
2. 启动程序并完成运行环境检测。
3. 新用户点击 **连接 ChatGPT**，在浏览器完成登录；程序会自动重新检测。
4. 开启 API Host 并生成 Gateway Key。
5. 需要跨设备访问时，保持 Host 电脑在线；V2 当前通过 Tailscale Funnel 发布公网 Host，并可在首页点击 **Check online** 验证。

### 从源码运行

```powershell
npm install
npm start
```

运行无界面 HTTP 服务：

```powershell
npm run server
```

## 高级文档

- [完整 HTTP API 契约](docs/openapi.yaml)
- [安全说明](SECURITY.md)
- [隐私说明](PRIVACY.md)
- [参与贡献](CONTRIBUTING.md)
- [第三方软件声明](THIRD_PARTY_NOTICES.md)
- [MIT License](LICENSE)

</details>

## Overview

Coding Agent Gateway is designed as one entry point for multiple coding agents, including ChatGPT/Codex, Claude Code, and Gemini. It brings tasks, models, project permissions, live logs, results, Gateway keys, and token usage into one application.

The current release ships with the Codex SDK provider first. As additional coding agents are added, client applications can continue using the same Gateway address and calling pattern.

## Use cases

- **Develop and debug AI-agent products:** test agents, automations, IDE extensions, and internal applications through a simulated OpenAI-compatible API.
- **Call agents across devices and applications:** let local programs, other computers, phones, and internal team tools call the coding agent running on the Host computer through one HTTP API.
- **Manage a team centrally:** create a separate Gateway key for each team member or product, then monitor, restrict, or revoke access independently.
- **Monitor token consumption:** track calls, tokens, latency, status, and model usage per Gateway key, with a configurable cumulative token limit.
- **Control temporary access:** set an automatic deletion time for each Gateway key; expiration permanently removes the key and stops its tasks and connections.
- **Lower calling costs:** use a unified provider subscription to reduce costs compared with per-token APIs.
- **Test compatibility:** validate AI-agent products with normal responses, SSE streaming, image input, and compatible errors.

## How to call the gateway

### 1. Prepare the Host computer

1. Start Coding Agent Gateway.
2. Confirm that Codex is signed in and the runtime check passes.
3. Enable **API Host**.
4. Create a `ccc_live_...` Gateway key under **API Keys & Usage**.
5. Select the model, reasoning effort, speed, and file permission for that key.

### 2. Configure the client application

For calls on the Host computer:

```text
base_url = http://127.0.0.1:4310/v1
api_key  = ccc_live_GatewayKeyGeneratedByThisApp
```

For another device or a public connection:

```text
base_url = https://your-public-host.example/v1
api_key  = ccc_live_GatewayKeyAssignedByTheHostAdmin
```

The `ccc_live_...` value is a Gateway key generated by this application. For public access, use the exact address displayed under `OPENAI HOST` on the dashboard.

### 3. List models, then create a task

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
```

Chat Completions:

```python
chat = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "Explain what this project does."}],
)

print(chat.choices[0].message.content)
```

Streaming:

```python
stream = client.responses.create(
    model=model,
    input="Introduce this project in three sentences.",
    stream=True,
)

for event in stream:
    if event.type == "response.output_text.delta":
        print(event.delta, end="", flush=True)
```

Main compatibility endpoints:

```text
GET  /v1/models
POST /v1/responses
POST /v1/chat/completions
```

Normal responses, SSE streaming, compatible errors, `X-Request-Id`, and image input are supported. For task polling, cancellation, project directories, and full native events, use the retained `/api/v1/external/tasks` asynchronous task API.

## Features

- Windows desktop task console with live task status.
- Model, reasoning effort, speed, project, and file-permission controls.
- Gateway key creation, secure viewing, independent usage tracking, cumulative token limits, automatic expiration, and permanent deletion.
- Monitoring for calls, tokens, latency, success rate, and model usage.
- Text, PNG, JPEG, WebP image, and general attachment input.
- OpenAI-compatible Responses and Chat Completions, including normal and streaming calls.
- Native asynchronous tasks, SSE events, and an optional WebSocket channel.
- Local API Host controls.
- V2 public Host, online checks, and automatic Tailscale Funnel repair.
- An extensible public-Host provider interface for adding other publishing channels.

## Install and start

### Windows users

1. Download the latest installer or Portable EXE from [GitHub Releases](https://github.com/daizhongtian/Coding-Agent-Gateway/releases).
2. Start the application and complete the runtime check.
3. Sign in to Codex.
4. Enable API Host and generate a Gateway key.
5. For access from other devices, keep the Host computer online. V2 currently publishes the public Host through Tailscale Funnel; select **Check online** on the dashboard to verify it.

### Run from source

```powershell
npm install
npm start
```

Run the headless HTTP service:

```powershell
npm run server
```

## Advanced documentation

- [Complete HTTP API contract](docs/openapi.yaml)
- [Security](SECURITY.md)
- [Privacy](PRIVACY.md)
- [Contributing](CONTRIBUTING.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [MIT License](LICENSE)
