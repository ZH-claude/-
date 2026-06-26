import { PrismaPg } from '@prisma/adapter-pg';
import { hash as bcryptHash } from 'bcryptjs';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat as fsStat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ApiTokenStatus,
  AiRechargeProductKind,
  AiRechargeProductStatus,
  AnnouncementCategory,
  AnnouncementStatus,
  ModelPricingMode,
  ModelStatus,
  PrismaClient,
  RechargeCodeKind,
  RechargeCodeStatus,
  UpstreamProviderKind,
  UpstreamProviderStatus,
  UserRole,
  UserStatus,
  UsageEventStatus,
  WalletTransactionType
} from '../src/generated/prisma/client';

type CdpEvent = {
  method?: string;
  params?: Record<string, unknown>;
};

type CdpResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const ROOT_DIR = path.resolve(__dirname, '../../..');
const ARTIFACT_DIR = path.join(ROOT_DIR, '.gstack', 'qa-reports', 'release-gate');
const DEFAULT_DATABASE_URL = 'postgresql://nested_relay:change-me@localhost:5432/nested_relay?schema=public';
const USE_EXISTING_SERVICES = process.env.RELEASE_GATE_USE_EXISTING_SERVICES === 'true';
let API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3011';
let WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3010';
let DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
let PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL ?? WEB_BASE_URL;
const DEFAULT_CDP_COMMAND_TIMEOUT_MS = 30_000;

let gateEnv = buildGateEnv();

const checks: string[] = [];
const REQUIRED_RELEASE_GATE_CHECKS = [
  'git_diff_check',
  'typecheck',
  'build',
  'release_gate_documentation_contract',
  'api_health_200',
  'web_homepage_200',
  'qa_t12_pricing',
  'qa_t18_rate_limits',
  'qa_t29_relay_cost_guard',
  'qa_t23_route_metering',
  'qa_t23_billing_reconciliation',
  'qa_t25_stream_billing_guard',
  'qa_t26_payment_orders',
  'qa_t27_model_experience',
  'qa_t28_site_content',
  'qa_t22_merchant_model_config',
  'qa_t22_merchant_recharge_codes',
  'qa_t22_merchant_announcements_audit',
  'qa_t22_merchant_dashboard',
  'qa_t22_merchant_routing',
  'qa_t22_merchant_shell',
  'qa_t22_merchant_role_isolation',
  'qa_t23_production_strict_smoke_readiness',
  'qa_t23_security_permissions',
  'qa_t23_ops_rehearsal',
  'qa_t23_launch_decision',
  'qa_t23_final_fullstack_readiness',
  'qa_t30_vibecoding',
  'qa_t31_upstream_routing',
  'qa_t32_enterprise_performance',
  'qa_frontend_scale',
  'qa_t15_announcements',
  'qa_language_catalog',
  'qa_i18n_content',
  'chrome_announcements_screenshot_smoke',
  'chrome_public_site_localized_no_source_leak_smoke',
  'chrome_user_home_announcements_localized_smoke',
  'chrome_user_models_localized_no_source_leak_smoke',
  'chrome_user_profile_localized_no_source_leak_smoke',
  'chrome_user_notification_settings_localized_no_source_leak_smoke',
  'chrome_user_recharge_localized_no_source_leak_smoke',
  'chrome_user_experience_localized_no_source_leak_smoke',
  'chrome_user_ai_recharge_localized_smoke',
  'chrome_user_log_localized_no_source_leak_smoke',
  'chrome_user_token_localized_no_source_leak_smoke',
  'chrome_merchant_dashboard_performance_smoke',
  'chrome_merchant_announcements_workflow_smoke',
  'chrome_merchant_model_config_save_smoke',
  'chrome_merchant_recharge_codes_save_smoke',
  'chrome_merchant_ai_recharge_save_smoke',
  'chrome_user_vibecoding_leaderboard_smoke',
  'chrome_auth_localized_phone_recovery_copy',
  'chrome_phone_auth_recovery_smoke',
  'release_gate_browser_artifacts_verified'
] as const;

type ManagedDatabase = {
  dataDir: string;
  databaseUrl: string;
  pgCtlPath: string;
};

async function main() {
  const managedServices: ChildProcess[] = [];
  let managedDatabase: ManagedDatabase | null = null;

  try {
    await mkdir(ARTIFACT_DIR, { recursive: true });

    if (!USE_EXISTING_SERVICES) {
      if (!process.env.DATABASE_URL) {
        managedDatabase = await startManagedDatabase();
        DATABASE_URL = managedDatabase.databaseUrl;
      }

      const apiPort = await selectManagedPort(process.env.RELEASE_GATE_API_PORT, 3027, 'RELEASE_GATE_API_PORT');
      const webPort = await selectManagedPort(process.env.RELEASE_GATE_WEB_PORT, 3028, 'RELEASE_GATE_WEB_PORT');
      API_BASE_URL = `http://127.0.0.1:${apiPort}`;
      WEB_BASE_URL = `http://127.0.0.1:${webPort}`;
      PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL ?? WEB_BASE_URL;
      gateEnv = buildGateEnv();
    }

    console.log(
      JSON.stringify(
        {
          gate: 'release-review-qa',
          serviceMode: USE_EXISTING_SERVICES ? 'existing' : 'managed',
          apiBaseUrl: API_BASE_URL,
          webBaseUrl: WEB_BASE_URL,
          publicSiteUrl: PUBLIC_SITE_URL,
          databaseUrlSource: process.env.DATABASE_URL ? 'env' : managedDatabase ? 'managed-temp-postgres' : 'default-local-dev'
        },
        null,
        2
      )
    );

    await runCommand('git_diff_check', 'git', ['diff', '--check'], ROOT_DIR);
    await runCommand('typecheck', 'npm', ['run', 'typecheck'], ROOT_DIR);
    await runCommand('build', 'npm', ['run', 'build'], ROOT_DIR);
    await assertReleaseGateDocumentationContract();
    if (!USE_EXISTING_SERVICES) {
      managedServices.push(...await startManagedServices());
      checks.push('managed_services_started');
    }
    await preflightServices();
    await runCommand('qa_t12_pricing', 'npm', ['run', 'qa:t12:pricing'], ROOT_DIR);
    await runCommand('qa_t18_rate_limits', 'npm', ['run', 'qa:t18:rate-limits'], ROOT_DIR);
    await runCommand('qa_t29_relay_cost_guard', 'npm', ['run', 'qa:t29:relay-cost-guard'], ROOT_DIR);
    await runCommand('qa_t23_route_metering', 'npm', ['run', 'qa:t23:route-metering'], ROOT_DIR);
    await runCommand('qa_t23_billing_reconciliation', 'npm', ['run', 'qa:t23:billing-reconciliation'], ROOT_DIR);
    await runCommand('qa_t25_stream_billing_guard', 'npm', ['run', 'qa:t25:stream-billing-guard'], ROOT_DIR);
    await runCommand('qa_t26_payment_orders', 'npm', ['run', 'qa:t26:payment-orders'], ROOT_DIR);
    await runCommand('qa_t27_model_experience', 'npm', ['run', 'qa:t27:model-experience'], ROOT_DIR);
    await runCommand('qa_t28_site_content', 'npm', ['run', 'qa:t28:site-content'], ROOT_DIR);
    await runCommand('qa_t22_merchant_model_config', 'npm', ['run', 'qa:t22:merchant-model-config'], ROOT_DIR);
    await runCommand('qa_t22_merchant_recharge_codes', 'npm', ['run', 'qa:t22:merchant-recharge-codes'], ROOT_DIR);
    await runCommand('qa_t22_merchant_announcements_audit', 'npm', ['run', 'qa:t22:merchant-announcements-audit'], ROOT_DIR);
    await runCommand('qa_t22_merchant_dashboard', 'npm', ['run', 'qa:t22:merchant-dashboard'], ROOT_DIR);
    await runCommand('qa_t22_merchant_routing', 'npm', ['run', 'qa:t22:merchant-routing'], ROOT_DIR);
    await runCommand('qa_t22_merchant_shell', 'npm', ['run', 'qa:t22:merchant-shell'], ROOT_DIR);
    await runCommand('qa_t22_merchant_role_isolation', 'npm', ['run', 'qa:t22:merchant-role-isolation'], ROOT_DIR);
    await runCommand('qa_t23_production_strict_smoke_readiness', 'npm', ['run', 'qa:t23:production-strict-smoke-readiness'], ROOT_DIR);
    await runCommand('qa_t23_security_permissions', 'npm', ['run', 'qa:t23:security-permissions'], ROOT_DIR);
    await runCommand('qa_t23_ops_rehearsal', 'npm', ['run', 'qa:t23:ops-rehearsal'], ROOT_DIR);
    await runCommand('qa_t23_launch_decision', 'npm', ['run', 'qa:t23:launch-decision'], ROOT_DIR);
    await runCommand('qa_t23_final_fullstack_readiness', 'npm', ['run', 'qa:t23:final-fullstack-readiness'], ROOT_DIR);
    await runCommand('qa_t30_vibecoding', 'npm', ['run', 'qa:t30:vibecoding'], ROOT_DIR);
    await runCommand('qa_t31_upstream_routing', 'npm', ['run', 'qa:t31:upstream-routing'], ROOT_DIR);
    await runCommand('qa_t32_enterprise_performance', 'npm', ['run', 'qa:t32:enterprise-performance'], ROOT_DIR);
    await runCommand('qa_frontend_scale', 'npm', ['run', 'qa:frontend-scale'], ROOT_DIR);
    await runCommand('qa_t15_announcements', 'npm', ['run', 'qa:t15:announcements'], ROOT_DIR);
    await runCommand('qa_language_catalog', 'npm', ['run', 'qa:language-catalog'], ROOT_DIR);
    await runCommand('qa_i18n_content', 'npm', ['run', 'qa:i18n-content'], ROOT_DIR);
    const browserSmoke = await runChromeAnnouncementSmoke();
    const publicSiteLocalizationSmoke = await runChromePublicSiteLocalizationSmoke();
    const userHomeAnnouncementSmoke = await runChromeUserHomeAnnouncementSmoke();
    const userModelsLocalizationSmoke = await runChromeUserModelsLocalizationSmoke();
    const userProfileLocalizationSmoke = await runChromeUserProfileLocalizationSmoke();
    const userNotificationSettingsLocalizationSmoke = await runChromeUserNotificationSettingsLocalizationSmoke();
    const userRechargeLocalizationSmoke = await runChromeUserRechargeLocalizationSmoke();
    const userExperienceLocalizationSmoke = await runChromeUserExperienceLocalizationSmoke();
    const merchantDashboardSmoke = await runChromeMerchantDashboardPerformanceSmoke();
    const merchantAnnouncementSmoke = await runChromeMerchantAnnouncementSmoke();
    const merchantModelConfigSmoke = await runChromeMerchantModelConfigSaveSmoke();
    const merchantRechargeCodeSmoke = await runChromeMerchantRechargeCodesSmoke();
    const merchantAiRechargeSmoke = await runChromeMerchantAiRechargeSmoke();
    const phoneAuthRecoverySmoke = await runChromePhoneAuthRecoverySmoke();
    await assertBrowserSmokeArtifacts({
      browserSmoke,
      publicSiteLocalizationSmoke,
      userHomeAnnouncementSmoke,
      userModelsLocalizationSmoke,
      userProfileLocalizationSmoke,
      userNotificationSettingsLocalizationSmoke,
      userRechargeLocalizationSmoke,
      userExperienceLocalizationSmoke,
      merchantDashboardSmoke,
      merchantAnnouncementSmoke,
      merchantModelConfigSmoke,
      merchantRechargeCodeSmoke,
      merchantAiRechargeSmoke,
      phoneAuthRecoverySmoke
    });
    assertRequiredReleaseGateChecks();

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks,
          browserSmoke,
          publicSiteLocalizationSmoke,
          userHomeAnnouncementSmoke,
          userModelsLocalizationSmoke,
          userProfileLocalizationSmoke,
          userNotificationSettingsLocalizationSmoke,
          userRechargeLocalizationSmoke,
          userExperienceLocalizationSmoke,
          merchantDashboardSmoke,
          merchantAnnouncementSmoke,
          merchantModelConfigSmoke,
          merchantRechargeCodeSmoke,
          merchantAiRechargeSmoke,
          phoneAuthRecoverySmoke
        },
        null,
        2
      )
    );
  } finally {
    await stopManagedServices(managedServices);
    if (managedDatabase) {
      await stopManagedDatabase(managedDatabase);
    }
  }
}

function buildGateEnv() {
  return {
    ...process.env,
    API_BASE_URL,
    WEB_BASE_URL,
    DATABASE_URL,
    PUBLIC_SITE_URL,
    INTERNAL_API_BASE_URL: API_BASE_URL,
    NEXT_PUBLIC_API_BASE_URL: API_BASE_URL,
    UPSTREAM_KEY_ENCRYPTION_SECRET:
      process.env.UPSTREAM_KEY_ENCRYPTION_SECRET ?? 'local-release-gate-upstream-secret-32chars',
    API_TOKEN_KEY_ENCRYPTION_SECRET:
      process.env.API_TOKEN_KEY_ENCRYPTION_SECRET ?? 'local-release-gate-api-token-secret-32chars',
    PASSWORD_RECOVERY_CODE_SECRET:
      process.env.PASSWORD_RECOVERY_CODE_SECRET ?? 'local-release-gate-password-recovery-secret-32chars',
    AUTH_PASSWORD_RECOVERY_DEBUG_CODE: process.env.AUTH_PASSWORD_RECOVERY_DEBUG_CODE ?? 'true',
    AUTO_TRANSLATE_PROVIDER: process.env.AUTO_TRANSLATE_PROVIDER ?? 'disabled',
    AUTO_TRANSLATE_TARGET_LANGUAGES: process.env.AUTO_TRANSLATE_TARGET_LANGUAGES ?? 'en-US,es,fr,ja',
    NEXT_TELEMETRY_DISABLED: '1'
  };
}

async function assertReleaseGateDocumentationContract() {
  const docPath = path.join(ROOT_DIR, 'docs', 'quality', 'release-gate.md');
  const text = await readFile(docPath, 'utf8');
  const requiredPhrases = [
    'release_gate_documentation_contract',
    'criticalMetricCount: 6',
    'merchant-dashboard-today-recharge',
    'merchant-dashboard-month-active-users',
    'VibeCoding daily and weekly package',
    'production guard that blocks the public Google translate endpoint',
    'qa:t32:enterprise-performance',
    'chrome_auth_localized_phone_recovery_copy',
    'repository_tracked_files_exclude_runtime_env_and_high_risk_secrets',
    'pricing_response_localizes_model_display_name_from_language_selection',
    'merchant_model_config_saves_display_name_translation_for_user_pricing',
    'qa:t23:billing-reconciliation',
    'billing_reconciliation_release_gate_covers_route_stream_payment_and_experience',
    'qa:t25:stream-billing-guard',
    'qa:t26:payment-orders',
    'payment_order_appears_in_recharge_records',
    'duplicate_mock_success_is_idempotent',
    'qa:t27:model-experience',
    'experience_chat_routes_to_real_upstream_and_bills_wallet',
    'wallet_cny_balance_tracks_usd_price_converted_cost',
    'qa:t28:site-content',
    'public_and_next_proxy_return_saved_site_content',
    'public_home_renders_saved_site_content_and_popup',
    'site_content_update_writes_admin_audit',
    'qa:t23:production-strict-smoke-readiness',
    'production_strict_smoke_requires_urls_and_fails_on_skip_or_fail',
    'qa:t23:ops-rehearsal',
    'strict_deploy_smoke_fails_on_skips_and_covers_core_flows',
    'qa:t23:launch-decision',
    'launch_decision_blocks_production_and_allows_controlled_internal_trial_only',
    'qa:t23:final-fullstack-readiness',
    'final_fullstack_readiness_requires_release_gate_manifest_and_browser_evidence',
    'final_fullstack_readiness_requires_structured_strict_smoke_evidence_template',
    'final_fullstack_readiness_blocks_production_completion_without_real_evidence',
    'qa:frontend-scale',
    'frontend_scale_pages_do_not_render_unbounded_1000_row_tables',
    'qa:language-catalog',
    'language_catalog_matches_frontend_backend_translation_targets',
    'user_profile_requests_carry_selected_language',
    'user_experience_models_carry_selected_language',
    'user_next_api_proxies_forward_selected_language',
    'model_marketplace_copy_overrides_cover_supported_language_catalog',
    'vibecoding_package_labels_cover_supported_language_catalog',
    'user_content_api_errors_do_not_expose_raw_backend_messages',
    'i18n_catalog_labels_and_core_copy_do_not_render_mojibake',
    'i18n_core_auth_nav_packs_do_not_fallback_to_english_only',
    'default_chinese_page_terms_do_not_fallback_to_language_label_plus_english',
    'all_supported_page_terms_do_not_fallback_to_language_label_plus_english',
    'user_home_announcements_follow_selected_language',
    'public_site_core_copy_no_mojibake_for_supported_languages',
    'public_docs_core_copy_no_mojibake_for_zh_ja',
    'public_search_optimization_artifacts_are_not_generated',
    'user_entry_and_console_keep_language_selector_while_merchant_shell_has_none',
    'language_selector_uses_saas_menu_not_native_select',
    'language_selector_labels_use_readable_native_unicode',
    'billing_format_outputs_do_not_render_mojibake',
    'user_recharge_copy_outputs_do_not_render_mojibake',
    'custom-http with a private/official translation service',
    'custom_http_provider_supports_private_production_translation',
    'Chrome DevTools smoke',
    'chrome_public_site_localized_no_source_leak_smoke',
    'chrome_user_home_announcements_localized_smoke',
    'chrome_user_models_localized_no_source_leak_smoke',
    'chrome_user_profile_localized_no_source_leak_smoke',
    'chrome_user_notification_settings_localized_no_source_leak_smoke',
    'chrome_user_recharge_localized_no_source_leak_smoke',
    'chrome_user_experience_localized_no_source_leak_smoke',
    'chrome_user_ai_recharge_localized_smoke',
    'chrome_user_log_localized_no_source_leak_smoke',
    'chrome_user_token_localized_no_source_leak_smoke',
    'release_gate_browser_artifacts_verified',
    'merchant_content_workflow_covers_announcements_update_logs_and_usage_guides',
    'release_gate_required_checks_manifest'
  ];
  const missing = requiredPhrases.filter((phrase) => !text.includes(phrase));
  assert(missing.length === 0, `release gate documentation is missing required contract phrases: ${missing.join(', ')}`);
  checks.push('release_gate_documentation_contract');
}

function assertRequiredReleaseGateChecks() {
  const completed = new Set(checks);
  const missing = REQUIRED_RELEASE_GATE_CHECKS.filter((label) => !completed.has(label));
  assert(missing.length === 0, `release gate did not complete required checks: ${missing.join(', ')}`);
  if (!USE_EXISTING_SERVICES) {
    assert(completed.has('managed_services_started'), 'release gate managed services did not start');
  }
  checks.push('release_gate_required_checks_manifest');
}

async function assertBrowserSmokeArtifacts(smokes: Record<string, unknown>) {
  const screenshotKeys = [
    'screenshotPath',
    'userScreenshotPath',
    'localizedUserScreenshotPath',
    'tokenScreenshotPath',
    'pricingScreenshotPath',
    'docsScreenshotPath',
    'statusScreenshotPath',
    'japaneseNotificationSettingsScreenshotPath',
    'japaneseRechargeScreenshotPath',
    'japaneseAiRechargeScreenshotPath',
    'japaneseScreenshotPath',
    'japaneseModelsScreenshotPath',
    'japaneseProfileScreenshotPath',
    'japaneseExperienceScreenshotPath',
    'japanesePricingScreenshotPath',
    'japaneseDocsScreenshotPath',
    'japaneseStatusScreenshotPath'
  ];
  const artifacts: Array<{ label: string; filePath: string }> = [];

  for (const [smokeName, smokeResult] of Object.entries(smokes)) {
    if (!smokeResult || typeof smokeResult !== 'object') {
      continue;
    }
    const record = smokeResult as Record<string, unknown>;
    for (const key of screenshotKeys) {
      const filePath = record[key];
      if (typeof filePath === 'string' && filePath.trim().length > 0) {
        artifacts.push({ label: `${smokeName}.${key}`, filePath });
      }
    }
  }

  assert(artifacts.length >= 10, `release gate expected at least 10 browser screenshot artifacts, got ${artifacts.length}`);

  const invalidArtifacts: string[] = [];
  for (const artifact of artifacts) {
    try {
      const file = await fsStat(artifact.filePath);
      if (!file.isFile() || file.size <= 0) {
        invalidArtifacts.push(`${artifact.label}:${artifact.filePath}:empty-or-not-file`);
      }
    } catch {
      invalidArtifacts.push(`${artifact.label}:${artifact.filePath}:missing`);
    }
  }

  assert(
    invalidArtifacts.length === 0,
    `release gate browser screenshot artifacts missing or empty: ${invalidArtifacts.join(', ')}`
  );
  checks.push('release_gate_browser_artifacts_verified');
}

async function startManagedServices() {
  const apiPort = new URL(API_BASE_URL).port;
  const webPort = new URL(WEB_BASE_URL).port;
  const api = spawnManagedService(
    'managed-api',
    process.execPath,
    [path.join(ROOT_DIR, 'apps/api/dist/main.js')],
    ROOT_DIR,
    {
      ...gateEnv,
      API_PORT: apiPort
    }
  );
  await waitForHttp(`${API_BASE_URL}/health`, 30_000, 'managed API');

  const web = spawnManagedService(
    'managed-web',
    process.execPath,
    [path.join(ROOT_DIR, 'apps/web/node_modules/next/dist/bin/next'), 'start', '-p', webPort],
    path.join(ROOT_DIR, 'apps/web'),
    gateEnv
  );
  await waitForHttp(WEB_BASE_URL, 45_000, 'managed web');

  return [api, web];
}

function spawnManagedService(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
) {
  const stdout = createWriteStream(path.join(ARTIFACT_DIR, `${label}.out.log`), { flags: 'a' });
  const stderr = createWriteStream(path.join(ARTIFACT_DIR, `${label}.err.log`), { flags: 'a' });
  const child = spawn(command, args, {
    cwd,
    env: cleanEnv(env),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout?.pipe(stdout);
  child.stderr?.pipe(stderr);

  child.on('exit', () => {
    stdout.end();
    stderr.end();
  });

  return child;
}

async function stopManagedServices(children: ChildProcess[]) {
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }

  await Promise.all(children.map((child) => waitForProcessExit(child, 10_000)));

  const survivors = children.filter((child) => child.exitCode === null && child.signalCode === null);
  await Promise.all(survivors.map((child) => forceKillProcessTree(child)));
  await Promise.all(survivors.map((child) => waitForProcessExit(child, 5_000)));
}

async function forceKillProcessTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform !== 'win32') {
    child.kill('SIGKILL');
    return;
  }

  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    killer.once('exit', () => resolve());
    killer.once('error', () => resolve());
  });
}

async function waitForHttp(url: string, timeoutMs: number, label: string) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status >= 200 && response.status < 500) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }

  throw new Error(`${label} did not become ready at ${url}: ${lastError || 'timeout'}`);
}

async function selectManagedPort(value: string | undefined, fallback: number, label: string) {
  if (value) {
    const parsed = Number(value);
    assert(Number.isInteger(parsed) && parsed > 0 && parsed < 65536, `${label} must be a valid TCP port`);
    assert(await isPortAvailable(parsed), `${label} ${parsed} is already in use`);
    return parsed;
  }

  for (let port = fallback; port < fallback + 100; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available managed release-gate port found from ${fallback} to ${fallback + 99}`);
}

async function startManagedDatabase(): Promise<ManagedDatabase> {
  const initdbPath = resolvePostgresBinary('initdb');
  const pgCtlPath = resolvePostgresBinary('pg_ctl');
  const createdbPath = resolvePostgresBinary('createdb');
  const dataDir = await mkdtemp(path.join(tmpdir(), 'relay-release-gate-pg-'));
  const tmpRoot = path.resolve(tmpdir());
  const port = await selectManagedPort(process.env.RELEASE_GATE_DB_PORT, 55432, 'RELEASE_GATE_DB_PORT');
  const databaseUrl = `postgresql://postgres@127.0.0.1:${port}/nested_relay?schema=public`;

  assert(
    path.resolve(dataDir).startsWith(`${tmpRoot}${path.sep}`) && path.basename(dataDir).startsWith('relay-release-gate-pg-'),
    `managed database dataDir must stay inside the release-gate temp prefix: ${dataDir}`
  );

  await runInternalCommand(
    'managed_postgres_initdb',
    initdbPath,
    ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'],
    ROOT_DIR
  );
  await runInternalCommand(
    'managed_postgres_start',
    pgCtlPath,
    ['start', '-D', dataDir, '-l', path.join(ARTIFACT_DIR, 'managed-postgres.log'), '-o', `-p ${port} -h 127.0.0.1`, '-w'],
    ROOT_DIR
  );
  await runInternalCommand('managed_postgres_createdb', createdbPath, ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'nested_relay'], ROOT_DIR);
  await runInternalCommand(
    'managed_postgres_migrate',
    'npm',
    ['--prefix', 'apps/api', 'run', 'db:migrate'],
    ROOT_DIR,
    { ...process.env, DATABASE_URL: databaseUrl }
  );
  checks.push('managed_database_started');

  return { dataDir, databaseUrl, pgCtlPath };
}

async function stopManagedDatabase(database: ManagedDatabase) {
  await runInternalCommand(
    'managed_postgres_stop',
    database.pgCtlPath,
    ['stop', '-D', database.dataDir, '-m', 'fast', '-w'],
    ROOT_DIR,
    undefined,
    true
  );
  await rm(database.dataDir, { recursive: true, force: true });
}

function resolvePostgresBinary(name: string) {
  const pathValue = process.env.PATH ?? process.env.Path ?? '';
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return name;
}

async function runInternalCommand(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  allowFailure = false
) {
  console.log(`[release-gate] ${label}: ${command} ${args.join(' ')}`);
  await new Promise<void>((resolve, reject) => {
    const executable = shouldSpawnDirectly(command) ? { command, args } : resolveExecutable(command, args);
    const child = spawn(executable.command, executable.args, {
      cwd,
      env: cleanEnv(env),
      stdio: 'inherit'
    });

    child.on('error', (error) => {
      if (allowFailure) {
        resolve();
        return;
      }
      reject(error);
    });
    child.on('exit', (code) => {
      if (code === 0 || allowFailure) {
        resolve();
        return;
      }

      reject(new Error(`${label} failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

function shouldSpawnDirectly(command: string) {
  return path.isAbsolute(command) || existsSync(command);
}

async function isPortAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        server.close(() => resolve(true));
      })
      .listen(port, '127.0.0.1');
  });
}

async function preflightServices() {
  const health = await fetchJson(`${API_BASE_URL}/health`);
  assert(health.status === 200, `API health check failed with ${health.status}`);
  checks.push('api_health_200');

  const homepage = await fetch(WEB_BASE_URL);
  assert(homepage.status === 200, `Web homepage failed with ${homepage.status}`);
  checks.push('web_homepage_200');
}

async function runCommand(label: string, command: string, args: string[], cwd: string) {
  console.log(`[release-gate] ${label}: ${command} ${args.join(' ')}`);
  await new Promise<void>((resolve, reject) => {
    const executable = resolveExecutable(command, args);
    const child = spawn(executable.command, executable.args, {
      cwd,
      env: cleanEnv(gateEnv),
      stdio: 'inherit'
    });

    child.on('error', (error) => reject(error));
    child.on('exit', (code) => {
      if (code === 0) {
        checks.push(label);
        resolve();
        return;
      }

      reject(new Error(`${label} failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

async function runChromeAnnouncementSmoke() {
  const chromePath = resolveChromePath();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'relay-gate-chrome-'));
  let chrome: ChildProcess | null = null;

  try {
    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--window-size=1440,1000',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const port = await readDevToolsPort(userDataDir);
    const target = await firstPageTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const events: CdpEvent[] = [];
    cdp.onEvent((event) => events.push(event));

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    const loadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/announcements?language=ja-JP` });
    await loadEvent;
    await delay(1_000);

    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    }) as { data?: string };
    assert(typeof screenshot.data === 'string' && screenshot.data.length > 0, 'Chrome screenshot capture returned no data');
    const screenshotPath = path.join(ARTIFACT_DIR, `announcements-ja-JP-${Date.now()}.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

    const apiPayload = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(() => fetch('/api/announcements?language=ja-JP', { cache: 'no-store' })
        .then(async (response) => ({ status: response.status, body: await response.json() })))()`
    }) as { result?: { value?: AnnouncementApiResult } };

    const payload = apiPayload.result?.value;
    assert(payload?.status === 200, `Next announcements proxy failed with ${payload?.status ?? 'missing status'}`);
    const leakedFields = collectPublicAnnouncementLeaks(payload.body);
    assert(leakedFields.length === 0, `public announcement payload leaked internal fields: ${leakedFields.join(', ')}`);

    const consoleErrors = collectConsoleErrors(events);
    assert(consoleErrors.length === 0, `Chrome console errors detected: ${consoleErrors.join(' | ')}`);

    await cdp.send('Browser.close').catch(() => undefined);
    await cdp.close();
    checks.push('chrome_announcements_screenshot_smoke');
    return {
      page: `${WEB_BASE_URL}/announcements?language=ja-JP`,
      apiStatus: payload.status,
      total: payload.body.total,
      screenshotPath,
      consoleErrorCount: consoleErrors.length,
      leakedFields
    };
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome, 5_000);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}

async function runChromePublicSiteLocalizationSmoke() {
  const chromePath = resolveChromePath();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'relay-gate-public-site-chrome-'));
  let chrome: ChildProcess | null = null;

  const pages = [
    {
      language: 'es-ES',
      route: '/pricing',
      requiredLocalizedTerms: [
        'Precios de modelos',
        'La entrada y la salida se facturan por separado',
        'reglas de facturacion',
        'Inicio rapido',
        'Documentacion API'
      ],
      forbiddenSourceTerms: [
        'Model pricing',
        'Input and output are billed separately',
        'Pricing',
        'API documentation',
        'Production checklist',
        'OpenAI-compatible API relay access'
      ]
    },
    {
      language: 'es-ES',
      route: '/docs',
      requiredLocalizedTerms: [
        'Documentacion API',
        'Inicio rapido',
        'Crea un token dedicado para cada aplicacion',
        'Rutas compatibles con OpenAI',
        'Usa el endpoint compatible con OpenAI'
      ],
      forbiddenSourceTerms: [
        'API documentation',
        'Quickstart',
        'Create a dedicated token for each application',
        'Use the OpenAI-compatible endpoint',
        'Production checklist'
      ]
    },
    {
      language: 'es-ES',
      route: '/status',
      requiredLocalizedTerms: [
        'Estado',
        'Alcance operativo',
        'Servicio',
        'Ultima comprobacion',
        'Supervisa fallos de upstream'
      ],
      forbiddenSourceTerms: [
        'Status and operational signals',
        'Operational scope',
        'Service',
        'Last check',
        'Monitor upstream failures',
        'Public health covers',
        'What to monitor'
      ]
    },
    {
      language: 'ja-JP',
      route: '/pricing',
      requiredLocalizedTerms: [
        'モデル料金',
        '入力と出力は別々に課金されます',
        'API 連携例',
        'クイックスタート',
        'API ドキュメント'
      ],
      forbiddenSourceTerms: [
        'Model pricing',
        'Input and output are billed separately',
        'Pricing',
        'Production checklist',
        'OpenAI-compatible API relay access'
      ]
    },
    {
      language: 'ja-JP',
      route: '/docs',
      requiredLocalizedTerms: [
        'API ドキュメント',
        'クイックスタート',
        'アプリごとに専用トークンを作成します',
        'OpenAI 互換パス',
        'OpenAI 互換エンドポイント'
      ],
      forbiddenSourceTerms: [
        'API documentation',
        'Quickstart',
        'Create a dedicated token for each application',
        'Use the OpenAI-compatible endpoint',
        'Production checklist'
      ]
    },
    {
      language: 'ja-JP',
      route: '/status',
      requiredLocalizedTerms: [
        'ステータス',
        '運用範囲',
        'サービス',
        '最終確認',
        '上流障害'
      ],
      forbiddenSourceTerms: [
        'Status and operational signals',
        'Operational scope',
        'Service',
        'Last check',
        'Monitor upstream failures',
        'Public health covers',
        'What to monitor'
      ]
    }
  ];

  try {
    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--window-size=1440,1000',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const port = await readDevToolsPort(userDataDir);
    const target = await firstPageTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const events: CdpEvent[] = [];
    cdp.onEvent((event) => events.push(event));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');

    const pageResults: Array<PublicSiteLocalizationPageState & { route: string; screenshotPath: string }> = [];
    for (const page of pages) {
      const loadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
      await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}${page.route}?language=${page.language}` });
      await loadEvent;
      await delay(750);

      const result = await cdp.send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: buildPublicSiteLocalizationExpression(page)
      }) as RuntimeEvaluationResult<PublicSiteLocalizationPageState>;

      if (result.exceptionDetails) {
        assert(false, `public site localization state evaluation failed for ${page.route}: ${formatRuntimeEvaluationFailure(result)}`);
      }

      const state = result.result?.value;
      assert(
        state?.ok,
        `${page.language} public site page leaked source language or missed localized copy on ${page.route}: ${
          state?.debug ?? formatRuntimeEvaluationFailure(result)
        }`
      );

      const screenshot = await captureChromeScreenshotWithRetry(cdp, `Public site ${page.route} ${page.language} localization Chrome`, {
        format: 'png',
        captureBeyondViewport: true
      });
      const screenshotPath = path.join(ARTIFACT_DIR, `public-${page.route.replace(/[^a-z0-9]+/gi, '-')}-${page.language}-${Date.now()}.png`);
      await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
      pageResults.push({ ...state, route: `${page.language}:${page.route}`, screenshotPath });
    }

    const consoleErrors = collectConsoleErrors(events);
    assert(consoleErrors.length === 0, `Public site localization Chrome console errors detected: ${consoleErrors.join(' | ')}`);

    await cdp.send('Browser.close').catch(() => undefined);
    await cdp.close();
    checks.push('chrome_public_site_localized_no_source_leak_smoke');
    const screenshotByRoute = Object.fromEntries(pageResults.map((page) => [page.route, page.screenshotPath]));
    return {
      languages: ['es-ES', 'ja-JP'],
      pricingScreenshotPath: screenshotByRoute['es-ES:/pricing'],
      docsScreenshotPath: screenshotByRoute['es-ES:/docs'],
      statusScreenshotPath: screenshotByRoute['es-ES:/status'],
      japanesePricingScreenshotPath: screenshotByRoute['ja-JP:/pricing'],
      japaneseDocsScreenshotPath: screenshotByRoute['ja-JP:/docs'],
      japaneseStatusScreenshotPath: screenshotByRoute['ja-JP:/status'],
      pages: pageResults.map((page) => ({
        route: page.route,
        screenshotPath: page.screenshotPath,
        cjkMatches: page.cjkMatches,
        leakedSourceTerms: page.leakedSourceTerms,
        requiredLocalizedTerms: page.requiredLocalizedTerms
      })),
      consoleErrorCount: consoleErrors.length
    };
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome, 5_000);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}

