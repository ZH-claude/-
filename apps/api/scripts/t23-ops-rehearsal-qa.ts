import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = path.resolve(__dirname, '../../..');

const files = {
  backup: path.join(ROOT_DIR, 'ops', 'backup', 'postgres-backup.sh'),
  deploy: path.join(ROOT_DIR, 'ops', 'deploy', 'deploy.sh'),
  rollback: path.join(ROOT_DIR, 'ops', 'deploy', 'rollback.sh'),
  restart: path.join(ROOT_DIR, 'ops', 'deploy', 'restart-verify.sh'),
  preflight: path.join(ROOT_DIR, 'ops', 'deploy', 'preflight.mjs'),
  smoke: path.join(ROOT_DIR, 'ops', 'smoke', 't21-deploy-smoke.mjs'),
  compose: path.join(ROOT_DIR, 'compose.prod.yml')
};

const checks: string[] = [];

async function main() {
  const text = {
    backup: await readRequiredFile(files.backup),
    deploy: await readRequiredFile(files.deploy),
    rollback: await readRequiredFile(files.rollback),
    restart: await readRequiredFile(files.restart),
    preflight: await readRequiredFile(files.preflight),
    smoke: await readRequiredFile(files.smoke),
    compose: await readRequiredFile(files.compose)
  };

  assertShellSafety('backup script', text.backup);
  assertShellSafety('deploy script', text.deploy);
  assertShellSafety('rollback script', text.rollback);
  assertShellSafety('restart verify script', text.restart);
  checks.push('ops_scripts_use_fail_fast_shell_mode');

  assertIncludes(text.backup, 'pg_dump', 'backup must use pg_dump');
  assertIncludes(text.backup, '--format=custom', 'backup must produce custom-format dumps for pg_restore compatibility');
  assertIncludes(text.backup, '--no-owner', 'backup must avoid owner binding');
  assertIncludes(text.backup, '--no-privileges', 'backup must avoid privilege binding');
  assertIncludes(text.backup, 'sha256sum "$OUT" > "$OUT.sha256"', 'backup must write checksum next to dump');
  assertIncludes(text.backup, 'exec -T postgres', 'backup must run inside the postgres service');
  checks.push('postgres_backup_generates_custom_dump_and_checksum');

  assertIncludes(text.deploy, 'RUN_BACKUP_BEFORE_DEPLOY="${RUN_BACKUP_BEFORE_DEPLOY:-true}"', 'deploy must default to backup before deploy');
  assertIncludes(text.deploy, 'PRECHECK_ONLY="${PRECHECK_ONLY:-false}"', 'deploy must expose precheck-only mode');
  assertOrder(text.deploy, 'node ops/deploy/preflight.mjs --env-file "$ENV_FILE"', 'compose up -d --build --remove-orphans', 'preflight must run before deploy');
  assertOrder(text.deploy, 'sh ops/backup/postgres-backup.sh', 'compose up -d --build --remove-orphans', 'backup must run before compose deploy');
  assertOrder(text.deploy, 'compose up -d --build --remove-orphans', 'compose exec -T api npm --prefix apps/api run db:migrate', 'migrations must run after services are up');
  assertIncludes(text.deploy, 'RUN_RESTART_VERIFY="${RUN_RESTART_VERIFY:-false}"', 'deploy must be able to chain restart verification');
  checks.push('deploy_preflight_backup_migrate_and_restart_verify_guards_are_wired');

  assertIncludes(text.rollback, 'usage: ops/deploy/rollback.sh <git-ref>', 'rollback must require an explicit git ref');
  assertIncludes(text.rollback, 'SKIP_ROLLBACK_BACKUP="${SKIP_ROLLBACK_BACKUP:-false}"', 'rollback must default to taking a backup');
  assertOrder(text.rollback, 'sh ops/backup/postgres-backup.sh', 'git fetch origin --tags', 'rollback backup must happen before git ref changes');
  assertOrder(text.rollback, 'git checkout "$TARGET_REF"', 'docker compose -f "$COMPOSE_FILE" build api web', 'rollback must checkout target before rebuilding');
  assertIncludes(text.rollback, 'node ops/smoke/t21-deploy-smoke.mjs', 'rollback must run deploy smoke when URLs are configured');
  checks.push('rollback_requires_ref_and_backs_up_before_checkout');

  assertIncludes(text.restart, 'compose restart postgres redis api web caddy', 'restart verification must restart every production service');
  assertIncludes(text.restart, 'wait_api_health', 'restart verification must wait for API health');
  assertIncludes(text.restart, 'RUN_SMOKE="${RUN_SMOKE:-auto}"', 'restart verification must support smoke enforcement');
  assertIncludes(text.restart, 'SMOKE_API_URL and SMOKE_WEB_URL are required when RUN_SMOKE=true', 'RUN_SMOKE=true must not silently skip smoke');
  checks.push('restart_verify_restarts_core_services_and_can_require_smoke');

  assertIncludes(text.preflight, 'checkEnvFilePermissions(envFile)', 'preflight must check env file permissions');
  assertIncludes(text.preflight, 'checkNoPlaceholderSecrets(env)', 'preflight must reject placeholders');
  assertIncludes(text.preflight, 'checkDatabaseUrl(env)', 'preflight must validate database URL');
  assertIncludes(text.preflight, 'checkRedisUrl(env)', 'preflight must validate Redis URL');
  assertIncludes(text.preflight, 'checkPublicUrlsAndDomains(env)', 'preflight must validate HTTPS public URLs and domains');
  assertIncludes(text.preflight, 'checkComposeConfig()', 'preflight must render production compose config');
  checks.push('preflight_checks_env_secrets_urls_ports_and_compose');

  assertIncludes(text.smoke, "const STRICT = process.env.SMOKE_STRICT === 'true'", 'deploy smoke must support strict mode');
  assertIncludes(text.smoke, "skip('login'", 'deploy smoke must report missing login as a skip');
  assertIncludes(text.smoke, "skip('v1_chat_completions'", 'deploy smoke must report missing chat config as a skip');
  assertIncludes(text.smoke, 'failed.length > 0 || (STRICT && skipped.length > 0)', 'strict deploy smoke must fail on skip');
  for (const checkName of ['api_health', 'web_home', 'login', 'token_create', 'v1_models', 'usage_trace', 'v1_chat_completions', 'recharge_redeem', 'notification_test_webhook']) {
    assertIncludes(text.smoke, checkName, `deploy smoke must include ${checkName}`);
  }
  checks.push('strict_deploy_smoke_fails_on_skips_and_covers_core_flows');

  for (const service of ['postgres:', 'redis:', 'api:', 'web:', 'caddy:']) {
    assertIncludes(text.compose, service, `compose production config must define ${service}`);
  }
  assertIncludes(text.compose, 'restart: unless-stopped', 'production services must use restart policy');
  assertIncludes(text.compose, 'healthcheck:', 'production compose must include healthchecks');
  assertIncludes(text.compose, 'postgres_data:', 'postgres data volume must be declared');
  assertIncludes(text.compose, 'caddy_data:', 'caddy data volume must be declared');
  assertIncludes(text.compose, 'condition: service_healthy', 'API must depend on healthy backing services');
  checks.push('production_compose_has_restart_healthcheck_and_persistent_volumes');

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

async function readRequiredFile(filePath: string) {
  const info = await stat(filePath);
  assert(info.isFile() && info.size > 0, `required ops file is missing or empty: ${path.relative(ROOT_DIR, filePath)}`);
  return readFile(filePath, 'utf8');
}

function assertShellSafety(label: string, text: string) {
  assert(text.startsWith('#!/usr/bin/env sh'), `${label} must use the sh shebang`);
  assertIncludes(text, 'set -eu', `${label} must fail fast on unset variables and command errors`);
}

function assertIncludes(text: string, needle: string, message: string) {
  assert(text.includes(needle), message);
}

function assertOrder(text: string, first: string, second: string, message: string) {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  assert(firstIndex !== -1, `${message}: missing first marker ${first}`);
  assert(secondIndex !== -1, `${message}: missing second marker ${second}`);
  assert(firstIndex < secondIndex, message);
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
