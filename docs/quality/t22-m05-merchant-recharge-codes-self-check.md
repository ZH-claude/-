# T22 M05 商家端充值码管理页自检

日期：2026-06-16

## 范围

- 新增商家端独立页面 `/merchant/recharge-codes`。
- 商家端导航“充值码”从旧 `/admin#merchant-recharge-codes` 切换到新页面。
- 继续复用真实后台接口 `GET/POST /admin/recharge-codes` 和 `POST /admin/recharge-codes/:id/disable`。
- 用户兑换继续走真实 `POST /recharge/redeem`。
- 旧 `/admin` 大页面保留兼容，不在本任务删除。

## 真实数据来源

- 充值码列表：`recharge_codes`、创建人 `users`、使用人 `users`、关联 `wallet_transactions`。
- 充值码生成：后端只在创建响应返回一次明文，数据库保存 `code_hash`。
- 充值码禁用：只允许未使用码变为 `DISABLED`。
- 用户兑换：事务内更新 `recharge_codes.status`、`wallets.balance_cents` 和 `wallet_transactions`。
- 页面鉴权：真实 HttpOnly session cookie 调用 `/auth/me`，普通用户不能渲染商家页。

没有新增 mock、fake、dummy、示例充值码或前端假列表。

## 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm run qa:t22:merchant-recharge-codes`：通过。
- `npm run qa:t22:merchant-routing`：通过。
- `npm run qa:t22:merchant-shell`：通过。
- `npm run qa:t22:merchant-dashboard`：通过。
- `npm run qa:t22:merchant-users`：通过。
- 浏览器真实登录 `merchant_test_1 / merchant200611`：通过。

浏览器验证地址：

- API：`http://127.0.0.1:3103`
- Web：`http://127.0.0.1:3005`

截图：

- `.gstack/qa-reports/screenshots/t22-m05-recharge-desktop1366.png`
- `.gstack/qa-reports/screenshots/t22-m05-recharge-mobile390.png`

## QA 覆盖

`qa:t22:merchant-recharge-codes` 使用真实 Postgres 和真实 HTTP：

- 创建临时后台账号、普通用户和钱包。
- 后台账号和普通用户均通过 `/auth/login` 获取真实 session cookie。
- 未登录访问 `/merchant/recharge-codes` 跳 `/login`。
- 普通用户访问 `/merchant/recharge-codes` 跳 `/account/profile`。
- 后台账号可渲染 `/merchant/recharge-codes`，页面包含商家 Shell、生成区和状态区。
- 普通用户访问 `/admin/recharge-codes` 创建、列表和禁用接口均返回 403。
- 后台账号真实生成充值码，并直接核对数据库只保存 `codeHash`，不保存明文码。
- 后台列表响应不包含 `code`、`codeHash`、`passwordHash`、`tokenHash`。
- 后台审计响应包含 `recharge_code_created`，但不包含明文充值码和 hash。
- 普通用户兑换一张充值码后，数据库余额增加，充值码状态变为 `USED`，`usedByUserId` 正确。
- 禁用已使用充值码失败或无副作用，最终状态仍为 `USED`。
- 禁用未使用充值码成功，之后普通用户兑换失败，余额不变。
- 充值记录响应不泄漏明文充值码、`codeHash`、`passwordHash`、`tokenHash`。
- 清理临时用户、钱包、会话、充值码、钱包交易、后台审计和安全审计，残留为 0。

## 修复记录

- 第一次 QA 失败：临时用户名超过真实后端 `3-32` 位规则，登录返回 400。处理：缩短 QA 用户名前缀，重跑通过，失败数据也清理为 0。
- 回归脚本第一次中断：`qa:t22:merchant-dashboard` 缺少 `UPSTREAM_KEY_ENCRYPTION_SECRET`。处理：补齐本地开发密钥环境变量后重跑 Dashboard 和 Users 通过。
- Web 验证第一次访问 `3004` 返回 404：旧 Web 服务未包含新页面。处理：启动当前构建到 `3005`，用当前 API `3103` 做真实浏览器验证。

## Review 结论

- 权限：新页面沿用 `requireMerchantProfile`，后台接口仍由 `AuthGuard + AdminGuard` 保护，普通用户脚本验证 403/跳转。
- 数据：页面所有业务数据来自真实 `admin-api` 请求，无前端构造的业务结果。
- 敏感字段：列表、审计和充值记录响应均扫描确认不返回明文充值码、`codeHash`、`tokenHash`、`passwordHash`。
- 事务一致性：兑换路径验证了充值码状态、钱包余额和钱包交易三者一致。
- 兼容性：旧 `/admin` 页面保留；M01-M04 回归通过。