async function runChromeUserHomeAnnouncementSmoke() {
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const usernamePrefix = `rgh_${suffix}`;
  const password = `qa-password-${suffix}`;
  const expectedSpanishTitle = `${usernamePrefix} anuncio localizado`;
  const expectedSpanishContent = `${usernamePrefix} contenido localizado`;
  const expectedJapaneseTitle = `${usernamePrefix} 日本語のお知らせ`;
  const expectedJapaneseContent = `${usernamePrefix} 日本語の本文`;
  const sourceTitle = `${usernamePrefix} 公告源文标题`;
  const sourceContent = `${usernamePrefix} 公告源文内容`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL })
  });
  let chrome: ChildProcess | null = null;
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'relay-gate-user-home-chrome-'));
  let seeded: Awaited<ReturnType<typeof seedUserHomeAnnouncementSmokeData>> | null = null;

  try {
    seeded = await seedUserHomeAnnouncementSmokeData(prisma, {
      usernamePrefix,
      password,
      sourceTitle,
      sourceContent,
      expectedSpanishTitle,
      expectedSpanishContent,
      expectedJapaneseTitle,
      expectedJapaneseContent
    });
    const login = await loginReleaseGateAdmin(seeded.username, password);
    const chromePath = resolveChromePath();
    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--window-size=1440,1000',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const port = await readDevToolsPort(userDataDir);
    const target = await firstPageTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const events: CdpEvent[] = [];
    cdp.onEvent((event) => events.push(event));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await setBrowserCookies(cdp, WEB_BASE_URL, login.cookies);

    const pageResults: Array<UserHomeAnnouncementLocalizationState & { language: string; page: string; screenshotPath: string }> = [];
    for (const page of [
      {
        expectedContent: expectedSpanishContent,
        expectedTitle: expectedSpanishTitle,
        forbiddenTerms: [
          'Smart service relay console',
          'Published content',
          'Latest publish',
          'Document entrances',
          'Platform announcements',
          'Close announcement',
          'Try models',
          'Logs',
          'AI recharge',
          '智能服务中转后台',
          '已发布内容',
          '最新发布',
          '文档入口',
          '平台公告',
          '关闭公告',
          '体验',
          '令牌',
          '日志',
          'AI代充',
          '通知设置'
        ],
        language: 'es-ES',
        name: 'Spanish',
        requiredLocalizedTerms: [
          expectedSpanishTitle,
          expectedSpanishContent,
          'Inicio',
          'Consola de relevo de servicios inteligentes',
          'Contenido publicado',
          'ltima publicaci',
          'Accesos a documentos',
          'Anuncios de la plataforma',
          'Cerrar anuncio',
          'Recarga IA',
          'Probar modelos',
          'Registros',
          'Notificaciones'
        ],
        rejectCjk: true
      },
      {
        expectedContent: expectedJapaneseContent,
        expectedTitle: expectedJapaneseTitle,
        forbiddenTerms: [
          'Smart service relay console',
          'Published content',
          'Latest publish',
          'Document entrances',
          'Platform announcements',
          'Close announcement',
          'Try models',
          'Logs',
          'AI recharge',
          '智能服务中转后台',
          '已发布内容',
          '最新发布',
          '文档入口',
          '平台公告',
          '关闭公告',
          '体验',
          '令牌',
          '日志',
          'AI代充',
          '通知设置'
        ],
        language: 'ja-JP',
        name: 'Japanese',
        requiredLocalizedTerms: [
          expectedJapaneseTitle,
          expectedJapaneseContent,
          'ホーム',
          'スマートサービス中継コンソール',
          '公開済みコンテンツ',
          '最新公開',
          'ドキュメント入口',
          'プラットフォームのお知らせ',
          'お知らせを閉じる',
          'AIチャージ',
          'モデルを試す',
          'ログ',
          '通知'
        ],
        rejectCjk: false
      }
    ]) {
      const loadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
      const pageUrl = `${WEB_BASE_URL}/account?language=${page.language}`;
      await cdp.send('Page.navigate', { url: pageUrl });
      await loadEvent;

      const stateResult = await cdp.send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: buildUserHomeAnnouncementLocalizationExpression({
          expectedContent: page.expectedContent,
          expectedTitle: page.expectedTitle,
          forbiddenTerms: page.forbiddenTerms,
          language: page.language,
          rejectCjk: page.rejectCjk,
          requiredLocalizedTerms: page.requiredLocalizedTerms,
          sourceContent,
          sourceTitle
        })
      }) as RuntimeEvaluationResult<UserHomeAnnouncementLocalizationState>;

      if (stateResult.exceptionDetails) {
        assert(false, `user home announcement localization state evaluation failed for ${page.language}: ${formatRuntimeEvaluationFailure(stateResult)}`);
      }

      const state = stateResult.result?.value;
      assert(
        state?.ok,
        `${page.name} user home announcements leaked source language or missed localized copy: ${state?.debug ?? formatRuntimeEvaluationFailure(stateResult)}`
      );

      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true
      }) as { data?: string };
      assert(typeof screenshot.data === 'string' && screenshot.data.length > 0, `User home announcement Chrome screenshot returned no data for ${page.language}`);
      const screenshotPath = path.join(ARTIFACT_DIR, `user-home-announcements-${page.language}-${Date.now()}.png`);
      await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
      pageResults.push({
        ...state,
        language: page.language,
        page: pageUrl,
        screenshotPath
      });
    }

    const consoleErrors = collectConsoleErrors(events);
    assert(consoleErrors.length === 0, `User home announcement Chrome console errors detected: ${consoleErrors.join(' | ')}`);

    await cdp.send('Browser.close').catch(() => undefined);
    await cdp.close();
    checks.push('chrome_user_home_announcements_localized_smoke');
    return {
      page: `${WEB_BASE_URL}/account?language=es-ES`,
      languages: pageResults.map((page) => page.language),
      username: seeded.username,
      announcementId: seeded.announcementId,
      expectedSpanishTitle,
      expectedSpanishContent,
      expectedJapaneseTitle,
      expectedJapaneseContent,
      popupText: pageResults[0]?.popupText,
      listText: pageResults[0]?.listText,
      screenshotPath: pageResults[0]?.screenshotPath,
      japanesePage: `${WEB_BASE_URL}/account?language=ja-JP`,
      japanesePopupText: pageResults[1]?.popupText,
      japaneseListText: pageResults[1]?.listText,
      japaneseScreenshotPath: pageResults[1]?.screenshotPath,
      consoleErrorCount: consoleErrors.length,
      cjkMatches: pageResults[0]?.cjkMatches ?? [],
      leakedSourceTerms: pageResults.flatMap((page) => page.leakedSourceTerms),
      requiredLocalizedTerms: pageResults.map((page) => ({
        language: page.language,
        terms: page.requiredLocalizedTerms
      }))
    };
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome, 5_000);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    if (seeded) {
      await cleanupUserHomeAnnouncementSmokeData(prisma, seeded).finally(() => prisma.$disconnect());
    } else {
      await prisma.$disconnect();
    }
  }
}

async function runChromeUserModelsLocalizationSmoke() {
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const usernamePrefix = `rgl_${suffix}`;
  const password = `qa-password-${suffix}`;
  const expectedSpanishDisplayName = `${usernamePrefix} Modelo QA Espanol`;
  const expectedJapaneseDisplayName = `${usernamePrefix} 日本語 QA モデル`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL })
  });
  let chrome: ChildProcess | null = null;
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'relay-gate-user-models-chrome-'));
  let seeded: Awaited<ReturnType<typeof seedUserModelsLocalizationSmokeData>> | null = null;

  try {
    seeded = await seedUserModelsLocalizationSmokeData(
      prisma,
      usernamePrefix,
      password,
      expectedSpanishDisplayName,
      expectedJapaneseDisplayName
    );
    const login = await loginReleaseGateAdmin(seeded.username, password);
    const chromePath = resolveChromePath();
    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--window-size=1440,1000',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const port = await readDevToolsPort(userDataDir);
    const target = await firstPageTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const events: CdpEvent[] = [];
    cdp.onEvent((event) => events.push(event));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await setBrowserCookies(cdp, WEB_BASE_URL, login.cookies);

    const sourceChineseTerms = [
      '模型广场',
      '模型市场',
      '扣费口径',
      '可用模型',
      '计费模型',
      '搜索结果',
      '支持流式',
      '复制'
    ];
    const modelPages = [
      {
        expectedDisplayName: expectedSpanishDisplayName,
        forbiddenTerms: sourceChineseTerms,
        language: 'es-ES',
        rejectCjk: true,
        requiredLocalizedTerms: ['Mercado de modelos', 'Reglas de cobro', 'Todos los modelos', 'Entrada', 'Salida', 'Copiar']
      },
      {
        expectedDisplayName: expectedJapaneseDisplayName,
        forbiddenTerms: [
          ...sourceChineseTerms,
          'Model marketplace',
          'Billing rules',
          'All models',
          'Paid models',
          'Search results',
          'Streaming supported',
          'Copy'
        ],
        language: 'ja-JP',
        rejectCjk: false,
        requiredLocalizedTerms: ['モデルマーケット', '課金ルール', 'すべてのモデル', '入力', '出力', 'コピー']
      }
    ];
    const pageResults: Array<UserModelsLocalizationState & { language: string; screenshotPath: string }> = [];

    for (const page of modelPages) {
      const loadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
      await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/models?language=${page.language}` });
      await loadEvent;
      await delay(2_000);

      const stateResult = await cdp.send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: buildUserModelsLocalizationExpression({
          expectedDisplayName: page.expectedDisplayName,
          expectedModelName: seeded.modelName,
          forbiddenTerms: page.forbiddenTerms,
          language: page.language,
          rejectCjk: page.rejectCjk,
          requiredLocalizedTerms: page.requiredLocalizedTerms
        })
      }) as RuntimeEvaluationResult<UserModelsLocalizationState>;

      if (stateResult.exceptionDetails) {
        assert(false, `user models ${page.language} localization state evaluation failed: ${formatRuntimeEvaluationFailure(stateResult)}`);
      }

      const state = stateResult.result?.value;
      assert(
        state?.ok,
        `${page.language} models page leaked source language or missed localized copy: ${
          state?.debug ?? formatRuntimeEvaluationFailure(stateResult)
        }`
      );

      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true
      }) as { data?: string };
      assert(
        typeof screenshot.data === 'string' && screenshot.data.length > 0,
        `User models ${page.language} localization Chrome screenshot returned no data`
      );
      const screenshotPath = path.join(ARTIFACT_DIR, `user-models-${page.language}-${Date.now()}.png`);
      await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
      pageResults.push({ ...state, language: page.language, screenshotPath });
    }

    const consoleErrors = collectConsoleErrors(events);
    assert(consoleErrors.length === 0, `User models localization Chrome console errors detected: ${consoleErrors.join(' | ')}`);

    await cdp.send('Browser.close').catch(() => undefined);
    await cdp.close();
    checks.push('chrome_user_models_localized_no_source_leak_smoke');
    return {
      page: `${WEB_BASE_URL}/models?language=es-ES`,
      japanesePage: `${WEB_BASE_URL}/models?language=ja-JP`,
      modelName: seeded.modelName,
      expectedSpanishDisplayName,
      expectedJapaneseDisplayName,
      screenshotPath: pageResults[0]?.screenshotPath,
      japaneseModelsScreenshotPath: pageResults[1]?.screenshotPath,
      consoleErrorCount: consoleErrors.length,
      languages: pageResults.map((page) => page.language),
      cjkMatches: Object.fromEntries(pageResults.map((page) => [page.language, page.cjkMatches])),
      leakedSourceTerms: Object.fromEntries(pageResults.map((page) => [page.language, page.leakedSourceTerms])),
      requiredLocalizedTerms: Object.fromEntries(pageResults.map((page) => [page.language, page.requiredLocalizedTerms]))
    };
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome, 5_000);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    if (seeded) {
      await cleanupMerchantModelConfigSmokeData(prisma, {
        adminUserId: seeded.userId,
        usernamePrefix,
        username: seeded.username,
        groupId: seeded.groupId,
        modelId: seeded.modelId,
        modelName: seeded.modelName,
        upstreamModelName: seeded.upstreamModelName,
        mappingId: seeded.mappingId,
        providerId: seeded.providerId
      }).finally(() => prisma.$disconnect());
    } else {
      await prisma.$disconnect();
    }
  }
}

async function runChromeUserProfileLocalizationSmoke() {
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const usernamePrefix = `rgp_${suffix}`;
  const password = `qa-password-${suffix}`;
  const expectedSpanishDisplayName = `${usernamePrefix} Perfil Modelo QA Espanol`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL })
  });
  let chrome: ChildProcess | null = null;
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'relay-gate-user-profile-chrome-'));
  let seeded: Awaited<ReturnType<typeof seedUserModelsLocalizationSmokeData>> | null = null;

  try {
    seeded = await seedUserModelsLocalizationSmokeData(prisma, usernamePrefix, password, expectedSpanishDisplayName);
    const login = await loginReleaseGateAdmin(seeded.username, password);
    const chromePath = resolveChromePath();
    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--window-size=1440,1000',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const port = await readDevToolsPort(userDataDir);
    const target = await firstPageTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const events: CdpEvent[] = [];
    cdp.onEvent((event) => events.push(event));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await setBrowserCookies(cdp, WEB_BASE_URL, login.cookies);

    const sourceChineseTerms = [
      '个人中心',
      '账户',
      '账户选项',
      '用户信息',
      '可用模型',
      '余额',
      '模型配置',
      '模型列表',
      '搜索模型',
      '今日 token',
      '系统令牌',
      '复制全部模型',
      '修改密码'
    ];
    const profilePages = [
      {
        forbiddenTerms: sourceChineseTerms,
        language: 'es-ES',
        rejectCjk: true,
        requiredLocalizedTerms: ['Saldo', 'Modelos disponibles', 'Tokens totales', 'Zona horaria', 'Modelo']
      },
      {
        forbiddenTerms: [
          ...sourceChineseTerms,
          'Account options',
          'User information',
          'Available models',
          'Balance',
          'Model configuration',
          'Model list',
          'Search models',
          'Today tokens',
          'System tokens',
          'Copy all models',
          'Change password'
        ],
        language: 'ja-JP',
        rejectCjk: false,
        requiredLocalizedTerms: ['残高', '利用可能なモデル', '合計トークン', 'タイムゾーン', 'モデル']
      }
    ];
    const pageResults: Array<UserProfileLocalizationState & { language: string; screenshotPath: string }> = [];

    for (const page of profilePages) {
      const loadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
      await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/account/profile?language=${page.language}` });
      await loadEvent;
      await delay(2_000);

      const state = await waitForUserProfileLocalizationState(cdp, {
        expectedModelName: seeded.modelName,
        expectedUsername: seeded.username,
        forbiddenTerms: page.forbiddenTerms,
        language: page.language,
        rejectCjk: page.rejectCjk,
        requiredLocalizedTerms: page.requiredLocalizedTerms
      });
      assert(
        state?.ok,
        `${page.language} profile page leaked source language or missed localized copy: ${
          state?.debug ?? 'profile localization state was not available'
        }`
      );

      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true
      }) as { data?: string };
      assert(
        typeof screenshot.data === 'string' && screenshot.data.length > 0,
        `User profile ${page.language} localization Chrome screenshot returned no data`
      );
      const screenshotPath = path.join(ARTIFACT_DIR, `user-profile-${page.language}-${Date.now()}.png`);
      await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
      pageResults.push({ ...state, language: page.language, screenshotPath });
    }

    const consoleErrors = collectConsoleErrors(events);
    assert(consoleErrors.length === 0, `User profile localization Chrome console errors detected: ${consoleErrors.join(' | ')}`);

    await cdp.send('Browser.close').catch(() => undefined);
    await cdp.close();
    checks.push('chrome_user_profile_localized_no_source_leak_smoke');
    return {
      page: `${WEB_BASE_URL}/account/profile?language=es-ES`,
      japanesePage: `${WEB_BASE_URL}/account/profile?language=ja-JP`,
      username: seeded.username,
      modelName: seeded.modelName,
      screenshotPath: pageResults[0]?.screenshotPath,
      japaneseProfileScreenshotPath: pageResults[1]?.screenshotPath,
      consoleErrorCount: consoleErrors.length,
      languages: pageResults.map((page) => page.language),
      cjkMatches: Object.fromEntries(pageResults.map((page) => [page.language, page.cjkMatches])),
      leakedSourceTerms: Object.fromEntries(pageResults.map((page) => [page.language, page.leakedSourceTerms])),
      requiredLocalizedTerms: Object.fromEntries(pageResults.map((page) => [page.language, page.requiredLocalizedTerms]))
    };
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome, 5_000);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    if (seeded) {
      await cleanupMerchantModelConfigSmokeData(prisma, {
        adminUserId: seeded.userId,
        usernamePrefix,
        username: seeded.username,
        groupId: seeded.groupId,
        modelId: seeded.modelId,
        modelName: seeded.modelName,
        upstreamModelName: seeded.upstreamModelName,
        mappingId: seeded.mappingId,
        providerId: seeded.providerId
      }).finally(() => prisma.$disconnect());
    } else {
      await prisma.$disconnect();
    }
  }
}

async function runChromeUserRechargeLocalizationSmoke() {
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const usernamePrefix = `rgr_${suffix}`;
  const password = `qa-password-${suffix}`;
  const expectedSpanishDisplayName = `${usernamePrefix} Recarga Modelo QA Espanol`;
  const expectedJapaneseDisplayName = `${usernamePrefix} 日本語 チャージモデル`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL })
  });
  let chrome: ChildProcess | null = null;
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'relay-gate-user-recharge-chrome-'));
  let seeded: Awaited<ReturnType<typeof seedUserModelsLocalizationSmokeData>> | null = null;

  try {
    seeded = await seedUserModelsLocalizationSmokeData(
      prisma,
      usernamePrefix,
      password,
      expectedSpanishDisplayName,
      expectedJapaneseDisplayName
    );
    const login = await loginReleaseGateAdmin(seeded.username, password);
    const chromePath = resolveChromePath();
    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--window-size=1440,1000',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const port = await readDevToolsPort(userDataDir);
    const target = await firstPageTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const events: CdpEvent[] = [];
    cdp.onEvent((event) => events.push(event));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await setBrowserCookies(cdp, WEB_BASE_URL, login.cookies);

    const languageChecks = [
      {
        language: 'es-ES',
        label: 'Spanish',
        rejectCjk: true,
        screenshotName: 'user-recharge-es-ES',
        requiredLocalizedTerms: [
          'Recargar saldo',
          'Codigo de recarga',
          'Canjear',
          'Comprar codigos de recarga',
          'Registros de recarga',
          'Importe CNY',
          'Saldo despues',
          'Sin registros de recarga',
          'Escanea WeChat o QQ'
        ],
        forbiddenTerms: [
          'Balance top-up',
          'Buy recharge codes',
          'Manual recharge codes',
          'Scan WeChat or QQ',
          'Enter recharge code',
          'Recharge records',
          'No recharge records',
          'Credited balance',
          'Balance after',
          '充值',
          '充值码',
          '充值记录',
          '扫码付款',
          '兑换'
        ]
      },
      {
        language: 'ja-JP',
        label: 'Japanese',
        rejectCjk: false,
        screenshotName: 'user-recharge-ja-JP',
        requiredLocalizedTerms: [
          '残高チャージ',
          'チャージコード',
          '交換',
          'チャージコードを購入',
          'チャージ記録',
          'CNY金額',
          'チャージ後残高',
          'チャージ記録はありません',
          'WeChatまたはQQ'
        ],
        forbiddenTerms: [
          'Balance top-up',
          'Buy recharge codes',
          'Manual recharge codes',
          'Scan WeChat or QQ',
          'Enter recharge code',
          'Recharge records',
          'No recharge records',
          'Credited balance',
          'Balance after',
          'Recargar saldo',
          'Codigo de recarga',
          'Comprar codigos de recarga',
          'Registros de recarga',
          'Sin registros de recarga',
          '充值',
          '充值码',
          '充值记录',
          '扫码付款',
          '兑换'
        ]
      }
    ] as const;

    const results: Array<{
      cjkMatches: string[];
      leakedSourceTerms: string[];
      page: string;
      requiredLocalizedTerms: string[];
      screenshotPath: string;
    }> = [];

    for (const check of languageChecks) {
      const page = `${WEB_BASE_URL}/account/topup/recharge?language=${check.language}`;
      const loadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
      await cdp.send('Page.navigate', { url: page });
      await loadEvent;
      await delay(2_000);

      const state = await waitForUserRechargeLocalizationState(cdp, {
        expectedUsername: seeded.username,
        forbiddenTerms: check.forbiddenTerms,
        language: check.language,
        rejectCjk: check.rejectCjk,
        requiredLocalizedTerms: check.requiredLocalizedTerms
      });
      assert(
        state?.ok,
        `${check.label} recharge page leaked source language or missed localized copy: ${
          state?.debug ?? 'recharge localization state was not available'
        }`
      );

      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true
      }) as { data?: string };
      assert(typeof screenshot.data === 'string' && screenshot.data.length > 0, `${check.label} user recharge localization Chrome screenshot returned no data`);
      const screenshotPath = path.join(ARTIFACT_DIR, `${check.screenshotName}-${Date.now()}.png`);
      await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
      results.push({
        cjkMatches: state.cjkMatches,
        leakedSourceTerms: state.leakedSourceTerms,
        page,
        requiredLocalizedTerms: state.requiredLocalizedTerms,
        screenshotPath
      });
    }

    const consoleErrors = collectConsoleErrors(events);
    assert(consoleErrors.length === 0, `User recharge localization Chrome console errors detected: ${consoleErrors.join(' | ')}`);

    await cdp.send('Browser.close').catch(() => undefined);
    await cdp.close();
    checks.push('chrome_user_recharge_localized_no_source_leak_smoke');
    const [spanishResult, japaneseResult] = results;
    return {
      page: spanishResult?.page,
      japanesePage: japaneseResult?.page,
      username: seeded.username,
      screenshotPath: spanishResult?.screenshotPath,
      japaneseRechargeScreenshotPath: japaneseResult?.screenshotPath,
      consoleErrorCount: consoleErrors.length,
      languages: languageChecks.map((check) => check.language),
      cjkMatches: results.flatMap((result) => result.cjkMatches),
      leakedSourceTerms: results.flatMap((result) => result.leakedSourceTerms),
      requiredLocalizedTerms: Object.fromEntries(results.map((result) => [result.page, result.requiredLocalizedTerms]))
    };
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome, 5_000);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    if (seeded) {
      await cleanupMerchantModelConfigSmokeData(prisma, {
        adminUserId: seeded.userId,
        usernamePrefix,
        username: seeded.username,
        groupId: seeded.groupId,
        modelId: seeded.modelId,
        modelName: seeded.modelName,
        upstreamModelName: seeded.upstreamModelName,
        mappingId: seeded.mappingId,
        providerId: seeded.providerId
      }).finally(() => prisma.$disconnect());
    } else {
      await prisma.$disconnect();
    }
  }
}

async function runChromeUserNotificationSettingsLocalizationSmoke() {
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const usernamePrefix = `rgn_${suffix}`;
  const password = `qa-password-${suffix}`;
  const expectedSpanishDisplayName = `${usernamePrefix} Notificaciones Modelo QA Espanol`;
  const expectedJapaneseDisplayName = `${usernamePrefix} 日本語 通知モデル`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL })
  });
  let chrome: ChildProcess | null = null;
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'relay-gate-user-notifications-chrome-'));
  let seeded: Awaited<ReturnType<typeof seedUserModelsLocalizationSmokeData>> | null = null;

  try {
    seeded = await seedUserModelsLocalizationSmokeData(
      prisma,
      usernamePrefix,
      password,
      expectedSpanishDisplayName,
      expectedJapaneseDisplayName
    );
    const login = await loginReleaseGateAdmin(seeded.username, password);
    const chromePath = resolveChromePath();
    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--window-size=1440,1000',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const port = await readDevToolsPort(userDataDir);
    const target = await firstPageTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const events: CdpEvent[] = [];
    cdp.onEvent((event) => events.push(event));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await setBrowserCookies(cdp, WEB_BASE_URL, login.cookies);

    const languageChecks = [
      {
        language: 'es-ES',
        label: 'Spanish',
        rejectCjk: true,
        screenshotName: 'user-notification-settings-es-ES',
        requiredLocalizedTerms: [
          'Notificaciones',
          'Alerta de saldo bajo',
          'Suscripciones de eventos',
          'Canales de notificacion',
          'Registros de entrega',
          'Guardar configuracion',
          'Sin registros',
          'Estado',
          'Objetivo'
        ],
        forbiddenTerms: [
          'Notification settings',
          'Low balance alert',
          'Event subscriptions',
          'Notification channels',
          'Delivery records',
          'Save settings',
          'No real delivery records',
          '通知设置',
          '通知設定',
          '低余额提醒',
          '低餘額提醒',
          '事件订阅',
          '事件訂閱',
          '通知渠道',
          '投递记录',
          '投遞記錄',
          '保存设置',
          '儲存設定'
        ]
      },
      {
        language: 'ja-JP',
        label: 'Japanese',
        rejectCjk: false,
        screenshotName: 'user-notification-settings-ja-JP',
        requiredLocalizedTerms: [
          '通知',
          '残高不足',
          'イベント',
          '配信',
          '記録',
          'しきい値',
          '保存',
          'ステータス',
          'ターゲット'
        ],
        forbiddenTerms: [
          'Notification settings',
          'Low balance alert',
          'Event subscriptions',
          'Notification channels',
          'Delivery records',
          'Save settings',
          'No real delivery records',
          'Notifications',
          'Low balance',
          'Event subscriptions',
          'Delivery records',
          'Save settings',
          '通知设置',
          '通知設定',
          '低余额提醒',
          '低餘額提醒',
          '事件订阅',
          '事件訂閱',
          '通知渠道',
          '投递记录',
          '投遞記錄',
          '保存设置',
          '儲存設定'
        ]
      }
    ] as const;

    const results: Array<{
      cjkMatches: string[];
      leakedSourceTerms: string[];
      page: string;
      requiredLocalizedTerms: string[];
      screenshotPath: string;
    }> = [];

    for (const check of languageChecks) {
      const page = `${WEB_BASE_URL}/account/notificationSettings?language=${check.language}`;
      const loadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
      await cdp.send('Page.navigate', { url: page });
      await loadEvent;
      await delay(2_000);

      const state = await waitForUserNotificationSettingsLocalizationState(cdp, {
        expectedUsername: seeded.username,
        forbiddenTerms: check.forbiddenTerms,
        language: check.language,
        rejectCjk: check.rejectCjk,
        requiredLocalizedTerms: check.requiredLocalizedTerms
      });
      assert(
        state?.ok,
        `${check.label} notification settings page leaked source language or missed localized copy: ${
          state?.debug ?? 'notification settings localization state was not available'
        }`
      );

      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true
      }) as { data?: string };
      assert(
        typeof screenshot.data === 'string' && screenshot.data.length > 0,
        `${check.label} user notification settings localization Chrome screenshot returned no data`
      );
      const screenshotPath = path.join(ARTIFACT_DIR, `${check.screenshotName}-${Date.now()}.png`);
      await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
      results.push({
        cjkMatches: state.cjkMatches,
        leakedSourceTerms: state.leakedSourceTerms,
        page,
        requiredLocalizedTerms: state.requiredLocalizedTerms,
        screenshotPath
      });
    }

    const consoleErrors = collectConsoleErrors(events);
    assert(consoleErrors.length === 0, `User notification settings localization Chrome console errors detected: ${consoleErrors.join(' | ')}`);

    await cdp.send('Browser.close').catch(() => undefined);
    await cdp.close();
    checks.push('chrome_user_notification_settings_localized_no_source_leak_smoke');
    const [spanishResult, japaneseResult] = results;
    return {
      page: spanishResult?.page,
      japanesePage: japaneseResult?.page,
      username: seeded.username,
      screenshotPath: spanishResult?.screenshotPath,
      japaneseNotificationSettingsScreenshotPath: japaneseResult?.screenshotPath,
      consoleErrorCount: consoleErrors.length,
      languages: languageChecks.map((check) => check.language),
      cjkMatches: results.flatMap((result) => result.cjkMatches),
      leakedSourceTerms: results.flatMap((result) => result.leakedSourceTerms),
      requiredLocalizedTerms: Object.fromEntries(results.map((result) => [result.page, result.requiredLocalizedTerms]))
    };
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome, 5_000);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    if (seeded) {
      await cleanupMerchantModelConfigSmokeData(prisma, {
        adminUserId: seeded.userId,
        usernamePrefix,
        username: seeded.username,
        groupId: seeded.groupId,
        modelId: seeded.modelId,
        modelName: seeded.modelName,
        upstreamModelName: seeded.upstreamModelName,
        mappingId: seeded.mappingId,
        providerId: seeded.providerId
      }).finally(() => prisma.$disconnect());
    } else {
      await prisma.$disconnect();
    }
  }
}

