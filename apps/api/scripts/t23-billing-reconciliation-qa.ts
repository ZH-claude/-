import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = path.resolve(__dirname, '../../..');
const ROOT_PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const API_PACKAGE_PATH = path.join(ROOT_DIR, 'apps', 'api', 'package.json');
const RELEASE_GATE_SCRIPT_PATH = path.join(ROOT_DIR, 'apps', 'api', 'scripts', 'release-gate-qa.ts');
const RELEASE_GATE_DOC_PATH = path.join(ROOT_DIR, 'docs', 'quality', 'release-gate.md');
const SELF_CHECK_PATH = path.join(ROOT_DIR, 'docs', 'quality', 't23-m03-billing-reconciliation-self-check.md');
const PLAN_PATH = path.join(ROOT_DIR, 'docs', 'product', 'prelaunch-acceptance-plan.md');

const checks: string[] = [];

async function main() {
  const rootPackage = parsePackage(await readRequiredFile(ROOT_PACKAGE_PATH), ROOT_PACKAGE_PATH);
  const apiPackage = parsePackage(await readRequiredFile(API_PACKAGE_PATH), API_PACKAGE_PATH);
  const releaseGateScript = await readRequiredFile(RELEASE_GATE_SCRIPT_PATH);
  const releaseGateDoc = await readRequiredFile(RELEASE_GATE_DOC_PATH);
  const selfCheck = await readRequiredFile(SELF_CHECK_PATH);
  const plan = await readRequiredFile(PLAN_PATH);

  assert(
    rootPackage.scripts?.['qa:t23:billing-reconciliation'] === 'npm --prefix apps/api run qa:t23:billing-reconciliation',
    'root package must expose qa:t23:billing-reconciliation'
  );
  assert(
    apiPackage.scripts?.['qa:t23:billing-reconciliation'] === 'tsx scripts/t23-billing-reconciliation-qa.ts',
    'api package must expose qa:t23:billing-reconciliation'
  );
  checks.push('billing_reconciliation_command_is_exposed');

  for (const command of [
    'npm run qa:t23:billing-reconciliation',
    'npm run qa:t23:route-metering',
    'npm run qa:t25:stream-billing-guard',
    'npm run qa:t26:payment-orders',
    'npm run qa:t27:model-experience'
  ]) {
    assertIncludes(selfCheck, command, `M03 self-check must list ${command}`);
    assertIncludes(releaseGateDoc, command, `release gate documentation must list ${command}`);
  }
  checks.push('billing_reconciliation_documents_required_subchecks');

  for (const marker of [
    'qa_t23_billing_reconciliation',
    "runCommand('qa_t23_billing_reconciliation'",
    "'qa:t23:billing-reconciliation'",
    'billing_reconciliation_release_gate_covers_route_stream_payment_and_experience'
  ]) {
    assertIncludes(releaseGateScript, marker, `release gate script must include ${marker}`);
  }
  checks.push('billing_reconciliation_release_gate_script_runs_hard_gate');

  for (const marker of [
    'qa_t23_billing_reconciliation',
    'billing_reconciliation_release_gate_covers_route_stream_payment_and_experience',
    'local real-flow check',
    'production verification is still blocked'
  ]) {
    assertIncludes(selfCheck, marker, `M03 self-check must include ${marker}`);
    assertIncludes(releaseGateDoc, marker, `release gate documentation must include ${marker}`);
  }
  checks.push('billing_reconciliation_release_gate_covers_route_stream_payment_and_experience');

  for (const marker of [
    'docs/quality/t23-m03-billing-reconciliation-self-check.md',
    'npm run qa:t23:billing-reconciliation',
    'production verification is still blocked'
  ]) {
    assertIncludes(plan, marker, `prelaunch plan must include M03 marker: ${marker}`);
  }
  checks.push('prelaunch_plan_records_m03_billing_reconciliation_status');

  for (const forbidden of [
    'production billing reconciliation is complete',
    'real payment reconciliation is complete',
    'real upstream billing reconciliation is complete'
  ]) {
    assert(!selfCheck.includes(forbidden), `M03 self-check contains forbidden production overclaim: ${forbidden}`);
    assert(!plan.includes(forbidden), `prelaunch plan contains forbidden production overclaim: ${forbidden}`);
  }
  checks.push('billing_reconciliation_rejects_false_production_completion_claims');

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

async function readRequiredFile(filePath: string) {
  const info = await stat(filePath);
  assert(info.isFile() && info.size > 0, `required file is missing or empty: ${path.relative(ROOT_DIR, filePath)}`);
  return readFile(filePath, 'utf8');
}

function parsePackage(text: string, filePath: string) {
  try {
    return JSON.parse(text) as { scripts?: Record<string, string> };
  } catch (error) {
    throw new Error(`${path.relative(ROOT_DIR, filePath)} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
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
