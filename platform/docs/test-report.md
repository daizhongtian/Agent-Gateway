# Agent Gateway V3 自动化测试报告

测试日期：2026-07-30
分支：`V3`

## 结论

桌面 Gateway、Spring Boot 平台后端和 React 平台前端的正式自动化测试、覆盖率门槛、平台全栈 E2E、桌面视觉回归及 Windows 安装包测试均已通过。

所有新增测试均作为仓库源码提交，可以重复执行；没有使用真实 Coding Agent 推理，不会消耗模型 Token，也没有依赖仅用于本次任务的一次性脚本。

V3 的 Online Host 主流程是平台账号、桌面自动登记、一次性设备配对、Host 分配和 Relay/本地开发代理。用户不需要安装或配置 Tailscale。当前仓库提供 localhost 开发代理；真正跨设备公网地址仍需要部署公开平台与 Relay。

## 覆盖率与门槛

| 工程 | 正式测试 | 实际覆盖率 | 全局门槛 | 安全门槛 |
| --- | ---: | --- | --- | --- |
| Windows 桌面 / Gateway（Node.js） | 159/159 | 行 90.30%；分支 80.75%；函数 92.57% | 行 85%；分支 80%；函数 85% | 行 96.11%；分支 91.40%；函数 97.67%（要求 95% / 90% / 95%） |
| 平台后端（Spring Boot） | 49/49 | 行 96.92%；分支 89.68%；方法 96.76% | 行 90%；分支 85%；方法 90% | `security` 包：行 99.23%；分支 94.00%；方法 97.37%（要求 95% / 90% / 95%） |
| 平台前端（React） | 30/30 | 行 84.07%；分支 79.27%；函数 81.29%；语句 80.94% | 行 80%；分支 75%；函数 80%；语句 75% | 由前端全局门槛、API/CSRF 单元测试与全栈 E2E 共同约束 |

变更覆盖率门槛为行 90%、分支 85%、函数/方法 90%。本次有可执行变更的结果为行 100%（4/4）、函数 100%（4/4）；没有新增可执行分支。

覆盖率报告：

- 桌面：`coverage/desktop/index.html`
- 后端：`platform/backend/target/site/jacoco/index.html`
- 前端：`platform/frontend/coverage/index.html`

## 通过的正式测试

| 测试层 | 结果 | 主要覆盖内容 |
| --- | --- | --- |
| 桌面 Node 测试 | 159/159 | 认证、Gateway Key、Token 上限/销毁、任务与附件、图片输入、Responses、Chat Completions、SSE、Request ID、平台会话、设备配对、Host 检查、Codex Runner 与安全错误 |
| 后端 JUnit / Spring 集成测试 | 49/49 | 注册登录、Cookie、CSRF、Token 轮换、限流、设备、配对码、Host、Relay、本地代理、资源归属、错误格式和安全过滤器 |
| 前端 Vitest | 30/30 | 登录/注册条款、会话恢复、API 客户端、CSRF、401 刷新、Dashboard、落地页、法律页和多语言 |
| JavaScript 语法检查 | 69 个文件 | `src`、`public`、`test`、`scripts` 和平台 E2E；子进程无法启动时会报告真实原因 |
| TypeScript 与 Vite | 通过 | `tsc -b` 和生产构建 |
| 平台 Docker/Chrome E2E | 通过 | 注册条款、Cookie/CSRF、自动设备登记、一次性配对码防重放、Host 创建与开关、调用说明、设备撤销、退出后重新登录和 PostgreSQL 持久化 |
| 桌面视觉回归 | 通过 | 首次条款、账号弹窗、中英文、暗色/亮色、Host fail-closed、Gateway Key、用量、附件、错误状态和移动布局 |
| 发布配置 | 通过 | electron-builder、NSIS、多语言许可、版本、图标、仓库元数据和第三方声明 |
| Windows 打包测试 | 通过 | unpacked、Portable、固定端口持久化、NSIS 自定义目录、安装后运行、卸载和保留用户数据；内置 Codex Runtime 与渲染器均实际启动 |