async function runChromeUserExperienceLocalizationSmoke() {
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const usernamePrefix = `rge_${suffix}`;
  const password = `qa-password-${suffix}`;
  const expectedSpanishDisplayName = `${usernamePrefix} Experiencia Modelo QA Espanol`;
  const expectedJapaneseDisplayName = `${usernamePrefix} 日本語 体験モデル`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL })
  });
  let chrome: ChildProcess | null = null;
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'relay-gate-user-experience-chrome-'));
  let seeded: Awaited<ReturnType<typeof seedUserModelsLocalizationSmokeData>> | null = null;

  try {
    seeded = await seedUserModelsLocalizationSmokeData(
      prisma,
      usernamePrefix,
      password,
      expectedSpanishDisplayName,
      expectedJapaneseDisplayName
    );
    const login = await loginReleaseGateAdmin(seeded.username, password);
    const chromePath = resolveChromePath();
    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--window-size=1440,1000',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const port = await readDevToolsPort(userDataDir);
    const target = await firstPageTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const events: CdpEvent[] = [];
    cdp.onEvent((event) => events.push(event));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await setBrowserCookies(cdp, WEB_BASE_URL, login.cookies);

    const sourceChineseTerms = [
      '页面显示美元单价',
      '实际扣余额',
      '模型配置',
      '搜索模型名称',
      '输入',
      '输出',
      '发送',
      '选择模型',
      '系统提示词',
      '余额不足',
      '模型体验加载失败',
      '扣余额'
    ];
    const experiencePages = [
      {
        expectedDisplayName: expectedSpanishDisplayName,
        forbiddenTerms: sourceChineseTerms,
        language: 'es-ES',
        rejectCjk: true,
        requiredLocalizedTerms: ['Saldo', 'Modelo', 'Entrada', 'Salida', 'Enviar', 'Facturacion']
      },
      {
        expectedDisplayName: expectedJapaneseDisplayName,
        forbiddenTerms: [
          ...sourceChineseTerms,
          'Balance',
          'Model configuration',
          'Search model name',
          'Input',
          'Output',
          'Send',
          'Select model',
          'System prompt',
          'Insufficient balance',
          'Model experience failed to load'
        ],
        language: 'ja-JP',
        rejectCjk: false,
        requiredLocalizedTerms: ['残高', 'モデル', '入力', '出力', '送信', '課金']
      }
    ];
    const pageResults: Array<UserExperienceLocalizationState & { language: string; screenshotPath: string }> = [];

    for (const page of experiencePages) {
      const loadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
      await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/experience?language=${page.language}` });
      await loadEvent;
      await delay(2_000);

      const state = await waitForUserExperienceLocalizationState(cdp, {
        expectedDisplayName: page.expectedDisplayName,
        forbiddenTerms: page.forbiddenTerms,
        language: page.language,
        rejectCjk: page.rejectCjk,
        requiredLocalizedTerms: page.requiredLocalizedTerms
      });
      assert(
        state?.ok,
        `${page.language} experience page leaked source language or missed localized copy: ${
          state?.debug ?? 'experience localization state was not available'
        }`
      );

      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true
      }) as { data?: string };
      assert(
        typeof screenshot.data === 'string' && screenshot.data.length > 0,
        `User experience ${page.language} localization Chrome screenshot returned no data`
      );
      const screenshotPath = path.join(ARTIFACT_DIR, `user-experience-${page.language}-${Date.now()}.png`);
      await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
      pageResults.push({ ...state, language: page.language, screenshotPath });
    }

    const consoleErrors = collectConsoleErrors(events);
    assert(consoleErrors.length === 0, `User experience localization Chrome console errors detected: ${consoleErrors.join(' | ')}`);

    await cdp.send('Browser.close').catch(() => undefined);
    await cdp.close();
    checks.push('chrome_user_experience_localized_no_source_leak_smoke');
    return {
      page: `${WEB_BASE_URL}/experience?language=es-ES`,
      japanesePage: `${WEB_BASE_URL}/experience?language=ja-JP`,
      modelName: seeded.modelName,
      expectedSpanishDisplayName,
      expectedJapaneseDisplayName,
      screenshotPath: pageResults[0]?.screenshotPath,
      japaneseExperienceScreenshotPath: pageResults[1]?.screenshotPath,
      consoleErrorCount: consoleErrors.length,
      languages: pageResults.map((page) => page.language),
      cjkMatches: Object.fromEntries(pageResults.map((page) => [page.language, page.cjkMatches])),
      leakedSourceTerms: Object.fromEntries(pageResults.map((page) => [page.language, page.leakedSourceTerms])),
      requiredLocalizedTerms: Object.fromEntries(pageResults.map((page) => [page.language, page.requiredLocalizedTerms]))
    };
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome, 5_000);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    if (seeded) {
      await cleanupMerchantModelConfigSmokeData(prisma, {
        adminUserId: seeded.userId,
        usernamePrefix,
        username: seeded.username,
        groupId: seeded.groupId,
        modelId: seeded.modelId,
        modelName: seeded.modelName,
        upstreamModelName: seeded.upstreamModelName,
        mappingId: seeded.mappingId,
        providerId: seeded.providerId
      }).finally(() => prisma.$disconnect());
    } else {
      await prisma.$disconnect();
    }
  }
}

async function runChromeMerchantDashboardPerformanceSmoke() {
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const usernamePrefix = `rgd_${suffix}`;
  const password = `qa-password-${suffix}`;
  const maxDashboardReadyMs = Number(process.env.RELEASE_GATE_MERCHANT_DASHBOARD_READY_MAX_MS ?? 12_000);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL })
  });
  let adminUserId = '';
  let userId = '';
  let chrome: ChildProcess | null = null;
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'relay-gate-dashboard-chrome-'));

  try {
    const seeded = await seedMerchantDashboardSmokeData(prisma, usernamePrefix, password);
    adminUserId = seeded.adminUserId;
    userId = seeded.userId;
    const login = await loginReleaseGateAdmin(seeded.username, password);

    const chromePath = resolveChromePath();
    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--window-size=1440,1000',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const port = await readDevToolsPort(userDataDir);
    const target = await firstPageTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const events: CdpEvent[] = [];
    cdp.onEvent((event) => events.push(event));

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await setBrowserCookies(cdp, WEB_BASE_URL, login.cookies);

    const startedAt = Date.now();
    const loadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/merchant` });
    await loadEvent;
    const pageState = await waitForMerchantDashboardPerformanceState(cdp, seeded.userUsername);
    const dashboardReadyMs = Date.now() - startedAt;
    assert(pageState?.ok, `merchant dashboard smoke did not reach ready state: ${pageState?.debug ?? 'no-state'}`);
    assert(
      dashboardReadyMs <= maxDashboardReadyMs,
      `merchant dashboard took ${dashboardReadyMs}ms to become ready, limit ${maxDashboardReadyMs}ms`
    );

    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    }) as { data?: string };
    assert(typeof screenshot.data === 'string' && screenshot.data.length > 0, 'Chrome dashboard screenshot capture returned no data');
    const screenshotPath = path.join(ARTIFACT_DIR, `merchant-dashboard-performance-${Date.now()}.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

    const consoleErrors = collectConsoleErrors(events);
    assert(consoleErrors.length === 0, `Chrome dashboard console errors detected: ${consoleErrors.join(' | ')}`);

    await cdp.send('Browser.close').catch(() => undefined);
    await cdp.close();
    checks.push('chrome_merchant_dashboard_performance_smoke');
    return {
      page: `${WEB_BASE_URL}/merchant`,
      dashboardReadyMs,
      maxDashboardReadyMs,
      criticalMetricCount: pageState.criticalMetricCount,
      metricPanelCount: pageState.metricPanelCount,
      seededUserVisible: pageState.seededUserVisible,
      tableRowCount: pageState.tableRowCount,
      screenshotPath,
      consoleErrorCount: consoleErrors.length
    };
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome, 5_000);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    await cleanupMerchantDashboardSmokeData(prisma, usernamePrefix, adminUserId, userId).finally(() => prisma.$disconnect());
  }
}

async function runChromeMerchantAnnouncementSmoke() {
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const usernamePrefix = `rgm_${suffix}`;
  const password = `qa-password-${suffix}`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL })
  });
  let adminUserId = '';
  let announcementId = '';
  let chrome: ChildProcess | null = null;
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'relay-gate-merchant-chrome-'));

  try {
    const seeded = await seedMerchantAnnouncementSmokeData(prisma, usernamePrefix, password);
    adminUserId = seeded.adminUserId;
    announcementId = seeded.announcementId;
    const login = await loginReleaseGateAdmin(seeded.username, password);
    const chromePath = resolveChromePath();

    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--window-size=1440,1000',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const port = await readDevToolsPort(userDataDir);
    const target = await firstPageTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const events: CdpEvent[] = [];
    cdp.onEvent((event) => events.push(event));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await setBrowserCookies(cdp, WEB_BASE_URL, login.cookies);

    const loadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/merchant/announcements` });
    await loadEvent;
    await delay(2_000);

    const pageStateResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(() => {
        const text = document.body?.innerText ?? '';
        const previewSelect = document.querySelector('[data-preview-language-select]');
        const previewOptions = Array.from(previewSelect?.querySelectorAll('option') ?? []);
        return {
          text,
          announcementRows: document.querySelectorAll('.announcement-item').length,
          hasDraftStatus: Boolean(document.querySelector('[data-announcement-draft-status]')),
          hasGlossaryForm: Boolean(document.querySelector('[data-qa="merchant-translation-glossary-form"]')),
          hasPreviewSelect: Boolean(previewSelect),
          hasPreviewAction: Boolean(document.querySelector('[data-preview-sync-button]')),
          hasMissingFallbackOption: previewOptions.some((option) =>
            option.textContent?.includes('\\u7f3a\\u5931\\u65f6\\u56de\\u6e90')
          )
        };
      })()`
    }) as RuntimeEvaluationResult<MerchantAnnouncementPageState>;
    if (pageStateResult.exceptionDetails) {
      assert(false, `merchant announcement page state evaluation failed: ${formatRuntimeEvaluationFailure(pageStateResult)}`);
    }
    const pageState = pageStateResult.result?.value;
    assert(pageState, 'merchant announcement page state missing');
    assert(pageState.text.includes(usernamePrefix), 'merchant announcement page did not render seeded announcement');
    assert(pageState.announcementRows >= 1, 'merchant announcement page did not render announcement rows');
    assert(pageState.hasDraftStatus, 'merchant announcement page missing local draft status');
    assert(pageState.hasGlossaryForm, 'merchant announcement page missing translation glossary form');
    assert(pageState.hasPreviewSelect, 'merchant announcement page missing server preview language selector');
    assert(pageState.hasPreviewAction, 'merchant announcement page missing preview sync action');
    assert(pageState.hasMissingFallbackOption, 'merchant announcement page missing missing-translation fallback language options');

    const workflowPanelStateResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(() => ({
        workflowPanelFound: Boolean(document.querySelector('[data-announcement-workflow-panel]')),
        workflowStatusFilterFound: Boolean(document.querySelector('[data-announcement-workflow-status-filter]')),
        workflowCategoryFilterFound: Boolean(document.querySelector('[data-announcement-workflow-category-filter]')),
        workflowCountText: (document.querySelector('[data-announcement-workflow-count]')?.textContent ?? '').trim(),
        workflowMachineDraftCountText: (document.querySelector('[data-announcement-workflow-machine-draft-count]')?.textContent ?? '').trim(),
        workflowEntrySources: Array.from(document.querySelectorAll('[data-announcement-workflow-entry-source]')).map((node) =>
          node.getAttribute('data-announcement-workflow-entry-source') ?? ''
        ),
        workflowEntryLocks: Array.from(document.querySelectorAll('[data-announcement-workflow-entry-locked]')).map((node) =>
          node.getAttribute('data-announcement-workflow-entry-locked') ?? ''
        ),
        workflowEntryStatuses: Array.from(document.querySelectorAll('[data-announcement-workflow-entry-status]')).map((node) =>
          node.getAttribute('data-announcement-workflow-entry-status') ?? ''
        ),
        workflowEntrySourceLabelCount: document.querySelectorAll('[data-announcement-workflow-entry-source-label]').length,
        workflowEntryCoverageCount: document.querySelectorAll('[data-announcement-workflow-entry-coverage]').length,
      }))()`
    }) as { result?: { value?: MerchantAnnouncementWorkflowPanelState } };
    const workflowPanelState = workflowPanelStateResult.result?.value;
    assert(workflowPanelState?.workflowPanelFound, 'merchant announcement page missing workflow panel');
    assert(workflowPanelState?.workflowStatusFilterFound, 'merchant announcement page missing workflow status filter');
    assert(workflowPanelState?.workflowCategoryFilterFound, 'merchant announcement page missing workflow category filter');
    assert(workflowPanelState?.workflowCountText?.length > 0, 'merchant announcement page workflow count text is empty');
    assert(
      workflowPanelState.workflowMachineDraftCountText?.length > 0,
      'merchant announcement machine draft count text is empty'
    );
    assert(
      workflowPanelState.workflowEntrySources?.includes('release-gate'),
      `merchant announcement workflow source metadata missing release-gate source: ${workflowPanelState.workflowEntrySources?.join(',') ?? 'none'}`
    );
    assert(
      workflowPanelState.workflowEntryStatuses?.includes('human_reviewed') &&
        workflowPanelState.workflowEntryStatuses?.includes('machine_draft'),
      `merchant announcement workflow status metadata missing expected states: ${workflowPanelState.workflowEntryStatuses?.join(',') ?? 'none'}`
    );
    assert(
      workflowPanelState.workflowEntryLocks?.includes('true') && workflowPanelState.workflowEntryLocks?.includes('false'),
      `merchant announcement workflow locked metadata missing true/false states: ${workflowPanelState.workflowEntryLocks?.join(',') ?? 'none'}`
    );
    assert(workflowPanelState.workflowEntrySourceLabelCount > 0, 'merchant announcement workflow source labels are missing');
    assert(workflowPanelState.workflowEntryCoverageCount > 0, 'merchant announcement workflow coverage labels are missing');

    const workflowFilterResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantAnnouncementWorkflowFilterExpression(announcementId)
    }) as { result?: { value?: MerchantAnnouncementWorkflowFilterState } };
    const workflowFilter = workflowFilterResult.result?.value;
    assert(
      workflowFilter?.statusFilterSet && workflowFilter?.seededAnnouncementVisible,
      `merchant announcement workflow filter interaction failed: ${workflowFilter?.debug ?? 'missing state'}`
    );
    assert(
      (workflowFilter?.visibleAnnouncementRows ?? 0) >= 1,
      `merchant announcement workflow filter did not leave any announcement row visible for seeded machine-draft announcement`
    );

    const glossarySourceTerm = `${usernamePrefix}_SourceBrand`;
    const glossaryReplacementTerm = `${usernamePrefix}_LockedBrand`;
    const glossaryResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantTranslationGlossaryCreateExpression(glossarySourceTerm, glossaryReplacementTerm)
    }) as RuntimeEvaluationResult<MerchantTranslationGlossaryCreateState>;
    const glossaryState = glossaryResult.result?.value;
    assert(
      glossaryState?.ok,
      `merchant translation glossary create smoke failed: ${glossaryState?.debug ?? formatRuntimeEvaluationFailure(glossaryResult)}`
    );
    assert(glossaryState.savedFound, 'merchant translation glossary create smoke missing saved archive');
    assert(glossaryState.rowFound, `merchant translation glossary create smoke missing row for ${glossaryState.savedId}`);
    assert(glossaryState.savedText.includes(glossarySourceTerm), `merchant translation glossary archive missing source term: ${glossaryState.savedText}`);
    assert(glossaryState.savedText.includes(glossaryReplacementTerm), `merchant translation glossary archive missing replacement term: ${glossaryState.savedText}`);
    assert(
      glossaryState.locationSearch.includes('saved=glossary') && glossaryState.locationSearch.includes(`term=${encodeURIComponent(glossaryState.savedId)}`),
      `merchant translation glossary URL missing saved term state: ${glossaryState.locationSearch}`
    );

    const translationFormTitle = `${usernamePrefix}_fr_manual_title`;
    const translationFormContent = `${usernamePrefix}_fr_manual_content`;
    const translationFormResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantAnnouncementTranslationFormExpression(announcementId, 'fr-FR', translationFormTitle, translationFormContent)
    }) as RuntimeEvaluationResult<MerchantAnnouncementTranslationFormState>;
    const translationFormState = translationFormResult.result?.value;
    assert(
      translationFormState?.ok,
      `merchant announcement translation form smoke failed: ${translationFormState?.debug ?? formatRuntimeEvaluationFailure(translationFormResult)}`
    );
    assert(translationFormState.titleValue === translationFormTitle, `translation form title did not settle: ${translationFormState.titleValue}`);
    assert(translationFormState.contentValue === translationFormContent, `translation form content did not settle: ${translationFormState.contentValue}`);
    assert(translationFormState.statusValue === 'human_reviewed', `translation form status should be human_reviewed, got ${translationFormState.statusValue}`);
    assert(translationFormState.lockedChecked, 'translation form lock checkbox should be checked');
    assert(translationFormState.savedMessageFound, `translation save message missing: ${translationFormState.messageText}`);
    assert(translationFormState.archiveFound, 'translation form save did not show selected announcement archive');
    const persistedTranslation = await readAnnouncementTranslationRecord(prisma, announcementId, 'fr-FR');
    assert(
      persistedTranslation?.title === translationFormTitle,
      `persisted fr-FR translation title mismatch: ${JSON.stringify(persistedTranslation)}`
    );
    assert(
      persistedTranslation?.content === translationFormContent,
      `persisted fr-FR translation content mismatch: ${JSON.stringify(persistedTranslation)}`
    );
    assert(
      persistedTranslation?._status === 'human_reviewed',
      `persisted fr-FR translation status mismatch: ${JSON.stringify(persistedTranslation)}`
    );
    assert(
      persistedTranslation?._locked === true,
      `persisted fr-FR translation lock mismatch: ${JSON.stringify(persistedTranslation)}`
    );

    const draftTitle = `${usernamePrefix}_local_draft_title`;
    const draftContent = `${usernamePrefix}_local_draft_content`;
    const draftInteractionResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantAnnouncementDraftInteractionExpression(draftTitle, draftContent)
    }) as RuntimeEvaluationResult<MerchantAnnouncementDraftInteractionState>;
    const draftInteraction = draftInteractionResult.result?.value;
    assert(
      draftInteraction,
      `merchant draft smoke returned no state: ${formatRuntimeEvaluationFailure(draftInteractionResult)}`
    );
    assert(draftInteraction?.titleFound, `merchant draft smoke could not find title input: ${draftInteraction?.debug ?? 'missing state'}`);
    assert(draftInteraction.contentFound, `merchant draft smoke could not find content input: ${draftInteraction.debug}`);
    assert(draftInteraction.statusSelectFound, `merchant draft smoke could not find status select: ${draftInteraction.debug}`);
    assert(draftInteraction.draftSaved, `merchant draft smoke did not persist local draft: ${draftInteraction.draftStatus}`);

    const draftReloadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/merchant/announcements` });
    await draftReloadEvent;
    await delay(2_000);

    const draftRestoreResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantAnnouncementDraftRestoreExpression(draftTitle, draftContent)
    }) as { result?: { value?: MerchantAnnouncementDraftRestoreState } };
    const draftRestore = draftRestoreResult.result?.value;
    assert(draftRestore?.titleRestored, `merchant draft title did not restore after reload: ${draftRestore?.title ?? 'missing'}`);
    assert(draftRestore.contentRestored, `merchant draft content did not restore after reload: ${draftRestore.content ?? 'missing'}`);
    assert(draftRestore.statusRestored, `merchant draft status did not restore after reload: ${draftRestore.status ?? 'missing'}`);

    const selectedLoadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', {
      url: `${WEB_BASE_URL}/merchant/announcements?selected=${encodeURIComponent(announcementId)}&saved=announcement`
    });
    await selectedLoadEvent;
    await delay(2_000);

    const selectedArchiveResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantAnnouncementSelectedArchiveExpression(announcementId, `${usernamePrefix}_公告`)
    }) as { result?: { value?: MerchantAnnouncementSelectedArchiveState } };
    const selectedArchive = selectedArchiveResult.result?.value;
    assert(selectedArchive?.archiveFound, 'merchant selected archive panel missing after selected URL navigation');
    assert(
      selectedArchive.titleFound,
      `merchant selected archive did not hydrate the selected announcement: ${selectedArchive.archiveText}`
    );
    assert(
      selectedArchive.savedMessageFound,
      `merchant selected archive did not show saved message after selected URL navigation: ${selectedArchive.messageText}`
    );

    const networkStartIndex = events.length;
    const previewInteractionResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `((__name) => (${merchantPreviewInteraction.toString()})(${JSON.stringify(announcementId)}, ${JSON.stringify(`${usernamePrefix}_ja_title`)}))((target) => target)`
    }) as { result?: { value?: MerchantAnnouncementPreviewInteractionState } };
    const previewInteraction = previewInteractionResult.result?.value;
    assert(
      previewInteraction?.rowFound,
      `merchant preview smoke could not find seeded announcement row: ${previewInteraction?.debug ?? formatRuntimeEvaluationFailure(previewInteractionResult)}`
    );
    assert(previewInteraction.selectFound, 'merchant preview smoke could not find language select');
    assert(previewInteraction.buttonFound, 'merchant preview smoke could not find preview sync button');
    assert(previewInteraction.status.length > 0, `merchant preview status did not show server hit: ${previewInteraction.status}`);
    assert(
      previewInteraction.title.includes(`${usernamePrefix}_ja_title`),
      `merchant preview title did not update to server ja preview: ${previewInteraction.title}`
    );
    const previewNetwork = summarizePreviewNetwork(events.slice(networkStartIndex), announcementId);
    const previewFetch = previewInteraction.previewFetches.find((item) => {
      return item.url.includes(`/announcements/${announcementId}/preview`) && item.url.includes('language=ja-JP');
    });
    const previewFetchSummary =
      previewInteraction.previewFetches.length > 0 ? JSON.stringify(previewInteraction.previewFetches) : 'none';
    assert(
      previewNetwork.requestObserved || Boolean(previewFetch),
      `merchant preview smoke did not send preview request: network=${previewNetwork.summary}; fetch=${previewFetchSummary}`
    );
    assert(
      previewNetwork.successResponseObserved || previewFetch?.ok,
      `merchant preview smoke did not observe preview endpoint HTTP success: network=${previewNetwork.summary}; fetch=${previewFetchSummary}`
    );

    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    }) as { data?: string };
    assert(typeof screenshot.data === 'string' && screenshot.data.length > 0, 'Merchant Chrome screenshot capture returned no data');
    const screenshotPath = path.join(ARTIFACT_DIR, `merchant-announcements-workflow-${Date.now()}.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

    const consoleErrors = collectConsoleErrors(events);
    assert(consoleErrors.length === 0, `Merchant Chrome console errors detected: ${consoleErrors.join(' | ')}`);

    await cdp.send('Browser.close').catch(() => undefined);
    await cdp.close();
    checks.push('chrome_merchant_announcements_workflow_smoke');
    return {
      page: `${WEB_BASE_URL}/merchant/announcements`,
      announcementId,
      announcementRows: pageState.announcementRows,
      draftStatus: draftInteraction.draftStatus,
      glossarySavedText: glossaryState.savedText,
      translationFormSavedText: translationFormState.messageText,
      restoredDraftTitle: draftRestore.title,
      selectedArchiveText: selectedArchive.archiveText,
      previewStatus: previewInteraction.status,
      previewTitle: previewInteraction.title,
      screenshotPath,
      consoleErrorCount: consoleErrors.length
    };
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome, 5_000);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    await cleanupMerchantAnnouncementSmokeData(prisma, usernamePrefix, adminUserId, announcementId).finally(() => prisma.$disconnect());
  }
}

async function runChromeMerchantModelConfigSaveSmoke() {
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const usernamePrefix = `rmg_${suffix}`;
  const password = `qa-password-${suffix}`;
  const modelName = `${usernamePrefix}_model`;
  const upstreamModelName = `${modelName}_upstream`;
  const formUpstreamModelName = `${modelName}_form_upstream`;
  const providerName = `${usernamePrefix}_provider`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL })
  });
  let adminUserId = '';
  let username = '';
  let modelId = '';
  let groupId = '';
  let providerId = '';
  let mappingId = '';
  const screenshotPrefix = `merchant-model-config-save-${Date.now()}`;
  let chrome: ChildProcess | null = null;
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'relay-gate-model-config-chrome-'));

  try {
    const seeded = await seedMerchantModelConfigSmokeData(prisma, usernamePrefix, password);
    adminUserId = seeded.adminUserId;
    username = seeded.username;
    const login = await loginReleaseGateAdmin(username, password);
    const cookieHeader = login.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    const browserApi = async <T>(method: string, endpoint: string, body?: unknown): Promise<ApiJsonResponse<T>> => {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(cookieHeader ? { cookie: cookieHeader } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const text = await response.text();
      let json = {} as T;
      if (text) {
        try {
          json = JSON.parse(text) as T;
        } catch {
          json = {} as T;
        }
      }
      assert(response.status >= 200 && response.status < 300, `merchant model-config smoke API call to ${endpoint} failed with ${response.status}`);
      return { status: response.status, json, text };
    };

    const group = await browserApi<{ id: string; code: string }>(
      'POST',
      '/admin/groups',
      {
        code: `${usernamePrefix}_group`,
        name: `${usernamePrefix} Group`,
        multiplier: '1.0000'
      }
    );
    groupId = group.json.id;

    const model = await browserApi<{ id: string; model: string }>(
      'POST',
      '/admin/models',
      {
        model: modelName,
        displayName: `${modelName} display`,
        groupIds: [groupId]
      }
    );
    modelId = model.json.id;

    const provider = await browserApi<{ id: string }>(
      'POST',
      '/admin/upstreams',
      {
        name: providerName,
        baseUrl: `https://${providerName}.example.invalid`,
        apiKey: `qa-${usernamePrefix}-provider-key`,
        status: 'active'
      }
    );
    providerId = provider.json.id;

    const mapping = await browserApi<{ id: string; publicModel: string }>(
      'POST',
      '/admin/upstream-models',
      {
        providerId,
        publicModel: modelName,
        upstreamModel: upstreamModelName,
        priority: 1,
        timeoutMs: 5000,
        upstreamPrompt: 'Release gate model-config smoke prompt',
        pricingMode: 'manual',
        inputPriceCentsPer1k: 17,
        outputPriceCentsPer1k: 31,
        modelMultiplier: '1.0000',
        status: 'active',
        supportsStream: true
      }
    );
    mappingId = mapping.json.id;

    const chromePath = resolveChromePath();
    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--window-size=1440,1000',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const port = await readDevToolsPort(userDataDir);
    const target = await firstPageTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const events: CdpEvent[] = [];
    cdp.onEvent((event) => events.push(event));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await setBrowserCookies(cdp, WEB_BASE_URL, login.cookies);

    const configUrl = `${WEB_BASE_URL}/merchant/model-config?model=${encodeURIComponent(modelName)}&selectedModel=${encodeURIComponent(modelId)}&saved=model`;
    const configLoadEvent = cdp.waitEvent('Page.loadEventFired', 20_000);
    await cdp.send('Page.navigate', { url: configUrl });
    await configLoadEvent;
    await delay(1_500);

    const modelConfigState = await waitForMerchantModelConfigSavedState(cdp, modelId);
    assert(modelConfigState?.ok, `merchant model-config save smoke did not show saved model archive: ${modelConfigState?.messageText ?? 'no-state'}`);
    assert(
      modelConfigState?.selectedModelIdFromPanel === modelId,
      `merchant model-config saved archive id mismatch: ${modelConfigState.selectedModelIdFromPanel}`
    );
    assert(
      modelConfigState?.selectedModelFound && modelConfigState?.savedPanelFound && modelConfigState?.savedPanelVisible,
      `merchant model-config save smoke missing visible saved archive for ${modelId}`
    );
    assert(modelConfigState?.urlSearch.includes('saved=model'), `merchant model-config save smoke missing saved query state: ${modelConfigState?.urlSearch}`);
    assert(modelConfigState?.selectedModelActive, 'merchant model-config save smoke did not preserve active selected model row');

    const returnBase = `${WEB_BASE_URL}/merchant`;
    const returnLoadEvent = cdp.waitEvent('Page.loadEventFired', 20_000);
    await cdp.send('Page.navigate', { url: returnBase });
    await returnLoadEvent;
    await delay(1_000);

    const restoreLoadEvent = cdp.waitEvent('Page.loadEventFired', 20_000);
    await cdp.send('Page.navigate', { url: configUrl });
    await restoreLoadEvent;
    await delay(1_000);
    const restoreModelState = await waitForMerchantModelConfigSavedState(cdp, modelId);
    assert(
      restoreModelState?.ok,
      `merchant model-config restore smoke did not rehydrate saved archive after navigation: ${restoreModelState?.messageText ?? 'no-state'}`
    );
    assert(restoreModelState?.urlSearch.includes('saved=model'), `merchant model-config restore smoke missing saved query state: ${restoreModelState?.urlSearch}`);
    assert(restoreModelState?.selectedModelActive, 'merchant model-config restore smoke did not keep active saved model row');

    const routesUrl = `${WEB_BASE_URL}/merchant/model-routes?model=${encodeURIComponent(modelName)}&selectedModel=${encodeURIComponent(modelId)}&mapping=${encodeURIComponent(mappingId)}&selected=${encodeURIComponent(mappingId)}&saved=route`;
    const routesLoadEvent = cdp.waitEvent('Page.loadEventFired', 20_000);
    await cdp.send('Page.navigate', { url: routesUrl });
    await routesLoadEvent;
    await delay(1_500);

    const routesState = await waitForMerchantModelConfigRoutesSavedState(cdp, mappingId);
    assert(
      routesState?.ok,
      `merchant model-routes save smoke did not show selected mapping detail: ${routesState?.debug ?? 'no-state'}`
    );
    assert(routesState?.urlSearch.includes('saved=route'), `merchant model-routes save smoke missing saved query state: ${routesState?.urlSearch}`);
    assert(routesState?.selectedMappingIdFromPanel === mappingId, `merchant model-routes selected mapping mismatch: ${routesState?.selectedMappingIdFromPanel}`);

    const routeRestoreLoadEvent = cdp.waitEvent('Page.loadEventFired', 20_000);
    await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/merchant` });
    await routeRestoreLoadEvent;
    await delay(1_000);
    const routeReloadEvent = cdp.waitEvent('Page.loadEventFired', 20_000);
    await cdp.send('Page.navigate', { url: routesUrl });
    await routeReloadEvent;
    await delay(1_000);
    const routeRestoreState = await waitForMerchantModelConfigRoutesSavedState(cdp, mappingId);
    assert(routeRestoreState?.ok, `merchant model-routes restore smoke failed after navigation: ${routeRestoreState?.debug ?? 'no-state'}`);
    assert(routeRestoreState?.urlSearch.includes('saved=route'), `merchant model-routes restore smoke missing saved query state: ${routeRestoreState?.urlSearch}`);
    assert(routeRestoreState?.selectedMappingActive, 'merchant model-routes restore smoke did not keep active mapping row');

    const formRouteUrl = `${WEB_BASE_URL}/merchant/model-routes?model=${encodeURIComponent(modelName)}&selectedModel=${encodeURIComponent(modelId)}`;
    const formRouteLoadEvent = cdp.waitEvent('Page.loadEventFired', 20_000);
    await cdp.send('Page.navigate', { url: formRouteUrl });
    await formRouteLoadEvent;
    await delay(1_500);

    const submitRouteResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantModelRoutesFormSubmitExpression({
        modelName,
        providerId,
        upstreamModelName: formUpstreamModelName
      })
    }) as RuntimeEvaluationResult<{ ok: boolean; debug: string }>;
    const submitRouteState = submitRouteResult.result?.value;
    assert(
      submitRouteState?.ok,
      `merchant model-routes form submit did not start: ${submitRouteState?.debug ?? formatRuntimeEvaluationFailure(submitRouteResult)}`
    );

    const submittedRouteState = await waitForMerchantModelConfigRoutesSubmittedState(cdp, {
      publicModel: modelName,
      providerId,
      upstreamModel: formUpstreamModelName
    });
    assert(
      submittedRouteState?.ok,
      `merchant model-routes form submit smoke did not show saved route archive: ${submittedRouteState?.debug ?? 'no-state'}`
    );
    assert(
      submittedRouteState.selectedProviderIdFromPanel === providerId,
      `merchant model-routes submitted archive provider mismatch: ${submittedRouteState.selectedProviderIdFromPanel}`
    );
    assert(
      submittedRouteState.selectedUpstreamModelFromPanel === formUpstreamModelName,
      `merchant model-routes submitted archive upstream model mismatch: ${submittedRouteState.selectedUpstreamModelFromPanel}`
    );
    assert(
      submittedRouteState.urlSearch.includes('saved=route') && submittedRouteState.urlSearch.includes('mapping='),
      `merchant model-routes submitted URL missing saved route state: ${submittedRouteState.urlSearch}`
    );

    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    }) as { data?: string };
    assert(typeof screenshot.data === 'string' && screenshot.data.length > 0, 'Merchant model-config Chrome screenshot capture returned no data');
    const screenshotPath = path.join(ARTIFACT_DIR, `${screenshotPrefix}-${Date.now()}.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

    const consoleErrors = collectConsoleErrors(events);
    assert(consoleErrors.length === 0, `Merchant model-config Chrome console errors detected: ${consoleErrors.join(' | ')}`);

    await cdp.send('Browser.close').catch(() => undefined);
    await cdp.close();
    checks.push('chrome_merchant_model_config_save_smoke');
    return {
      page: `${WEB_BASE_URL}/merchant/model-config`,
      modelName,
      modelId,
      mappingId,
      screenshotPath,
      consoleErrorCount: consoleErrors.length
    };
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome, 5_000);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    await cleanupMerchantModelConfigSmokeData(prisma, {
      adminUserId,
      usernamePrefix,
      username,
      groupId,
      modelId,
      modelName,
      upstreamModelName,
      mappingId,
      providerId
    }).finally(() => prisma.$disconnect());
  }
}

async function runChromeMerchantRechargeCodesSmoke() {
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const usernamePrefix = `rgr_${suffix}`;
  const password = `qa-password-${suffix}`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL })
  });
  let adminUserId = '';
  let selectedCodeId = '';
  let chrome: ChildProcess | null = null;
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'relay-gate-recharge-chrome-'));

  try {
    const seeded = await seedMerchantRechargeCodeSmokeData(prisma, usernamePrefix, password);
    adminUserId = seeded.adminUserId;
    const login = await loginReleaseGateAdmin(seeded.username, password);
    const chromePath = resolveChromePath();

    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--window-size=1440,1000',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const port = await readDevToolsPort(userDataDir);
    const target = await firstPageTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const events: CdpEvent[] = [];
    cdp.onEvent((event) => events.push(event));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await setBrowserCookies(cdp, WEB_BASE_URL, login.cookies);

    const loadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/merchant/recharge-codes` });
    await loadEvent;
    await delay(2_000);

    const createResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantRechargeCreateExpression()
    }) as RuntimeEvaluationResult<MerchantRechargeCodeCreateState>;
    const createState = createResult.result?.value;
    assert(createState?.ok, `merchant recharge create smoke failed: ${createState?.debug ?? formatRuntimeEvaluationFailure(createResult)}`);
    assert(createState.createdCount === 2, `merchant recharge create smoke expected 2 created codes, got ${createState.createdCount}`);
    assert(createState.savedFound, 'merchant recharge create smoke missing saved archive panel');
    assert(createState.createdFound, 'merchant recharge create smoke missing one-time created codes panel');
    assert(createState.firstCreatedId.length > 0, 'merchant recharge create smoke did not expose first created id');
    assert(createState.savedId === createState.firstCreatedId, `merchant recharge saved id mismatch: ${createState.savedId} vs ${createState.firstCreatedId}`);
    assert(createState.savedKind === 'vibe_coding', `merchant recharge saved kind should be vibe_coding, got ${createState.savedKind}`);
    assert(createState.rowFound, `merchant recharge created code row did not hydrate before selected navigation: ${createState.debug}`);
    assert(createState.locationSearch.includes(`selected=${encodeURIComponent(createState.firstCreatedId)}`), `merchant recharge URL missing selected id: ${createState.locationSearch}`);
    assert(createState.savedText.includes('5h') && createState.savedText.includes('7') && createState.savedText.includes('50,000'), `merchant recharge saved text missing quota details: ${createState.savedText}`);
    selectedCodeId = createState.firstCreatedId;

    const selectedLoadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', {
      url: `${WEB_BASE_URL}/merchant/recharge-codes?selected=${encodeURIComponent(selectedCodeId)}`
    });
    await selectedLoadEvent;
    await delay(2_000);

    const selectedResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantRechargeSelectedArchiveExpression(selectedCodeId)
    }) as RuntimeEvaluationResult<MerchantRechargeCodeSelectedState>;
    const selectedState = selectedResult.result?.value;
    assert(selectedState?.ok, `merchant recharge selected archive smoke failed: ${selectedState?.debug ?? formatRuntimeEvaluationFailure(selectedResult)}`);
    assert(selectedState.savedId === selectedCodeId, `merchant recharge selected archive did not restore selected id: ${selectedState.savedId}`);
    assert(selectedState.rowFound, `merchant recharge selected archive missing table row for ${selectedCodeId}`);
    assert(selectedState.savedKind === 'vibe_coding', `merchant recharge selected archive kind mismatch: ${selectedState.savedKind}`);

    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    }) as { data?: string };
    assert(typeof screenshot.data === 'string' && screenshot.data.length > 0, 'Merchant recharge Chrome screenshot capture returned no data');
    const screenshotPath = path.join(ARTIFACT_DIR, `merchant-recharge-codes-save-${Date.now()}.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

    const consoleErrors = collectConsoleErrors(events);
    assert(consoleErrors.length === 0, `Merchant recharge Chrome console errors detected: ${consoleErrors.join(' | ')}`);

    await cdp.send('Browser.close').catch(() => undefined);
    await cdp.close();
    checks.push('chrome_merchant_recharge_codes_save_smoke');
    return {
      page: `${WEB_BASE_URL}/merchant/recharge-codes`,
      selectedCodeId,
      createdCount: createState.createdCount,
      savedText: selectedState.savedText,
      screenshotPath,
      consoleErrorCount: consoleErrors.length
    };
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome, 5_000);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    await cleanupMerchantRechargeCodeSmokeData(prisma, usernamePrefix, adminUserId).finally(() => prisma.$disconnect());
  }
}

async function readAnnouncementTranslationRecord(
  prisma: PrismaClient,
  announcementId: string,
  language: string
): Promise<Record<string, unknown> | null> {
  const announcement = await prisma.announcement.findUniqueOrThrow({
    where: { id: announcementId },
    select: { translations: true }
  });
  const translations = plainRecordOrNull(announcement.translations);
  const translation = translations?.[language];
  return plainRecordOrNull(translation);
}

function plainRecordOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function runChromeMerchantAiRechargeSmoke() {
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const usernamePrefix = `rga_${suffix}`;
  const password = `qa-password-${suffix}`;
  const productTitle = `${usernamePrefix}_VibeCoding套餐`;
  const dailyProductTitle = `${usernamePrefix}_VibeCoding日包`;
  const spanishWeeklyTitle = `${usernamePrefix}_VibeCoding paquete semanal`;
  const spanishDailyTitle = `${usernamePrefix}_VibeCoding paquete diario`;
  const spanishPlatform = `${usernamePrefix}_VibeCoding ES`;
  const spanishIntroTitle = `${usernamePrefix}_Intro ES`;
  const spanishIntroContent = `Contenido introductorio localizado ${suffix}`;
  const japaneseWeeklyTitle = `${usernamePrefix}_VibeCoding 週間パッケージ`;
  const japaneseDailyTitle = `${usernamePrefix}_VibeCoding 1日パッケージ`;
  const japaneseIntroTitle = `${usernamePrefix}_Intro JA`;
  const japaneseIntroContent = `日本語の紹介文 ${suffix}`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL })
  });
  let adminUserId = '';
  let selectedProductId = '';
  let dailyProductId = '';
  const introTitle = `${usernamePrefix}_Intro`;
  const introContent = `Release gate intro save content ${suffix}`;
  const deletedProductTitle = `${usernamePrefix}_DeleteSmoke`;
  const orderNote = `Release gate order note ${suffix}`;
  let selectedOrderId = '';
  let deletedProductId = '';
  let deletedProductText = '';
  let introSavedText = '';
  let orderSavedText = '';
  let chrome: ChildProcess | null = null;
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'relay-gate-ai-recharge-chrome-'));

  try {
    const seeded = await seedMerchantAiRechargeSmokeData(prisma, usernamePrefix, password);
    adminUserId = seeded.adminUserId;
    const login = await loginReleaseGateAdmin(seeded.username, password);
    const chromePath = resolveChromePath();

    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--window-size=1440,1000',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const port = await readDevToolsPort(userDataDir);
    const target = await firstPageTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const events: CdpEvent[] = [];
    cdp.onEvent((event) => events.push(event));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await setBrowserCookies(cdp, WEB_BASE_URL, login.cookies);

    const loadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/merchant/ai-recharge` });
    await loadEvent;
    await delay(2_000);

    const createResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantAiRechargeProductCreateExpression(productTitle)
    }) as RuntimeEvaluationResult<MerchantAiRechargeProductCreateState>;
    const createState = createResult.result?.value;
    assert(createState?.ok, `merchant AI recharge product create smoke failed: ${createState?.debug ?? formatRuntimeEvaluationFailure(createResult)}`);
    assert(createState.savedFound, 'merchant AI recharge create smoke missing saved product archive');
    assert(createState.savedId.length > 0, 'merchant AI recharge create smoke did not expose saved product id');
    assert(createState.savedKind === 'vibe_coding', `merchant AI recharge saved kind should be vibe_coding, got ${createState.savedKind}`);
    assert(createState.rowFound, `merchant AI recharge saved product row missing for ${createState.savedId}`);
    assert(createState.locationSearch.includes(`selected=${encodeURIComponent(createState.savedId)}`), `merchant AI recharge URL missing selected id: ${createState.locationSearch}`);
    assert(createState.savedText.includes(productTitle), `merchant AI recharge saved archive missing title: ${createState.savedText}`);
    assert(
      createState.savedText.includes('5h') && createState.savedText.includes('7d') && createState.savedText.includes('50,000'),
      `merchant AI recharge saved archive missing quota details: ${createState.savedText}`
    );
    selectedProductId = createState.savedId;
    await prisma.aiRechargeProduct.update({
      where: { id: selectedProductId },
      data: {
        translations: {
          'es-ES': {
            title: spanishWeeklyTitle,
            platform: spanishPlatform,
            planName: 'Semanal 5h',
            description: `${usernamePrefix} paquete semanal localizado`,
            purchaseNote: 'Nota de compra localizada',
            deliveryNote: 'Nota de entrega localizada'
          },
          'ja-JP': {
            title: japaneseWeeklyTitle,
            platform: `${usernamePrefix}_VibeCoding JA`,
            planName: '週間 5h',
            description: `${usernamePrefix} 週間パッケージ説明`,
            purchaseNote: '購入メモローカライズ済み',
            deliveryNote: '納品メモローカライズ済み'
          }
        }
      }
    });
    const dailyProduct = await seedMerchantAiRechargeDailyProductData(prisma, adminUserId, usernamePrefix, dailyProductTitle);
    dailyProductId = dailyProduct.id;
    await prisma.aiRechargeProduct.update({
      where: { id: dailyProductId },
      data: {
        translations: {
          'es-ES': {
            title: spanishDailyTitle,
            platform: spanishPlatform,
            planName: 'Diario 5h',
            description: `${usernamePrefix} paquete diario localizado`,
            purchaseNote: 'Nota de compra diaria localizada',
            deliveryNote: 'Nota de entrega diaria localizada'
          },
          'ja-JP': {
            title: japaneseDailyTitle,
            platform: `${usernamePrefix}_VibeCoding JA`,
            planName: '1日 5h',
            description: `${usernamePrefix} 1日パッケージ説明`,
            purchaseNote: '1日購入メモローカライズ済み',
            deliveryNote: '1日納品メモローカライズ済み'
          }
        }
      }
    });

    const selectedLoadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', {
      url: `${WEB_BASE_URL}/merchant/ai-recharge?products=1&selected=${encodeURIComponent(selectedProductId)}&saved=product`
    });
    await selectedLoadEvent;
    await delay(2_000);

    const selectedResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantAiRechargeSelectedArchiveExpression(selectedProductId, productTitle)
    }) as RuntimeEvaluationResult<MerchantAiRechargeSelectedState>;
    const selectedState = selectedResult.result?.value;
    assert(selectedState?.ok, `merchant AI recharge selected archive smoke failed: ${selectedState?.debug ?? formatRuntimeEvaluationFailure(selectedResult)}`);
    assert(selectedState.savedId === selectedProductId, `merchant AI recharge selected archive did not restore selected id: ${selectedState.savedId}`);
    assert(selectedState.rowFound, `merchant AI recharge selected archive missing table row for ${selectedProductId}`);
    assert(selectedState.rowActive, `merchant AI recharge selected product row is not visually active for ${selectedProductId}`);
    assert(selectedState.savedText.includes(productTitle), `merchant AI recharge selected archive missing saved title: ${selectedState.savedText}`);

    const deleteProduct = await seedMerchantAiRechargeDeleteProductData(prisma, adminUserId, usernamePrefix, deletedProductTitle);
    deletedProductId = deleteProduct.id;
    const deleteLoadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', {
      url: `${WEB_BASE_URL}/merchant/ai-recharge?products=1&selected=${encodeURIComponent(deletedProductId)}&saved=product`
    });
    await deleteLoadEvent;
    await delay(2_000);

    const deleteResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantAiRechargeProductDeleteExpression(deletedProductId, deletedProductTitle)
    }) as RuntimeEvaluationResult<MerchantAiRechargeProductDeleteState>;
    const deleteState = deleteResult.result?.value;
    assert(deleteState?.ok, `merchant AI recharge product delete smoke failed: ${deleteState?.debug ?? formatRuntimeEvaluationFailure(deleteResult)}`);
    assert(deleteState.deletedFound, 'merchant AI recharge product delete smoke missing deleted product archive');
    assert(deleteState.deletedId === deletedProductId, `merchant AI recharge product delete archive did not expose deleted id: ${deleteState?.deletedId}`);
    assert(deleteState.rowGone, `merchant AI recharge product delete row still visible for ${deletedProductId}`);
    assert(deleteState.urlHasDeletedState, `merchant AI recharge product delete smoke missing URL delete state: ${deleteState?.urlSearch}`);
    assert(deleteState.deletedText.includes(deletedProductTitle), `merchant AI recharge product delete archive missing title: ${deleteState.deletedText}`);
    deletedProductText = deleteState.deletedText;

    const introResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantAiRechargeIntroSaveExpression(introTitle, introContent)
    }) as RuntimeEvaluationResult<MerchantAiRechargeIntroSaveState>;
    const introState = introResult.result?.value;
    assert(introState?.ok, `merchant AI recharge intro save smoke failed: ${introState?.debug ?? formatRuntimeEvaluationFailure(introResult)}`);
    assert(introState.savedFound, 'merchant AI recharge intro save smoke missing intro saved panel');
    assert(introState.dataPageConfigSaved === 'true', `merchant AI recharge intro save smoke missing data-page-config-saved true: ${introState.dataPageConfigSaved}`);
    assert(introState.savedViaQuery, `merchant AI recharge intro save smoke missing saved=intro or intro=1 query state: ${introState.urlSearch}`);
    introSavedText = introState.savedText;
    await prisma.aiRechargePageConfig.update({
      where: { id: 'default' },
      data: {
        translations: {
          'es-ES': {
            introTitle: spanishIntroTitle,
            introContent: spanishIntroContent
          },
          'ja-JP': {
            introTitle: japaneseIntroTitle,
            introContent: japaneseIntroContent
          }
        }
      }
    });

    const seededOrder = await seedMerchantAiRechargeSmokeOrderData(
      prisma,
      adminUserId,
      selectedProductId,
      productTitle,
      'VibeCoding',
      orderNote
    );
    selectedOrderId = seededOrder.id;

    const orderLoadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', {
      url: `${WEB_BASE_URL}/merchant/ai-recharge?orders=1&order=${encodeURIComponent(selectedOrderId)}&saved=order`
    });
    await orderLoadEvent;
    await delay(2_000);

    const orderResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantAiRechargeOrderSaveExpression(selectedOrderId, orderNote)
    }) as RuntimeEvaluationResult<MerchantAiRechargeOrderSaveState>;
    const orderState = orderResult.result?.value;
    assert(orderState?.ok, `merchant AI recharge order save smoke failed: ${orderState?.debug ?? formatRuntimeEvaluationFailure(orderResult)}`);
    assert(orderState.savedFound, 'merchant AI recharge order save smoke missing order saved panel');
    assert(orderState.selectedOrderId === selectedOrderId, `merchant AI recharge order save smoke did not restore selected order id: ${orderState?.selectedOrderId}`);
    assert(orderState.rowFound, `merchant AI recharge order save missing row for ${selectedOrderId}`);
    assert(orderState.rowActive, `merchant AI recharge order save row is not visually active for ${selectedOrderId}`);
    assert(orderState.urlHasSavedState && orderState.urlHasOrderQuery, `merchant AI recharge order save smoke missing saved query state: ${orderState?.urlSearch}`);
    assert(orderState.savedText.includes(orderNote), `merchant AI recharge order saved archive missing saved note: ${orderState.savedText}`);
    orderSavedText = orderState.savedText;

    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    }) as { data?: string };
    assert(typeof screenshot.data === 'string' && screenshot.data.length > 0, 'Merchant AI recharge Chrome screenshot capture returned no data');
    const screenshotPath = path.join(ARTIFACT_DIR, `merchant-ai-recharge-save-${Date.now()}.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

    const userLogin = await loginReleaseGateAdmin(seeded.userUsername, password);
    await cdp.send('Network.clearBrowserCookies');
    await setBrowserCookies(cdp, WEB_BASE_URL, userLogin.cookies);

    const userProductLoadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/ai-recharge` });
    await userProductLoadEvent;
    await delay(2_000);

    const userProductResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildUserAiRechargeProductVisibleExpression({
        dailyProductId,
        dailyProductTitle,
        weeklyProductId: selectedProductId,
        weeklyProductTitle: productTitle
      })
    }) as RuntimeEvaluationResult<UserAiRechargeProductVisibleState>;
    const userProductState = userProductResult.result?.value;
    assert(
      userProductState?.ok,
      `user AI recharge page did not show merchant VibeCoding package: ${userProductState?.debug ?? formatRuntimeEvaluationFailure(userProductResult)}`
    );

    const localizedAiRechargeChecks = [
      {
        language: 'es-ES',
        label: 'Spanish',
        screenshotName: 'user-ai-recharge-es-ES',
        dailyProductTitle: spanishDailyTitle,
        expectedDailyPackageLabel: 'Paquete diario',
        expectedIntroContent: spanishIntroContent,
        expectedIntroTitle: spanishIntroTitle,
        expectedWeeklyPackageLabel: 'Paquete semanal',
        forbiddenSourceTitles: [dailyProductTitle, productTitle],
        weeklyProductTitle: spanishWeeklyTitle
      },
      {
        language: 'ja-JP',
        label: 'Japanese',
        screenshotName: 'user-ai-recharge-ja-JP',
        dailyProductTitle: japaneseDailyTitle,
        expectedDailyPackageLabel: '1日パッケージ',
        expectedIntroContent: japaneseIntroContent,
        expectedIntroTitle: japaneseIntroTitle,
        expectedWeeklyPackageLabel: '週間パッケージ',
        forbiddenSourceTitles: [
          dailyProductTitle,
          productTitle,
          spanishDailyTitle,
          spanishWeeklyTitle,
          'Membership recharge products',
          'Available recharge products',
          'Purchase notes',
          'Delivery notes',
          'Productos de recarga'
        ],
        weeklyProductTitle: japaneseWeeklyTitle
      }
    ] as const;

    const localizedAiRechargeResults: Array<{
      dailyCardText: string;
      introText: string;
      language: string;
      page: string;
      screenshotPath: string;
      weeklyCardText: string;
    }> = [];

    for (const check of localizedAiRechargeChecks) {
      const page = `${WEB_BASE_URL}/ai-recharge?language=${check.language}`;
      const localizedUserProductLoadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
      await cdp.send('Page.navigate', { url: page });
      await localizedUserProductLoadEvent;
      await delay(2_000);

      const localizedUserProductResult = await cdp.send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: buildUserAiRechargeProductVisibleExpression({
          dailyProductId,
          dailyProductTitle: check.dailyProductTitle,
          expectedDailyPackageLabel: check.expectedDailyPackageLabel,
          expectedIntroContent: check.expectedIntroContent,
          expectedIntroTitle: check.expectedIntroTitle,
          expectedWeeklyPackageLabel: check.expectedWeeklyPackageLabel,
          forbiddenSourceTitles: check.forbiddenSourceTitles,
          weeklyProductId: selectedProductId,
          weeklyProductTitle: check.weeklyProductTitle
        })
      }) as RuntimeEvaluationResult<UserAiRechargeProductVisibleState>;
      const localizedUserProductState = localizedUserProductResult.result?.value;
      assert(
        localizedUserProductState?.ok,
        `user AI recharge page did not follow selected ${check.label} language: ${
          localizedUserProductState?.debug ?? formatRuntimeEvaluationFailure(localizedUserProductResult)
        }`
      );

      const localizedUserScreenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true
      }) as { data?: string };
      assert(
        typeof localizedUserScreenshot.data === 'string' && localizedUserScreenshot.data.length > 0,
        `${check.label} localized user AI recharge Chrome screenshot returned no data`
      );
      const screenshotPath = path.join(ARTIFACT_DIR, `${check.screenshotName}-${Date.now()}.png`);
      await writeFile(screenshotPath, Buffer.from(localizedUserScreenshot.data, 'base64'));
      localizedAiRechargeResults.push({
        dailyCardText: localizedUserProductState.dailyCardText,
        introText: localizedUserProductState.introText,
        language: check.language,
        page,
        screenshotPath,
        weeklyCardText: localizedUserProductState.weeklyCardText
      });
    }
    const localizedUserProductState = localizedAiRechargeResults[0];
    const japaneseLocalizedUserProductState = localizedAiRechargeResults[1];

    const userLeaderboardLoadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/log?language=es-ES` });
    await userLeaderboardLoadEvent;
    await delay(2_000);

    const userLeaderboardResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildUserTokenLeaderboardVisibleExpression(seeded.userUsername, seeded.userTotalTokens)
    }) as RuntimeEvaluationResult<UserTokenLeaderboardVisibleState>;
    const userLeaderboardState = userLeaderboardResult.result?.value;
    assert(
      userLeaderboardState?.ok,
      `user token leaderboard did not show current user's seeded token usage: ${
        userLeaderboardState?.debug ?? formatRuntimeEvaluationFailure(userLeaderboardResult)
      }`
    );

    const userScreenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    }) as { data?: string };
    assert(typeof userScreenshot.data === 'string' && userScreenshot.data.length > 0, 'User VibeCoding/leaderboard Chrome screenshot returned no data');
    const userScreenshotPath = path.join(ARTIFACT_DIR, `user-vibecoding-leaderboard-${Date.now()}.png`);
    await writeFile(userScreenshotPath, Buffer.from(userScreenshot.data, 'base64'));

    const userTokenLoadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/token?language=es-ES` });
    await userTokenLoadEvent;
    await delay(2_000);

    const userTokenResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildUserTokenManagementLocalizationExpression(seeded.userTokenName)
    }) as RuntimeEvaluationResult<UserTokenManagementLocalizationState>;
    const userTokenState = userTokenResult.result?.value;
    assert(
      userTokenState?.ok,
      `user token management page did not follow selected Spanish language: ${
        userTokenState?.debug ?? formatRuntimeEvaluationFailure(userTokenResult)
      }`
    );

    const tokenScreenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    }) as { data?: string };
    assert(typeof tokenScreenshot.data === 'string' && tokenScreenshot.data.length > 0, 'User token localization Chrome screenshot returned no data');
    const tokenScreenshotPath = path.join(ARTIFACT_DIR, `user-token-es-ES-${Date.now()}.png`);
    await writeFile(tokenScreenshotPath, Buffer.from(tokenScreenshot.data, 'base64'));

    const consoleErrors = collectConsoleErrors(events);
    assert(consoleErrors.length === 0, `Merchant AI recharge Chrome console errors detected: ${consoleErrors.join(' | ')}`);

    await cdp.send('Browser.close').catch(() => undefined);
    await cdp.close();
    checks.push('chrome_merchant_ai_recharge_save_smoke');
    checks.push('chrome_user_ai_recharge_localized_smoke');
    checks.push('chrome_user_vibecoding_leaderboard_smoke');
    checks.push('chrome_user_log_localized_no_source_leak_smoke');
    checks.push('chrome_user_token_localized_no_source_leak_smoke');
    return {
      page: `${WEB_BASE_URL}/merchant/ai-recharge`,
      selectedProductId,
      deletedProductId,
      deletedProductText,
      selectedOrderId,
      introSavedText,
      orderSavedText,
      savedText: selectedState.savedText,
      screenshotPath,
      localizedUserProductText: localizedUserProductState?.weeklyCardText,
      localizedUserDailyProductText: localizedUserProductState?.dailyCardText,
      localizedUserIntroText: localizedUserProductState?.introText,
      localizedUserScreenshotPath: localizedUserProductState?.screenshotPath,
      japanesePage: japaneseLocalizedUserProductState?.page,
      japaneseLocalizedUserProductText: japaneseLocalizedUserProductState?.weeklyCardText,
      japaneseLocalizedUserDailyProductText: japaneseLocalizedUserProductState?.dailyCardText,
      japaneseLocalizedUserIntroText: japaneseLocalizedUserProductState?.introText,
      japaneseAiRechargeScreenshotPath: japaneseLocalizedUserProductState?.screenshotPath,
      aiRechargeLanguages: localizedAiRechargeResults.map((result) => result.language),
      userLeaderboardText: userLeaderboardState.rowText,
      userLogRequiredSpanishTerms: userLeaderboardState.requiredSpanishTerms,
      userLogCjkMatches: userLeaderboardState.cjkMatches,
      userLogLeakedSourceTerms: userLeaderboardState.leakedSourceTerms,
      userTokenText: userTokenState.bodyText,
      userTokenRequiredSpanishTerms: userTokenState.requiredSpanishTerms,
      userTokenCjkMatches: userTokenState.cjkMatches,
      userTokenLeakedSourceTerms: userTokenState.leakedSourceTerms,
      tokenScreenshotPath,
      userDailyProductText: userProductState.dailyCardText,
      userProductText: userProductState.weeklyCardText,
      userScreenshotPath,
      consoleErrorCount: consoleErrors.length
    };
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome, 5_000);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    await cleanupMerchantAiRechargeSmokeData(prisma, usernamePrefix, adminUserId).finally(() => prisma.$disconnect());
  }
}

async function runChromePhoneAuthRecoverySmoke() {
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const usernamePrefix = `rph_${suffix}`;
  const password = `qa-password-${suffix}`;
  const resetPassword = `qa-password-reset-${suffix}`;
  const phoneNumber = `+86137${Date.now().toString().slice(-8)}`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL })
  });
  let userId = '';
  let username = '';
  let chrome: ChildProcess | null = null;
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'relay-gate-phone-auth-chrome-'));

  try {
    const seeded = await seedPhoneAuthRecoverySmokeData(prisma, {
      usernamePrefix,
      password,
      phoneNumber
    });
    userId = seeded.userId;
    username = seeded.username;

    const chromePath = resolveChromePath();
    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--window-size=1280,900',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const port = await readDevToolsPort(userDataDir);
    const target = await firstPageTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    const events: CdpEvent[] = [];
    cdp.onEvent((event) => events.push(event));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');

    const authLocalization = await assertChromeAuthLocalization(cdp);

    const loadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
    await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/login?language=es-ES` });
    await loadEvent;
    await delay(1_500);

    const recoveryResult = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildPhoneAuthRecoveryExpression({
        phoneNumber,
        resetPassword,
        username
      })
    }) as RuntimeEvaluationResult<{
      debug: string;
      debugCode: string;
      finalPath: string;
      messageText: string;
      ok: boolean;
      profileText: string;
    }>;
    const recoveryState = recoveryResult.result?.value;
    assert(
      recoveryState?.ok,
      `phone auth recovery Chrome smoke failed: ${recoveryState?.debug ?? formatRuntimeEvaluationFailure(recoveryResult)}`
    );
    assert(/^\d{6}$/.test(recoveryState.debugCode), `phone auth recovery smoke did not read local debug code: ${recoveryState.debugCode}`);
    assert(recoveryState.finalPath.includes('/account/profile'), `phone auth recovery smoke did not navigate to profile: ${recoveryState.finalPath}`);

    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { phoneVerifiedAt: true }
    });
    assert(dbUser?.phoneVerifiedAt instanceof Date, 'phone auth recovery smoke should mark phoneVerifiedAt after reset');

    await waitForPhoneAuthProfileReady(cdp);
    const screenshot = await captureChromeScreenshotWithRetry(cdp, 'Phone auth recovery Chrome', {
      format: 'png',
      captureBeyondViewport: true
    });
    assert(typeof screenshot.data === 'string' && screenshot.data.length > 0, 'Phone auth recovery Chrome screenshot returned no data');
    const screenshotPath = path.join(ARTIFACT_DIR, `phone-auth-recovery-${Date.now()}.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

    const consoleErrors = collectConsoleErrors(events);
    assert(consoleErrors.length === 0, `Phone auth recovery Chrome console errors detected: ${consoleErrors.join(' | ')}`);

    await cdp.send('Browser.close').catch(() => undefined);
    await cdp.close();
    checks.push('chrome_phone_auth_recovery_smoke');
    return {
      page: `${WEB_BASE_URL}/login`,
      username,
      phoneNumber,
      authLocalization,
      finalPath: recoveryState.finalPath,
      messageText: recoveryState.messageText,
      screenshotPath,
      consoleErrorCount: consoleErrors.length
    };
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome, 5_000);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    await cleanupPhoneAuthRecoverySmokeData(prisma, usernamePrefix, userId).finally(() => prisma.$disconnect());
  }
}

async function waitForPhoneAuthProfileReady(
  cdp: Awaited<ReturnType<typeof connectCdp>>,
  timeoutMs = 10_000
) {
  let lastState = 'not evaluated';
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = (await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `
        (() => {
          const bodyText = document.body?.innerText ?? '';
          return {
            bodyText: bodyText.slice(0, 1000),
            ok: Boolean(
              window.location.pathname.includes('/account/profile') &&
              document.readyState === 'complete' &&
              bodyText.length > 0
            ),
            path: window.location.pathname,
            readyState: document.readyState
          };
        })()
      `
    })) as RuntimeEvaluationResult<{ bodyText: string; ok: boolean; path: string; readyState: string }>;

    if (result.exceptionDetails) {
      lastState = formatRuntimeEvaluationFailure(result);
    } else {
      const state = result.result?.value;
      if (state?.ok) {
        return state;
      }
      lastState = JSON.stringify(state ?? {});
    }

    await delay(250);
  }

  assert(false, `phone auth recovery profile did not settle before screenshot: ${lastState}`);
}

async function captureChromeScreenshotWithRetry(
  cdp: Awaited<ReturnType<typeof connectCdp>>,
  label: string,
  params: Record<string, unknown>,
  attempts = 3
) {
  let lastError = 'not attempted';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (attempt > 1) {
        await delay(750);
      }
      const screenshot = (await cdp.send('Page.captureScreenshot', params, 30_000)) as { data?: string };
      if (typeof screenshot.data === 'string' && screenshot.data.length > 0) {
        return screenshot;
      }
      lastError = 'empty screenshot data';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  assert(false, `${label} screenshot failed after ${attempts} attempts: ${lastError}`);
}

async function assertChromeAuthLocalization(cdp: Awaited<ReturnType<typeof connectCdp>>) {
  const loginLoadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
  await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/login?language=es-ES` });
  await loginLoadEvent;
  await delay(1_000);
  const loginResult = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `
      (async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const click = (selector) => {
          const element = document.querySelector(selector);
          if (!element) {
            return false;
          }
          element.click();
          return true;
        };
        click('[data-qa="login-phone-mode"]');
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const text = document.body?.innerText ?? '';
          if (text.includes('Número de teléfono') && text.includes('Solicitar recuperación de contraseña')) {
            break;
          }
          await wait(100);
        }
        const text = document.body?.innerText ?? '';
        const required = ['Teléfono', 'Número de teléfono', 'Solicitar recuperación de contraseña'];
        const forbidden = ['Phone number', 'Request password recovery', 'Reset password', 'Verification code'];
        return {
          ok: required.every((item) => text.includes(item)) && forbidden.every((item) => !text.includes(item)),
          text: text.slice(0, 1000),
          missing: required.filter((item) => !text.includes(item)),
          leaked: forbidden.filter((item) => text.includes(item))
        };
      })()
    `
  }) as RuntimeEvaluationResult<{ leaked: string[]; missing: string[]; ok: boolean; text: string }>;
  const loginState = loginResult.result?.value;
  assert(
    loginState?.ok,
    `Spanish login phone recovery copy did not localize: missing=${loginState?.missing.join(', ') ?? 'unknown'} leaked=${loginState?.leaked.join(', ') ?? 'unknown'} body=${loginState?.text ?? formatRuntimeEvaluationFailure(loginResult)}`
  );

  const registerLoadEvent = cdp.waitEvent('Page.loadEventFired', 30_000);
  await cdp.send('Page.navigate', { url: `${WEB_BASE_URL}/register?language=es-ES` });
  await registerLoadEvent;
  await delay(1_000);
  const registerResult = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `
      (async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const text = document.body?.innerText ?? '';
          if (text.includes('Número de teléfono (opcional)')) {
            break;
          }
          await wait(100);
        }
        const text = document.body?.innerText ?? '';
        const required = ['Número de teléfono (opcional)'];
        const forbidden = ['Phone number'];
        return {
          ok: required.every((item) => text.includes(item)) && forbidden.every((item) => !text.includes(item)),
          text: text.slice(0, 1000),
          missing: required.filter((item) => !text.includes(item)),
          leaked: forbidden.filter((item) => text.includes(item))
        };
      })()
    `
  }) as RuntimeEvaluationResult<{ leaked: string[]; missing: string[]; ok: boolean; text: string }>;
  const registerState = registerResult.result?.value;
  assert(
    registerState?.ok,
    `Spanish register phone copy did not localize: missing=${registerState?.missing.join(', ') ?? 'unknown'} leaked=${registerState?.leaked.join(', ') ?? 'unknown'} body=${registerState?.text ?? formatRuntimeEvaluationFailure(registerResult)}`
  );

  checks.push('chrome_auth_localized_phone_recovery_copy');
  return {
    loginText: loginState.text,
    registerText: registerState.text
  };
}

type AnnouncementApiResult = {
  status: number;
  body: {
    total: number;
    sections: Array<{
      items: Array<Record<string, unknown>>;
    }>;
  };
};

type PublicSiteLocalizationPageState = {
  bodyText: string;
  cjkMatches: string[];
  debug: string;
  leakedSourceTerms: string[];
  missingLocalizedTerms: string[];
  ok: boolean;
  readyState: string;
  requiredLocalizedTerms: string[];
  url: string;
};

type UserHomeAnnouncementLocalizationState = {
  bodyText: string;
  cjkMatches: string[];
  debug: string;
  listText: string;
  leakedSourceTerms: string[];
  missingLocalizedTerms: string[];
  ok: boolean;
  popupText: string;
  requiredLocalizedTerms: string[];
};

type MerchantDashboardPerformanceState = {
  debug: string;
  dashboardFound: boolean;
  criticalMetricCount: number;
  metricPanelCount: number;
  navigationDurationMs: number;
  ok: boolean;
  readyState: string;
  seededUserVisible: boolean;
  tableRowCount: number;
};

type MerchantAnnouncementPageState = {
  announcementRows: number;
  hasDraftStatus: boolean;
  hasGlossaryForm: boolean;
  hasMissingFallbackOption: boolean;
  hasPreviewAction: boolean;
  hasPreviewSelect: boolean;
  text: string;
};

type MerchantAnnouncementWorkflowPanelState = {
  workflowCategoryFilterFound: boolean;
  workflowCountText: string;
  workflowEntryCoverageCount: number;
  workflowEntryLocks: string[];
  workflowEntrySourceLabelCount: number;
  workflowEntrySources: string[];
  workflowEntryStatuses: string[];
  workflowMachineDraftCountText: string;
  workflowPanelFound: boolean;
  workflowStatusFilterFound: boolean;
};

type MerchantAnnouncementWorkflowFilterState = {
  categoryFilterFound: boolean;
  debug: string;
  seededAnnouncementFound: boolean;
  seededAnnouncementVisible: boolean;
  statusFilterFound: boolean;
  visibleAnnouncementRows: number;
  statusFilterSet: boolean;
};

type MerchantTranslationGlossaryCreateState = {
  debug: string;
  locationSearch: string;
  ok: boolean;
  rowFound: boolean;
  savedFound: boolean;
  savedId: string;
  savedInViewport: boolean;
  savedText: string;
};

type MerchantAnnouncementTranslationFormState = {
  archiveFound: boolean;
  contentValue: string;
  debug: string;
  editButtonFound: boolean;
  languageValue: string;
  lockedChecked: boolean;
  messageText: string;
  ok: boolean;
  rowFound: boolean;
  savedMessageFound: boolean;
  saveButtonFound: boolean;
  statusValue: string;
  titleValue: string;
};

type RuntimeEvaluationResult<T> = {
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
      value?: unknown;
    };
  };
  result?: {
    description?: string;
    value?: T;
  };
};

type MerchantAnnouncementPreviewInteractionState = {
  buttonFound: boolean;
  content: string;
  debug: string;
  previewFetches: PreviewFetchObservation[];
  rowFound: boolean;
  selectFound: boolean;
  status: string;
  title: string;
};

type PreviewFetchObservation = {
  error: string;
  ok: boolean;
  status: number | null;
  url: string;
};

type MerchantAnnouncementDraftInteractionState = {
  content: string;
  contentFound: boolean;
  debug: string;
  draftSaved: boolean;
  draftStatus: string;
  status: string;
  statusSelectFound: boolean;
  title: string;
  titleFound: boolean;
};

type MerchantAnnouncementDraftRestoreState = {
  content: string;
  contentRestored: boolean;
  status: string;
  statusRestored: boolean;
  title: string;
  titleRestored: boolean;
};

type MerchantAnnouncementSelectedArchiveState = {
  archiveFound: boolean;
  archiveText: string;
  messageText: string;
  savedMessageFound: boolean;
  titleFound: boolean;
};

type MerchantRechargeCodeCreateState = {
  createdCount: number;
  createdFound: boolean;
  debug: string;
  firstCreatedId: string;
  locationSearch: string;
  ok: boolean;
  rowFound: boolean;
  savedFound: boolean;
  savedId: string;
  savedInViewport: boolean;
  savedKind: string;
  savedStatus: string;
  savedText: string;
};

type MerchantRechargeCodeSelectedState = {
  debug: string;
  ok: boolean;
  rowFound: boolean;
  savedFound: boolean;
  savedId: string;
  savedKind: string;
  savedStatus: string;
  savedText: string;
};

type MerchantAiRechargeProductCreateState = {
  debug: string;
  locationSearch: string;
  ok: boolean;
  rowFound: boolean;
  savedFound: boolean;
  savedId: string;
  savedInViewport: boolean;
  savedKind: string;
  savedStatus: string;
  savedText: string;
};

type MerchantAiRechargeSelectedState = {
  debug: string;
  ok: boolean;
  rowActive: boolean;
  rowFound: boolean;
  savedFound: boolean;
  savedId: string;
  savedKind: string;
  savedStatus: string;
  savedText: string;
};

type MerchantAiRechargeProductDeleteState = {
  debug: string;
  ok: boolean;
  deleteButtonFound: boolean;
  deletedFound: boolean;
  deletedId: string;
  deletedText: string;
  rowFoundBeforeClick: boolean;
  rowGone: boolean;
  urlHasDeletedState: boolean;
  urlSearch: string;
};

type MerchantAiRechargeIntroSaveState = {
  debug: string;
  introSectionFound: boolean;
  ok: boolean;
  saveButtonFound: boolean;
  savedFound: boolean;
  savedInView: boolean;
  savedText: string;
  savedViaQuery: boolean;
  titleInputFound: boolean;
  urlSearch: string;
  contentInputFound: boolean;
  dataPageConfigSaved: string;
};

type MerchantAiRechargeOrderSaveState = {
  debug: string;
  noteInputFound: boolean;
  ok: boolean;
  rowActive: boolean;
  rowFound: boolean;
  savedFound: boolean;
  savedText: string;
  selectedOrderId: string;
  selectedOrderStatus: string;
  saveButtonFound: boolean;
  statusSelectFound: boolean;
  statusValue: string;
  urlHasSavedState: boolean;
  urlHasOrderQuery: boolean;
  urlSearch: string;
};

type UserAiRechargeProductVisibleState = {
  dailyCardFound: boolean;
  dailyCardText: string;
  debug: string;
  introText: string;
  ok: boolean;
  weeklyCardFound: boolean;
  weeklyCardText: string;
};

type UserTokenLeaderboardVisibleState = {
  cjkMatches: string[];
  debug: string;
  leakedSourceTerms: string[];
  ok: boolean;
  panelFound: boolean;
  requiredSpanishTerms: string[];
  rowFound: boolean;
  rowText: string;
  totalTokens: string;
  username: string;
};

type UserTokenManagementLocalizationState = {
  bodyText: string;
  cjkMatches: string[];
  debug: string;
  expectedTokenFound: boolean;
  leakedSourceTerms: string[];
  missingSpanishTerms: string[];
  ok: boolean;
  readyState: string;
  requiredSpanishTerms: string[];
  url: string;
};

type UserModelsLocalizationState = {
  bodyText: string;
  cjkMatches: string[];
  debug: string;
  expectedLocalizedDisplayNameFound: boolean;
  expectedModelFound: boolean;
  leakedSourceTerms: string[];
  missingLocalizedTerms: string[];
  ok: boolean;
  readyState: string;
  requiredLocalizedTerms: string[];
  url: string;
};

type UserProfileLocalizationState = {
  bodyText: string;
  cjkMatches: string[];
  debug: string;
  expectedModelFound: boolean;
  expectedUsernameFound: boolean;
  leakedSourceTerms: string[];
  missingLocalizedTerms: string[];
  ok: boolean;
  readyState: string;
  requiredLocalizedTerms: string[];
  url: string;
};

type UserNotificationSettingsLocalizationState = {
  bodyText: string;
  cjkMatches: string[];
  debug: string;
  expectedUsernameFound: boolean;
  leakedSourceTerms: string[];
  missingLocalizedTerms: string[];
  ok: boolean;
  readyState: string;
  requiredLocalizedTerms: string[];
  url: string;
};

type UserRechargeLocalizationState = {
  bodyText: string;
  cjkMatches: string[];
  debug: string;
  expectedUsernameFound: boolean;
  leakedSourceTerms: string[];
  missingLocalizedTerms: string[];
  ok: boolean;
  readyState: string;
  requiredLocalizedTerms: string[];
  url: string;
};

type UserExperienceLocalizationState = {
  bodyText: string;
  cjkMatches: string[];
  debug: string;
  expectedLocalizedDisplayNameFound: boolean;
  leakedSourceTerms: string[];
  missingLocalizedTerms: string[];
  ok: boolean;
  readyState: string;
  requiredLocalizedTerms: string[];
  url: string;
};

