# T22 M09 角色隔离与端到端回归自检

日期：2026-06-16

结论：通过。第 9 项已完成双端角色隔离、真实数据互通和端到端回归检查；第 10 项收尾文档与部署检查尚未开始。

## 完成内容

- 新增第 9 项真实互通检查命令：`npm run qa:t22:merchant-role-isolation`。
- 旧 `/admin` 兼容页已改为服务端角色保护，普通用户不能先看到商家页壳再被拦截。
- 修复无效上游健康检查返回 500 的问题：无效编号现在返回正常业务错误。
- 补强用户分组调整的无效编号校验，避免同类后台内部错误。
- 修复手机宽度下商家端重复导航问题，只保留一排可横向访问的商家菜单。

## 真实数据检查

- `npm run qa:t22:merchant-role-isolation` 通过。
- 检查脚本临时创建 1 个普通用户和 1 个商家账号，并创建真实钱包。
- 通过真实登录拿到真实会话，再分别验证用户端和商家端。
- 已验证商家账号登录后进入商家端，普通用户登录后进入账户中心。
- 已验证普通用户无法访问任一商家端页面。
- 已验证普通用户无法调用后台能力；未登录返回 401，普通用户返回 403。
- 已验证商家账号可访问后台能力：用户、充值码、分组、模型、上游、公告、审计、请求日志、绘图日志和服务状态。
- 已验证用户端能力仍可用：账户、充值、令牌、日志、价格、模型、通知、绘图和服务状态。
- 清理结果：临时用户、钱包、会话和安全审计残留均为 0。

## 页面检查

- `npm run typecheck` 通过。
- `npm run build` 通过。
- 本地 Chrome 真实注册普通用户并真实登录。
- 本地 Chrome 真实登录商家账号：`merchant_test_1 / MERCHANT_TEST_PASSWORD`。
- 已验证用户端页面：`/account/profile`、`/account/topup/recharge`、`/token`、`/log`、`/account/pricing`、`/groupAvailability`、`/account/notificationSettings`、`/midjourney`、`/uptimeStatus`。
- 已验证商家端页面：`/merchant`、`/admin`、`/merchant/users`、`/merchant/recharge-codes`、`/merchant/model-config`、`/merchant/announcements`、`/merchant/audit`、`/merchant/service-status`、`/merchant/request-logs`、`/merchant/drawing-logs`。
- 已验证宽度：1366 和 390。
- 页面结果：无控制台错误、无 500、无横向页面溢出；商家端没有普通用户菜单泄漏，用户端没有商家壳泄漏。
- 截图证据：`.gstack/qa-reports/screenshots/t22-m09-*.png`，共 38 张。

## Review 结论

- 权限边界：商家端页面和后台能力继续由真实登录态和后台角色保护，普通用户不能访问。
- 数据真实性：本轮检查使用真实数据库、真实登录、真实会话、真实钱包和真实接口，没有用假数据填充通过。
- 兼容性：用户端核心路径和商家端核心路径都已跑通，旧 `/admin` 兼容页仍可给商家账号使用，但普通用户不能访问。
- 稳定性：本轮发现的后台 500 已修复，并通过第 9 项检查复测。

## 副手复核

- 已尝试调用 Codex GPT-5.3-Codex-Spark 副手做只读复核。
- 副手未完成，原因是等待结果超时。
- 本轮最终计划、实现、检查和审查结论由主 Codex 本地完成。

## 剩余边界

- 当前仍是 MVP 的单平台老板模式，商家端账号由 `ADMIN` 承载。
- 多商家各自独立上游密钥、客户按商家归属转发，仍属于商用升级计划，未在第 9 项中实现。
- 第 10 项收尾、文档与部署检查仍待执行。
