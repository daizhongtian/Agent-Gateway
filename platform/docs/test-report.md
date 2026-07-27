# Codex Control Platform 测试报告

测试日期：2026-07-27

## 结论

`platform` 当前已实现的账户、会话、设备、配对、OPENAI HOST 地址分配、Host 状态控制、数据库迁移、前端控制台和容器部署功能均已通过测试。测试没有修改仓库原有桌面程序。

公网 Relay 和真正的 `/v1/*` OpenAI 请求转发不在本阶段实现范围内，因此不能声称 Online Host 已真正接入公网。当前验证的是控制面闭环：用户可注册和登录、绑定设备、获得稳定 OPENAI HOST 地址，并在 Relay 未配置时保持准确的 `offline` 状态。

## 测试环境

- Java 21.0.10、Spring Boot 4.1.0、Maven 3.9.11
- Node.js 24.15.0、React 19.2.7、Vite 8.1.5、Vitest 4.1.10
- PostgreSQL 18.4（Docker）和 H2 2.4.240
- Docker 三服务栈：PostgreSQL、Spring Boot、Nginx/React
- 本机 Google Chrome，通过 Playwright Core 执行无头浏览器测试

## 自动测试结果

| 层级 | 结果 | 覆盖内容 |
| --- | --- | --- |
| Spring Boot 单元/集成测试（H2） | 14/14 通过 | API、鉴权、CSRF、限流、资源归属、配置、错误处理、加密令牌、OpenAPI 契约 |
| Spring Boot 集成测试（PostgreSQL 18.4） | 13/13 通过 | 在真实 PostgreSQL、Flyway 迁移及 Hibernate schema validation 下执行全部业务测试 |
| React/Vitest | 8/8 通过 | 注册、会话恢复、设备/Host 操作、错误显示、API 客户端、CSRF、401 自动刷新、204 响应 |
| TypeScript | 通过 | `tsc -b --pretty false` |
| React 生产构建 | 通过 | Vite 生产包生成成功 |
| npm 安全审计 | 通过 | 0 个已知漏洞 |
| OpenAPI 契约 | 通过 | YAML 可解析，17 条路径、20 个唯一 `operationId` |
| Docker 镜像 | 通过 | backend 与 frontend 均成功构建；backend 镜像构建阶段运行测试 |
| Docker Compose | 通过 | 配置解析成功，database/backend 健康，frontend 可访问 |
| Nginx 生产入口 | 通过 | 页面 200、API 反向代理、请求 ID、安全响应头和 CSP |
| Chrome 端到端 | 通过 | 完整真实 UI 和 PostgreSQL 闭环 |
| CORS | 通过 | 允许来源预检 200；陌生来源预检 403 |

## 功能覆盖矩阵

### 平台与部署

- `/health`、`/readiness` 和 `/platform/config` 的正常响应。
- 数据库不可用和异常探针值时 readiness 返回 503。
- 请求 ID 同时出现在响应头和结构化错误体中。
- Relay、Secure Cookie、公共 Host 域名等配置覆盖可以正确生效。
- PostgreSQL 18 数据卷、Flyway V1 迁移和 Hibernate schema validation 均通过。
- Nginx 只暴露前端与 `/api/*` 反向代理；数据库仅绑定 loopback。

### 账户与会话

- 浏览器注册、重复邮箱拒绝、登录、错误凭据、当前会话、刷新、令牌轮换、注销和重新登录。
- HttpOnly access/refresh Cookie、可读 CSRF Cookie、`SameSite=Strict` 和生产 `Secure` 配置。
- 浏览器写请求缺少 CSRF 时拒绝；桌面 Bearer 调用不要求浏览器 CSRF。
- 桌面 access/refresh token 返回、轮换、旧 token 失效和注销失效。
- 账户显示名称更新。
- 会话数量上限及旧会话淘汰。

### 设备与桌面配对

- 设备列表、创建、改名、平台校验、数量上限和撤销。
- 设备与 Host 的账户归属隔离，其他账户无法读取或修改。
- 一次性配对码生成；生成新码使旧码失效；成功兑换后不能重放。
- 配对成功后只返回一次 `ccc_dev_...` 设备密钥，设备状态更新为 active。
- 被撤销设备不能重新配对，也不能重新启用关联 Host。

### OPENAI HOST 控制面

- 为账户自有设备分配不可预测且稳定的 `https://h-*.domain/v1` 地址。
- Host 列表、创建、改名、desired-online 更新、数量上限、停用和启用。
- Relay 关闭时 Host 不会被错误标记为 online。
- 停用状态拒绝不合法更新；撤销设备会同时停用关联 Host。
- Chrome 真实页面验证了停用、重新启用和再次停用。

### 输入和安全边界

- 非法 JSON、字段校验、超长 Unicode 密码、非法平台和非法 UUID 返回安全的 4xx 错误，而非 500。
- 登录敏感接口达到限制后返回 429 和 `Retry-After`。
- 配对码重放返回 401。
- CORS 仅允许精确配置的前端 Origin，并允许凭证；恶意 Origin 返回 403。
- CSP、`X-Frame-Options: DENY`、`nosniff`、Referrer Policy 和 Permissions Policy 已验证。

## 浏览器闭环

最终 E2E 顺序如下：

1. 打开 Nginx 提供的 React 生产页面。
2. 注册账户并进入控制台。
3. 创建设备并获得一次性配对码。
4. 创建 Host 并获得 OPENAI HOST 地址。
5. 模拟桌面端兑换配对码，验证设备密钥和 Host 地址一致。
6. 再次使用同一配对码，确认重放被拒绝。
7. 刷新控制台，确认设备 active。
8. 停用、启用并再次停用 Host。
9. 撤销设备。
10. 注销并重新登录，确认 revoked/disabled 状态由 PostgreSQL 持久保存。

成功截图由测试写入 `frontend/test-results/full-stack.png`，该目录已加入 `.gitignore`。

## 测试中发现并修复的问题

1. 非法 UUID 路径参数曾返回 500；现在返回 400 `INVALID_PARAMETER`。
2. PostgreSQL 18 的 Compose 数据卷挂载路径不正确；已改为 `/var/lib/postgresql`。
3. Spring Boot 4 未通过普通 Flyway 依赖启用自动配置；已使用 `spring-boot-starter-flyway`。
4. Flyway 的 `CHAR(64)` 与 JPA `VARCHAR(64)` schema validation 不一致；已统一为 `VARCHAR(64)`。
5. 浏览器 User-Agent 清洗正则曾触发 `PatternSyntaxException`；已改为安全的字面替换并加入回归测试。
6. OpenAPI 曾遗漏账户改名和设备改名两个 PATCH 接口；已补齐并增加契约测试。

## 复现命令

后端：

```powershell
cd backend
.\mvnw.cmd test
```

前端：

```powershell
cd frontend
npm install
npm test
npm run check
npm run build
```

完整 Docker/Chrome 闭环：

```powershell
Copy-Item .env.example .env
docker compose --env-file .env up -d --build
cd frontend
npm run test:e2e
```

E2E 默认访问 `http://localhost:8088`；其他端口可通过 `PLATFORM_E2E_URL` 指定。