## 平台全栈 E2E 顺序

1. 打开 Nginx 提供的 React 生产页面。
2. 选择注册，填写唯一用户名和密码，可选择填写找回密码邮箱，并主动勾选平台条款与隐私确认。
3. 验证浏览器 Cookie 会话不会把 Bearer Token 暴露给 JavaScript，并通过双提交 CSRF 完成 Token 轮换。
4. 按桌面 App 的真实流程自动登记设备并生成一次性配对码。
5. 兑换配对码并确认只返回一次 `ccc_dev_...` 设备凭据；重放同一配对码必须返回 401。
6. 自动创建 Host、启用 Online Host，并在 Dashboard 展示精确 Base URL 和调用方法。
7. 从 Dashboard 关闭、重新开启 Host；本地没有桌面 Gateway 时，真实连通检查必须保持 fail-closed。
8. 停用 Host、撤销设备、退出平台。
9. 重新登录并再次完成条款确认，确认 revoked/disabled 状态由 PostgreSQL 持久保存。

浏览器截图写入 `platform/frontend/test-results/full-stack.png`；CI 会把截图和 Compose 日志作为 Artifact 上传。

## 测试中发现并修复的问题

1. 首次条款弹窗会暂停桌面初始化，旧视觉测试在事件绑定前点击账号按钮。测试现先验证默认未勾选状态，再完成真实首次确认流程。
2. 公网检查按钮在桌面 Bridge 尚未确认能力时不应可用。初始 HTML 现采用 fail-closed 的 `disabled` 状态。
3. 平台账号刷新进行中时，点击账号入口曾可能不显示对话框。现在对话框立即打开，再等待异步刷新。
4. 平台 E2E 仍依赖已删除的“手工设备/Host 管理”旧页面。测试已改为当前 V3 的桌面自动登记、自动配对和自动 Host 流程。
5. 新增平台条款后，E2E 未勾选确认导致注册按钮保持禁用。注册和重新登录路径现均验证主动勾选。
6. E2E 的直接平台写请求起初未回送 CSRF Cookie。测试现验证 CSRF Cookie/Header 匹配与刷新后 Token 轮换。
7. 语法检查以前没有覆盖平台 E2E，且子进程启动失败会被误报成源码语法错误。检查范围和错误报告均已修复。
8. 在 Portable EXE 正在运行时直接覆盖 `release` 会造成 electron-builder 卡住。新增 `test:packaged:fresh`，始终在 `artifacts/packaged` 隔离构建并自动执行安装包测试，不中断当前应用。
9. Dashboard 会持续轮询桌面与 Host 状态，E2E 使用 `networkidle` 等待刷新会永久不稳定。测试现等待 `domcontentloaded` 和账号专属 UI，修复后已用全新 Docker 构建从头重跑通过。
10. Linux CI 无法直接执行未设置可执行位的 Maven Wrapper。后端工作流现调用由 GitHub runner 提供的 Maven，避免平台相关的文件权限差异。
11. 特殊配置集成测试曾与默认测试上下文共用同一个 H2 内存数据库；测试上下文关闭时可能删除其他测试仍在使用的表。每个特殊配置测试现使用独立数据库，消除了依赖测试类顺序的间歇性 HTTP 500。

## 可重复执行的标准命令

首次安装锁定依赖：

```powershell
npm ci
npm ci --prefix platform/frontend
```

三工程测试、覆盖率、TypeScript、前端生产构建与变更覆盖率：

```powershell
npm run test:all
```

平台 Docker/Chrome 全栈 E2E：

```powershell
docker compose -f platform/compose.yaml up -d --build --wait
npm run test:e2e:platform
```

桌面视觉回归：

```powershell
npm run test:visual
```

Windows 隔离构建与打包后测试：

```powershell
npm run test:packaged:fresh
```

CI 对 `main` 和 `V3` 的 push/PR 执行三工程覆盖率、变更覆盖率、Docker/Chrome E2E 和视觉测试；Release 工作流在发布前再次执行覆盖率、视觉、构建与安装包测试。
