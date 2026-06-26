import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = path.resolve(__dirname, '../../..');
const ROOT_PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const API_PACKAGE_PATH = path.join(ROOT_DIR, 'apps', 'api', 'package.json');
const RELEASE_GATE_SCRIPT_PATH = path.join(ROOT_DIR, 'apps', 'api', 'scripts', 'release-gate-qa.ts');
const RELEASE_GATE_DOC_PATH = path.join(ROOT_DIR, 'docs', 'quality', 'release-gate.md');
const PLAN_PATH = path.join(ROOT_DIR, 'docs', 'product', 'prelaunch-acceptance-plan.md');
const LAUNCH_DECISION_PATH = path.join(ROOT_DIR, 'docs', 'quality', 't23-m07-launch-decision-report.md');
const SELF_CHECK_PATH = path.join(ROOT_DIR, 'docs', 'quality', 't23-m08-final-fullstack-readiness-self-check.md');
const STRICT_SMOKE_TEMPLATE_PATH = path.join(ROOT_DIR, 'docs', 'quality', 'production-strict-smoke-evidence-template.json');

type PackageJson = {
  scripts?: Record<string, string>;
};

const checks: string[] = [];

async function main() {
  const rootPackage = parseJson(await readRequiredFile(ROOT_PACKAGE_PATH), ROOT_PACKAGE_PATH) as PackageJson;
  const apiPackage = parseJson(await readRequiredFile(API_PACKAGE_PATH), API_PACKAGE_PATH) as PackageJson;
  const releaseGateScript = await readRequiredFile(RELEASE_GATE_SCRIPT_PATH);
  const releaseGateDoc = await readRequiredFile(RELEASE_GATE_DOC_PATH);
  const plan = await readRequiredFile(PLAN_PATH);
  const launchDecision = await readRequiredFile(LAUNCH_DECISION_PATH);
  const selfCheck = await readRequiredFile(SELF_CHECK_PATH);
  const strictSmokeTemplate = parseJson(
    await readRequiredFile(STRICT_SMOKE_TEMPLATE_PATH),
    STRICT_SMOKE_TEMPLATE_PATH
  ) as Record<string, unknown>;

  assert(
    rootPackage.scripts?.['qa:t23:final-fullstack-readiness'] === 'npm --prefix apps/api run qa:t23:final-fullstack-readiness',
    'root package must expose qa:t23:final-fullstack-readiness'
  );
  assert(
    apiPackage.scripts?.['qa:t23:final-fullstack-readiness'] === 'tsx scripts/t23-final-fullstack-readiness-qa.ts',
    'api package must expose qa:t23:final-fullstack-readiness'
  );
  checks.push('final_fullstack_readiness_command_is_exposed');

  for (const marker of [
    'qa_t23_final_fullstack_readiness',
    "runCommand('qa_t23_final_fullstack_readiness'",
    "'qa:t23:final-fullstack-readiness'",
    'final_fullstack_readiness_requires_release_gate_manifest_and_browser_evidence',
    'final_fullstack_readiness_requires_structured_strict_smoke_evidence_template',
    'final_fullstack_readiness_blocks_production_completion_without_real_evidence'
  ]) {
    assertIncludes(releaseGateScript, marker, `release gate script must include ${marker}`);
  }
  checks.push('final_fullstack_readiness_is_part_of_release_gate');

  for (const marker of [
    'release_gate_required_checks_manifest',
    'release_gate_browser_artifacts_verified',
    'chrome_user_home_announcements_localized_smoke',
    'chrome_user_models_localized_no_source_leak_smoke',
    'chrome_user_profile_localized_no_source_leak_smoke',
    'chrome_merchant_dashboard_performance_smoke',
    'qa_t23_billing_reconciliation',
    'qa_t23_security_permissions',
    'qa_t23_ops_rehearsal',
    'qa_t32_enterprise_performance',
    'qa_language_catalog',
    'qa_i18n_content'
  ]) {
    assertIncludes(releaseGateScript, marker, `release gate script must preserve fullstack evidence marker ${marker}`);
    assertIncludes(releaseGateDoc, marker, `release gate doc must preserve fullstack evidence marker ${marker}`);
  }
  checks.push('final_fullstack_readiness_requires_release_gate_manifest_and_browser_evidence');

  for (const marker of [
    'npm run qa:t23:final-fullstack-readiness',
    'final_fullstack_readiness_requires_release_gate_manifest_and_browser_evidence',
    'final_fullstack_readiness_requires_structured_strict_smoke_evidence_template',
    'final_fullstack_readiness_blocks_production_completion_without_real_evidence'
  ]) {
    assertIncludes(releaseGateDoc, marker, `release gate doc must include final-fullstack marker ${marker}`);
    assertIncludes(plan, marker, `prelaunch plan must include final-fullstack marker ${marker}`);
    assertIncludes(selfCheck, marker, `M08 self-check must include final-fullstack marker ${marker}`);
  }
  checks.push('final_fullstack_readiness_is_documented_for_handoff');

  assert(
    strictSmokeTemplate.status === 'blocked_pending_real_production_strict_smoke',
    'production strict smoke evidence template must remain blocked until real production evidence exists'
  );
  assert(strictSmokeTemplate.capturedAt === null, 'production strict smoke evidence template must not contain fake capturedAt evidence');
  assertStrictSmokeEvidenceTemplateBlocksFalseCompletion(strictSmokeTemplate);
  checks.push('final_fullstack_readiness_requires_structured_strict_smoke_evidence_template');

  const combinedEvidence = `${releaseGateDoc}\n${plan}\n${launchDecision}\n${selfCheck}\n${JSON.stringify(strictSmokeTemplate)}`;
  for (const marker of [
    'real server, DNS, HTTPS, production `.env`, real upstream key, real payment, and real notification inputs exist',
    'production verification is still blocked',
    'This template is not evidence by itself.',
    'zero skips',
    'zero failures'
  ]) {
    assertIncludes(
      combinedEvidence,
      marker,
      `final fullstack readiness must preserve production blocker marker ${marker}`
    );
  }
  checks.push('final_fullstack_readiness_blocks_production_completion_without_real_evidence');

  for (const forbidden of [
    'production fullstack verification complete',
    'production full-stack verification complete',
    'production launch complete',
    'customer production launch approved',
    'real production strict smoke passed'
  ]) {
    assert(!releaseGateDoc.includes(forbidden), `release gate doc contains forbidden final overclaim: ${forbidden}`);
    assert(!plan.includes(forbidden), `prelaunch plan contains forbidden final overclaim: ${forbidden}`);
    assert(!launchDecision.includes(forbidden), `launch decision report contains forbidden final overclaim: ${forbidden}`);
  }
  checks.push('final_fullstack_readiness_rejects_false_production_overclaims');

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

async function readRequiredFile(filePath: string) {
  const info = await stat(filePath);
  assert(info.isFile() && info.size > 0, `required file is missing or empty: ${path.relative(ROOT_DIR, filePath)}`);
  return readFile(filePath, 'utf8');
}

function parseJson(text: string, filePath: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${path.relative(ROOT_DIR, filePath)} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertStrictSmokeEvidenceTemplateBlocksFalseCompletion(template: Record<string, unknown>) {
  assert(template.schemaVersion === 1, 'production strict smoke evidence template must keep schemaVersion 1');

  const environment = asRecord(template.environment, 'production strict smoke evidence template must include environment');
  assert(environment.apiUrl === null, 'production strict smoke evidence template must not contain fake apiUrl evidence');
  assert(environment.webUrl === null, 'production strict smoke evidence template must not contain fake webUrl evidence');
  assert(environment.gitRef === null, 'production strict smoke evidence template must not contain fake gitRef evidence');
  assert(environment.smokeStrict === true, 'production strict smoke evidence template must require smokeStrict=true');

  const requiredRealInputs = asRecord(
    template.requiredRealInputs,
    'production strict smoke evidence template must include requiredRealInputs'
  );
  assert(
    requiredRealInputs.smokeApiUrl === 'SMOKE_API_URL=https://api.example.com',
    'production strict smoke evidence template must keep placeholder SMOKE_API_URL'
  );
  assert(
    requiredRealInputs.smokeWebUrl === 'SMOKE_WEB_URL=https://app.example.com',
    'production strict smoke evidence template must keep placeholder SMOKE_WEB_URL'
  );
  for (const flag of [
    'smokeUsernameProvided',
    'smokePasswordProvided',
    'smokeModelProvided',
    'smokeRunChat',
    'smokeApiKeyProvided',
    'smokeRechargeCodeProvided',
    'smokeTestNotification'
  ]) {
    assert(requiredRealInputs[flag] === false, `production strict smoke evidence template must keep ${flag}=false`);
  }

  const requiredChecks = asRecord(template.requiredChecks, 'production strict smoke evidence template must include requiredChecks');
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
    const check = asRecord(requiredChecks[checkName], `production strict smoke evidence template must include ${checkName}`);
    assert(check.status === 'pending', `production strict smoke evidence template must keep ${checkName}.status pending`);
    assert(check.evidence === null, `production strict smoke evidence template must keep ${checkName}.evidence null`);
  }

  const strictSmokeCommand = String(template.strictSmokeCommand ?? '');
  for (const marker of [
    'SMOKE_API_URL=https://api.example.com',
    'SMOKE_WEB_URL=https://app.example.com',
    'SMOKE_USERNAME=<real-user>',
    'SMOKE_PASSWORD=<real-password>',
    'SMOKE_MODEL=<real-enabled-model>',
    'SMOKE_RUN_CHAT=true',
    'SMOKE_API_KEY=<real-api-key>',
    'SMOKE_RECHARGE_CODE=<real-unused-recharge-code>',
    'SMOKE_TEST_NOTIFICATION=true',
    'SMOKE_STRICT=true',
    'npm run smoke:t21:deploy'
  ]) {
    assertIncludes(strictSmokeCommand, marker, `production strict smoke command must include ${marker}`);
  }

  const expectedPassCondition = asRecord(
    template.expectedPassCondition,
    'production strict smoke evidence template must include expectedPassCondition'
  );
  assert(expectedPassCondition.ok === true, 'production strict smoke evidence template must require ok=true');
  assert(expectedPassCondition.strict === true, 'production strict smoke evidence template must require strict=true');
  assert(expectedPassCondition.skipCount === 0, 'production strict smoke evidence template must require skipCount=0');
  assert(expectedPassCondition.failCount === 0, 'production strict smoke evidence template must require failCount=0');

  assert(Array.isArray(template.forbiddenCompletionClaims), 'production strict smoke evidence template must include forbiddenCompletionClaims');
  const forbiddenCompletionClaims = template.forbiddenCompletionClaims.map(String);
  for (const forbidden of [
    'production strict smoke passed',
    'production is ready',
    'customer production launch approved',
    'zero skips verified',
    'real notification channel verified',
    'real recharge code verified'
  ]) {
    assert(
      forbiddenCompletionClaims.includes(forbidden),
      `production strict smoke evidence template must forbid false completion claim: ${forbidden}`
    );
  }
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), message);
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