type MerchantModelConfigSaveState = {
  savedPanelFound: boolean;
  selectedModelFound: boolean;
  selectedModelActive: boolean;
  selectedModelId: string;
  messageFound: boolean;
  selectedModelIdFromPanel: string;
  messageText: string;
  savedPanelVisible: boolean;
  urlSearch: string;
  ok: boolean;
};

type MerchantModelRoutesSavedState = {
  routeSavedPanelFound: boolean;
  selectedMappingFound: boolean;
  selectedMappingActive: boolean;
  selectedMappingId: string;
  selectedMappingIdFromPanel: string;
  modelNameInPanelFound: boolean;
  modelListFound: boolean;
  urlSearch: string;
  ok: boolean;
  debug: string;
};

type MerchantModelRoutesSubmittedState = MerchantModelRoutesSavedState & {
  selectedProviderIdFromPanel: string;
  selectedPublicModelFromPanel: string;
  selectedUpstreamModelFromPanel: string;
  savedQueryFound: boolean;
};

async function waitForMerchantDashboardPerformanceState(
  cdp: Awaited<ReturnType<typeof connectCdp>>,
  expectedUsername: string,
  timeoutMs = 20_000
) {
  let lastState: MerchantDashboardPerformanceState | null = null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = (await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantDashboardPerformanceExpression(expectedUsername)
    })) as RuntimeEvaluationResult<MerchantDashboardPerformanceState>;

    if (result.exceptionDetails) {
      assert(false, `merchant dashboard performance state evaluation failed: ${formatRuntimeEvaluationFailure(result)}`);
    }

    lastState = result.result?.value ?? null;
    if (lastState?.ok) {
      return lastState;
    }

    await delay(250);
  }

  return lastState;
}

function buildMerchantDashboardPerformanceExpression(expectedUsername: string) {
  return `
    (() => {
      const expectedUsername = ${JSON.stringify(expectedUsername)};
      const bodyText = document.body?.innerText ?? '';
      const dashboard = document.querySelector('.merchant-dashboard');
      const criticalMetricSelectors = [
        '[data-qa="merchant-dashboard-today-recharge"]',
        '[data-qa="merchant-dashboard-today-new-users"]',
        '[data-qa="merchant-dashboard-today-active-users"]',
        '[data-qa="merchant-dashboard-month-recharge"]',
        '[data-qa="merchant-dashboard-month-new-users"]',
        '[data-qa="merchant-dashboard-month-active-users"]'
      ];
      const criticalMetricCount = criticalMetricSelectors.filter((selector) => {
        const metric = document.querySelector(selector);
        const text = metric?.textContent?.trim() ?? '';
        return Boolean(metric && text.length > 0 && !text.includes('undefined') && !text.includes('NaN'));
      }).length;
      const metricPanelCount = document.querySelectorAll('.merchant-dashboard .metric-panel').length;
      const tableRowCount = document.querySelectorAll('.merchant-dashboard-user-table tbody tr').length;
      const navigation = performance.getEntriesByType('navigation')[0];
      const navigationDurationMs = navigation && 'duration' in navigation ? Math.round(navigation.duration) : Math.round(performance.now());
      const seededUserVisible = bodyText.includes(expectedUsername);
      const debug = JSON.stringify({
        bodyText: bodyText.slice(0, 1200),
        criticalMetricCount,
        dashboardFound: Boolean(dashboard),
        metricPanelCount,
        readyState: document.readyState,
        seededUserVisible,
        tableRowCount,
        title: document.title,
        url: window.location.href
      });

      return {
        debug,
        dashboardFound: Boolean(dashboard),
        criticalMetricCount,
        metricPanelCount,
        navigationDurationMs,
        ok: Boolean(
          dashboard &&
          document.readyState === 'complete' &&
          criticalMetricCount === criticalMetricSelectors.length &&
          metricPanelCount >= 8 &&
          tableRowCount >= 1 &&
          seededUserVisible &&
          !bodyText.includes('500: Internal server error')
        ),
        readyState: document.readyState,
        seededUserVisible,
        tableRowCount
      };
    })()
  `;
}

function buildPublicSiteLocalizationExpression(input: {
  forbiddenSourceTerms: string[];
  language: string;
  requiredLocalizedTerms: string[];
  route: string;
}) {
  return `
    (() => {
      const language = ${JSON.stringify(input.language)};
      const requiredLocalizedTerms = ${JSON.stringify(input.requiredLocalizedTerms)};
      const forbiddenSourceTerms = ${JSON.stringify([
        ...input.forbiddenSourceTerms,
        '模型价格',
        'API 文档',
        '生产检查清单',
        '快速开始',
        '监控重点',
        '状态',
        '服务',
        '最后检查'
      ])};
      const bodyText = document.body?.innerText ?? '';
      const businessShell = document.body?.cloneNode(true);
      if (businessShell && 'querySelectorAll' in businessShell) {
        businessShell.querySelectorAll('.public-language-menu,script,style,noscript,pre,code').forEach((entry) => entry.remove());
      }
      const businessText = businessShell && 'textContent' in businessShell ? businessShell.textContent ?? bodyText : bodyText;
      const missingLocalizedTerms = requiredLocalizedTerms.filter((term) => !businessText.includes(term));
      const leakedSourceTerms = forbiddenSourceTerms.filter((term) => businessText.includes(term));
      const cjkMatches = language === 'ja-JP' ? [] : Array.from(new Set(businessText.match(/[\\u3400-\\u9FFF\\uF900-\\uFAFF]/g) ?? [])).slice(0, 20);
      const debug = JSON.stringify({
        businessText: businessText.slice(0, 2200),
        cjkMatches,
        leakedSourceTerms,
        missingLocalizedTerms,
        readyState: document.readyState,
        url: window.location.href
      });

      return {
        bodyText: bodyText.slice(0, 2400),
        cjkMatches,
        debug,
        leakedSourceTerms,
        missingLocalizedTerms,
        ok: Boolean(
          document.readyState === 'complete' &&
          missingLocalizedTerms.length === 0 &&
          leakedSourceTerms.length === 0 &&
          cjkMatches.length === 0 &&
          !bodyText.includes('500: Internal server error')
        ),
        readyState: document.readyState,
        requiredLocalizedTerms,
        url: window.location.href
      };
    })()
  `;
}

function buildUserHomeAnnouncementLocalizationExpression(input: {
  expectedContent: string;
  expectedTitle: string;
  forbiddenTerms: string[];
  language: string;
  rejectCjk: boolean;
  requiredLocalizedTerms: string[];
  sourceContent: string;
  sourceTitle: string;
}) {
  return `
    (async () => {
      const expectedTitle = ${JSON.stringify(input.expectedTitle)};
      const expectedContent = ${JSON.stringify(input.expectedContent)};
      const sourceTitle = ${JSON.stringify(input.sourceTitle)};
      const sourceContent = ${JSON.stringify(input.sourceContent)};
      const forbiddenTerms = ${JSON.stringify(input.forbiddenTerms)};
      const rejectCjk = ${JSON.stringify(input.rejectCjk)};
      const requiredLocalizedTerms = ${JSON.stringify(input.requiredLocalizedTerms)};

      async function waitForContent() {
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const text = document.body?.innerText ?? '';
          const popup = document.querySelector('[data-qa="user-home-announcement-popup"]');
          const list = document.querySelector('[data-qa="user-home-announcements"]');
          if (popup && list && text.includes(expectedTitle) && text.includes(expectedContent)) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }

      await waitForContent();

      const bodyText = document.body?.innerText ?? '';
      const businessShell = document.body?.cloneNode(true);
      if (businessShell && 'querySelectorAll' in businessShell) {
        businessShell.querySelectorAll('.language-switcher,script,style,noscript').forEach((entry) => entry.remove());
      }
      const businessText = businessShell && 'textContent' in businessShell ? businessShell.textContent ?? bodyText : bodyText;
      const popupText = document.querySelector('[data-qa="user-home-announcement-popup"]')?.textContent?.trim() ?? '';
      const listText = document.querySelector('[data-qa="user-home-announcements"]')?.textContent?.trim() ?? '';
      const forbiddenSourceTerms = [sourceTitle, sourceContent, ...forbiddenTerms];
      const leakedSourceTerms = forbiddenSourceTerms.filter((term) => businessText.includes(term));
      const missingLocalizedTerms = requiredLocalizedTerms.filter((term) => !businessText.includes(term));
      const cjkMatches = businessText.match(/[\\u3400-\\u9fff\\uf900-\\ufaff]/g) ?? [];
      const popupHasLocalizedCopy = popupText.includes(expectedTitle) && popupText.includes(expectedContent);
      const listHasLocalizedCopy = listText.includes(expectedTitle) && listText.includes(expectedContent);
      const debug = JSON.stringify({
        bodyText: bodyText.slice(0, 1800),
        businessText: businessText.slice(0, 1800),
        cjkMatches: cjkMatches.slice(0, 20),
        language: ${JSON.stringify(input.language)},
        listHasLocalizedCopy,
        listText: listText.slice(0, 900),
        missingLocalizedTerms,
        popupHasLocalizedCopy,
        popupText: popupText.slice(0, 900),
        readyState: document.readyState,
        leakedSourceTerms,
        url: window.location.href
      });

      return {
        bodyText: bodyText.slice(0, 2200),
        cjkMatches: cjkMatches.slice(0, 20),
        debug,
        leakedSourceTerms,
        listText: listText.slice(0, 1200),
        missingLocalizedTerms,
        ok: Boolean(
          document.readyState === 'complete' &&
          popupHasLocalizedCopy &&
          listHasLocalizedCopy &&
          missingLocalizedTerms.length === 0 &&
          leakedSourceTerms.length === 0 &&
          (!rejectCjk || cjkMatches.length === 0) &&
          !bodyText.includes('500: Internal server error')
        ),
        popupText: popupText.slice(0, 1200),
        requiredLocalizedTerms
      };
    })()
  `;
}

function buildUserModelsLocalizationExpression(input: {
  expectedDisplayName: string;
  expectedModelName: string;
  forbiddenTerms: string[];
  language: string;
  rejectCjk: boolean;
  requiredLocalizedTerms: string[];
}) {
  return `
    (() => {
      const language = ${JSON.stringify(input.language)};
      const expectedDisplayName = ${JSON.stringify(input.expectedDisplayName)};
      const expectedModelName = ${JSON.stringify(input.expectedModelName)};
      const forbiddenTerms = ${JSON.stringify(input.forbiddenTerms)};
      const rejectCjk = ${JSON.stringify(input.rejectCjk)};
      const requiredLocalizedTerms = ${JSON.stringify(input.requiredLocalizedTerms)};
      const bodyText = document.body?.innerText ?? '';
      const businessShell = document.body?.cloneNode(true);
      if (businessShell && 'querySelectorAll' in businessShell) {
        businessShell.querySelectorAll('.language-switcher').forEach((entry) => entry.remove());
      }
      const businessText = businessShell && 'textContent' in businessShell ? businessShell.textContent ?? bodyText : bodyText;
      const leakedSourceTerms = forbiddenTerms.filter((term) => businessText.includes(term));
      const cjkMatches = Array.from(new Set(businessText.match(/[\\u3400-\\u9FFF\\uF900-\\uFAFF]/g) ?? [])).slice(0, 20);
      const missingLocalizedTerms = requiredLocalizedTerms.filter((term) => !bodyText.includes(term));
      const expectedModelFound = bodyText.includes(expectedModelName);
      const expectedLocalizedDisplayNameFound = bodyText.includes(expectedDisplayName);
      const debug = JSON.stringify({
        bodyText: businessText.slice(0, 1600),
        cjkMatches,
        expectedLocalizedDisplayNameFound,
        expectedModelFound,
        language,
        leakedSourceTerms,
        missingLocalizedTerms,
        readyState: document.readyState,
        title: document.title,
        url: window.location.href
      });

      return {
        bodyText: businessText.slice(0, 2000),
        cjkMatches,
        debug,
        expectedLocalizedDisplayNameFound,
        expectedModelFound,
        leakedSourceTerms,
        missingLocalizedTerms,
        ok: Boolean(
          document.readyState === 'complete' &&
          expectedModelFound &&
          expectedLocalizedDisplayNameFound &&
          missingLocalizedTerms.length === 0 &&
          leakedSourceTerms.length === 0 &&
          (!rejectCjk || cjkMatches.length === 0) &&
          !bodyText.includes('500: Internal server error')
        ),
        readyState: document.readyState,
        requiredLocalizedTerms,
        url: window.location.href
      };
    })()
  `;
}

async function waitForUserProfileLocalizationState(
  cdp: Awaited<ReturnType<typeof connectCdp>>,
  input: {
    expectedModelName: string;
    expectedUsername: string;
    forbiddenTerms: string[];
    language: string;
    rejectCjk: boolean;
    requiredLocalizedTerms: string[];
  },
  timeoutMs = 20_000
) {
  let lastState: UserProfileLocalizationState | null = null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = (await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildUserProfileLocalizationExpression(input)
    })) as RuntimeEvaluationResult<UserProfileLocalizationState>;

    if (result.exceptionDetails) {
      assert(false, `user profile localization state evaluation failed: ${formatRuntimeEvaluationFailure(result)}`);
    }

    lastState = result.result?.value ?? null;
    if (lastState?.ok) {
      return lastState;
    }

    await delay(250);
  }

  return lastState;
}

function buildUserProfileLocalizationExpression(input: {
  expectedModelName: string;
  expectedUsername: string;
  forbiddenTerms: string[];
  language: string;
  rejectCjk: boolean;
  requiredLocalizedTerms: string[];
}) {
  return `
    (() => {
      const expectedModelName = ${JSON.stringify(input.expectedModelName)};
      const expectedUsername = ${JSON.stringify(input.expectedUsername)};
      const forbiddenTerms = ${JSON.stringify(input.forbiddenTerms)};
      const language = ${JSON.stringify(input.language)};
      const rejectCjk = ${JSON.stringify(input.rejectCjk)};
      const requiredLocalizedTerms = ${JSON.stringify(input.requiredLocalizedTerms)};
      const bodyText = document.body?.innerText ?? '';
      const businessShell = document.body?.cloneNode(true);
      if (businessShell && 'querySelectorAll' in businessShell) {
        businessShell.querySelectorAll('.language-switcher').forEach((entry) => entry.remove());
      }
      const businessText = businessShell && 'textContent' in businessShell ? businessShell.textContent ?? bodyText : bodyText;
      const leakedSourceTerms = forbiddenTerms.filter((term) => businessText.includes(term));
      const cjkMatches = Array.from(new Set(businessText.match(/[\\u3400-\\u9FFF\\uF900-\\uFAFF]/g) ?? [])).slice(0, 20);
      const missingLocalizedTerms = requiredLocalizedTerms.filter((term) => !bodyText.includes(term));
      const expectedModelFound = bodyText.includes(expectedModelName);
      const expectedUsernameFound = bodyText.includes(expectedUsername);
      const debug = JSON.stringify({
        bodyText: businessText.slice(0, 1800),
        cjkMatches,
        expectedModelFound,
        expectedUsernameFound,
        language,
        leakedSourceTerms,
        missingLocalizedTerms,
        readyState: document.readyState,
        title: document.title,
        url: window.location.href
      });

      return {
        bodyText: businessText.slice(0, 2200),
        cjkMatches,
        debug,
        expectedModelFound,
        expectedUsernameFound,
        leakedSourceTerms,
        missingLocalizedTerms,
        ok: Boolean(
          document.readyState === 'complete' &&
          expectedModelFound &&
          expectedUsernameFound &&
          missingLocalizedTerms.length === 0 &&
          leakedSourceTerms.length === 0 &&
          (!rejectCjk || cjkMatches.length === 0) &&
          !bodyText.includes('500: Internal server error')
        ),
        readyState: document.readyState,
        requiredLocalizedTerms,
        url: window.location.href
      };
    })()
  `;
}

async function waitForUserNotificationSettingsLocalizationState(
  cdp: Awaited<ReturnType<typeof connectCdp>>,
  input: {
    expectedUsername: string;
    forbiddenTerms: readonly string[];
    language: string;
    rejectCjk: boolean;
    requiredLocalizedTerms: readonly string[];
  },
  timeoutMs = 20_000
) {
  let lastState: UserNotificationSettingsLocalizationState | null = null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = (await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildUserNotificationSettingsLocalizationExpression(input)
    })) as RuntimeEvaluationResult<UserNotificationSettingsLocalizationState>;

    if (result.exceptionDetails) {
      assert(false, `user notification settings localization state evaluation failed: ${formatRuntimeEvaluationFailure(result)}`);
    }

    lastState = result.result?.value ?? null;
    if (lastState?.ok) {
      return lastState;
    }

    await delay(250);
  }

  return lastState;
}

function buildUserNotificationSettingsLocalizationExpression(input: {
  expectedUsername: string;
  forbiddenTerms: readonly string[];
  language: string;
  rejectCjk: boolean;
  requiredLocalizedTerms: readonly string[];
}) {
  return `
    (() => {
      const expectedUsername = ${JSON.stringify(input.expectedUsername)};
      const language = ${JSON.stringify(input.language)};
      const rejectCjk = ${JSON.stringify(input.rejectCjk)};
      const bodyText = document.body?.innerText ?? '';
      const businessShell = document.body?.cloneNode(true);
      if (businessShell && 'querySelectorAll' in businessShell) {
        businessShell.querySelectorAll('.language-switcher,script,style,noscript').forEach((entry) => entry.remove());
      }
      const businessText = businessShell && 'innerText' in businessShell
        ? businessShell.innerText ?? bodyText
        : businessShell && 'textContent' in businessShell
          ? businessShell.textContent ?? bodyText
          : bodyText;
      const requiredLocalizedTerms = ${JSON.stringify(input.requiredLocalizedTerms)};
      const sourceTerms = ${JSON.stringify(input.forbiddenTerms)};
      const leakedSourceTerms = sourceTerms.filter((term) => businessText.includes(term));
      const cjkMatches = Array.from(new Set(businessText.match(/[\\u3400-\\u9FFF\\uF900-\\uFAFF]/g) ?? [])).slice(0, 20);
      const missingLocalizedTerms = requiredLocalizedTerms.filter((term) => !bodyText.includes(term));
      const expectedUsernameFound = bodyText.includes(expectedUsername);
      const debug = JSON.stringify({
        bodyText: businessText.slice(0, 1800),
        cjkMatches,
        expectedUsernameFound,
        language,
        leakedSourceTerms,
        missingLocalizedTerms,
        readyState: document.readyState,
        title: document.title,
        url: window.location.href
      });

      return {
        bodyText: businessText.slice(0, 2200),
        cjkMatches,
        debug,
        expectedUsernameFound,
        leakedSourceTerms,
        missingLocalizedTerms,
        ok: Boolean(
          document.readyState === 'complete' &&
          expectedUsernameFound &&
          missingLocalizedTerms.length === 0 &&
          leakedSourceTerms.length === 0 &&
          (!rejectCjk || cjkMatches.length === 0) &&
          !bodyText.includes('500: Internal server error')
        ),
        readyState: document.readyState,
        requiredLocalizedTerms: requiredLocalizedTerms.filter((term) => bodyText.includes(term)),
        url: window.location.href
      };
    })()
  `;
}

async function waitForUserRechargeLocalizationState(
  cdp: Awaited<ReturnType<typeof connectCdp>>,
  input: {
    expectedUsername: string;
    forbiddenTerms: readonly string[];
    language: string;
    rejectCjk: boolean;
    requiredLocalizedTerms: readonly string[];
  },
  timeoutMs = 20_000
) {
  let lastState: UserRechargeLocalizationState | null = null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = (await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildUserRechargeLocalizationExpression(input)
    })) as RuntimeEvaluationResult<UserRechargeLocalizationState>;

    if (result.exceptionDetails) {
      assert(false, `user recharge localization state evaluation failed: ${formatRuntimeEvaluationFailure(result)}`);
    }

    lastState = result.result?.value ?? null;
    if (lastState?.ok) {
      return lastState;
    }

    await delay(250);
  }

  return lastState;
}

function buildUserRechargeLocalizationExpression(input: {
  expectedUsername: string;
  forbiddenTerms: readonly string[];
  language: string;
  rejectCjk: boolean;
  requiredLocalizedTerms: readonly string[];
}) {
  return `
    (() => {
      const expectedUsername = ${JSON.stringify(input.expectedUsername)};
      const language = ${JSON.stringify(input.language)};
      const rejectCjk = ${JSON.stringify(input.rejectCjk)};
      const bodyText = document.body?.innerText ?? '';
      const businessShell = document.body?.cloneNode(true);
      if (businessShell && 'querySelectorAll' in businessShell) {
        businessShell.querySelectorAll('.language-switcher,script,style,noscript').forEach((entry) => entry.remove());
      }
      const businessText = businessShell && 'innerText' in businessShell
        ? businessShell.innerText ?? bodyText
        : businessShell && 'textContent' in businessShell
          ? businessShell.textContent ?? bodyText
          : bodyText;
      const requiredLocalizedTerms = ${JSON.stringify(input.requiredLocalizedTerms)};
      const sourceTerms = ${JSON.stringify(input.forbiddenTerms)};
      const leakedSourceTerms = sourceTerms.filter((term) => businessText.includes(term));
      const cjkMatches = Array.from(new Set(businessText.match(/[\\u3400-\\u9FFF\\uF900-\\uFAFF]/g) ?? [])).slice(0, 20);
      const missingLocalizedTerms = requiredLocalizedTerms.filter((term) => !bodyText.includes(term));
      const expectedUsernameFound = bodyText.includes(expectedUsername);
      const debug = JSON.stringify({
        bodyText: businessText.slice(0, 1800),
        cjkMatches,
        expectedUsernameFound,
        language,
        leakedSourceTerms,
        missingLocalizedTerms,
        readyState: document.readyState,
        title: document.title,
        url: window.location.href
      });

      return {
        bodyText: businessText.slice(0, 2200),
        cjkMatches,
        debug,
        expectedUsernameFound,
        leakedSourceTerms,
        missingLocalizedTerms,
        ok: Boolean(
          document.readyState === 'complete' &&
          expectedUsernameFound &&
          missingLocalizedTerms.length === 0 &&
          leakedSourceTerms.length === 0 &&
          (!rejectCjk || cjkMatches.length === 0) &&
          !bodyText.includes('500: Internal server error')
        ),
        readyState: document.readyState,
        requiredLocalizedTerms: requiredLocalizedTerms.filter((term) => bodyText.includes(term)),
        url: window.location.href
      };
    })()
  `;
}

async function waitForUserExperienceLocalizationState(
  cdp: Awaited<ReturnType<typeof connectCdp>>,
  input: {
    expectedDisplayName: string;
    forbiddenTerms: string[];
    language: string;
    rejectCjk: boolean;
    requiredLocalizedTerms: string[];
  },
  timeoutMs = 20_000
) {
  let lastState: UserExperienceLocalizationState | null = null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = (await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildUserExperienceLocalizationExpression(input)
    })) as RuntimeEvaluationResult<UserExperienceLocalizationState>;

    if (result.exceptionDetails) {
      assert(false, `user experience localization state evaluation failed: ${formatRuntimeEvaluationFailure(result)}`);
    }

    lastState = result.result?.value ?? null;
    if (lastState?.ok) {
      return lastState;
    }

    await delay(250);
  }

  return lastState;
}

function buildUserExperienceLocalizationExpression(input: {
  expectedDisplayName: string;
  forbiddenTerms: string[];
  language: string;
  rejectCjk: boolean;
  requiredLocalizedTerms: string[];
}) {
  return `
    (() => {
      const expectedDisplayName = ${JSON.stringify(input.expectedDisplayName)};
      const forbiddenTerms = ${JSON.stringify(input.forbiddenTerms)};
      const language = ${JSON.stringify(input.language)};
      const rejectCjk = ${JSON.stringify(input.rejectCjk)};
      const requiredLocalizedTerms = ${JSON.stringify(input.requiredLocalizedTerms)};
      const bodyText = document.body?.innerText ?? '';
      const businessShell = document.body?.cloneNode(true);
      if (businessShell && 'querySelectorAll' in businessShell) {
        businessShell.querySelectorAll('.language-switcher').forEach((entry) => entry.remove());
      }
      const businessText = businessShell && 'textContent' in businessShell ? businessShell.textContent ?? bodyText : bodyText;
      const leakedSourceTerms = forbiddenTerms.filter((term) => businessText.includes(term));
      const cjkMatches = Array.from(new Set(businessText.match(/[\\u3400-\\u9FFF\\uF900-\\uFAFF]/g) ?? [])).slice(0, 20);
      const missingLocalizedTerms = requiredLocalizedTerms.filter((term) => !bodyText.includes(term));
      const expectedLocalizedDisplayNameFound = bodyText.includes(expectedDisplayName);
      const debug = JSON.stringify({
        bodyText: businessText.slice(0, 1800),
        cjkMatches,
        expectedLocalizedDisplayNameFound,
        language,
        leakedSourceTerms,
        missingLocalizedTerms,
        readyState: document.readyState,
        title: document.title,
        url: window.location.href
      });

      return {
        bodyText: businessText.slice(0, 2200),
        cjkMatches,
        debug,
        expectedLocalizedDisplayNameFound,
        leakedSourceTerms,
        missingLocalizedTerms,
        ok: Boolean(
          document.readyState === 'complete' &&
          expectedLocalizedDisplayNameFound &&
          missingLocalizedTerms.length === 0 &&
          leakedSourceTerms.length === 0 &&
          (!rejectCjk || cjkMatches.length === 0) &&
          !bodyText.includes('500: Internal server error')
        ),
        readyState: document.readyState,
        requiredLocalizedTerms,
        url: window.location.href
      };
    })()
  `;
}

async function waitForMerchantModelConfigSavedState(
  cdp: Awaited<ReturnType<typeof connectCdp>>,
  expectedModelId: string,
  timeoutMs = 20_000
) {
  let lastState: MerchantModelConfigSaveState | null = null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = (await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantModelConfigSavedStateExpressionV2(expectedModelId)
    })) as RuntimeEvaluationResult<MerchantModelConfigSaveState>;

    if (result.exceptionDetails) {
      assert(false, `merchant model-config save state evaluation failed: ${formatRuntimeEvaluationFailure(result)}`);
    }

    lastState = result.result?.value ?? null;
    if (lastState?.ok) {
      return lastState;
    }

    await delay(250);
  }

  return lastState;
}

async function waitForMerchantModelConfigRoutesSavedState(
  cdp: Awaited<ReturnType<typeof connectCdp>>,
  expectedMappingId: string,
  timeoutMs = 20_000
) {
  let lastState: MerchantModelRoutesSavedState | null = null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = (await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantModelRoutesSavedStateExpressionV2(expectedMappingId)
    })) as RuntimeEvaluationResult<MerchantModelRoutesSavedState>;

    if (result.exceptionDetails) {
      assert(false, `merchant model-routes save state evaluation failed: ${formatRuntimeEvaluationFailure(result)}`);
    }

    lastState = result.result?.value ?? null;
    if (lastState?.ok) {
      return lastState;
    }

    await delay(250);
  }

  return lastState;
}

async function waitForMerchantModelConfigRoutesSubmittedState(
  cdp: Awaited<ReturnType<typeof connectCdp>>,
  expected: {
    providerId: string;
    publicModel: string;
    upstreamModel: string;
  },
  timeoutMs = 20_000
) {
  let lastState: MerchantModelRoutesSubmittedState | null = null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = (await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: buildMerchantModelRoutesSubmittedStateExpression(expected)
    })) as RuntimeEvaluationResult<MerchantModelRoutesSubmittedState>;

    if (result.exceptionDetails) {
      assert(false, `merchant model-routes submitted state evaluation failed: ${formatRuntimeEvaluationFailure(result)}`);
    }

    lastState = result.result?.value ?? null;
    if (lastState?.ok) {
      return lastState;
    }

    await delay(250);
  }

  return lastState;
}

type ApiJsonResponse<T> = {
  status: number;
  json: T;
  text: string;
};

function formatRuntimeEvaluationFailure(result: RuntimeEvaluationResult<unknown>) {
  return (
    result.exceptionDetails?.exception?.description ??
    result.exceptionDetails?.text ??
    result.result?.description ??
    JSON.stringify(result)
  );
}

function buildMerchantModelConfigSavedStateExpressionV2(expectedModelId: string) {
  return `
    (async () => {
      const expectedModelId = ${JSON.stringify(expectedModelId)};
      const panel = document.querySelector('[data-qa="merchant-model-saved"]');
      const row = document.querySelector('[data-qa="merchant-model-row"][data-model-id="' + expectedModelId + '"]');
      const message = document.querySelector('.form-success');
      const isVisible = (element) => {
        if (!element) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      return {
        savedPanelFound: Boolean(panel),
        selectedModelFound: Boolean(row),
        selectedModelActive: Boolean(row && row.classList.contains('active-row')),
        selectedModelId: expectedModelId,
        selectedModelIdFromPanel: panel?.getAttribute('data-selected-model-id') ?? '',
        messageFound: Boolean(message),
        messageText: message?.textContent?.trim() ?? '',
        savedPanelVisible: isVisible(panel),
        urlSearch: window.location.search,
        ok: Boolean(
          panel &&
            panel.getAttribute('data-selected-model-id') === expectedModelId &&
            row &&
            row.classList.contains('active-row')
        )
      };
    })()
  `;
}

function buildMerchantModelRoutesSavedStateExpressionV2(expectedMappingId: string) {
  return `
    (async () => {
      const expectedMappingId = ${JSON.stringify(expectedMappingId)};
      const panel = document.querySelector('[data-qa="merchant-model-route-detail"]');
      const selectedRow = document.querySelector(
        '[data-qa="merchant-model-route-row"][data-mapping-id="' + expectedMappingId + '"]'
      );
      const routePanel = document.querySelector('[data-page="merchant-model-routes"]');

      return {
        routeSavedPanelFound: Boolean(panel),
        selectedMappingFound: Boolean(selectedRow),
        selectedMappingActive: Boolean(selectedRow && selectedRow.classList.contains('active-row')),
        selectedMappingId: expectedMappingId,
        selectedMappingIdFromPanel: panel?.getAttribute('data-selected-mapping-id') ?? '',
        modelNameInPanelFound: Boolean(routePanel),
        modelListFound: Boolean(document.querySelector('[data-qa="merchant-model-route-row"]')),
        urlSearch: window.location.search,
        debug: (document.body?.innerText ?? '').slice(0, 1000),
        ok: Boolean(
          panel &&
            panel.getAttribute('data-selected-mapping-id') === expectedMappingId &&
            selectedRow &&
            selectedRow.classList.contains('active-row')
        )
      };
    })()
  `;
}

function buildMerchantModelRoutesFormSubmitExpression(input: {
  modelName: string;
  providerId: string;
  upstreamModelName: string;
}) {
  return `
    (async () => {
      const modelName = ${JSON.stringify(input.modelName)};
      const providerId = ${JSON.stringify(input.providerId)};
      const upstreamModelName = ${JSON.stringify(input.upstreamModelName)};
      const form = document.querySelector('[data-qa="merchant-model-route-form"]');
      const submit = document.querySelector('[data-qa="merchant-model-route-submit"]');
      const setNativeValue = (element, value) => {
        if (!element) {
          return false;
        }
        const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value');
        if (descriptor?.set) {
          descriptor.set.call(element, value);
        } else {
          element.value = value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };
      const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
      const publicModel = document.querySelector('[data-qa="merchant-model-route-public-model"]');
      const provider = document.querySelector('[data-qa="merchant-model-route-provider"]');
      const upstreamModel = document.querySelector('[data-qa="merchant-model-route-upstream-model"]');
      const timeout = document.querySelector('[data-qa="merchant-model-route-timeout-ms"]');
      const inputPrice = document.querySelector('[data-qa="merchant-model-route-input-price"]');
      const outputPrice = document.querySelector('[data-qa="merchant-model-route-output-price"]');
      const prompt = document.querySelector('[data-qa="merchant-model-route-prompt"]');
      const status = document.querySelector('[data-qa="merchant-model-route-status"]');
      const missing = [
        ['form', form],
        ['submit', submit],
        ['publicModel', publicModel],
        ['provider', provider],
        ['upstreamModel', upstreamModel],
        ['timeout', timeout],
        ['status', status]
      ].filter(([, node]) => !node).map(([name]) => name);

      if (missing.length > 0) {
        return {
          ok: false,
          debug: 'missing route form controls: ' + missing.join(', ')
        };
      }

      setNativeValue(publicModel, modelName);
      setNativeValue(provider, providerId);
      await wait(500);
      setNativeValue(upstreamModel, upstreamModelName);
      setNativeValue(timeout, '5500');
      if (inputPrice) {
        setNativeValue(inputPrice, '0.321');
      }
      if (outputPrice) {
        setNativeValue(outputPrice, '0.654');
      }
      if (prompt) {
        setNativeValue(prompt, 'Release gate submitted route prompt');
      }
      setNativeValue(status, 'active');
      await wait(200);

      if (form.requestSubmit) {
        form.requestSubmit(submit);
      } else {
        submit.click();
      }

      return {
        ok: true,
        debug: 'submitted'
      };
    })()
  `;
}

function buildMerchantModelRoutesSubmittedStateExpression(expected: {
  providerId: string;
  publicModel: string;
  upstreamModel: string;
}) {
  return `
    (async () => {
      const expectedProviderId = ${JSON.stringify(expected.providerId)};
      const expectedPublicModel = ${JSON.stringify(expected.publicModel)};
      const expectedUpstreamModel = ${JSON.stringify(expected.upstreamModel)};
      const panel = document.querySelector('[data-qa="merchant-model-route-detail"]');
      const selectedMappingIdFromPanel = panel?.getAttribute('data-selected-mapping-id') ?? '';
      const selectedProviderIdFromPanel = panel?.getAttribute('data-selected-provider-id') ?? '';
      const selectedPublicModelFromPanel = panel?.getAttribute('data-selected-public-model') ?? '';
      const selectedUpstreamModelFromPanel = panel?.getAttribute('data-selected-upstream-model') ?? '';
      const rows = Array.from(document.querySelectorAll('[data-qa="merchant-model-route-row"]'));
      const selectedRow = rows.find((row) => row.getAttribute('data-mapping-id') === selectedMappingIdFromPanel) ?? null;
      const routePanel = document.querySelector('[data-page="merchant-model-routes"]');
      const urlSearch = window.location.search;
      const savedQueryFound = urlSearch.includes('saved=route') && urlSearch.includes('mapping=');

      return {
        routeSavedPanelFound: Boolean(panel),
        selectedMappingFound: Boolean(selectedRow),
        selectedMappingActive: Boolean(selectedRow && selectedRow.classList.contains('active-row')),
        selectedMappingId: selectedMappingIdFromPanel,
        selectedMappingIdFromPanel,
        selectedProviderIdFromPanel,
        selectedPublicModelFromPanel,
        selectedUpstreamModelFromPanel,
        modelNameInPanelFound: Boolean(routePanel),
        modelListFound: rows.length > 0,
        savedQueryFound,
        urlSearch,
        debug: (document.body?.innerText ?? '').slice(0, 1000),
        ok: Boolean(
          panel &&
            selectedMappingIdFromPanel &&
            selectedProviderIdFromPanel === expectedProviderId &&
            selectedPublicModelFromPanel === expectedPublicModel &&
            selectedUpstreamModelFromPanel === expectedUpstreamModel &&
            selectedRow &&
            selectedRow.classList.contains('active-row') &&
            savedQueryFound
        )
      };
    })()
  `;
}

