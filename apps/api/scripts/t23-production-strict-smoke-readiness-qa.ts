import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = path.resolve(__dirname, '../../..');
const SMOKE_PATH = path.join(ROOT_DIR, 'ops', 'smoke', 't21-deploy-smoke.mjs');
const DEPLOYMENT_DOC_PATH = path.join(ROOT_DIR, 'docs', 'deployment', 'cloud-server-deployment.md');
const PLAN_PATH = path.join(ROOT_DIR, 'docs', 'product', 'prelaunch-acceptance-plan.md');
const RELEASE_GATE_PATH = path.join(ROOT_DIR, 'docs', 'quality', 'release-gate.md');
const SELF_CHECK_PATH = path.join(ROOT_DIR, 'docs', 'quality', 't23-m02-production-strict-smoke-readiness-self-check.md');
const EVIDENCE_TEMPLATE_PATH = path.join(ROOT_DIR, 'docs', 'quality', 'production-strict-smoke-evidence-template.json');

const checks: string[] = [];

async function main() {
  const smoke = await readRequiredFile(SMOKE_PATH);
  const deploymentDoc = await readRequiredFile(DEPLOYMENT_DOC_PATH);
  const plan = await readRequiredFile(PLAN_PATH);
  const releaseGate = await readRequiredFile(RELEASE_GATE_PATH);
  const selfCheck = await readRequiredFile(SELF_CHECK_PATH);
  const evidenceTemplate = parseEvidenceTemplate(await readRequiredFile(EVIDENCE_TEMPLATE_PATH));

  for (const marker of [
    "const API_URL = stripTrailingSlash(requiredEnv('SMOKE_API_URL'))",
    "const WEB_URL = stripTrailingSlash(requiredEnv('SMOKE_WEB_URL'))",
    "const STRICT = process.env.SMOKE_STRICT === 'true'",
    'failed.length > 0 || (STRICT && skipped.length > 0)',
    'process.exit(1)'
  ]) {
    assertIncludes(smoke, marker, `deploy smoke script must include strict-mode marker: ${marker}`);
  }
  checks.push('production_strict_smoke_requires_urls_and_fails_on_skip_or_fail');

  for (const checkName of [
    'api_health',
    'web_home',
    'login',
    'token_create',
    'v1_models',
    'usage_trace',
    'v1_chat_completions',
    'recharge_redeem',
    'notification_test_webhook'
  ]) {
    assertIncludes(smoke, checkName, `deploy smoke script must cover ${checkName}`);
  }
  checks.push('production_strict_smoke_covers_core_customer_and_operator_flows');

  for (const inputName of [
    'SMOKE_API_URL',
    'SMOKE_WEB_URL',
    'SMOKE_USERNAME',
    'SMOKE_PASSWORD',
    'SMOKE_MODEL',
    'SMOKE_RUN_CHAT',
    'SMOKE_API_KEY',
    'SMOKE_RECHARGE_CODE',
    'SMOKE_TEST_NOTIFICATION',
    'SMOKE_STRICT=true'
  ]) {
    assertIncludes(smoke, inputName.replace('=true', ''), `deploy smoke script must support ${inputName}`);
    assertIncludes(deploymentDoc, inputName, `deployment guide must document ${inputName}`);
  }
  checks.push('production_strict_smoke_documents_required_real_inputs');

  assertStrictSmokeEvidenceTemplateBlocksFalseCompletion(evidenceTemplate);
  assertIncludes(
    releaseGate,
    'docs/quality/production-strict-smoke-evidence-template.json',
    'release gate must reference the production strict smoke evidence template'
  );
  assertIncludes(
    selfCheck,
    'production-strict-smoke-evidence-template.json',
    'M02 self-check must reference the production strict smoke evidence template'
  );
  checks.push('production_strict_smoke_evidence_template_requires_real_zero_skip_run');

  for (const marker of [
    'SMOKE_STRICT=true',
    'skip',
    'fail',
    'SMOKE_RUN_CHAT',
    'SMOKE_RECHARGE_CODE',
    'SMOKE_TEST_NOTIFICATION'
  ]) {
    assertIncludes(deploymentDoc, marker, `deployment guide must preserve strict smoke rule marker: ${marker}`);
  }
  checks.push('deployment_guide_preserves_strict_smoke_no_fake_pass_rules');

  for (const planMarker of [
    'M02 生产 strict smoke 准备',
    '状态：准备项已完成；真实执行仍受 T21 外部条件阻塞',
    'docs/quality/t23-m02-production-strict-smoke-readiness-self-check.md',
    'npm run qa:t23:production-strict-smoke-readiness',
    '真实执行仍需要云服务器、正式域名、HTTPS、生产 `.env`、真实上游 Key、真实 smoke 账号、真实余额、真实充值码和真实通知渠道'
  ]) {
    assertIncludes(plan, planMarker, `prelaunch plan must include M02 readiness marker: ${planMarker}`);
  }
  checks.push('prelaunch_plan_records_m02_readiness_without_claiming_execution');

  for (const gateMarker of [
    'npm run qa:t23:production-strict-smoke-readiness',
    'qa_t23_production_strict_smoke_readiness',
    'production_strict_smoke_requires_urls_and_fails_on_skip_or_fail'
  ]) {
    assertIncludes(releaseGate, gateMarker, `release gate documentation must include strict-smoke marker: ${gateMarker}`);
  }
  checks.push('release_gate_documents_production_strict_smoke_readiness');

  for (const phrase of [
    '状态：已完成生产 strict smoke',
    '状态：生产 strict smoke 已通过',
    '结论：生产 strict smoke 已通过',
    '真实生产 smoke 已完成',
    'M02 生产 strict smoke 准备\n\n状态：已完成'
  ]) {
    assert(!plan.includes(phrase), `prelaunch plan contains forbidden M02 overclaim: ${phrase}`);
  }
  checks.push('production_strict_smoke_readiness_rejects_false_execution_claims');

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

async function readRequiredFile(filePath: string) {
  const info = await stat(filePath);
  assert(info.isFile() && info.size > 0, `required file is missing or empty: ${path.relative(ROOT_DIR, filePath)}`);
  return readFile(filePath, 'utf8');
}

function parseEvidenceTemplate(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`production strict smoke evidence template must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertStrictSmokeEvidenceTemplateBlocksFalseCompletion(template: Record<string, unknown>) {
  assert(template.schemaVersion === 1, 'production strict smoke evidence template must declare schemaVersion 1');
  assert(
    template.status === 'blocked_pending_real_production_strict_smoke',
    'production strict smoke evidence template must stay blocked until real evidence is captured'
  );
  assert(template.capturedAt === null, 'production strict smoke evidence template capturedAt must be null before real evidence exists');

  const environment = recordValue(template.environment, 'environment');
  assert(environment.apiUrl === null, 'production strict smoke template apiUrl must default to null');
  assert(environment.webUrl === null, 'production strict smoke template webUrl must default to null');
  assert(environment.smokeStrict === true, 'production strict smoke template must require smokeStrict=true');

  const inputs = recordValue(template.requiredRealInputs, 'requiredRealInputs');
  for (const key of [
    'smokeUsernameProvided',
    'smokePasswordProvided',
    'smokeModelProvided',
    'smokeRunChat',
    'smokeApiKeyProvided',
    'smokeRechargeCodeProvided',
    'smokeTestNotification'
  ]) {
    assert(inputs[key] === false, `production strict smoke template ${key} must default to false`);
  }

  const requiredChecks = recordValue(template.requiredChecks, 'requiredChecks');
  for (const checkName of [
    'api_health',
    'web_home',
    'login',
    'token_create',
    'v1_models',
    'usage_trace',
    'v1_chat_completions',
    'recharge_redeem',
    'notification_test_webhook'
  ]) {
    const check = recordValue(requiredChecks[checkName], `requiredChecks.${checkName}`);
    assert(check.status === 'pending', `production strict smoke template ${checkName} must default to pending`);
    assert(check.evidence === null, `production strict smoke template ${checkName} evidence must default to null`);
  }

  const passCondition = recordValue(template.expectedPassCondition, 'expectedPassCondition');
  assert(passCondition.ok === true, 'production strict smoke template expected pass ok must be true');
  assert(passCondition.strict === true, 'production strict smoke template expected pass strict must be true');
  assert(passCondition.skipCount === 0, 'production strict smoke template expected pass skipCount must be 0');
  assert(passCondition.failCount === 0, 'production strict smoke template expected pass failCount must be 0');

  const serialized = JSON.stringify(template);
  for (const marker of [
    'SMOKE_API_URL=https://api.example.com',
    'SMOKE_WEB_URL=https://app.example.com',
    'SMOKE_RUN_CHAT=true',
    'SMOKE_RECHARGE_CODE=<real-unused-recharge-code>',
    'SMOKE_TEST_NOTIFICATION=true',
    'SMOKE_STRICT=true',
    'zero skips',
    'zero failures',
    'This template is not evidence by itself.'
  ]) {
    assertIncludes(serialized, marker, `production strict smoke evidence template missing marker: ${marker}`);
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function assertIncludes(text: string, needle: string, message: string) {
  assert(text.includes(needle), message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
