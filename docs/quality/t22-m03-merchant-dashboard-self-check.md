# T22 M03 商家端入口 Dashboard 自检

日期：2026-06-16

## 范围

- 本次只完成 M03：`/merchant` 商家端 Dashboard 和真实后台汇总接口。
- 不拆 M04-M08 的具体管理页，不把 M09/M10 标记为完成。
- 商家端账号仍使用 MVP 的 `ADMIN` 角色承载，未新增伪造角色。

## 真实数据来源

新增接口：`GET /admin/dashboard-summary`

接口由 `AuthGuard + AdminGuard` 保护，返回字段全部来自 Prisma 查询：
- 用户：未删除用户总数、活跃/禁用/风控、普通用户/后台账号、今日新增。
- 钱包：总余额、累计消费。
- 今日调用：调用次数、消费、token 总量、状态分布。
- 上游：启用/禁用、健康/异常/未知。
- 模型：公开模型、启用/停用模型、上游映射。
- 充值码：总数、未使用、已使用、已禁用。
- 最近告警：最近 24 小时 request log 异常和异常上游。

接口响应不包含 `passwordHash`、`tokenHash`、`encryptedApiKey`、`codeHash`、连接串或原始密钥。

## QA 结果

- `npm run qa:t22:merchant-dashboard`
  - 真实创建临时普通用户、后台用户、钱包、API token、上游、模型价格、上游模型映射、usage event、request log、充值码。
  - 通过真实 `/auth/login` 获取 session cookie。
  - 后台账号调用真实 `/admin/dashboard-summary` 返回 200。
  - 普通用户调用真实 `/admin/dashboard-summary` 返回 403。
  - 用数据库实时重算 expected summary，并与接口响应逐项比对一致。
  - 敏感字段扫描通过。
  - 清理后残留：users 0、sessions 0、wallets 0、apiTokens 0、usageEvents 0、requestLogs 0、upstreamProviders 0、upstreamModels 0、modelPrices 0、rechargeCodes 0。
- `npm run qa:t22:merchant-routing`
  - 已按新行为验证后台账号进入 `/merchant` Dashboard，普通用户仍回用户端。
  - 清理后 users/wallets/sessions/securityAuditLogs 均为 0。
- `npm run qa:t22:merchant-shell`
  - 已按新行为验证 `/merchant` Dashboard 和 `/admin` 商家 Shell。
  - 清理后 users/wallets/sessions/securityAuditLogs 均为 0。

## 浏览器验证

测试服务：
- API：`http://127.0.0.1:3101`
- Web：`http://127.0.0.1:3003`

真实登录账号：`merchant_test_1 / merchant200611`

视口：
- 1920 x 1080
- 1366 x 768
- 390 x 844

结果：
- 登录后进入 `/merchant`。
- 商家 Shell、商家固定导航和 Dashboard 指标区存在。
- 普通用户侧栏菜单未泄漏。
- 无横向溢出。
- 无 console error 和 page error。

截图：
- `.gstack/qa-reports/screenshots/t22-m03-dashboard-desktop1920.png`
- `.gstack/qa-reports/screenshots/t22-m03-dashboard-desktop1366.png`
- `.gstack/qa-reports/screenshots/t22-m03-dashboard-mobile390.png`

## 工程检查

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `git diff --check`：通过。
- 假数据扫描：新增产品代码未出现 mock/fake/dummy/sample 业务数据；QA 脚本使用真实数据库临时数据并清理。

## Review 结论

- 权限：Dashboard 汇总接口沿用后台控制器级 `AuthGuard + AdminGuard`，普通用户脚本验证 403。
- 数据一致性：QA 使用数据库实时重算值与接口响应逐项比对，不依赖假增量。
- 敏感信息：接口响应为白名单字段，不返回用户密码哈希、token hash、上游密钥、充值码 hash、连接串或原始快照。
- 兼容性：M01/M02 回归脚本已更新并通过，用户端分流和商家 Shell 未回归。
- 已修复的自检问题：最初 QA 用户名前缀过长导致登录 400；已缩短。最初 request log 残留统计使用行 id 匹配 requestId，已改为 requestId 白名单和前缀匹配。
