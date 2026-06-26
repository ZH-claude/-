import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = path.resolve(__dirname, '../../..');
const REPORT_PATH = path.join(ROOT_DIR, 'docs', 'quality', 't23-m07-launch-decision-report.md');
const PLAN_PATH = path.join(ROOT_DIR, 'docs', 'product', 'prelaunch-acceptance-plan.md');
const RELEASE_GATE_PATH = path.join(ROOT_DIR, 'docs', 'quality', 'release-gate.md');

const checks: string[] = [];

async function main() {
  const report = await readRequiredFile(REPORT_PATH);
  const plan = await readRequiredFile(PLAN_PATH);
  const releaseGate = await readRequiredFile(RELEASE_GATE_PATH);

  assertIncludes(report, '结论：暂缓生产上线；可继续受控内测', 'launch decision must not approve production');
  assertIncludes(report, '不能开放给客户作为正式生产服务', 'launch decision must block public customer production use');
  checks.push('launch_decision_blocks_production_and_allows_controlled_internal_trial_only');

  for (const marker of [
    'M02 生产 strict smoke',
    'M03 账单与余额核对',
    'M04 压测与限流基线',
    'M05 安全与权限复核',
    'M06 运维演练',
    'npm run qa:t23:route-metering',
    'npm run qa:t32:enterprise-performance',
    'npm run qa:t23:security-permissions',
    'npm run qa:t23:ops-rehearsal',
    'npm run qa:release-gate'
  ]) {
    assertIncludes(report, marker, `launch decision report must include evidence marker: ${marker}`);
  }
  checks.push('launch_decision_summarizes_m02_to_m06_evidence');

  for (const blocker of [
    '无真实云服务器 SSH',
    '无正式域名 DNS',
    '无生产 `.env`',
    '无真实上游 Key',
    '无真实 smoke 账号',
    '无真实通知渠道',
    '真实支付回调未验签',
    '外部监控未配置'
  ]) {
    assertIncludes(report, blocker, `launch decision report must list blocker: ${blocker}`);
  }
  checks.push('launch_decision_lists_p0_p1_external_blockers');

  for (const boundary of [
    '真实上游未接入生产',
    '真实支付未接入生产',
    '真实通知未接入生产',
    '外部监控未接入生产',
    '真实生产恢复演练未完成'
  ]) {
    assertIncludes(report, boundary, `launch decision report must state unfinished boundary: ${boundary}`);
  }
  checks.push('launch_decision_does_not_fake_upstream_payment_notification_monitoring_or_restore');

  const forbiddenPhrases = [
    '结论：可以生产上线',
    '生产上线完成',
    '可以开放给客户作为正式生产服务',
    '真实上游已接入生产',
    '真实支付已接入生产',
    '真实通知已接入生产',
    '外部监控已接入生产',
    '真实生产恢复演练已完成',
    'P0/P1 阻塞项已全部关闭'
  ];
  for (const phrase of forbiddenPhrases) {
    assert(!report.includes(phrase), `launch decision report contains forbidden overclaim: ${phrase}`);
  }
  checks.push('launch_decision_rejects_false_production_ready_claims');

  for (const planMarker of [
    'docs/quality/t23-m07-launch-decision-report.md',
    'npm run qa:t23:launch-decision'
  ]) {
    assertIncludes(plan, planMarker, `prelaunch plan must include M07 marker: ${planMarker}`);
  }
  checks.push('prelaunch_plan_records_m07_local_decision_status');

  for (const gateMarker of [
    'npm run qa:t23:launch-decision',
    'qa_t23_launch_decision',
    'launch_decision_blocks_production_and_allows_controlled_internal_trial_only'
  ]) {
    assertIncludes(releaseGate, gateMarker, `release gate documentation must include launch-decision marker: ${gateMarker}`);
  }
  checks.push('release_gate_documents_launch_decision_hard_gate');

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

async function readRequiredFile(filePath: string) {
  const info = await stat(filePath);
  assert(info.isFile() && info.size > 0, `required file is missing or empty: ${path.relative(ROOT_DIR, filePath)}`);
  return readFile(filePath, 'utf8');
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
