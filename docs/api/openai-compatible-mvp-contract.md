# OpenAI 兼容 API MVP 合约

状态：冻结草案  
所属任务：T02  
更新日期：2026-06-16

## 1. 基础约定

| 项 | 决策 |
| --- | --- |
| Base URL | `https://你的域名/v1` |
| 鉴权 | `Authorization: Bearer <用户 API Key>` |
| 请求格式 | JSON，保持 OpenAI 兼容字段 |
| 响应格式 | 默认透传 OpenAI 风格 JSON，错误统一包一层平台错误码 |
| 流式协议 | Server-Sent Events，`stream: true` 时透传 data chunk |
| 幂等标识 | 平台生成 `request_id`，未来可接受 `Idempotency-Key` |
| 超时 | 默认 120 秒，管理员可调整 |

## 2. MVP 支持接口

| 方法 | 路径 | MVP 状态 | 说明 |
| --- | --- | --- | --- |
| GET | `/v1/models` | 支持 | 返回当前用户分组可用模型 |
| POST | `/v1/chat/completions` | 支持 | 支持非流式和流式 |
| GET | `/health` | 内部支持 | 平台健康检查，不属于 OpenAI 兼容 API |

## 3. 暂不支持接口

| 路径 | 处理 |
| --- | --- |
| `/v1/embeddings` | 返回 `501 not_implemented` |
| `/v1/images/*` | 返回 `501 not_implemented` |
| `/v1/audio/*` | 返回 `501 not_implemented` |
| `/v1/files/*` | 返回 `501 not_implemented` |
| `/v1/batches/*` | 返回 `501 not_implemented` |
| `/v1/fine_tuning/*` | 返回 `501 not_implemented` |

## 4. `/v1/models`

### 请求

```http
GET /v1/models
Authorization: Bearer sk-your-key
```

### 响应

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-5.4",
      "object": "model",
      "owned_by": "nested-relay"
    }
  ]
}
```

### 规则

- 只返回用户分组可见且启用的模型。
- 如果模型在上游不可用但平台仍启用，返回列表中可以保留，但调用时需要给出明确错误。
- 不返回上游真实渠道 ID。
- 同样执行用户、令牌、IP 白名单、IP 限流和首次激活策略。

## 5. `/v1/chat/completions`

### 请求字段

| 字段 | MVP 支持 | 说明 |
| --- | --- | --- |
| `model` | 必填 | 平台模型名，后端映射到上游模型名 |
| `messages` | 必填 | OpenAI 兼容 message 数组 |
| `stream` | 支持 | `true` 时启用 SSE |
| `temperature` | 透传 | 不额外校验范围以外的 OpenAI 基础校验 |
| `max_tokens` | 透传 | 后续可做用户级上限 |
| `top_p` | 透传 | 透传上游 |
| `tools` | 透传 | 上游不支持时返回上游错误 |
| `tool_choice` | 透传 | 上游不支持时返回上游错误 |
| 其他字段 | 透传 | 记录字段白名单外内容但不写日志明文大字段 |

### 非流式响应

- 上游成功：透传主体，补充内部日志，不向用户暴露上游 Key。
- 上游失败：转换为统一错误，保留 `request_id`。
- 上游返回 malformed JSON：返回 `502 upstream_malformed_response`，不扣费。

### 流式响应

- 上游 chunk 原样转成 SSE 返回。
- 客户端断开：停止读取上游，记录 `client_aborted`。
- 上游中断：返回已收到 chunk，记录 `upstream_stream_interrupted`。
- 流式计费：优先使用上游 usage；如果上游没有 usage，则标记 `metering_unknown`，MVP 不扣费或按管理员配置的保守规则处理，默认不扣费。

## 6. 错误码

| HTTP | `code` | 触发条件 | 是否扣费 |
| --- | --- | --- | --- |
| 400 | `bad_request` | JSON 无效、缺少 model/messages | 否 |
| 401 | `invalid_api_key` | Key 不存在、hash 不匹配 | 否 |
| 403 | `token_disabled` | Key 被禁用或过期 | 否 |
| 403 | `model_not_allowed` | 用户分组或令牌不允许该模型 | 否 |
| 403 | `ip_not_allowed` | 请求 IP 不在令牌白名单 | 否 |
| 403 | `ip_required` | 令牌启用 IP 限流但服务端无法取得客户端 IP | 否 |
| 403 | `token_activation_expired` | 首次激活有效期已过 | 否 |
| 402 | `insufficient_balance` | 余额不足 | 否 |
| 408 | `upstream_timeout` | 上游超时 | 否 |
| 429 | `rate_limit_exceeded` | 用户、令牌、IP 或模型限流 | 否 |
| 429 | `risk_limit_exceeded` | 用户被风控锁定或近 5 分钟失败事件触发熔断 | 否 |
| 429 | `rate_limited` | 上游返回 429 限流错误 | 否 |
| 500 | `internal_error` | 平台未知错误 | 否 |
| 502 | `upstream_error` | 上游 5xx 或连接失败 | 否 |
| 502 | `upstream_malformed_response` | 上游返回无法解析 | 否 |
| 501 | `not_implemented` | MVP 暂不支持接口 | 否 |

错误响应格式：

```json
{
  "error": {
    "message": "Insufficient balance",
    "type": "billing_error",
    "code": "insufficient_balance",
    "request_id": "req_..."
  }
}
```

## 7. 重试和熔断

| 场景 | MVP 行为 |
| --- | --- |
| 上游连接失败 | 最多重试 1 次，仅限连接错误或 502/503/504 |
| 上游 4xx | 不重试，直接返回 |
| 流式响应已开始 | 不重试，避免重复输出和重复扣费 |
| 同一 request_id 已成功扣费 | 不重复扣费 |
| 上游连续失败 | 标记渠道 `degraded`，管理员后台可见 |

## 8. 日志和脱敏

- 不记录 `Authorization` 明文。
- 不记录上游 API Key。
- 用户 API Key 只存 hash，响应中只在创建时展示一次。
- 请求体可以记录摘要、模型、token、费用、状态；完整 messages 默认不入库，后续可做用户可选开关。
- 每次调用必须有 `request_id`，贯穿 request log、usage event、wallet transaction。

## 9. 兼容性验收

```bash
curl http://localhost:3001/health
curl http://localhost:3001/v1/models -H "Authorization: Bearer <用户Key>"
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer <用户Key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4","messages":[{"role":"user","content":"hello"}]}'
```

MVP 实现前，以上 `/v1/*` 接口可返回 `501 not_implemented`；进入 T08 后必须按本合约实现。