function buildMerchantModelConfigSavedStateExpression(expectedModelId: string) {
  return `
    (async () => {
      const expectedModelId = ${JSON.stringify(expectedModelId)};
      const panel = document.querySelector('[data-qa="merchant-model-saved"]');
      const row = document.querySelector('[data-model-id="' + expectedModelId + '"]');
      const message = document.querySelector('.form-success');
      return {
        savedPanelFound: Boolean(panel),
        selectedModelFound: Boolean(row),
        selectedModelActive: Boolean(row && row.classList.contains('active-row')),
        selectedModelId: expectedModelId,
        selectedModelIdFromPanel: panel?.getAttribute('data-selected-model-id') ?? '',
        messageFound: Boolean(message && message.textContent?.includes(expectedModelId)),
        messageText: message?.textContent?.trim() ?? '',
        urlSearch: window.location.search,
        ok: Boolean(
          panel &&
            panel.getAttribute('data-selected-model-id') === expectedModelId &&
            row &&
            row.classList.contains('active-row')
        )
      };
    })()
  `;
}

function buildMerchantModelRoutesSavedStateExpression(expectedMappingId: string) {
  return `
    (async () => {
      const expectedMappingId = ${JSON.stringify(expectedMappingId)};
      const panel = document.querySelector('[data-qa="merchant-model-route-detail"]');
      const selectedRow = document.querySelector(
        '[data-qa="merchant-model-route-row"][data-mapping-id="' + expectedMappingId + '"]'
      );
      const modelPanel = document.querySelector('[data-page="merchant-model-routes"]');
      return {
        routeSavedPanelFound: Boolean(panel),
        selectedMappingFound: Boolean(selectedRow),
        selectedMappingActive: Boolean(selectedRow && selectedRow.classList.contains('active-row')),
        selectedMappingId: expectedMappingId,
        selectedMappingIdFromPanel: panel?.getAttribute('data-selected-mapping-id') ?? '',
        modelNameInPanelFound: Boolean(panel && panel.textContent?.includes(modelPanel?.textContent?.trim() || '')),
        modelListFound: Boolean(document.querySelector('[data-qa="merchant-model-route-row"]')),
        urlSearch: window.location.search,
        debug: (document.body?.innerText ?? '').slice(0, 1000),
        ok: Boolean(
          panel &&
            panel.getAttribute('data-selected-mapping-id') === expectedMappingId &&
            selectedRow
        )
      };
    })()
  `;
}

function buildPhoneAuthRecoveryExpression(input: {
  phoneNumber: string;
  resetPassword: string;
  username: string;
}) {
  return `
    (async () => {
      const phoneNumber = ${JSON.stringify(input.phoneNumber)};
      const resetPassword = ${JSON.stringify(input.resetPassword)};
      const username = ${JSON.stringify(input.username)};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const setNativeValue = (element, value) => {
        if (!element) {
          return false;
        }
        const prototype = element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : element instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        descriptor?.set?.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };
      const click = (selector) => {
        const element = document.querySelector(selector);
        if (!element) {
          return false;
        }
        element.click();
        return true;
      };
      const readDebug = () => {
        const text = document.querySelector('[data-qa="login-recovery-debug-code"]')?.textContent ?? '';
        return text.match(/\\b(\\d{6})\\b/)?.[1] ?? '';
      };
      const state = (label) => ({
        debug: JSON.stringify({
          label,
          body: (document.body?.innerText ?? '').slice(0, 1000),
          error: document.querySelector('[data-qa="login-error"]')?.textContent?.trim() ?? '',
          message: document.querySelector('[data-qa="login-recovery-message"]')?.textContent?.trim() ?? '',
          path: window.location.pathname,
          phoneModeFound: Boolean(document.querySelector('[data-qa="login-phone-mode"]')),
          phoneInputFound: Boolean(document.querySelector('[data-qa="login-phone-number"]')),
          passwordInputFound: Boolean(document.querySelector('[data-qa="login-password"]'))
        }),
        debugCode: readDebug(),
        finalPath: window.location.pathname,
        messageText: document.querySelector('[data-qa="login-recovery-message"]')?.textContent?.trim() ?? '',
        ok: false,
        profileText: (document.body?.innerText ?? '').slice(0, 1000)
      });

      if (!click('[data-qa="login-phone-mode"]')) {
        return state('missing phone mode');
      }
      await wait(200);
      if (!setNativeValue(document.querySelector('[data-qa="login-phone-number"]'), phoneNumber)) {
        return state('missing phone input');
      }
      if (!click('[data-qa="login-recovery-request"]')) {
        return state('missing recovery request');
      }

      let debugCode = '';
      for (let attempt = 0; attempt < 100; attempt += 1) {
        debugCode = readDebug();
        if (debugCode) {
          break;
        }
        await wait(100);
      }
      if (!debugCode) {
        return state('missing debug code after request');
      }

      if (!setNativeValue(document.querySelector('[data-qa="login-recovery-code"]'), debugCode)) {
        return state('missing recovery code input');
      }
      if (!setNativeValue(document.querySelector('[data-qa="login-recovery-new-password"]'), resetPassword)) {
        return state('missing recovery password input');
      }
      if (!click('[data-qa="login-recovery-reset"]')) {
        return state('missing recovery reset');
      }

      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (document.querySelector('[data-qa="login-password"]')) {
          break;
        }
        await wait(100);
      }
      const messageText = document.querySelector('[data-qa="login-recovery-message"]')?.textContent?.trim() ?? '';
      if (!messageText || !document.querySelector('[data-qa="login-password"]')) {
        return state('reset success state not shown');
      }

      if (!setNativeValue(document.querySelector('[data-qa="login-password"]'), resetPassword)) {
        return state('missing login password after reset');
      }
      if (!click('[data-qa="login-submit"]')) {
        return state('missing login submit');
      }

      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (window.location.pathname.includes('/account/profile')) {
          const body = document.body?.innerText ?? '';
          return {
            debug: JSON.stringify({ label: 'ok', body: body.slice(0, 1000), path: window.location.pathname, username }),
            debugCode,
            finalPath: window.location.pathname,
            messageText,
            ok: true,
            profileText: body.slice(0, 1000)
          };
        }
        await wait(100);
      }

      return state('profile navigation timeout');
    })()
  `;
}

function buildMerchantRechargeCreateExpression() {
  return `
    (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const debugSummary = () => JSON.stringify({
        bodyText: (document.body?.innerText ?? '').slice(0, 800),
        errorText: document.querySelector('.form-error')?.textContent?.trim() ?? '',
        formFound: Boolean(document.querySelector('[data-qa="merchant-recharge-code-form"]')),
        kindFound: Boolean(document.querySelector('[data-qa="merchant-recharge-kind"]')),
        packagePreset: document.querySelector('[data-qa="merchant-recharge-package-preset"]')?.value ?? '',
        packagePresetFound: Boolean(document.querySelector('[data-qa="merchant-recharge-package-preset"]')),
        submitFound: Boolean(document.querySelector('[data-qa="merchant-recharge-submit"]')),
        inputCount: document.querySelectorAll('input').length
      });
      const setNativeValue = (element, value) => {
        if (!element) {
          return;
        }
        const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        descriptor?.set?.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      try {
        const kind = document.querySelector('[data-qa="merchant-recharge-kind"]');
        const submit = document.querySelector('[data-qa="merchant-recharge-submit"]');
        if (!kind || !submit) {
          throw new Error('missing recharge form controls: ' + debugSummary());
        }

        setNativeValue(kind, 'vibe_coding');
        await wait(100);
        const packagePreset = document.querySelector('[data-qa="merchant-recharge-package-preset"]');
        if (!packagePreset) {
          throw new Error('missing VibeCoding recharge package preset selector: ' + debugSummary());
        }

        setNativeValue(packagePreset, 'daily');
        await wait(100);
        const dailyQuotaPeriodDays = document.querySelector('[data-qa="merchant-recharge-quota-period-days"]')?.value ?? '';
        if (dailyQuotaPeriodDays !== '1') {
          throw new Error('daily recharge package preset did not set one-day quota window: ' + debugSummary());
        }

        setNativeValue(packagePreset, 'weekly');
        await wait(100);
        const weeklyQuotaPeriodDays = document.querySelector('[data-qa="merchant-recharge-quota-period-days"]')?.value ?? '';
        if (weeklyQuotaPeriodDays !== '7') {
          throw new Error('weekly recharge package preset did not restore seven-day quota window: ' + debugSummary());
        }

        setNativeValue(document.querySelector('[data-qa="merchant-recharge-quota-hours"]'), '5');
        setNativeValue(document.querySelector('[data-qa="merchant-recharge-quota-period-days"]'), '7');
        setNativeValue(document.querySelector('[data-qa="merchant-recharge-token-quota"]'), '50000');
        setNativeValue(document.querySelector('[data-qa="merchant-recharge-count"]'), '2');
        submit.click();

        for (let attempt = 0; attempt < 120; attempt += 1) {
          const createdItems = Array.from(document.querySelectorAll('[data-qa="merchant-recharge-created-item"]'));
          const saved = document.querySelector('[data-qa="merchant-recharge-saved"]');
          const firstCreatedId = createdItems[0]?.getAttribute('data-code-id') ?? '';
          const savedId = saved?.getAttribute('data-selected-code-id') ?? '';
          const row = firstCreatedId ? document.querySelector('[data-recharge-code-id="' + firstCreatedId + '"]') : null;
          const errorText = document.querySelector('.form-error')?.textContent?.trim() ?? '';
          const urlHasSelectedId = firstCreatedId ? window.location.search.includes('selected=' + encodeURIComponent(firstCreatedId)) : false;
          if (createdItems.length === 2 && saved && firstCreatedId && savedId === firstCreatedId && row && !errorText && urlHasSelectedId) {
            const rect = saved.getBoundingClientRect();
            return {
              ok: true,
              createdCount: createdItems.length,
              createdFound: true,
              debug: debugSummary(),
              firstCreatedId,
              locationSearch: window.location.search,
              rowFound: true,
              savedFound: true,
              savedId,
              savedInViewport: rect.top >= 0 && rect.top < window.innerHeight,
              savedKind: saved.getAttribute('data-selected-code-kind') ?? '',
              savedStatus: saved.getAttribute('data-selected-code-status') ?? '',
              savedText: saved.textContent?.trim() ?? ''
            };
          }
          await wait(100);
        }

        return {
          ok: false,
          createdCount: document.querySelectorAll('[data-qa="merchant-recharge-created-item"]').length,
          createdFound: Boolean(document.querySelector('[data-qa="merchant-recharge-created"]')),
          debug: debugSummary(),
          firstCreatedId: '',
          locationSearch: window.location.search,
          rowFound: false,
          savedFound: Boolean(document.querySelector('[data-qa="merchant-recharge-saved"]')),
          savedId: document.querySelector('[data-qa="merchant-recharge-saved"]')?.getAttribute('data-selected-code-id') ?? '',
          savedInViewport: false,
          savedKind: document.querySelector('[data-qa="merchant-recharge-saved"]')?.getAttribute('data-selected-code-kind') ?? '',
          savedStatus: document.querySelector('[data-qa="merchant-recharge-saved"]')?.getAttribute('data-selected-code-status') ?? '',
          savedText: document.querySelector('[data-qa="merchant-recharge-saved"]')?.textContent?.trim() ?? ''
        };
      } catch (error) {
        return {
          ok: false,
          createdCount: 0,
          createdFound: false,
          debug: String(error instanceof Error ? error.message : error) + ' :: ' + debugSummary(),
          firstCreatedId: '',
          locationSearch: window.location.search,
          rowFound: false,
          savedFound: false,
          savedId: '',
          savedInViewport: false,
          savedKind: '',
          savedStatus: '',
          savedText: ''
        };
      }
    })()
  `;
}

function buildMerchantRechargeSelectedArchiveExpression(expectedCodeId: string) {
  return `
    (async () => {
      const expectedCodeId = ${JSON.stringify(expectedCodeId)};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const readState = () => {
        const saved = document.querySelector('[data-qa="merchant-recharge-saved"]');
        const row = document.querySelector('[data-recharge-code-id="' + expectedCodeId + '"]');
        return {
          debug: (document.body?.innerText ?? '').slice(0, 800),
          ok: Boolean(saved && saved.getAttribute('data-selected-code-id') === expectedCodeId && row),
          rowFound: Boolean(row),
          savedFound: Boolean(saved),
          savedId: saved?.getAttribute('data-selected-code-id') ?? '',
          savedKind: saved?.getAttribute('data-selected-code-kind') ?? '',
          savedStatus: saved?.getAttribute('data-selected-code-status') ?? '',
          savedText: saved?.textContent?.trim() ?? ''
        };
      };

      for (let attempt = 0; attempt < 80; attempt += 1) {
        const state = readState();
        if (state.ok) {
          return state;
        }
        await wait(100);
      }

      return readState();
    })()
  `;
}

function buildMerchantAiRechargeProductCreateExpression(expectedTitle: string) {
  return `
    (async () => {
      const expectedTitle = ${JSON.stringify(expectedTitle)};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const fieldValues = () => ({
        kind: document.querySelector('[data-qa="merchant-ai-recharge-product-kind"]')?.value ?? '',
        title: document.querySelector('[data-qa="merchant-ai-recharge-title"]')?.value ?? '',
        platform: document.querySelector('[data-qa="merchant-ai-recharge-platform"]')?.value ?? '',
        planName: document.querySelector('[data-qa="merchant-ai-recharge-plan-name"]')?.value ?? '',
        price: document.querySelector('[data-qa="merchant-ai-recharge-price"]')?.value ?? '',
        durationDays: document.querySelector('[data-qa="merchant-ai-recharge-duration-days"]')?.value ?? '',
        quotaHours: document.querySelector('[data-qa="merchant-ai-recharge-quota-hours"]')?.value ?? '',
        quotaPeriodDays: document.querySelector('[data-qa="merchant-ai-recharge-quota-period-days"]')?.value ?? '',
        tokenQuota: document.querySelector('[data-qa="merchant-ai-recharge-token-quota"]')?.value ?? '',
        sortOrder: document.querySelector('[data-qa="merchant-ai-recharge-sort-order"]')?.value ?? '',
        status: document.querySelector('[data-qa="merchant-ai-recharge-status"]')?.value ?? '',
        description: document.querySelector('[data-qa="merchant-ai-recharge-description"]')?.value ?? '',
        purchaseNote: document.querySelector('[data-qa="merchant-ai-recharge-purchase-note"]')?.value ?? '',
        deliveryNote: document.querySelector('[data-qa="merchant-ai-recharge-delivery-note"]')?.value ?? ''
      });
      const debugSummary = () => JSON.stringify({
        bodyText: (document.body?.innerText ?? '').slice(0, 1000),
        formFound: Boolean(document.querySelector('[data-qa="merchant-ai-recharge-product-form"]')),
        kindFound: Boolean(document.querySelector('[data-qa="merchant-ai-recharge-product-kind"]')),
        packagePresetFound: Boolean(document.querySelector('[data-qa="merchant-ai-recharge-package-preset"]')),
        packagePreset: document.querySelector('[data-qa="merchant-ai-recharge-package-preset"]')?.value ?? '',
        submitFound: Boolean(document.querySelector('[data-qa="merchant-ai-recharge-submit"]')),
        submitDisabled: Boolean(document.querySelector('[data-qa="merchant-ai-recharge-submit"]')?.disabled),
        values: fieldValues(),
        inputCount: document.querySelectorAll('input').length,
        textareaCount: document.querySelectorAll('textarea').length
      });
      const setNativeValue = (element, value) => {
        if (!element) {
          return;
        }
        const prototype = element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        descriptor?.set?.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const expectedValues = [
        ['[data-qa="merchant-ai-recharge-product-kind"]', 'vibe_coding'],
        ['[data-qa="merchant-ai-recharge-title"]', expectedTitle],
        ['[data-qa="merchant-ai-recharge-platform"]', 'VibeCoding'],
        ['[data-qa="merchant-ai-recharge-plan-name"]', 'Weekly 5h'],
        ['[data-qa="merchant-ai-recharge-price"]', '39.90'],
        ['[data-qa="merchant-ai-recharge-duration-days"]', '7'],
        ['[data-qa="merchant-ai-recharge-quota-hours"]', '5'],
        ['[data-qa="merchant-ai-recharge-quota-period-days"]', '7'],
        ['[data-qa="merchant-ai-recharge-token-quota"]', '50000'],
        ['[data-qa="merchant-ai-recharge-sort-order"]', '7'],
        ['[data-qa="merchant-ai-recharge-status"]', 'active'],
        ['[data-qa="merchant-ai-recharge-description"]', 'Release gate VibeCoding package save archive smoke.'],
        ['[data-qa="merchant-ai-recharge-purchase-note"]', 'QA purchase note'],
        ['[data-qa="merchant-ai-recharge-delivery-note"]', 'QA delivery note']
      ];
      const fillExpectedValues = async () => {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          for (const [selector, value] of expectedValues) {
            setNativeValue(document.querySelector(selector), value);
          }
          await wait(100);
          const mismatches = expectedValues.filter(([selector, value]) => document.querySelector(selector)?.value !== value);
          if (mismatches.length === 0) {
            await wait(250);
            return [];
          }
        }
        return expectedValues
          .filter(([selector, value]) => document.querySelector(selector)?.value !== value)
          .map(([selector, value]) => ({ selector, expected: value, actual: document.querySelector(selector)?.value ?? null }));
      };
      try {
        const form = document.querySelector('[data-qa="merchant-ai-recharge-product-form"]');
        const kind = document.querySelector('[data-qa="merchant-ai-recharge-product-kind"]');
        const submit = document.querySelector('[data-qa="merchant-ai-recharge-submit"]');
        if (!form || !kind || !submit) {
          throw new Error('missing AI recharge form controls: ' + debugSummary());
        }

        setNativeValue(kind, 'vibe_coding');
        await wait(250);
        const packagePreset = document.querySelector('[data-qa="merchant-ai-recharge-package-preset"]');
        if (!packagePreset) {
          throw new Error('missing VibeCoding package preset control: ' + debugSummary());
        }
        setNativeValue(packagePreset, 'daily');
        await wait(250);
        const dailyPresetState = fieldValues();
        if (dailyPresetState.durationDays !== '1' || dailyPresetState.quotaPeriodDays !== '1') {
          throw new Error('daily package preset did not set one-day quota window: ' + debugSummary());
        }
        setNativeValue(packagePreset, 'weekly');
        await wait(250);

        const mismatches = await fillExpectedValues();
        if (mismatches.length > 0) {
          throw new Error('AI recharge form values did not settle: ' + JSON.stringify(mismatches) + ' :: ' + debugSummary());
        }
        if (submit.disabled) {
          throw new Error('AI recharge submit button is disabled before submit: ' + debugSummary());
        }
        if (form instanceof HTMLFormElement && !form.reportValidity()) {
          throw new Error('AI recharge form is invalid before submit: ' + debugSummary());
        }

        if (form instanceof HTMLFormElement && typeof form.requestSubmit === 'function') {
          form.requestSubmit(submit);
        } else {
          submit.click();
        }

        for (let attempt = 0; attempt < 140; attempt += 1) {
          const saved = document.querySelector('[data-qa="merchant-ai-recharge-saved-product"]');
          const savedId = saved?.getAttribute('data-selected-product-id') ?? '';
          const row = savedId
            ? document.querySelector('[data-qa="merchant-ai-recharge-product-row"][data-product-id="' + savedId + '"]')
            : null;
          const urlHasSelectedId = savedId ? window.location.search.includes('selected=' + encodeURIComponent(savedId)) : false;
          const savedText = saved?.textContent?.trim() ?? '';
          if (saved && savedId && row && urlHasSelectedId && savedText.includes(expectedTitle)) {
            const rect = saved.getBoundingClientRect();
            return {
              debug: debugSummary(),
              locationSearch: window.location.search,
              ok: true,
              rowFound: true,
              savedFound: true,
              savedId,
              savedInViewport: rect.top >= 0 && rect.top < window.innerHeight,
              savedKind: saved.getAttribute('data-selected-product-kind') ?? '',
              savedStatus: saved.getAttribute('data-selected-product-status') ?? '',
              savedText
            };
          }
          await wait(100);
        }

        const saved = document.querySelector('[data-qa="merchant-ai-recharge-saved-product"]');
        const savedId = saved?.getAttribute('data-selected-product-id') ?? '';
        return {
          debug: debugSummary(),
          locationSearch: window.location.search,
          ok: false,
          rowFound: Boolean(savedId && document.querySelector('[data-qa="merchant-ai-recharge-product-row"][data-product-id="' + savedId + '"]')),
          savedFound: Boolean(saved),
          savedId,
          savedInViewport: false,
          savedKind: saved?.getAttribute('data-selected-product-kind') ?? '',
          savedStatus: saved?.getAttribute('data-selected-product-status') ?? '',
          savedText: saved?.textContent?.trim() ?? ''
        };
      } catch (error) {
        return {
          debug: String(error instanceof Error ? error.message : error) + ' :: ' + debugSummary(),
          locationSearch: window.location.search,
          ok: false,
          rowFound: false,
          savedFound: false,
          savedId: '',
          savedInViewport: false,
          savedKind: '',
          savedStatus: '',
          savedText: ''
        };
      }
    })()
  `;
}

function buildMerchantAiRechargeSelectedArchiveExpression(expectedProductId: string, expectedTitle: string) {
  return `
    (async () => {
      const expectedProductId = ${JSON.stringify(expectedProductId)};
      const expectedTitle = ${JSON.stringify(expectedTitle)};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const readState = () => {
        const saved = document.querySelector('[data-qa="merchant-ai-recharge-saved-product"]');
        const row = document.querySelector('[data-qa="merchant-ai-recharge-product-row"][data-product-id="' + expectedProductId + '"]');
        const savedText = saved?.textContent?.trim() ?? '';
        return {
          debug: (document.body?.innerText ?? '').slice(0, 1000),
          ok: Boolean(saved && saved.getAttribute('data-selected-product-id') === expectedProductId && row && row.classList.contains('active-row') && savedText.includes(expectedTitle)),
          rowActive: Boolean(row?.classList.contains('active-row')),
          rowFound: Boolean(row),
          savedFound: Boolean(saved),
          savedId: saved?.getAttribute('data-selected-product-id') ?? '',
          savedKind: saved?.getAttribute('data-selected-product-kind') ?? '',
          savedStatus: saved?.getAttribute('data-selected-product-status') ?? '',
          savedText
        };
      };

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const state = readState();
        if (state.ok) {
          return state;
        }
        await wait(100);
      }

      return readState();
    })()
  `;
}

function buildMerchantAiRechargeProductDeleteExpression(expectedProductId: string, expectedTitle: string) {
  return `
    (async () => {
      const expectedProductId = ${JSON.stringify(expectedProductId)};
      const expectedTitle = ${JSON.stringify(expectedTitle)};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const findRow = () => document.querySelector('[data-qa="merchant-ai-recharge-product-row"][data-product-id="' + expectedProductId + '"]');
      const findDeleteButton = () => {
        const row = findRow();
        return row
          ? row.querySelector('[data-qa="merchant-ai-recharge-product-delete"]') ||
            row.querySelector('.danger-button') ||
            row.querySelector('button')
          : null;
      };
      const readState = (rowFoundBeforeClick) => {
        const deleted = document.querySelector('[data-qa="merchant-ai-recharge-deleted-product"]');
        const deletedText = deleted?.textContent?.trim() ?? '';
        const search = window.location.search;
        const row = findRow();
        return {
          debug: JSON.stringify({
            bodyText: (document.body?.innerText ?? '').slice(0, 1000),
            rowFound: Boolean(row),
            deletedFound: Boolean(deleted),
            deletedId: deleted?.getAttribute('data-deleted-product-id') ?? '',
            urlSearch: search
          }),
          ok: Boolean(
            deleted &&
            deleted.getAttribute('data-deleted-product-id') === expectedProductId &&
            deleted.getAttribute('data-product-delete-saved') === 'true' &&
            !row &&
            deletedText.includes(expectedTitle) &&
            search.includes('saved=product-delete') &&
            search.includes('deleted=' + encodeURIComponent(expectedProductId))
          ),
          deleteButtonFound: Boolean(findDeleteButton()),
          deletedFound: Boolean(deleted),
          deletedId: deleted?.getAttribute('data-deleted-product-id') ?? '',
          deletedText,
          rowFoundBeforeClick,
          rowGone: !row,
          urlHasDeletedState: search.includes('saved=product-delete') && search.includes('deleted=' + encodeURIComponent(expectedProductId)),
          urlSearch: search
        };
      };

      const row = findRow();
      const deleteButton = findDeleteButton();
      const rowFoundBeforeClick = Boolean(row);
      if (!row || !deleteButton) {
        return {
          ...readState(rowFoundBeforeClick),
          ok: false,
          debug: readState(rowFoundBeforeClick).debug + ' :: delete controls missing'
        };
      }

      const originalConfirm = window.confirm;
      window.confirm = () => true;
      try {
        deleteButton.click();
      } finally {
        window.confirm = originalConfirm;
      }

      for (let attempt = 0; attempt < 120; attempt += 1) {
        const state = readState(rowFoundBeforeClick);
        if (state.ok) {
          return state;
        }
        await wait(100);
      }

      return readState(rowFoundBeforeClick);
    })()
  `;
}

function buildMerchantAiRechargeIntroSaveExpression(expectedTitle: string, expectedContent: string) {
  return `
    (async () => {
      const expectedTitle = ${JSON.stringify(expectedTitle)};
      const expectedContent = ${JSON.stringify(expectedContent)};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const debugSummary = () => JSON.stringify({
        introFound: Boolean(document.getElementById('merchant-ai-recharge-intro')),
        formFound: Boolean(document.querySelector('#merchant-ai-recharge-intro form')),
        titleInputFound: Boolean(findTitleInput()),
        contentInputFound: Boolean(findContentInput()),
        saveButtonFound: Boolean(findSaveButton()),
        savedFound: Boolean(document.querySelector('[data-qa=\"merchant-ai-recharge-intro-saved\"]')),
        savedPathConfig: document.querySelector('[data-qa=\"merchant-ai-recharge-intro-saved\"]')?.getAttribute('data-page-config-saved') ?? '',
        urlSearch: window.location.search
      });
      const setNativeValue = (element, value) => {
        if (!element) {
          return;
        }
        const prototype = element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        descriptor?.set?.call(element, value);
        element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const findTitleInput = () =>
        document.querySelector('[data-qa=\"merchant-ai-recharge-intro-title\"]') ||
        document.getElementById('merchant-ai-recharge-intro')?.querySelector('input');
      const findContentInput = () => {
        const explicit = document.querySelector('[data-qa=\"merchant-ai-recharge-intro-content\"]');
        if (explicit) {
          return explicit;
        }
        const section = document.getElementById('merchant-ai-recharge-intro');
        const candidates = section ? Array.from(section.querySelectorAll('textarea')) : [];
        return candidates.find((textarea) => !/JSON/i.test(textarea.placeholder || '')) || candidates[0] || null;
      };
      const findSaveButton = () =>
        document.querySelector('[data-qa=\"merchant-ai-recharge-intro-save\"]') ||
        document.getElementById('merchant-ai-recharge-intro')?.querySelector('form button[type=\"submit\"]') ||
        document.getElementById('merchant-ai-recharge-intro')?.querySelector('form button');

      const readState = () => {
        const titleInput = findTitleInput();
        const contentInput = findContentInput();
        const saveButton = findSaveButton();
        const saved = document.querySelector('[data-qa=\"merchant-ai-recharge-intro-saved\"]');
        const savedText = saved?.textContent?.trim() ?? '';
        const search = window.location.search;
        const savedStatus = saved?.getAttribute('data-page-config-saved') === 'true';
        return {
          debug: debugSummary(),
          introSectionFound: Boolean(document.getElementById('merchant-ai-recharge-intro')),
          ok: Boolean(
            saved &&
            savedStatus &&
            (search.includes('saved=intro') || search.includes('intro=1')) &&
            savedText.includes(expectedTitle)
          ),
          saveButtonFound: Boolean(saveButton),
          savedFound: Boolean(saved),
          savedInView: saved ? saved.getBoundingClientRect().top >= 0 && saved.getBoundingClientRect().top < window.innerHeight : false,
          savedText,
          savedViaQuery: savedStatus && (search.includes('saved=intro') || search.includes('intro=1')),
          titleInputFound: Boolean(titleInput),
          urlSearch: search,
          contentInputFound: Boolean(contentInput),
          dataPageConfigSaved: saved?.getAttribute('data-page-config-saved') ?? ''
        };
      };

      const titleInput = findTitleInput();
      const contentInput = findContentInput();
      const saveButton = findSaveButton();
      if (!titleInput || !contentInput || !saveButton) {
        return {
          ...readState(),
          ok: false,
          debug: debugSummary() + ' :: intro controls missing'
        };
      }

      setNativeValue(titleInput, expectedTitle);
      setNativeValue(contentInput, expectedContent);
      await wait(100);
      saveButton.click();

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const state = readState();
        if (state.ok) {
          return state;
        }
        await wait(100);
      }

      return readState();
    })()
  `;
}

function buildMerchantAiRechargeOrderSaveExpression(expectedOrderId: string, expectedNote: string) {
  return `
    (async () => {
      const expectedOrderId = ${JSON.stringify(expectedOrderId)};
      const expectedNote = ${JSON.stringify(expectedNote)};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const debugSummary = () => JSON.stringify({
        orderTableFound: Boolean(document.getElementById('merchant-ai-recharge-orders')),
        rowFound: Boolean(findOrderRow()),
        rowActive: findOrderRow()?.classList.contains('active-row') ?? false,
        statusFound: Boolean(findStatusSelect()),
        noteFound: Boolean(findNoteInput()),
        saveFound: Boolean(findSaveButton()),
        urlSearch: window.location.search
      });
      const setNativeValue = (element, value) => {
        if (!element) {
          return;
        }
        const descriptor = Object.getOwnPropertyDescriptor(
          element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
          'value'
        );
        descriptor?.set?.call(element, value);
        element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const findOrderRow = () => document.querySelector('[data-qa=\"merchant-ai-recharge-order-row\"][data-order-id=\"' + expectedOrderId + '\"]');
      const findStatusSelect = () => {
        const row = findOrderRow();
        return row
          ? row.querySelector('[data-qa=\"merchant-ai-recharge-order-status\"]') ||
            row.querySelector('select')
          : null;
      };
      const findNoteInput = () => {
        const row = findOrderRow();
        return row ? row.querySelector('[data-qa=\"merchant-ai-recharge-order-note\"]') || row.querySelector('input') : null;
      };
      const findSaveButton = () => {
        const row = findOrderRow();
        return row
          ? row.querySelector('[data-qa=\"merchant-ai-recharge-order-save\"]') ||
            row.querySelector('button[type=\"button\"]') ||
            row.querySelector('button')
          : null;
      };

      const readState = () => {
        const row = findOrderRow();
        const statusSelect = findStatusSelect();
        const saved = document.querySelector('[data-qa=\"merchant-ai-recharge-order-saved\"]');
        const savedText = saved?.textContent?.trim() ?? '';
        const search = window.location.search;
        const selectedOrderId = saved?.getAttribute('data-selected-order-id') ?? '';
        const selectedOrderStatus = saved?.getAttribute('data-selected-order-status') ?? '';
        return {
          debug: debugSummary(),
          noteInputFound: Boolean(findNoteInput()),
          ok: Boolean(
            saved &&
            selectedOrderId === expectedOrderId &&
            row &&
            row.classList.contains('active-row') &&
            savedText.includes(expectedNote)
          ),
          rowActive: row?.classList.contains('active-row') ?? false,
          rowFound: Boolean(row),
          savedFound: Boolean(saved),
          savedText,
          selectedOrderId,
          selectedOrderStatus,
          saveButtonFound: Boolean(findSaveButton()),
          statusSelectFound: Boolean(statusSelect),
          statusValue: statusSelect?.value ?? '',
          urlHasSavedState: search.includes('saved=order'),
          urlHasOrderQuery: search.includes('order=' + encodeURIComponent(expectedOrderId)),
          urlSearch: search
        };
      };

      const statusSelect = findStatusSelect();
      const noteInput = findNoteInput();
      const saveButton = findSaveButton();
      if (!statusSelect || !noteInput || !saveButton) {
        return {
          ...readState(),
          ok: false,
          debug: debugSummary() + ' :: order controls missing'
        };
      }

      const nextStatus = (() => {
        const values = Array.from(statusSelect.options).map((option) => option.value).filter(Boolean);
        return values.find((value) => value !== statusSelect.value && value !== 'pending') ||
          values.find((value) => value !== statusSelect.value) ||
          statusSelect.value;
      })();
      setNativeValue(statusSelect, nextStatus);
      setNativeValue(noteInput, expectedNote);
      await wait(100);
      saveButton.click();

      for (let attempt = 0; attempt < 140; attempt += 1) {
        const state = readState();
        if (state.ok && state.urlHasSavedState && state.urlHasOrderQuery) {
          return state;
        }
        await wait(100);
      }

      return readState();
    })()
  `;
}

