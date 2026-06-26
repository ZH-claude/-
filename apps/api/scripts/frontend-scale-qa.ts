import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = path.resolve(__dirname, '../../..');
const checks: string[] = [];

async function main() {
  const adminController = await readProjectFile('apps/api/src/admin/admin.controller.ts');
  const adminService = await readProjectFile('apps/api/src/admin/admin.service.ts');
  const usageLogsService = await readProjectFile('apps/api/src/usage-logs/usage-logs.service.ts');
  const merchantDashboardView = await readProjectFile('apps/web/app/merchant/merchant-dashboard-view.tsx');
  const merchantUsersView = await readProjectFile('apps/web/app/merchant/users/merchant-users-view.tsx');
  const merchantRequestLogsView = await readProjectFile('apps/web/app/merchant/request-logs/merchant-request-logs-view.tsx');
  const userLogPage = await readProjectFile('apps/web/app/log/page.tsx');
  const releaseGate = await readProjectFile('apps/api/scripts/release-gate-qa.ts');
  const releaseGateDoc = await readProjectFile('docs/quality/release-gate.md');

  assertAdminListEndpointsClampPageSize(adminController);
  checks.push('admin_list_endpoints_clamp_page_size_to_100');

  assertAdminServiceUsesPaginatedQueries(adminService);
  checks.push('admin_service_list_queries_use_skip_take_and_capped_dashboard_lists');

  assertUsageLogsClampUserFacingLimits(usageLogsService);
  checks.push('usage_logs_user_tables_are_capped_to_100_rows');

  assertFrontendPageSizeConstant(merchantUsersView, 'USER_PAGE_LIMIT', 50);
  assert(merchantUsersView.includes('listAdminUsers({ page, limit: USER_PAGE_LIMIT })'), 'merchant users page must request paginated user rows with USER_PAGE_LIMIT');
  assert(merchantUsersView.includes('users.map((user)'), 'merchant users page should render only the paginated user page');
  checks.push('merchant_users_page_renders_only_paginated_rows');

  assertFrontendPageSizeConstant(merchantRequestLogsView, 'REQUEST_LOG_LIMIT', 50);
  assert(merchantRequestLogsView.includes('listAdminRequestLogs({'), 'merchant request log page must use the paginated request-log API');
  assert(merchantRequestLogsView.includes('limit: REQUEST_LOG_LIMIT'), 'merchant request log page must request REQUEST_LOG_LIMIT rows');
  assert(merchantRequestLogsView.includes('rows.map((entry)'), 'merchant request log page should render only the paginated rows');
  checks.push('merchant_request_log_page_renders_only_paginated_rows');

  assert(merchantDashboardView.includes('dailyReport?.days.slice(0, 7).map'), 'merchant dashboard must cap daily report rows to 7 days');
  assert(merchantDashboardView.includes('summary?.topUsers.map'), 'merchant dashboard top user table must use backend-capped topUsers only');
  checks.push('merchant_dashboard_renders_capped_summary_tables');

  assert(userLogPage.includes("limit: '50'"), 'user usage-log page should default to 50 rows');
  assert(
    userLogPage.includes("listTokenLeaderboard({ period: '7d', limit: 10 }, language)"),
    'user token leaderboard should request only 10 rows and carry the selected language'
  );
  assert(userLogPage.includes('displayRows.map((row)'), 'user usage-log page should render grouped rows from the capped API response');
  checks.push('user_console_log_page_uses_capped_rows_and_leaderboard');

  for (const phrase of [
    'qa:frontend-scale',
    'frontend_scale_pages_do_not_render_unbounded_1000_row_tables'
  ]) {
    assert(releaseGate.includes(phrase), `release-gate script missing ${phrase}`);
    assert(releaseGateDoc.includes(phrase), `release-gate doc missing ${phrase}`);
  }
  checks.push('release_gate_documents_and_runs_frontend_scale_guard');

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

async function readProjectFile(relativePath: string) {
  return readFile(path.join(ROOT_DIR, relativePath), 'utf8');
}

function assertAdminListEndpointsClampPageSize(text: string) {
  const limitedEndpointMatches = text.match(/const limit = this\.parsePositiveInt\(limitValue, 20, 100\);/g) ?? [];
  assert(
    limitedEndpointMatches.length >= 5,
    `admin list endpoints should clamp page size to 100 in at least five places, got ${limitedEndpointMatches.length}`
  );
}

function assertAdminServiceUsesPaginatedQueries(text: string) {
  for (const phrase of [
    'const skip = (page - 1) * limit',
    'take: limit',
    'page,',
    'limit'
  ]) {
    assert(text.includes(phrase), `admin service missing pagination phrase: ${phrase}`);
  }

  assert(text.includes('.slice(0, 10)'), 'merchant dashboard topUsers must be capped to 10 before fetching users');
  assert(
    text.includes('.slice(0, DASHBOARD_RECENT_ALERT_LIMIT)'),
    'merchant dashboard recent alerts must be capped before rendering'
  );
}

function assertUsageLogsClampUserFacingLimits(text: string) {
  assert(readNumericConst(text, 'DEFAULT_LIMIT') === 50, 'usage log default limit should be 50');
  assert(readNumericConst(text, 'MAX_LIMIT') === 100, 'usage log max limit should be 100');
  assert(text.includes('take: filters.limit'), 'usage log query must use normalized capped filters.limit');
  assert(text.includes('take: limit'), 'token leaderboard query must use normalized capped limit');
}

function assertFrontendPageSizeConstant(text: string, name: string, maxValue: number) {
  const value = readNumericConst(text, name);
  assert(value > 0 && value <= maxValue, `${name} should be between 1 and ${maxValue}, got ${value}`);
}

function readNumericConst(text: string, name: string) {
  const match = text.match(new RegExp(`const\\s+${escapeRegExp(name)}\\s*=\\s*(\\d+)\\s*;`));
  assert(match, `missing numeric const ${name}`);
  return Number(match[1]);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
