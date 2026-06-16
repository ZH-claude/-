# T22 M02 商家端 Shell 与固定导航自检

日期：2026-06-16

## 范围

- 本次只完成 M02：商家端 Shell、固定顶部栏、左侧固定栏、`/admin` 接入商家导航和真实审计入口。
- 不把 M03 Dashboard 聚合接口、M04-M08 页面拆分、M09 全量回归和 M10 部署文档标记为完成。
- 商家端仍使用 MVP 的 `ADMIN` 角色承载，未伪造 `MERCHANT` 数据库角色。

## 真实数据验证

- `npm run qa:t22:merchant-routing`
  - 真实 Postgres 临时创建普通用户和商家账号。
  - 通过真实 `/auth/login`、真实 session cookie、真实 `/merchant` 重定向、真实 `/admin/users` 权限验证。
  - 清理后残留：users 0、wallets 0、sessions 0、securityAuditLogs 0。
- `npm run qa:t22:merchant-shell`
  - 真实 Postgres 临时创建普通用户和后台账号。
  - 验证真实 `/auth/me`、真实 `/merchant` 分流、真实 `/admin` 页面、后台 API 权限隔离、数据库钱包和会话一致性。
  - 清理后残留：users 0、wallets 0、sessions 0、securityAuditLogs 0。
- `npm run seed:merchant-test-accounts`
  - 确认 3 个真实商家测试账号存在：`merchant_test_1`、`merchant_test_2`、`merchant_test_3`。

## 浏览器 QA

测试地址：`http://127.0.0.1:3002`

真实登录账号：`merchant_test_1 / MERCHANT_TEST_PASSWORD`

视口：
- 1920 x 1080
- 1366 x 768
- 390 x 844

结果：
- 商家端 Shell 渲染成功。
- 顶部导航和商家侧栏渲染成功。
- 普通用户侧栏菜单未出现在商家端。
- 1920 和 1366 下侧栏为 sticky；390 下侧栏切换为横向条，不与顶部栏重叠。
- 无横向溢出。
- 无 console error 和 page error。

截图：
- `.gstack/qa-reports/screenshots/t22-m02-desktop1920.png`
- `.gstack/qa-reports/screenshots/t22-m02-desktop1366.png`
- `.gstack/qa-reports/screenshots/t22-m02-mobile390.png`

## 工程检查

- `npm run typecheck`：通过。
- `npm run build`：通过，API 和 Web 均完成生产构建。
- `git diff --check`：通过。
- 假数据扫描：新增/改动代码未出现 `mock`、`fake`、`fixture`、`dummy`、`sample` 等测试数据伪装；仅存在表单输入框 `placeholder` 文案。

## Review 结论

- 权限边界：普通用户仍不能访问后台 API，脚本验证 `/admin/users` 返回 403。
- 数据来源：审计、用户、充值码、模型、上游、公告均来自真实后端接口；没有在前端构造业务结果。
- 数据泄漏：新增审计表只展示动作、目标类型、目标 ID、账号、IP 和时间，不展示敏感哈希、密钥、连接串或快照。
- 兼容性：用户端登录分流、商家端登录分流和 `/merchant` 入口保持兼容。
- 后续风险：M02 只提供商家端 Shell 和入口锚点，`令牌入口`、`请求日志`、`绘图日志` 仍指向现有页面；真正商家端拆页和日志能力对齐留给 M04-M08。
