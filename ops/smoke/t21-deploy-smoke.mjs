#!/usr/bin/env node

const API_URL = stripTrailingSlash(requiredEnv('SMOKE_API_URL'));
const WEB_URL = stripTrailingSlash(requiredEnv('SMOKE_WEB_URL'));
const STRICT = process.env.SMOKE_STRICT === 'true';
const USERNAME = process.env.SMOKE_USERNAME;
const PASSWORD = process.env.SMOKE_PASSWORD;
const MODEL = process.env.SMOKE_MODEL;
const RUN_CHAT = process.env.SMOKE_RUN_CHAT === 'true';
const CHAT_BODY = process.env.SMOKE_CHAT_BODY;
const RECHARGE_CODE = process.env.SMOKE_RECHARGE_CODE;
const TEST_NOTIFICATION = process.env.SMOKE_TEST_NOTIFICATION === 'true';

const results = [];
let sessionCookie = null;
let apiKey = process.env.SMOKE_API_KEY || null;
let lastRequestId = null;

await check('api_health', async () => {
  const response = await http('GET', `${API_URL}/health`);
  assert(response.status === 200, `expected 200, got ${response.status}`);
  assert(response.json?.status === 'ok', 'health status is not ok');
});

await check('web_home', async () => {
  const response = await http('GET', WEB_URL);
  assert(response.status >= 200 && response.status < 400, `expected web 2xx/3xx, got ${response.status}`);
});

if (USERNAME && PASSWORD) {
  await check('login', async () => {
    const response = await http('POST', `${API_URL}/auth/login`, { username: USERNAME, password: PASSWORD });
    assert(response.status === 200 || response.status === 201, `expected login success, got ${response.status}`);
    sessionCookie = extractSessionCookie(response.headers);
    assert(sessionCookie, 'login did not return a session cookie');
  });
} else {
  skip('login', 'SMOKE_USERNAME/SMOKE_PASSWORD not set');
}

if (!apiKey && sessionCookie && MODEL) {
  await check('token_create', async () => {
    const response = await http(
      'POST',
      `${API_URL}/tokens`,
      { name: `deploy-smoke-${Date.now()}`, modelNames: [MODEL] },
      { cookie: sessionCookie }
    );
    assert(response.status === 200 || response.status === 201, `expected token create success, got ${response.status}`);
    apiKey = response.json?.apiKey;
    assert(apiKey, 'token create did not return apiKey');
  });
} else if (!apiKey) {
  skip('token_create', 'SMOKE_API_KEY not set and login/model are unavailable');
}

if (apiKey) {
  await check('v1_models', async () => {
    const response = await http('GET', `${API_URL}/v1/models`, undefined, { authorization: `Bearer ${apiKey}` });
    assert(response.status === 200, `expected models 200, got ${response.status}`);
    lastRequestId = response.headers.get('x-request-id');
    assert(lastRequestId, 'models response missing x-request-id');
    assert(Array.isArray(response.json?.data), 'models response data is not an array');
  });
} else {
  skip('v1_models', 'no API key available');
}

if (sessionCookie && lastRequestId) {
  await check('usage_trace', async () => {
    const response = await http('GET', `${API_URL}/usage/logs/${lastRequestId}/trace`, undefined, { cookie: sessionCookie });
    assert(response.status === 200, `expected trace 200, got ${response.status}`);
    assert(response.json?.requestId === lastRequestId, 'trace requestId mismatch');
    assert(response.json?.trace?.hasRequestLog === true, 'trace missing request log');
  });
} else {
  skip('usage_trace', 'login session and prior request_id are required');
}

if (RUN_CHAT && apiKey && (MODEL || CHAT_BODY)) {
  await check('v1_chat_completions', async () => {
    const body = CHAT_BODY
      ? JSON.parse(CHAT_BODY)
      : { model: MODEL, messages: [{ role: 'user', content: 'deployment smoke test' }] };
    const response = await http('POST', `${API_URL}/v1/chat/completions`, body, {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    });
    assert(response.status >= 200 && response.status < 300, `expected chat success, got ${response.status}`);
    assert(response.headers.get('x-request-id'), 'chat response missing x-request-id');
  });
} else {
  skip('v1_chat_completions', 'set SMOKE_RUN_CHAT=true plus SMOKE_API_KEY and SMOKE_MODEL/SMOKE_CHAT_BODY');
}

if (sessionCookie && RECHARGE_CODE) {
  await check('recharge_redeem', async () => {
    const response = await http('POST', `${API_URL}/recharge/redeem`, { code: RECHARGE_CODE }, { cookie: sessionCookie });
    assert(response.status >= 200 && response.status < 300, `expected recharge success, got ${response.status}`);
  });
} else {
  skip('recharge_redeem', 'SMOKE_RECHARGE_CODE not set or login unavailable');
}

if (sessionCookie && TEST_NOTIFICATION) {
  await check('notification_test_webhook', async () => {
    const response = await http('POST', `${API_URL}/notifications/test-webhook`, {}, { cookie: sessionCookie });
    assert(response.status >= 200 && response.status < 300, `expected notification test success, got ${response.status}`);
  });
} else {
  skip('notification_test_webhook', 'set SMOKE_TEST_NOTIFICATION=true after configuring a real notification channel');
}

const failed = results.filter((item) => item.status === 'fail');
const skipped = results.filter((item) => item.status === 'skip');
console.log(JSON.stringify({ ok: failed.length === 0 && (!STRICT || skipped.length === 0), strict: STRICT, results }, null, 2));

if (failed.length > 0 || (STRICT && skipped.length > 0)) {
  process.exit(1);
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'pass' });
  } catch (error) {
    results.push({ name, status: 'fail', error: error instanceof Error ? error.message : String(error) });
  }
}

function skip(name, reason) {
  results.push({ name, status: 'skip', reason });
}

async function http(method, url, body, headers = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      ...headers,
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, text, json };
}

function extractSessionCookie(headers) {
  return headers.get('set-cookie')?.split(';')[0] ?? null;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required`);
    process.exit(2);
  }
  return value;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
