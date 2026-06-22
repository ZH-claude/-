# 支付接口接入清单

## 已预留接口

- 用户创建支付订单：`POST /recharge/payments/orders`
- 用户查看支付订单：`GET /recharge/payments/orders`
- 用户查看单个订单：`GET /recharge/payments/orders/:orderNo`
- 管理员模拟支付成功：`POST /admin/payment-orders/:orderNo/mock-success`
- 支付宝回调占位：`POST /payment-notify/alipay`
- 微信支付回调占位：`POST /payment-notify/wechat`
- Web 侧回调转发：`POST /api/payment-notify/alipay`、`POST /api/payment-notify/wechat`

## 明天需要准备

### 支付宝

- 支付宝开放平台应用 `APPID`
- 应用公钥证书或应用公钥
- 应用私钥
- 支付宝公钥证书或支付宝公钥
- 签名算法要求，优先 `RSA2`
- 网关地址，生产通常为 `https://openapi.alipay.com/gateway.do`
- 异步通知地址：`https://你的域名/api/payment-notify/alipay`
- 同步跳转地址，可选：`https://你的域名/account/topup/recharge`
- 产品权限：电脑网站支付或当面付，按最终收款方式选择

### 微信支付

- 微信支付商户号 `mchid`
- 商户 API v3 密钥
- 商户 API 证书序列号
- 商户私钥
- 平台证书或平台证书自动下载权限
- 关联应用 `appid`
- 回调通知地址：`https://你的域名/api/payment-notify/wechat`
- 产品权限：Native 支付或 JSAPI 支付，按最终页面形态选择

## 当前安全状态

- 真实支付宝/微信回调未验签前不会入账。
- 普通用户不能调用模拟支付成功。
- 管理员模拟成功只用于本地或内测验证，已走同一条钱包入账逻辑。
- 同一支付订单重复确认不会重复加余额。

## 余额口径

- 当前余额展示为人民币。
- 充值比例为 `¥1.00 -> 1,000,000` 内部计费单位，即页面显示到账 `¥1.00`。
- 单笔充值上限暂定 `¥2,000.00`，受当前数据库 `Int` 金额字段上限保护。