function buildUserAiRechargeProductVisibleExpression(expected: {
  dailyProductId: string;
  dailyProductTitle: string;
  expectedDailyPackageLabel?: string;
  expectedIntroContent?: string;
  expectedIntroTitle?: string;
  expectedPlatform?: string;
  expectedWeeklyPackageLabel?: string;
  forbiddenSourceTitles?: readonly string[];
  weeklyProductId: string;
  weeklyProductTitle: string;
}) {
  return `
    (async () => {
      const expected = ${JSON.stringify(expected)};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const findCard = (cards, id, title) =>
        cards.find((entry) => entry.getAttribute('data-product-id') === id) ||
        cards.find((entry) => (entry.textContent ?? '').includes(title));
      const cardOk = (card, title, preset, quotaPeriodDays, tokenQuota) => {
        const text = card?.textContent?.trim() ?? '';
        const expectedPlatform = expected.expectedPlatform ?? 'VibeCoding';
        const packageLabel =
          preset === 'daily' ? expected.expectedDailyPackageLabel : expected.expectedWeeklyPackageLabel;
        return Boolean(
          card &&
          text.includes(title) &&
          text.includes(expectedPlatform) &&
          (!packageLabel || text.includes(packageLabel)) &&
          card.getAttribute('data-product-kind') === 'vibe_coding' &&
          card.getAttribute('data-package-preset') === preset &&
          card.getAttribute('data-quota-hours') === '5' &&
          card.getAttribute('data-quota-period-days') === quotaPeriodDays &&
          card.getAttribute('data-token-quota') === tokenQuota
        );
      };
      const readState = () => {
        const cards = Array.from(document.querySelectorAll('[data-qa="user-ai-recharge-product-card"]'));
        const weeklyCard = findCard(cards, expected.weeklyProductId, expected.weeklyProductTitle);
        const dailyCard = findCard(cards, expected.dailyProductId, expected.dailyProductTitle);
        const weeklyCardText = weeklyCard?.textContent?.trim() ?? '';
        const dailyCardText = dailyCard?.textContent?.trim() ?? '';
        const weeklyOk = cardOk(weeklyCard, expected.weeklyProductTitle, 'weekly', '7', '50000');
        const dailyOk = cardOk(dailyCard, expected.dailyProductTitle, 'daily', '1', '25000');
        const bodyText = document.body?.innerText ?? '';
        const introOk = [
          expected.expectedIntroTitle ? bodyText.includes(expected.expectedIntroTitle) : true,
          expected.expectedIntroContent ? bodyText.includes(expected.expectedIntroContent) : true
        ].every(Boolean);
        const leakedSourceTitles = (expected.forbiddenSourceTitles ?? []).filter((title) => bodyText.includes(title));
        return {
          dailyCardFound: Boolean(dailyCard),
          dailyCardText,
          debug: JSON.stringify({
            bodyText: bodyText.slice(0, 1000),
            cardCount: cards.length,
            daily: {
              found: Boolean(dailyCard),
              packagePreset: dailyCard?.getAttribute('data-package-preset') ?? '',
              quotaHours: dailyCard?.getAttribute('data-quota-hours') ?? '',
              quotaPeriodDays: dailyCard?.getAttribute('data-quota-period-days') ?? '',
              text: dailyCardText,
              tokenQuota: dailyCard?.getAttribute('data-token-quota') ?? ''
            },
            url: window.location.href,
            weekly: {
              found: Boolean(weeklyCard),
              packagePreset: weeklyCard?.getAttribute('data-package-preset') ?? '',
              quotaHours: weeklyCard?.getAttribute('data-quota-hours') ?? '',
              quotaPeriodDays: weeklyCard?.getAttribute('data-quota-period-days') ?? '',
              text: weeklyCardText,
              tokenQuota: weeklyCard?.getAttribute('data-token-quota') ?? ''
            },
            leakedSourceTitles
          }),
          introText: bodyText,
          ok: weeklyOk && dailyOk && introOk && leakedSourceTitles.length === 0,
          weeklyCardFound: Boolean(weeklyCard),
          weeklyCardText
        };
      };

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const state = readState();
        if (state.ok) {
          return state;
        }
        await wait(100);
      }

      return readState();
    })()
  `;
}

function buildUserTokenLeaderboardVisibleExpression(expectedUsername: string, expectedTotalTokens: number) {
  return `
    (async () => {
      const expectedUsername = ${JSON.stringify(expectedUsername)};
      const expectedTotalTokens = ${JSON.stringify(expectedTotalTokens)};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const readState = () => {
        const bodyText = document.body?.innerText ?? '';
        const businessShell = document.body?.cloneNode(true);
        if (businessShell && 'querySelectorAll' in businessShell) {
          businessShell.querySelectorAll('.language-switcher,script,style,noscript').forEach((entry) => entry.remove());
        }
        const businessText = businessShell && 'innerText' in businessShell
          ? businessShell.innerText ?? bodyText
          : businessShell && 'textContent' in businessShell
            ? businessShell.textContent ?? bodyText
            : bodyText;
        const panel = document.querySelector('[data-qa="user-token-leaderboard"]');
        const rows = Array.from(document.querySelectorAll('[data-qa="user-token-leaderboard-row"]'));
        const row = rows.find((entry) => entry.getAttribute('data-current-user') === 'true') ||
          rows.find((entry) => entry.getAttribute('data-username') === expectedUsername);
        const rowText = row?.textContent?.trim() ?? '';
        const totalTokens = row?.getAttribute('data-total-tokens') ?? '';
        const username = row?.getAttribute('data-username') ?? '';
        const requiredSpanishTerms = [
          'Registros',
          'Filtros',
          'Detalles de uso',
          'Tokens totales',
          'Todos los tokens',
          'Estado'
        ];
        const sourceTerms = [
          '调用日志',
          '令牌排行榜',
          '筛选计费',
          '使用详情',
          '全部令牌',
          '上游令牌',
          '成功扣费',
          '失败调用',
          '暂无使用日志',
          '应用',
          '重置',
          '导出当前结果'
        ];
        const leakedSourceTerms = sourceTerms.filter((term) => businessText.includes(term));
        const cjkMatches = Array.from(new Set(businessText.match(/[\\u3400-\\u9FFF\\uF900-\\uFAFF]/g) ?? [])).slice(0, 20);
        const missingSpanishTerms = requiredSpanishTerms.filter((term) => !bodyText.includes(term));
        return {
          cjkMatches,
          debug: JSON.stringify({
            bodyText: businessText.slice(0, 1400),
            cjkMatches,
            leakedSourceTerms,
            missingSpanishTerms,
            panelFound: Boolean(panel),
            rowCount: rows.length,
            url: window.location.href
          }),
          leakedSourceTerms,
          ok: Boolean(
            panel &&
            row &&
            row.getAttribute('data-current-user') === 'true' &&
            username === expectedUsername &&
            Number(totalTokens) === expectedTotalTokens &&
            missingSpanishTerms.length === 0 &&
            leakedSourceTerms.length === 0 &&
            cjkMatches.length === 0 &&
            !bodyText.includes('500: Internal server error')
          ),
          panelFound: Boolean(panel),
          requiredSpanishTerms: requiredSpanishTerms.filter((term) => bodyText.includes(term)),
          rowFound: Boolean(row),
          rowText,
          totalTokens,
          username
        };
      };

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const state = readState();
        if (state.ok) {
          return state;
        }
        await wait(100);
      }

      return readState();
    })()
  `;
}

function buildUserTokenManagementLocalizationExpression(expectedTokenName: string) {
  return `
    (async () => {
      const expectedTokenName = ${JSON.stringify(expectedTokenName)};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const readState = () => {
        const bodyText = document.body?.innerText ?? '';
        const businessShell = document.body?.cloneNode(true);
        if (businessShell && 'querySelectorAll' in businessShell) {
          businessShell.querySelectorAll('.language-switcher,script,style,noscript').forEach((entry) => entry.remove());
        }
        const businessText = businessShell && 'innerText' in businessShell
          ? businessShell.innerText ?? bodyText
          : businessShell && 'textContent' in businessShell
            ? businessShell.textContent ?? bodyText
            : bodyText;
        const requiredSpanishTerms = [
          'Tokens',
          'Nombre',
          'Estado',
          'Facturacion',
          'Modelos disponibles',
          'Cuota restante',
          'Todos los modelos',
          'Todos los estados',
          'Activo'
        ];
        const sourceTerms = [
          '令牌管理',
          '令牌名称',
          '全部模型',
          '全部状态',
          '可用模型',
          '剩余配额',
          '创建令牌',
          '删除所选',
          '重置密钥',
          '永不过期',
          '已计费'
        ];
        const leakedSourceTerms = sourceTerms.filter((term) => businessText.includes(term));
        const cjkMatches = Array.from(new Set(businessText.match(/[\\u3400-\\u9FFF\\uF900-\\uFAFF]/g) ?? [])).slice(0, 20);
        const missingSpanishTerms = requiredSpanishTerms.filter((term) => !bodyText.includes(term));
        const expectedTokenFound = bodyText.includes(expectedTokenName);
        const debug = JSON.stringify({
          bodyText: businessText.slice(0, 1600),
          cjkMatches,
          expectedTokenFound,
          leakedSourceTerms,
          missingSpanishTerms,
          readyState: document.readyState,
          title: document.title,
          url: window.location.href
        });

        return {
          bodyText: businessText.slice(0, 2200),
          cjkMatches,
          debug,
          expectedTokenFound,
          leakedSourceTerms,
          missingSpanishTerms,
          ok: Boolean(
            document.readyState === 'complete' &&
            expectedTokenFound &&
            missingSpanishTerms.length === 0 &&
            leakedSourceTerms.length === 0 &&
            cjkMatches.length === 0 &&
            !bodyText.includes('500: Internal server error')
          ),
          readyState: document.readyState,
          requiredSpanishTerms: requiredSpanishTerms.filter((term) => bodyText.includes(term)),
          url: window.location.href
        };
      };

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const state = readState();
        if (state.ok) {
          return state;
        }
        await wait(100);
      }

      return readState();
    })()
  `;
}

function buildMerchantAnnouncementDraftInteractionExpression(expectedTitle: string, expectedContent: string) {
  return `
    (async () => {
      const expectedTitle = ${JSON.stringify(expectedTitle)};
      const expectedContent = ${JSON.stringify(expectedContent)};
      const debugSummary = () => JSON.stringify({
        bodyText: (document.body?.innerText ?? '').slice(0, 500),
        draftStatusFound: Boolean(document.querySelector('[data-announcement-draft-status]')),
        inputCount: document.querySelectorAll('input').length,
        selectCount: document.querySelectorAll('select').length,
        textareaCount: document.querySelectorAll('textarea').length
      });
      const findTitleInput = () => document.querySelector('[data-announcement-title-input]') ||
        Array.from(document.querySelectorAll('input')).find((input) => input.required && input.maxLength === 120 && input.minLength === 3) ||
        null;
      const findContentInput = () => document.querySelector('[data-announcement-content-input]') ||
        Array.from(document.querySelectorAll('textarea')).find((textarea) => textarea.required && textarea.maxLength === 5000) ||
        null;
      const findStatusSelect = () => document.querySelector('[data-announcement-status-select]') ||
        Array.from(document.querySelectorAll('select')).find((select) => {
          const values = Array.from(select.options).map((option) => option.value);
          return values.includes('published') && values.includes('draft') && values.includes('archived');
        }) ||
        null;
      const setElementValue = (element, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
        if (descriptor && typeof descriptor.set === 'function') {
          descriptor.set.call(element, value);
        } else {
          element.value = value;
        }
        element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const findDraftInLocalStorage = () => Object.keys(localStorage).some((key) => {
        if (!key.startsWith('merchant-announcement-draft:v1')) {
          return false;
        }
        const value = localStorage.getItem(key) || '';
        return value.includes(expectedTitle) && value.includes(expectedContent);
      });

      const title = findTitleInput();
      const content = findContentInput();
      const status = findStatusSelect();
      const draftStatus = document.querySelector('[data-announcement-draft-status]');
      if (!title || !content || !status || !draftStatus) {
        return {
          content: content?.value || '',
          contentFound: Boolean(content),
          debug: debugSummary(),
          draftSaved: false,
          draftStatus: draftStatus?.textContent?.trim() || '',
          status: status?.value || '',
          statusSelectFound: Boolean(status),
          title: title?.value || '',
          titleFound: Boolean(title)
        };
      }

      setElementValue(title, expectedTitle);
      setElementValue(content, expectedContent);
      setElementValue(status, 'draft');

      const startedAt = Date.now();
      while (Date.now() - startedAt < 10_000) {
        const currentDraftStatus = draftStatus.textContent?.trim() || '';
        if (findDraftInLocalStorage() && title.value === expectedTitle && content.value === expectedContent && status.value === 'draft') {
          return {
            content: content.value,
            contentFound: true,
            debug: debugSummary(),
            draftSaved: true,
            draftStatus: currentDraftStatus,
            status: status.value,
            statusSelectFound: true,
            title: title.value,
            titleFound: true
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      return {
        content: content.value,
        contentFound: true,
        debug: debugSummary(),
        draftSaved: findDraftInLocalStorage(),
        draftStatus: draftStatus.textContent?.trim() || '',
        status: status.value,
        statusSelectFound: true,
        title: title.value,
        titleFound: true
      };
    })()
  `;
}

function buildMerchantAnnouncementDraftRestoreExpression(expectedTitle: string, expectedContent: string) {
  return `
    (async () => {
      const expectedTitle = ${JSON.stringify(expectedTitle)};
      const expectedContent = ${JSON.stringify(expectedContent)};
      const startedAt = Date.now();
      while (Date.now() - startedAt < 10_000) {
        const title = document.querySelector('[data-announcement-title-input]');
        const content = document.querySelector('[data-announcement-content-input]');
        const status = document.querySelector('[data-announcement-status-select]');
        if (title?.value === expectedTitle && content?.value === expectedContent && status?.value === 'draft') {
          return {
            content: content.value,
            contentRestored: true,
            status: status.value,
            statusRestored: true,
            title: title.value,
            titleRestored: true
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const title = document.querySelector('[data-announcement-title-input]');
      const content = document.querySelector('[data-announcement-content-input]');
      const status = document.querySelector('[data-announcement-status-select]');
      return {
        content: content?.value || '',
        contentRestored: content?.value === expectedContent,
        status: status?.value || '',
        statusRestored: status?.value === 'draft',
        title: title?.value || '',
        titleRestored: title?.value === expectedTitle
      };
    })()
  `;
}

function buildMerchantAnnouncementSelectedArchiveExpression(announcementId: string, expectedTitle: string) {
  return `
    (async () => {
      const announcementId = ${JSON.stringify(announcementId)};
      const expectedTitle = ${JSON.stringify(expectedTitle)};
      const startedAt = Date.now();
      while (Date.now() - startedAt < 10_000) {
        const archive = document.getElementById('merchant-announcement-saved');
        const archiveText = archive?.textContent?.trim() || '';
        const messageText = document.querySelector('.form-success')?.textContent?.trim() || '';
        if (archiveText.includes(announcementId) && archiveText.includes(expectedTitle) && messageText.includes(expectedTitle)) {
          return {
            archiveFound: Boolean(archive),
            archiveText,
            messageText,
            savedMessageFound: true,
            titleFound: true
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const archive = document.getElementById('merchant-announcement-saved');
      const archiveText = archive?.textContent?.trim() || '';
      const messageText = document.querySelector('.form-success')?.textContent?.trim() || '';
      return {
        archiveFound: Boolean(archive),
        archiveText,
        messageText,
        savedMessageFound: messageText.includes(expectedTitle),
        titleFound: archiveText.includes(announcementId) && archiveText.includes(expectedTitle)
      };
    })()
  `;
}

function buildMerchantAnnouncementWorkflowFilterExpression(announcementId: string) {
  return `
    (async () => {
      const announcementId = ${JSON.stringify(announcementId)};
      const statusFilter = document.querySelector('[data-announcement-workflow-status-filter]');
      const categoryFilter = document.querySelector('[data-announcement-workflow-category-filter]');
      const panel = document.querySelector('[data-announcement-workflow-panel]');
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const style = getComputedStyle(element);
        return style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || '1') > 0 &&
          !element.hasAttribute('hidden');
      };
      const visibleRows = () => Array.from(document.querySelectorAll('.announcement-item'))
        .filter((row) => isVisible(row))
        .length;
      const setFilterValue = (element, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
        if (descriptor && typeof descriptor.set === 'function') {
          descriptor.set.call(element, value);
        } else {
          element.value = value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const debugSummary = () => JSON.stringify({
        statusFilterValue: statusFilter?.value ?? '',
        categoryFilterValue: categoryFilter?.value ?? '',
        seededAnnouncementFound: Boolean(document.querySelector('[data-announcement-id="' + announcementId + '"]')),
        seededAnnouncementVisible: isVisible(document.querySelector('[data-announcement-id="' + announcementId + '"]')),
        visibleRows: visibleRows(),
        panelFound: Boolean(panel),
        pageTextLength: (document.body?.innerText ?? '').length
      });

      if (!statusFilter) {
        return {
          debug: debugSummary(),
          seededAnnouncementFound: false,
          seededAnnouncementVisible: false,
          statusFilterFound: false,
          categoryFilterFound: Boolean(categoryFilter),
          visibleAnnouncementRows: visibleRows(),
          statusFilterSet: false
        };
      }

      setFilterValue(statusFilter, 'machine_draft');
      const startedAt = Date.now();
      while (Date.now() - startedAt < 10_000) {
        const currentVisibleRows = visibleRows();
        const seededAnnouncement = document.querySelector('[data-announcement-id="' + announcementId + '"]');
        if (statusFilter.value === 'machine_draft' && isVisible(seededAnnouncement)) {
          return {
            debug: debugSummary(),
            seededAnnouncementFound: Boolean(seededAnnouncement),
            seededAnnouncementVisible: isVisible(seededAnnouncement),
            statusFilterFound: true,
            categoryFilterFound: Boolean(categoryFilter),
            visibleAnnouncementRows: currentVisibleRows,
            statusFilterSet: true
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const seededAnnouncement = document.querySelector('[data-announcement-id="' + announcementId + '"]');
      return {
        debug: debugSummary(),
        seededAnnouncementFound: Boolean(seededAnnouncement),
        seededAnnouncementVisible: isVisible(seededAnnouncement),
        statusFilterFound: true,
        categoryFilterFound: Boolean(categoryFilter),
        visibleAnnouncementRows: visibleRows(),
        statusFilterSet: statusFilter.value === 'machine_draft'
      };
    })()
  `;
}

function buildMerchantTranslationGlossaryCreateExpression(expectedSource: string, expectedReplacement: string) {
  return `
    (async () => {
      const expectedSource = ${JSON.stringify(expectedSource)};
      const expectedReplacement = ${JSON.stringify(expectedReplacement)};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const debugSummary = () => JSON.stringify({
        bodyText: (document.body?.innerText ?? '').slice(0, 1000),
        errorText: document.querySelector('.form-error')?.textContent?.trim() ?? '',
        formFound: Boolean(document.querySelector('[data-qa="merchant-translation-glossary-form"]')),
        sourceFound: Boolean(document.querySelector('[data-qa="merchant-translation-glossary-source"]')),
        replacementFound: Boolean(document.querySelector('[data-qa="merchant-translation-glossary-replacement"]')),
        submitFound: Boolean(document.querySelector('[data-qa="merchant-translation-glossary-submit"]')),
        sourceValue: document.querySelector('[data-qa="merchant-translation-glossary-source"]')?.value ?? '',
        replacementValue: document.querySelector('[data-qa="merchant-translation-glossary-replacement"]')?.value ?? ''
      });
      const setNativeValue = (element, value) => {
        if (!element) {
          return;
        }
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        descriptor?.set?.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      try {
        const form = document.querySelector('[data-qa="merchant-translation-glossary-form"]');
        const source = document.querySelector('[data-qa="merchant-translation-glossary-source"]');
        const replacement = document.querySelector('[data-qa="merchant-translation-glossary-replacement"]');
        const note = document.querySelector('[data-qa="merchant-translation-glossary-note"]');
        const submit = document.querySelector('[data-qa="merchant-translation-glossary-submit"]');
        if (!form || !source || !replacement || !submit) {
          throw new Error('missing translation glossary controls: ' + debugSummary());
        }

        for (let attempt = 0; attempt < 10; attempt += 1) {
          setNativeValue(source, expectedSource);
          setNativeValue(replacement, expectedReplacement);
          setNativeValue(note, 'Release gate glossary UI smoke');
          await wait(100);
          if (source.value === expectedSource && replacement.value === expectedReplacement) {
            break;
          }
        }
        if (source.value !== expectedSource || replacement.value !== expectedReplacement) {
          throw new Error('translation glossary form values did not settle: ' + debugSummary());
        }

        if (form instanceof HTMLFormElement && !form.reportValidity()) {
          throw new Error('translation glossary form is invalid before submit: ' + debugSummary());
        }
        if (form instanceof HTMLFormElement && typeof form.requestSubmit === 'function') {
          form.requestSubmit(submit);
        } else {
          submit.click();
        }

        for (let attempt = 0; attempt < 140; attempt += 1) {
          const saved = document.querySelector('[data-qa="merchant-translation-glossary-saved"]');
          const savedId = saved?.getAttribute('data-glossary-term-id') ?? '';
          const row = savedId
            ? document.querySelector('[data-qa="merchant-translation-glossary-row"][data-glossary-term-id="' + savedId + '"]')
            : null;
          const savedText = saved?.textContent?.trim() ?? '';
          const errorText = document.querySelector('.form-error')?.textContent?.trim() ?? '';
          const urlHasTermId = savedId ? window.location.search.includes('term=' + encodeURIComponent(savedId)) : false;
          if (saved && savedId && row && !errorText && urlHasTermId && savedText.includes(expectedSource) && savedText.includes(expectedReplacement)) {
            const rect = saved.getBoundingClientRect();
            return {
              debug: debugSummary(),
              locationSearch: window.location.search,
              ok: true,
              rowFound: true,
              savedFound: true,
              savedId,
              savedInViewport: rect.top >= 0 && rect.top < window.innerHeight,
              savedText
            };
          }
          await wait(100);
        }

        const saved = document.querySelector('[data-qa="merchant-translation-glossary-saved"]');
        const savedId = saved?.getAttribute('data-glossary-term-id') ?? '';
        return {
          debug: debugSummary(),
          locationSearch: window.location.search,
          ok: false,
          rowFound: Boolean(savedId && document.querySelector('[data-qa="merchant-translation-glossary-row"][data-glossary-term-id="' + savedId + '"]')),
          savedFound: Boolean(saved),
          savedId,
          savedInViewport: false,
          savedText: saved?.textContent?.trim() ?? ''
        };
      } catch (error) {
        return {
          debug: String(error instanceof Error ? error.message : error) + ' :: ' + debugSummary(),
          locationSearch: window.location.search,
          ok: false,
          rowFound: false,
          savedFound: false,
          savedId: '',
          savedInViewport: false,
          savedText: ''
        };
      }
    })()
  `;
}

function buildMerchantAnnouncementTranslationFormExpression(
  announcementId: string,
  language: string,
  expectedTitle: string,
  expectedContent: string
) {
  return `
    (async () => {
      const announcementId = ${JSON.stringify(announcementId)};
      const language = ${JSON.stringify(language)};
      const expectedTitle = ${JSON.stringify(expectedTitle)};
      const expectedContent = ${JSON.stringify(expectedContent)};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const row = document.querySelector('[data-announcement-id="' + announcementId + '"]');
      const debugSummary = () => JSON.stringify({
        rowFound: Boolean(row),
        formFound: Boolean(row?.querySelector('[data-translation-form]')),
        languageValue: row?.querySelector('[data-translation-language-select]')?.value ?? '',
        titleValue: row?.querySelector('[data-translation-title-input]')?.value ?? '',
        contentValue: row?.querySelector('[data-translation-content-input]')?.value ?? '',
        statusValue: row?.querySelector('[data-translation-status-select]')?.value ?? '',
        lockedChecked: Boolean(row?.querySelector('[data-translation-locked-checkbox]')?.checked),
        messageText: document.querySelector('.form-success')?.textContent?.trim() ?? '',
        errorText: document.querySelector('.form-error')?.textContent?.trim() ?? '',
        bodyText: (document.body?.innerText ?? '').slice(0, 1000)
      });
      const setNativeValue = (element, value) => {
        if (!element) {
          return;
        }
        const prototype = element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        descriptor?.set?.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const setNativeChecked = (element, checked) => {
        if (!element) {
          return;
        }
        if (element.checked !== checked) {
          element.click();
        }
        if (element.checked === checked) {
          return;
        }
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
        descriptor?.set?.call(element, checked);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const readState = (fieldState) => {
        const currentRow = document.querySelector('[data-announcement-id="' + announcementId + '"]');
        const title = currentRow?.querySelector('[data-translation-title-input]');
        const content = currentRow?.querySelector('[data-translation-content-input]');
        const status = currentRow?.querySelector('[data-translation-status-select]');
        const locked = currentRow?.querySelector('[data-translation-locked-checkbox]');
        const save = currentRow?.querySelector('[data-translation-save-button]');
        const messageText = document.querySelector('.form-success')?.textContent?.trim() ?? '';
        const errorText = document.querySelector('.form-error')?.textContent?.trim() ?? '';
        const archive = document.getElementById('merchant-announcement-saved');
        const locationSearch = window.location.search;
        const savedByUrl =
          locationSearch.includes('saved=translation') &&
          locationSearch.includes('selected=' + encodeURIComponent(announcementId));
        const titleValue = fieldState?.titleValue ?? title?.value ?? '';
        const contentValue = fieldState?.contentValue ?? content?.value ?? '';
        const statusValue = fieldState?.statusValue ?? status?.value ?? '';
        const lockedChecked = fieldState?.lockedChecked ?? Boolean(locked?.checked);
        const archiveFound = Boolean(archive?.textContent?.trim()) && savedByUrl;
        const valuesSettled =
          titleValue === expectedTitle &&
          contentValue === expectedContent &&
          statusValue === 'human_reviewed' &&
          lockedChecked === true;
        return {
          archiveFound,
          contentValue,
          debug: debugSummary(),
          editButtonFound: Boolean(currentRow?.querySelector('[data-translation-edit-button]')),
          languageValue: currentRow?.querySelector('[data-translation-language-select]')?.value ?? '',
          lockedChecked,
          messageText,
          ok: Boolean(valuesSettled && savedByUrl && archiveFound && !errorText),
          rowFound: Boolean(currentRow),
          savedMessageFound: savedByUrl && !errorText,
          saveButtonFound: Boolean(save),
          statusValue,
          titleValue
        };
      };

      try {
        if (!row) {
          return readState();
        }
        const editButton = row.querySelector('[data-translation-edit-button]');
        if (!editButton) {
          return readState();
        }
        if (!row.querySelector('[data-translation-form]')) {
          editButton.click();
        }

        let select = null;
        for (let attempt = 0; attempt < 80; attempt += 1) {
          select = row.querySelector('[data-translation-language-select]');
          if (select) {
            break;
          }
          await wait(100);
        }
        if (!select) {
          return readState();
        }

        setNativeValue(select, language);
        await wait(250);
        const title = row.querySelector('[data-translation-title-input]');
        const content = row.querySelector('[data-translation-content-input]');
        const status = row.querySelector('[data-translation-status-select]');
        const locked = row.querySelector('[data-translation-locked-checkbox]');
        const save = row.querySelector('[data-translation-save-button]');
        if (!title || !content || !status || !locked || !save) {
          return readState();
        }

        setNativeValue(title, expectedTitle);
        setNativeValue(content, expectedContent);
        setNativeValue(status, 'human_reviewed');
        setNativeChecked(locked, true);

        let formState = readState();
        for (let attempt = 0; attempt < 40; attempt += 1) {
          formState = readState();
          if (
            formState.titleValue === expectedTitle &&
            formState.contentValue === expectedContent &&
            formState.statusValue === 'human_reviewed' &&
            formState.lockedChecked
          ) {
            break;
          }
          await wait(100);
        }
        if (
          formState.titleValue !== expectedTitle ||
          formState.contentValue !== expectedContent ||
          formState.statusValue !== 'human_reviewed' ||
          !formState.lockedChecked
        ) {
          return formState;
        }

        const preSaveState = formState;
        save.click();

        for (let attempt = 0; attempt < 140; attempt += 1) {
          const state = readState(preSaveState);
          if (state.ok) {
            return state;
          }
          await wait(100);
        }

        return readState(preSaveState);
      } catch (error) {
        const state = readState();
        return {
          ...state,
          debug: String(error instanceof Error ? error.message : error) + ' :: ' + state.debug,
          ok: false
        };
      }
    })()
  `;
}

async function merchantPreviewInteraction(announcementId: string, expectedTitle: string) {
  const previewPath = `/announcements/${announcementId}/preview`;
  const previewLanguage = 'language=ja-JP';
  const browserWindow = window as typeof window & {
    __releaseGatePreviewFetches?: PreviewFetchObservation[];
    __releaseGatePreviewOriginalFetch?: typeof window.fetch;
  };
  browserWindow.__releaseGatePreviewFetches = [];

  const originalFetch = browserWindow.__releaseGatePreviewOriginalFetch ?? window.fetch.bind(window);
  browserWindow.__releaseGatePreviewOriginalFetch = originalFetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl =
      typeof input === 'string' || input instanceof URL
        ? String(input)
        : typeof input === 'object' && 'url' in input
          ? String(input.url)
          : String(input);
    const isPreviewRequest = requestUrl.includes(previewPath) && requestUrl.includes(previewLanguage);

    try {
      const response = await originalFetch(input, init);
      if (isPreviewRequest) {
        browserWindow.__releaseGatePreviewFetches?.push({
          error: '',
          ok: response.ok || response.status === 304,
          status: response.status,
          url: response.url || requestUrl
        });
      }
      return response;
    } catch (error) {
      if (isPreviewRequest) {
        browserWindow.__releaseGatePreviewFetches?.push({
          error: String(error instanceof Error ? error.message : error),
          ok: false,
          status: null,
          url: requestUrl
        });
      }
      throw error;
    }
  }) as typeof window.fetch;

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const readPreviewFetches = () => browserWindow.__releaseGatePreviewFetches ?? [];
  const debugSummary = () => JSON.stringify({
    bodyText: (document.body?.innerText ?? '').slice(0, 1000),
    categoryFilterValue: (document.querySelector('[data-announcement-workflow-category-filter]') as HTMLSelectElement | null)?.value ?? '',
    filteredEmptyState: document.querySelector('.empty-state')?.textContent?.trim() ?? '',
    rowCount: document.querySelectorAll('.announcement-item').length,
    seededAnnouncementFound: Boolean(document.querySelector(`[data-announcement-id="${announcementId}"]`)),
    statusFilterValue: (document.querySelector('[data-announcement-workflow-status-filter]') as HTMLSelectElement | null)?.value ?? ''
  });
  const setSelectValue = (element: HTMLSelectElement | null, value: string) => {
    if (!element || element.value === value) {
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setSelectValue(document.querySelector('[data-announcement-workflow-status-filter]'), 'all');
  setSelectValue(document.querySelector('[data-announcement-workflow-category-filter]'), 'all');
  await wait(250);
  let row = document.querySelector(`[data-announcement-id="${announcementId}"]`);
  const rowDeadline = Date.now() + 10_000;
  while (!row && Date.now() < rowDeadline) {
    await wait(200);
    row = document.querySelector(`[data-announcement-id="${announcementId}"]`);
  }
  if (!row) {
    return {
      buttonFound: false,
      content: '',
      debug: debugSummary(),
      previewFetches: readPreviewFetches(),
      rowFound: false,
      selectFound: false,
      status: '',
      title: ''
    };
  }

  const select = row.querySelector('[data-preview-language-select]') as HTMLSelectElement | null;
  const button = row.querySelector('[data-preview-sync-button]') as HTMLButtonElement | null;
  if (!select || !button) {
    return {
      buttonFound: Boolean(button),
      content: '',
      debug: debugSummary(),
      previewFetches: readPreviewFetches(),
      rowFound: true,
      selectFound: Boolean(select),
      status: '',
      title: ''
    };
  }

  select.value = 'ja-JP';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  button.click();

  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const status = row.querySelector('[data-preview-status]')?.textContent?.trim() ?? '';
    const title = row.querySelector('[data-preview-title]')?.textContent?.trim() ?? '';
    const content = row.querySelector('[data-preview-content]')?.textContent?.trim() ?? '';
    const previewFetchSucceeded = readPreviewFetches().some((item) => {
      return item.ok && item.url.includes(previewPath) && item.url.includes(previewLanguage);
    });
    if (previewFetchSucceeded && title.includes(expectedTitle)) {
      return {
        buttonFound: true,
        content,
        debug: debugSummary(),
        previewFetches: readPreviewFetches(),
        rowFound: true,
        selectFound: true,
        status,
        title
      };
    }
    await wait(250);
  }

  return {
    buttonFound: true,
    content: row.querySelector('[data-preview-content]')?.textContent?.trim() ?? '',
    debug: debugSummary(),
    previewFetches: readPreviewFetches(),
    rowFound: true,
    selectFound: true,
    status: row.querySelector('[data-preview-status]')?.textContent?.trim() ?? '',
    title: row.querySelector('[data-preview-title]')?.textContent?.trim() ?? ''
  };
}

async function seedUserHomeAnnouncementSmokeData(
  prisma: PrismaClient,
  input: {
    expectedJapaneseContent: string;
    expectedJapaneseTitle: string;
    expectedSpanishContent: string;
    expectedSpanishTitle: string;
    password: string;
    sourceContent: string;
    sourceTitle: string;
    usernamePrefix: string;
  }
) {
  const passwordHash = await bcryptHash(input.password, 12);
  const adminUsername = `${input.usernamePrefix}_admin`;
  const username = `${input.usernamePrefix}_user`;
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.upsert({
      where: { code: 'default' },
      update: {},
      create: {
        code: 'default',
        name: '榛樿鍒嗙粍'
      }
    });

    const admin = await tx.user.create({
      data: {
        username: adminUsername,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${input.usernamePrefix}_admin_invite`
      }
    });
    await tx.wallet.create({ data: { userId: admin.id } });

    const user = await tx.user.create({
      data: {
        username,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${input.usernamePrefix}_user_invite`,
        lastLoginAt: now
      }
    });
    await tx.wallet.create({ data: { userId: user.id } });

    const announcement = await tx.announcement.create({
      data: {
        title: input.sourceTitle,
        content: input.sourceContent,
        category: AnnouncementCategory.ANNOUNCEMENT,
        status: AnnouncementStatus.PUBLISHED,
        isPinned: true,
        publishedAt: now,
        createdByAdminId: admin.id,
        translations: {
          es: {
            title: input.expectedSpanishTitle,
            content: input.expectedSpanishContent,
            _locked: true,
            _status: 'human_reviewed',
            _source: 'release-gate-user-home-smoke',
            _updatedAt: now.toISOString()
          },
          'ja-JP': {
            title: input.expectedJapaneseTitle,
            content: input.expectedJapaneseContent,
            _locked: true,
            _status: 'human_reviewed',
            _source: 'release-gate-user-home-smoke',
            _updatedAt: now.toISOString()
          },
          'en-US': {
            title: `${input.usernamePrefix} English announcement`,
            content: `${input.usernamePrefix} English announcement content`,
            _locked: true,
            _status: 'human_reviewed',
            _source: 'release-gate-user-home-smoke',
            _updatedAt: now.toISOString()
          }
        }
      }
    });

    return {
      adminUserId: admin.id,
      announcementId: announcement.id,
      groupId: group.id,
      userId: user.id,
      username,
      usernamePrefix: input.usernamePrefix
    };
  });
}

async function cleanupUserHomeAnnouncementSmokeData(
  prisma: PrismaClient,
  input: Awaited<ReturnType<typeof seedUserHomeAnnouncementSmokeData>>
) {
  await prisma.announcement.deleteMany({
    where: {
      OR: [
        { id: input.announcementId },
        { createdByAdminId: input.adminUserId },
        { title: { startsWith: input.usernamePrefix } }
      ]
    }
  });
  await prisma.session.deleteMany({ where: { userId: { in: [input.adminUserId, input.userId] } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: [input.adminUserId, input.userId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [input.adminUserId, input.userId] } } });
}

