# T22 M04 商家端用户管理页自检

日期：2026-06-16

## 范围

- 新增商家端独立页面 `/merchant/users`。
- 新增后台只读接口 `GET /admin/groups`。
- 用户列表继续来自真实 `GET /admin/users`。
- 用户分组变更继续走真实 `POST /admin/users/:id/group`。
- 普通用户仍不能访问商家端页面和后台用户接口。

## 真实数据来源

- 用户列表：`users`、`wallets`、`user_groups`。
- 分组列表：`user_groups`、`model_group_accesses` 计数。
- 分组更新：写入 `users.group_id`，并由后端记录 `admin_audit_logs`。
- 登录与权限：真实 `/auth/login`、真实 session cookie、真实 `/auth/me`。

没有新增 mock、fixture UI、硬编码业务结果或前端假用户。

## 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm run qa:t22:merchant-users`：通过。
- `npm run qa:t22:merchant-routing`：通过。
- `npm run qa:t22:merchant-shell`：通过。
- `npm run qa:t22:merchant-dashboard`：通过。
- 浏览器真实登录 `merchant_test_1 / merchant200611`：通过。

浏览器验证地址：

- API：`http://127.0.0.1:3102`
- Web：`http://127.0.0.1:3004`

截图：

- `.gstack/qa-reports/screenshots/t22-m04-users-desktop1920.png`
- `.gstack/qa-reports/screenshots/t22-m04-users-desktop1366.png`
- `.gstack/qa-reports/screenshots/t22-m04-users-mobile390.png`

## QA 覆盖

`qa:t22:merchant-users` 使用真实 Postgres 和真实 HTTP：

- 创建临时管理员、普通用户、两个用户分组和钱包。
- 管理员真实登录并读取 `/admin/users`。
- 管理员真实读取 `/admin/groups`。
- 普通用户访问 `/admin/users` 返回 403。
- 普通用户访问 `/admin/groups` 返回 403。
- 普通用户调用 `/admin/users/:id/group` 返回 401/403。
- 管理员调用 `/admin/users/:id/group` 成功。
- 重新读取 `/admin/users` 验证分组变更可见。
- 直接查询数据库验证 `users.group_id` 已持久化。
- 扫描响应，确认不包含 `passwordHash`、`tokenHash`、`encryptedApiKey`、`codeHash`、连接串等敏感文本。
- 清理临时用户、钱包、会话、审计日志和分组，残留为 0。

## 修复记录

- 第一次 QA 失败：运行中的旧 API 未包含 `/admin/groups`，导致 404。处理：启动最新 API 端口 `3102`，确认 Nest 路由已映射。
- 第二次 QA 失败：脚本把 POST 成功写死为 200，但 Nest 默认 POST 成功为 201。处理：断言调整为 2xx，符合真实 HTTP 成功语义。
- 浏览器第一次失败：登录页输入框没有 `name/placeholder`，脚本选择器不匹配。处理：改用真实 DOM 的 `autocomplete=username/current-password`。

## Review 结论

- 权限：新增 `/admin/groups` 位于 `AdminController`，继承 `AuthGuard + AdminGuard`。
- 数据：用户页所有列表和操作均来自真实 API；没有前端假数据兜底。
- 敏感字段：新增接口复用 `toPublicGroup`，不返回用户密码、token、上游密钥、充值码 hash 或连接串。
- 兼容性：旧 `/admin` 大页面保留，M01-M03 回归通过。
- UI：商家端固定导航保持；移动端无横向页面溢出，表格本身在容器内横向滚动。