async function seedMerchantDashboardSmokeData(prisma: PrismaClient, usernamePrefix: string, password: string) {
  const passwordHash = await bcryptHash(password, 12);
  const username = `${usernamePrefix}_admin`;
  const userUsername = `${usernamePrefix}_user`;
  const model = `${usernamePrefix}_dashboard_model`;
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.upsert({
      where: { code: 'default' },
      update: {},
      create: {
        code: 'default',
        name: '榛樿鍒嗙粍'
      }
    });

    const admin = await tx.user.create({
      data: {
        username,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${usernamePrefix}_admin_invite`
      }
    });
    await tx.wallet.create({ data: { userId: admin.id } });

    const user = await tx.user.create({
      data: {
        username: userUsername,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${usernamePrefix}_user_invite`,
        lastLoginAt: now
      }
    });
    await tx.wallet.create({
      data: {
        userId: user.id,
        balanceCents: 7_654_321,
        totalSpendCents: 9_876_543
      }
    });

    const provider = await tx.upstreamProvider.create({
      data: {
        name: `${usernamePrefix}_dashboard_provider`,
        baseUrl: 'http://127.0.0.1',
        encryptedApiKey: `${usernamePrefix}_encrypted_key`,
        apiKeyPreview: 'rgd_qa',
        status: UpstreamProviderStatus.ACTIVE,
        createdByAdminId: admin.id
      }
    });

    const token = await tx.apiToken.create({
      data: {
        userId: user.id,
        name: `${usernamePrefix}_dashboard_token`,
        tokenHash: `${usernamePrefix}_token_hash_${randomBytes(6).toString('hex')}`,
        keyPreview: 'rgd_qa',
        status: ApiTokenStatus.ACTIVE
      }
    });

    await tx.usageEvent.create({
      data: {
        requestId: `${usernamePrefix}_dashboard_request`,
        userId: user.id,
        tokenId: token.id,
        upstreamProviderId: provider.id,
        model,
        upstreamModel: model,
        status: UsageEventStatus.BILLABLE,
        promptTokens: 55_000_000,
        completionTokens: 68_456_789,
        totalTokens: 123_456_789,
        costCents: 9_876_543,
        priceSnapshot: {
          source: 'release-gate-dashboard-smoke'
        },
        createdAt: now
      }
    });

    const rechargeCode = await tx.rechargeCode.create({
      data: {
        codeHash: `${usernamePrefix}_dashboard_recharge_hash`,
        kind: RechargeCodeKind.BALANCE,
        amountCents: 7_654_321,
        faceValueCnyCents: 7_654_321,
        status: RechargeCodeStatus.USED,
        createdByAdminId: admin.id,
        usedByUserId: user.id,
        usedAt: now,
        createdAt: now
      }
    });

    await tx.walletTransaction.create({
      data: {
        userId: user.id,
        type: WalletTransactionType.RECHARGE,
        amountCents: 7_654_321,
        balanceAfterCents: 7_654_321,
        rechargeCodeId: rechargeCode.id,
        idempotencyKey: `${usernamePrefix}_dashboard_recharge_tx`,
        createdAt: now
      }
    });

    return {
      adminUserId: admin.id,
      userId: user.id,
      userUsername,
      username
    };
  });
}

async function cleanupMerchantDashboardSmokeData(
  prisma: PrismaClient,
  usernamePrefix: string,
  adminUserId: string,
  userId: string
) {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        ...(adminUserId ? [{ id: adminUserId }] : []),
        ...(userId ? [{ id: userId }] : []),
        { username: { startsWith: usernamePrefix } }
      ]
    },
    select: { id: true }
  });
  const userIds = users.map((entry) => entry.id);

  const rechargeCodes = await prisma.rechargeCode.findMany({
    where: {
      OR: [
        { codeHash: { startsWith: usernamePrefix } },
        ...(userIds.length > 0 ? [{ createdByAdminId: { in: userIds } }, { usedByUserId: { in: userIds } }] : [])
      ]
    },
    select: { id: true }
  });
  const rechargeCodeIds = rechargeCodes.map((entry) => entry.id);

  await prisma.walletTransaction.deleteMany({
    where: {
      OR: [
        ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
        ...(rechargeCodeIds.length > 0 ? [{ rechargeCodeId: { in: rechargeCodeIds } }] : [])
      ]
    }
  });
  await prisma.rechargeCode.deleteMany({
    where: {
      OR: [
        ...(rechargeCodeIds.length > 0 ? [{ id: { in: rechargeCodeIds } }] : []),
        { codeHash: { startsWith: usernamePrefix } }
      ]
    }
  });
  await prisma.usageEvent.deleteMany({
    where: {
      OR: [
        ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
        { requestId: { startsWith: usernamePrefix } },
        { model: { startsWith: usernamePrefix } }
      ]
    }
  });
  await prisma.apiToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.upstreamProvider.deleteMany({
    where: {
      OR: [
        ...(userIds.length > 0 ? [{ createdByAdminId: { in: userIds } }] : []),
        { name: { startsWith: usernamePrefix } }
      ]
    }
  });
  if (userIds.length > 0) {
    await prisma.adminAuditLog.deleteMany({
      where: {
        adminUserId: { in: userIds }
      }
    });
    await prisma.securityAuditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: userIds } },
          { targetId: { in: userIds } }
        ]
      }
    });
  }
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function seedMerchantAnnouncementSmokeData(prisma: PrismaClient, usernamePrefix: string, password: string) {
  const passwordHash = await bcryptHash(password, 12);
  const username = `${usernamePrefix}_admin`;

  return prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.upsert({
      where: { code: 'default' },
      update: {},
      create: {
        code: 'default',
        name: '榛樿鍒嗙粍'
      }
    });

    const admin = await tx.user.create({
      data: {
        username,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${usernamePrefix}_invite`
      }
    });
    await tx.wallet.create({ data: { userId: admin.id } });

    const announcement = await tx.announcement.create({
      data: {
        title: `${usernamePrefix}_公告`,
        content: `${usernamePrefix}_真实公告内容`,
        category: AnnouncementCategory.ANNOUNCEMENT,
        status: AnnouncementStatus.PUBLISHED,
        isPinned: true,
        createdByAdminId: admin.id,
        publishedAt: new Date(),
        translations: {
          'en-US': {
            title: `${usernamePrefix}_en_title`,
            content: `${usernamePrefix}_en_content`,
            _locked: true,
            _status: 'human_reviewed',
            _source: 'release-gate',
            _updatedAt: new Date().toISOString()
          },
          'ja-JP': {
            title: `${usernamePrefix}_ja_title`,
            content: `${usernamePrefix}_ja_content`,
            _locked: false,
            _status: 'machine_draft',
            _source: 'release-gate',
            _updatedAt: new Date().toISOString()
          }
        }
      }
    });

    return {
      adminUserId: admin.id,
      announcementId: announcement.id,
      username
    };
  });
}

async function seedMerchantModelConfigSmokeData(prisma: PrismaClient, usernamePrefix: string, password: string) {
  const passwordHash = await bcryptHash(password, 12);
  const username = `${usernamePrefix}_admin`;

  return prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.upsert({
      where: { code: 'default' },
      update: {},
      create: {
        code: 'default',
        name: '姒涙顓婚崚鍡欑矋'
      }
    });

    const admin = await tx.user.create({
      data: {
        username,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${usernamePrefix}_invite`
      }
    });
    await tx.wallet.create({ data: { userId: admin.id } });

    return {
      adminUserId: admin.id,
      username
    };
  });
}

async function seedUserModelsLocalizationSmokeData(
  prisma: PrismaClient,
  usernamePrefix: string,
  password: string,
  expectedSpanishDisplayName: string,
  expectedJapaneseDisplayName = `${usernamePrefix} 日本語 QA モデル`
) {
  const passwordHash = await bcryptHash(password, 12);
  const username = `${usernamePrefix}_user`;
  const groupCode = `${usernamePrefix}_group`;
  const modelName = `${usernamePrefix}_model`;
  const upstreamProviderName = `${usernamePrefix}_provider`;
  const upstreamModelName = `${usernamePrefix}_upstream`;

  return prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.create({
      data: {
        code: groupCode,
        name: `${usernamePrefix} QA Group`,
        multiplier: '1.0000'
      }
    });

    const user = await tx.user.create({
      data: {
        username,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${usernamePrefix}_invite`
      }
    });
    await tx.wallet.create({ data: { userId: user.id, balanceCents: 1_000_000 } });

    const model = await tx.modelPrice.create({
      data: {
        model: modelName,
        displayName: `${usernamePrefix} QA Model`,
        translations: {
          'es-ES': {
            displayName: expectedSpanishDisplayName,
            _locked: true,
            _source: 'release-gate',
            _status: 'human_reviewed'
          },
          'ja-JP': {
            displayName: expectedJapaneseDisplayName,
            _locked: true,
            _source: 'release-gate',
            _status: 'human_reviewed'
          }
        },
        inputPriceCentsPer1k: 17,
        outputPriceCentsPer1k: 31,
        modelMultiplier: '1.0000',
        pricingMode: ModelPricingMode.MANUAL,
        status: ModelStatus.ACTIVE
      }
    });

    await tx.modelGroupAccess.create({
      data: {
        modelPriceId: model.id,
        groupId: group.id
      }
    });

    const provider = await tx.upstreamProvider.create({
      data: {
        name: upstreamProviderName,
        kind: UpstreamProviderKind.GENERIC,
        baseUrl: `https://${upstreamProviderName}.example.invalid`,
        encryptedApiKey: `${usernamePrefix}_encrypted_key`,
        apiKeyPreview: 'qa-***',
        status: UpstreamProviderStatus.ACTIVE,
        createdByAdminId: user.id
      }
    });

    const mapping = await tx.upstreamModel.create({
      data: {
        providerId: provider.id,
        publicModel: modelName,
        upstreamModel: upstreamModelName,
        priority: 1,
        timeoutMs: 5000,
        pricingMode: ModelPricingMode.MANUAL,
        inputPriceCentsPer1k: 17,
        outputPriceCentsPer1k: 31,
        modelMultiplier: '1.0000',
        status: ModelStatus.ACTIVE,
        supportsStream: true
      }
    });

    return {
      groupId: group.id,
      mappingId: mapping.id,
      modelId: model.id,
      modelName,
      providerId: provider.id,
      upstreamModelName,
      userId: user.id,
      username
    };
  });
}

async function cleanupMerchantModelConfigSmokeData(
  prisma: PrismaClient,
  context: {
    adminUserId: string;
    usernamePrefix: string;
    username: string;
    groupId: string;
    modelId: string;
    modelName: string;
    upstreamModelName: string;
    mappingId: string;
    providerId: string;
  }
) {
  const {
    adminUserId,
    usernamePrefix,
    groupId,
    modelId,
    modelName,
    upstreamModelName,
    mappingId,
    providerId
  } = context;

  const userWhere = [...(adminUserId ? [{ id: adminUserId }] : []), { username: { startsWith: usernamePrefix } }];
  const users = await prisma.user.findMany({
    where: { OR: userWhere },
    select: { id: true }
  });
  const userIds = users.map((entry) => entry.id);

  const modelPriceWhere = {
    OR: [
      ...(modelId ? [{ id: modelId }] : []),
      { model: { startsWith: usernamePrefix } },
      { model: modelName }
    ]
  };
  const modelPrices = await prisma.modelPrice.findMany({
    where: modelPriceWhere,
    select: { id: true, model: true }
  });
  const modelPriceIds = modelPrices.map((entry) => entry.id);

  const upstreamModelWhere = {
    OR: [
      ...(mappingId ? [{ id: mappingId }] : []),
      ...(modelName ? [{ publicModel: modelName }] : []),
      { publicModel: { startsWith: usernamePrefix } },
      { upstreamModel: upstreamModelName }
    ]
  };
  const upstreamModels = await prisma.upstreamModel.findMany({
    where: upstreamModelWhere,
    select: { id: true, publicModel: true }
  });
  const upstreamModelIds = upstreamModels.map((entry) => entry.id);

  const providerWhere = {
    OR: [
      ...(providerId ? [{ id: providerId }] : []),
      ...(userIds.length > 0 ? [{ createdByAdminId: { in: userIds } }] : []),
      { name: { startsWith: usernamePrefix } }
    ]
  };
  const providers = await prisma.upstreamProvider.findMany({
    where: providerWhere,
    select: { id: true }
  });
  const providerIds = providers.map((entry) => entry.id);

  const groupIds = [groupId].filter((value): value is string => Boolean(value));

  const mappedModelNames = [...new Set(upstreamModels.map((entry) => entry.publicModel).concat(modelPrices.map((entry) => entry.model)))];

  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminUserId: { in: userIds } },
        { targetId: { in: modelPriceIds } }
      ]
    }
  });
  await prisma.securityAuditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { targetId: { in: userIds } }
      ]
    }
  });
  await prisma.upstreamConcurrencySlot.deleteMany({
    where: {
      OR: [
        ...(mappedModelNames.length > 0 ? [{ publicModel: { in: mappedModelNames } }] : []),
        ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : [])
      ]
    }
  });
  await prisma.userUpstreamAssignment.deleteMany({
    where: {
      OR: [
        ...(mappedModelNames.length > 0 ? [{ publicModel: { in: mappedModelNames } }] : []),
        ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : [])
      ]
    }
  });
  await prisma.apiTokenModelAccess.deleteMany({
    where: {
      OR: [
        ...(modelName ? [{ model: modelName }] : []),
        ...(mappedModelNames.length > 0 ? [{ model: { in: mappedModelNames } }] : []),
        ...(modelPriceIds.length > 0 ? [{ model: { in: modelPrices.map((entry) => entry.model) } }] : [])
      ]
    }
  });
  await prisma.upstreamModel.deleteMany({
    where: {
      OR: [
        ...(upstreamModelIds.length > 0 ? [{ id: { in: upstreamModelIds } }] : []),
        ...(mappedModelNames.length > 0 ? [{ publicModel: { in: mappedModelNames } }] : [])
      ]
    }
  });
  await prisma.modelGroupAccess.deleteMany({
    where: {
      OR: [
        ...(modelPriceIds.length > 0 ? [{ modelPriceId: { in: modelPriceIds } }] : []),
        ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])
      ]
    }
  });
  await prisma.modelPrice.deleteMany({
    where: {
      OR: [
        ...(modelPriceIds.length > 0 ? [{ id: { in: modelPriceIds } }] : []),
        { model: { startsWith: usernamePrefix } }
      ]
    }
  });
  await prisma.upstreamProvider.deleteMany({
    where: {
      OR: [
        ...(providerIds.length > 0 ? [{ id: { in: providerIds } }] : []),
        { name: { startsWith: usernamePrefix } }
      ]
    }
  });
  await prisma.requestLog.deleteMany({
    where: {
      OR: [
        ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
        ...(mappedModelNames.length > 0 ? [{ model: { in: mappedModelNames } }] : [])
      ]
    }
  });
  await prisma.usageEvent.deleteMany({
    where: {
      OR: [
        ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
        ...(mappedModelNames.length > 0 ? [{ model: { in: mappedModelNames } }] : [])
      ]
    }
  });
  if (groupIds.length > 0) {
    await prisma.modelGroupAccess.deleteMany({
      where: { groupId: { in: groupIds } }
    });
  }
  if (userIds.length > 0) {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (groupIds.length > 0) {
    await prisma.userGroup.deleteMany({
      where: { id: { in: groupIds } }
    });
  }
}

async function cleanupMerchantAnnouncementSmokeData(
  prisma: PrismaClient,
  usernamePrefix: string,
  adminUserId: string,
  announcementId: string
) {
  const userWhere = [
    ...(adminUserId ? [{ id: adminUserId }] : []),
    { username: { startsWith: usernamePrefix } }
  ];
  const users = await prisma.user.findMany({
    where: { OR: userWhere },
    select: { id: true }
  });
  const userIds = users.map((entry) => entry.id);
  const announcementIds = [announcementId].filter(Boolean);

  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminUserId: { in: userIds } },
        { targetId: { in: announcementIds } }
      ]
    }
  });
  await prisma.securityAuditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { targetId: { in: userIds } }
      ]
    }
  });
  await prisma.announcement.deleteMany({
    where: {
      OR: [
        { id: { in: announcementIds } },
        { title: { startsWith: usernamePrefix } },
        { createdByAdminId: { in: userIds } }
      ]
    }
  });
  await prisma.translationGlossaryTerm.deleteMany({
    where: {
      OR: [
        { sourceTerm: { startsWith: usernamePrefix } },
        { replacementTerm: { startsWith: usernamePrefix } },
        { createdByAdminId: { in: userIds } },
        { updatedByAdminId: { in: userIds } }
      ]
    }
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function seedMerchantRechargeCodeSmokeData(prisma: PrismaClient, usernamePrefix: string, password: string) {
  const passwordHash = await bcryptHash(password, 12);
  const username = `${usernamePrefix}_admin`;

  return prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.upsert({
      where: { code: 'default' },
      update: {},
      create: {
        code: 'default',
        name: '姒涙顓婚崚鍡欑矋'
      }
    });

    const admin = await tx.user.create({
      data: {
        username,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${usernamePrefix}_invite`
      }
    });
    await tx.wallet.create({ data: { userId: admin.id } });

    return {
      adminUserId: admin.id,
      username
    };
  });
}

async function cleanupMerchantRechargeCodeSmokeData(
  prisma: PrismaClient,
  usernamePrefix: string,
  adminUserId: string
) {
  const userWhere = [
    ...(adminUserId ? [{ id: adminUserId }] : []),
    { username: { startsWith: usernamePrefix } }
  ];
  const users = await prisma.user.findMany({
    where: { OR: userWhere },
    select: { id: true }
  });
  const userIds = users.map((entry) => entry.id);
  const rechargeCodes = await prisma.rechargeCode.findMany({
    where: { createdByAdminId: { in: userIds } },
    select: { id: true }
  });
  const rechargeCodeIds = rechargeCodes.map((entry) => entry.id);

  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminUserId: { in: userIds } },
        { targetId: { in: rechargeCodeIds } }
      ]
    }
  });
  await prisma.securityAuditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { targetId: { in: userIds } }
      ]
    }
  });
  await prisma.walletTransaction.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { rechargeCodeId: { in: rechargeCodeIds } }
      ]
    }
  });
  await prisma.rechargeCode.deleteMany({
    where: {
      OR: [
        { id: { in: rechargeCodeIds } },
        { createdByAdminId: { in: userIds } }
      ]
    }
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function seedPhoneAuthRecoverySmokeData(
  prisma: PrismaClient,
  input: {
    password: string;
    phoneNumber: string;
    usernamePrefix: string;
  }
) {
  const passwordHash = await bcryptHash(input.password, 12);
  const username = `${input.usernamePrefix}_phone_user`;

  return prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.upsert({
      where: { code: 'default' },
      update: {},
      create: {
        code: 'default',
        name: '默认分组'
      }
    });

    const user = await tx.user.create({
      data: {
        username,
        phoneNumber: input.phoneNumber,
        phoneVerifiedAt: null,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${input.usernamePrefix}_invite`
      }
    });
    await tx.wallet.create({ data: { userId: user.id } });

    return {
      userId: user.id,
      username
    };
  });
}

async function cleanupPhoneAuthRecoverySmokeData(prisma: PrismaClient, usernamePrefix: string, userId: string) {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        ...(userId ? [{ id: userId }] : []),
        { username: { startsWith: usernamePrefix } }
      ]
    },
    select: { id: true }
  });
  const userIds = users.map((entry) => entry.id);

  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminUserId: { in: userIds } },
        { targetId: { in: userIds } }
      ]
    }
  });
  await prisma.securityAuditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { targetId: { in: userIds } }
      ]
    }
  });
  await prisma.passwordRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function seedMerchantAiRechargeSmokeData(prisma: PrismaClient, usernamePrefix: string, password: string) {
  const passwordHash = await bcryptHash(password, 12);
  const username = `${usernamePrefix}_admin`;
  const userUsername = `${usernamePrefix}_user`;
  const userTokenName = `${usernamePrefix}_leaderboard_token`;
  const userTotalTokens = 7_654_321;

  return prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.upsert({
      where: { code: 'default' },
      update: {},
      create: {
        code: 'default',
        name: '榛樿鍒嗙粍'
      }
    });

    const admin = await tx.user.create({
      data: {
        username,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${usernamePrefix}_invite`
      }
    });
    await tx.wallet.create({ data: { userId: admin.id } });

    const user = await tx.user.create({
      data: {
        username: userUsername,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${usernamePrefix}_user_invite`
      }
    });
    await tx.wallet.create({ data: { userId: user.id } });

    const provider = await tx.upstreamProvider.create({
      data: {
        name: `${usernamePrefix}_leaderboard_provider`,
        baseUrl: 'http://127.0.0.1',
        encryptedApiKey: `${usernamePrefix}_encrypted_key`,
        apiKeyPreview: 'qa',
        status: UpstreamProviderStatus.ACTIVE,
        createdByAdminId: admin.id
      }
    });
    const token = await tx.apiToken.create({
      data: {
        userId: user.id,
        name: userTokenName,
        tokenHash: `${usernamePrefix}_token_hash_${randomBytes(6).toString('hex')}`,
        keyPreview: 'rga_qa',
        status: ApiTokenStatus.ACTIVE
      }
    });
    await tx.usageEvent.create({
      data: {
        requestId: `${usernamePrefix}_leaderboard_request`,
        userId: user.id,
        tokenId: token.id,
        upstreamProviderId: provider.id,
        model: `${usernamePrefix}_leaderboard_model`,
        upstreamModel: `${usernamePrefix}_leaderboard_model`,
        status: UsageEventStatus.BILLABLE,
        promptTokens: 3_000_000,
        completionTokens: 4_654_321,
        totalTokens: userTotalTokens,
        costCents: 123,
        priceSnapshot: {}
      }
    });

    return {
      adminUserId: admin.id,
      userTokenName,
      userTotalTokens,
      userUsername,
      username
    };
  });
}

async function seedMerchantAiRechargeDeleteProductData(
  prisma: PrismaClient,
  adminUserId: string,
  usernamePrefix: string,
  title: string
) {
  return prisma.aiRechargeProduct.create({
    data: {
      productKind: AiRechargeProductKind.VIBE_CODING,
      title,
      platform: 'VibeCoding',
      planName: 'Delete smoke 5h',
      durationDays: 7,
      quotaHours: 5,
      quotaPeriodDays: 7,
      tokenQuota: 50000,
      priceCnyCents: 1990,
      description: `${usernamePrefix} delete smoke product`,
      purchaseNote: 'Release gate delete smoke purchase note',
      deliveryNote: 'Release gate delete smoke delivery note',
      sortOrder: 8,
      status: AiRechargeProductStatus.ACTIVE,
      createdByAdminId: adminUserId
    }
  });
}

async function seedMerchantAiRechargeDailyProductData(
  prisma: PrismaClient,
  adminUserId: string,
  usernamePrefix: string,
  title: string
) {
  return prisma.aiRechargeProduct.create({
    data: {
      productKind: AiRechargeProductKind.VIBE_CODING,
      title,
      platform: 'VibeCoding',
      planName: 'Daily 5h',
      durationDays: 1,
      quotaHours: 5,
      quotaPeriodDays: 1,
      tokenQuota: 25000,
      priceCnyCents: 1990,
      description: `${usernamePrefix} daily package smoke product`,
      purchaseNote: 'Release gate daily package purchase note',
      deliveryNote: 'Release gate daily package delivery note',
      sortOrder: 7,
      status: AiRechargeProductStatus.ACTIVE,
      createdByAdminId: adminUserId
    }
  });
}

async function seedMerchantAiRechargeSmokeOrderData(
  prisma: PrismaClient,
  adminUserId: string,
  productId: string,
  productTitle: string,
  platform: string,
  merchantNote: string
) {
  const orderNo = `rga-${Date.now()}-${randomBytes(2).toString('hex')}`;
  return prisma.aiRechargeOrder.create({
    data: {
      userId: adminUserId,
      productId,
      orderNo,
      productTitleSnapshot: productTitle,
      platformSnapshot: platform,
      planNameSnapshot: 'Weekly 5h',
      amountCnyCents: 3990,
      customerAccount: 'qa-customer@example.com',
      customerContact: 'chat.qa@example.com',
      customerNote: 'Release gate seeded order for smoke',
      merchantNote,
      status: 'PENDING'
    }
  });
}

async function cleanupMerchantAiRechargeSmokeData(
  prisma: PrismaClient,
  usernamePrefix: string,
  adminUserId: string
) {
  const userWhere = [
    ...(adminUserId ? [{ id: adminUserId }] : []),
    { username: { startsWith: usernamePrefix } }
  ];
  const users = await prisma.user.findMany({
    where: { OR: userWhere },
    select: { id: true }
  });
  const userIds = users.map((entry) => entry.id);
  const products = await prisma.aiRechargeProduct.findMany({
    where: {
      OR: [
        { createdByAdminId: { in: userIds } },
        { title: { startsWith: usernamePrefix } }
      ]
    },
    select: { id: true }
  });
  const productIds = products.map((entry) => entry.id);

  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminUserId: { in: userIds } },
        { targetId: { in: productIds } }
      ]
    }
  });
  await prisma.securityAuditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { targetId: { in: userIds } }
      ]
    }
  });
  await prisma.aiRechargeOrder.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { productId: { in: productIds } }
      ]
    }
  });
  await prisma.aiRechargeProduct.deleteMany({
    where: {
      OR: [
        { id: { in: productIds } },
        { createdByAdminId: { in: userIds } },
        { title: { startsWith: usernamePrefix } }
      ]
    }
  });
  await prisma.usageEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.apiToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.upstreamProvider.deleteMany({
    where: {
      OR: [
        { createdByAdminId: { in: userIds } },
        { name: { startsWith: usernamePrefix } }
      ]
    }
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function loginReleaseGateAdmin(username: string, password: string) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const text = await response.text();
  assert(response.status === 200 || response.status === 201, `release gate admin login failed with ${response.status}: ${text}`);
  const cookies = extractCookiePairs(response);
  assert(cookies.length > 0, 'release gate admin login did not return session cookies');
  return { cookies };
}

function extractCookiePairs(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookieHeaders = headers.getSetCookie ? headers.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
  return cookieHeaders
    .filter(Boolean)
    .map((header) => header.split(';')[0])
    .flatMap((pair) => {
      const separator = pair.indexOf('=');
      if (separator <= 0) {
        return [];
      }
      return [{ name: pair.slice(0, separator), value: pair.slice(separator + 1) }];
    });
}

async function setBrowserCookies(
  cdp: Awaited<ReturnType<typeof connectCdp>>,
  url: string,
  cookies: Array<{ name: string; value: string }>
) {
  for (const cookie of cookies) {
    const result = await cdp.send('Network.setCookie', {
      url,
      name: cookie.name,
      value: cookie.value,
      path: '/'
    }) as { success?: boolean };
    assert(result.success !== false, `Chrome refused to set cookie ${cookie.name}`);
  }
}

function collectPublicAnnouncementLeaks(body: AnnouncementApiResult['body']) {
  const forbidden = [
    'translations',
    'status',
    'scheduledAt',
    'scheduledPublishAt',
    'isPinned',
    'pinned',
    'createdByAdminId',
    'createdBy'
  ];
  const leaks = new Set<string>();
  for (const item of body.sections.flatMap((section) => section.items)) {
    for (const field of forbidden) {
      if (Object.prototype.hasOwnProperty.call(item, field)) {
        leaks.add(field);
      }
    }
  }
  return [...leaks];
}

type PreviewNetworkObservation = {
  requestObserved: boolean;
  successResponseObserved: boolean;
  summary: string;
};

function summarizePreviewNetwork(events: CdpEvent[], announcementId: string): PreviewNetworkObservation {
  const previewPath = `/announcements/${announcementId}/preview`;
  const previewLanguage = 'ja-JP';
  const previewRequestIds = new Set<string>();
  const requestUrls = new Set<string>();
  const responseUrls = new Set<string>();
  const responseStatuses = new Set<number>();
  const failedResponseStatuses = new Set<string>();
  let hasSuccessResponse = false;
  let hasFailure = false;

  const parseEventUrl = (rawUrl: string) => {
    if (!rawUrl) {
      return null;
    }
    try {
      return new URL(rawUrl, WEB_BASE_URL);
    } catch {
      return null;
    }
  };

  const isPreviewRequest = (url: URL) => {
    return url.pathname.includes(previewPath) && url.searchParams.get('language') === previewLanguage;
  };

  for (const event of events) {
    if (event.method === 'Network.requestWillBeSent') {
      const request = event.params?.request as { method?: string; url?: string } | undefined;
      const requestId = event.params?.requestId != null ? String(event.params.requestId) : undefined;
      const url = parseEventUrl(request?.url ?? '');
      if (!requestId || !url || request?.method !== 'GET' || !isPreviewRequest(url)) {
        continue;
      }
      previewRequestIds.add(requestId);
      requestUrls.add(url.toString());
      continue;
    }

    if (event.method === 'Network.responseReceived') {
      const requestId = event.params?.requestId != null ? String(event.params.requestId) : undefined;
      const response = event.params?.response as { status?: number; url?: string } | undefined;
      if (!requestId || !response) {
        continue;
      }
      if (!previewRequestIds.has(requestId)) {
        continue;
      }
      if (response.url) {
        responseUrls.add(response.url);
      }
      const status = response.status;
      if (typeof status === 'number') {
        responseStatuses.add(status);
        if ((status >= 200 && status < 300) || status === 304) {
          hasSuccessResponse = true;
        } else {
          hasFailure = true;
          failedResponseStatuses.add(String(status));
        }
      }
      continue;
    }

    if (event.method === 'Network.loadingFailed' && previewRequestIds.has(String(event.params?.requestId ?? ''))) {
      hasFailure = true;
      failedResponseStatuses.add((event.params?.errorText as string) ?? 'loading-failed');
    }
  }

  const requestList = Array.from(requestUrls);
  const responseList = Array.from(responseUrls);
  const seenResponse = Array.from(responseStatuses).join(',');
  const seenFailures = Array.from(failedResponseStatuses).join(',');
  return {
    requestObserved: requestList.length > 0,
    successResponseObserved: hasSuccessResponse,
    summary: [
      `requests=${requestList.length > 0 ? requestList.join(' | ') : 'none'}`,
      `responseUrls=${responseList.length > 0 ? responseList.join(' | ') : 'none'}`,
      `responses=${seenResponse || 'none'}`,
      `failures=${seenFailures || 'none'}`,
      `hasFailure=${hasFailure}`
    ].join('; ')
  };
}

function collectConsoleErrors(events: CdpEvent[]) {
  const errors: string[] = [];
  for (const event of events) {
    if (event.method === 'Runtime.exceptionThrown') {
      const details = event.params?.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
      errors.push(details?.exception?.description ?? details?.text ?? 'runtime exception');
    }
    if (event.method === 'Runtime.consoleAPICalled') {
      const params = event.params as { type?: string; args?: Array<{ value?: unknown; description?: string }> } | undefined;
      if (params?.type === 'error') {
        errors.push(params.args?.map((arg) => String(arg.value ?? arg.description ?? '')).join(' ') || 'console.error');
      }
    }
    if (event.method === 'Log.entryAdded') {
      const params = event.params as { entry?: { level?: string; text?: string } } | undefined;
      if (params?.entry?.level === 'error') {
        errors.push(params.entry.text ?? 'browser log error');
      }
    }
    if (event.method === 'Network.responseReceived') {
      const params = event.params as { response?: { status?: number; url?: string } } | undefined;
      const status = params?.response?.status ?? 0;
      if (status >= 400) {
        errors.push(`network ${status}: ${params?.response?.url ?? 'unknown url'}`);
      }
    }
  }
  return errors.filter(Boolean);
}

function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ].filter(Boolean) as string[];

  const chromePath = candidates.find((candidate) => existsSync(candidate));
  if (!chromePath) {
    throw new Error('Chrome executable not found. Set CHROME_PATH to run Chrome screenshot QA.');
  }
  return chromePath;
}

function resolveExecutable(command: string, args: string[]) {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', [command, ...args].map(quoteCmdArg).join(' ')]
    };
  }
  return { command, args };
}

function quoteCmdArg(value: string) {
  if (/^[A-Za-z0-9_./:=\\-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function cleanEnv(env: NodeJS.ProcessEnv) {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

async function waitForProcessExit(child: ChildProcess | null, timeoutMs: number) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function readDevToolsPort(userDataDir: string) {
  const filePath = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const content = await readFile(filePath, 'utf8');
      const [port] = content.trim().split(/\r?\n/);
      if (port) {
        return port;
      }
    } catch {
      await delay(250);
    }
  }
  throw new Error('Chrome did not expose a DevTools port in time');
}

async function firstPageTarget(port: string) {
  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  assert(targets.status === 200, `Chrome target list failed with ${targets.status}`);
  assert(Array.isArray(targets.json), 'Chrome target list should be an array');
  const target = targets.json.find((item: { type?: string; webSocketDebuggerUrl?: string }) => {
    return item.type === 'page' && item.webSocketDebuggerUrl;
  });
  assert(target?.webSocketDebuggerUrl, 'Chrome page target is missing a WebSocket debugger URL');
  return target as { webSocketDebuggerUrl: string };
}

async function fetchJson(url: string) {
  const response = await fetch(url);
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

async function connectCdp(webSocketUrl: string) {
  const WebSocketCtor = globalThis.WebSocket;
  if (!WebSocketCtor) {
    throw new Error('This Node runtime does not expose WebSocket for Chrome CDP QA');
  }

  const socket = new WebSocketCtor(webSocketUrl);
  const pending = new Map<number, PendingRequest>();
  const eventHandlers = new Set<(event: CdpEvent) => void>();
  let commandId = 0;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome CDP WebSocket open timed out')), 15_000);
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Chrome CDP WebSocket failed to open'));
    });
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as CdpResponse & CdpEvent;
    if (typeof message.id === 'number') {
      const request = pending.get(message.id);
      if (!request) {
        return;
      }
      pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(message.error.message ?? 'Chrome CDP command failed'));
        return;
      }
      request.resolve(message.result);
      return;
    }

    for (const handler of eventHandlers) {
      handler(message);
    }
  });
  const rejectPending = (error: Error) => {
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  };
  socket.addEventListener('close', () => {
    rejectPending(new Error('Chrome CDP WebSocket closed'));
  });
  socket.addEventListener('error', () => {
    rejectPending(new Error('Chrome CDP WebSocket error'));
  });

  return {
    send(method: string, params: Record<string, unknown> = {}, timeoutMs = DEFAULT_CDP_COMMAND_TIMEOUT_MS) {
      const id = ++commandId;
      const payload = JSON.stringify({ id, method, params });
      return new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for Chrome CDP command ${method}`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          }
        });
        try {
          socket.send(payload);
        } catch (error) {
          clearTimeout(timeout);
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    waitEvent(method: string, timeoutMs: number) {
      return new Promise<CdpEvent>((resolve, reject) => {
        const timeout = setTimeout(() => {
          eventHandlers.delete(handler);
          reject(new Error(`Timed out waiting for Chrome event ${method}`));
        }, timeoutMs);
        const handler = (event: CdpEvent) => {
          if (event.method !== method) {
            return;
          }
          clearTimeout(timeout);
          eventHandlers.delete(handler);
          resolve(event);
        };
        eventHandlers.add(handler);
      });
    },
    onEvent(handler: (event: CdpEvent) => void) {
      eventHandlers.add(handler);
    },
    close() {
      socket.close();
    }
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

