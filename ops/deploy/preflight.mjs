#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { promises as dns } from 'node:dns';
import { existsSync, readFileSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const envFile = args.envFile ?? '.env';
const requireDns = args.requireDns ?? true;
const checkPorts = args.checkPorts ?? true;
const json = args.json ?? false;

const results = [];

if (!existsSync(envFile)) {
  fail('env_file_exists', `${envFile} does not exist`);
  finish();
}

const env = parseEnv(readFileSync(envFile, 'utf8'));

checkEnvFilePermissions(envFile);
checkRequiredEnv(env);
checkNoPlaceholderSecrets(env);
checkDatabaseUrl(env);
checkRedisUrl(env);
checkPublicUrlsAndDomains(env);
await checkDns(env);
await checkRequiredPorts();
checkLocalCommand('git', ['--version'], 'git_available');
checkLocalCommand('docker', ['version', '--format', '{{.Server.Version}}'], 'docker_engine_available');
checkLocalCommand('docker', ['compose', 'version'], 'docker_compose_available');
checkComposeConfig();

finish();

function checkEnvFilePermissions(file) {
  if (process.platform === 'win32') {
    warn('env_file_permissions', 'Windows permission mode check skipped; on Linux run chmod 600 .env');
    return;
  }

  const mode = statSync(file).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    fail('env_file_permissions', `${file} must not be group/world readable; run chmod 600 ${file}`);
  } else {
    pass('env_file_permissions');
  }
}

function checkRequiredEnv(envMap) {
  const required = [
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
    'DATABASE_URL',
    'REDIS_URL',
    'UPSTREAM_KEY_ENCRYPTION_SECRET',
    'NOTIFICATION_SECRET_ENCRYPTION_SECRET',
    'JWT_SECRET',
    'SESSION_COOKIE_SECURE',
    'PUBLIC_WEB_URL',
    'PUBLIC_API_URL',
    'CADDY_WEB_DOMAIN',
    'CADDY_API_DOMAIN',
    'ACME_EMAIL'
  ];

  for (const name of required) {
    const value = envMap[name];
    if (!value) {
      fail('required_env', `${name} is required`);
    }
  }
}

function checkNoPlaceholderSecrets(envMap) {
  const placeholderNames = [
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
    'DATABASE_URL',
    'REDIS_URL',
    'UPSTREAM_KEY_ENCRYPTION_SECRET',
    'NOTIFICATION_SECRET_ENCRYPTION_SECRET',
    'JWT_SECRET',
    'PUBLIC_WEB_URL',
    'PUBLIC_API_URL',
    'CADDY_WEB_DOMAIN',
    'CADDY_API_DOMAIN',
    'ACME_EMAIL',
    'UPSTREAM_BASE_URL',
    'UPSTREAM_API_KEY'
  ];

  for (const name of placeholderNames) {
    const value = envMap[name];
    if (value && looksPlaceholder(value)) {
      fail('placeholder_env', `${name} still contains a placeholder/example value`);
    }
  }

  for (const name of ['POSTGRES_PASSWORD', 'UPSTREAM_KEY_ENCRYPTION_SECRET', 'NOTIFICATION_SECRET_ENCRYPTION_SECRET', 'JWT_SECRET']) {
    const value = envMap[name] ?? '';
    if (value && value.length < 32) {
      fail('secret_length', `${name} must be at least 32 characters`);
    }
  }

  if (envMap.SESSION_COOKIE_SECURE !== 'true') {
    fail('secure_cookie', 'SESSION_COOKIE_SECURE must be true in production');
  }

  if (envMap.ADMIN_BOOTSTRAP_PASSWORD) {
    warn('bootstrap_password', 'ADMIN_BOOTSTRAP_PASSWORD is set; clear it and restart after the first admin is created');
  }
}

function checkDatabaseUrl(envMap) {
  const databaseUrl = envMap.DATABASE_URL;
  if (!databaseUrl) {
    return;
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail('database_url', 'DATABASE_URL is not a valid URL');
    return;
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    fail('database_url', 'DATABASE_URL must use postgresql://');
  }
  if (parsed.hostname !== 'postgres') {
    fail('database_url', 'DATABASE_URL host must be postgres inside compose.prod.yml');
  }
  if (parsed.port && parsed.port !== '5432') {
    fail('database_url', 'DATABASE_URL port must be 5432 inside compose.prod.yml');
  }
  if (decodeURIComponent(parsed.username) !== envMap.POSTGRES_USER) {
    fail('database_url', 'DATABASE_URL username must match POSTGRES_USER');
  }
  if (decodeURIComponent(parsed.password) !== envMap.POSTGRES_PASSWORD) {
    fail('database_url', 'DATABASE_URL password must match POSTGRES_PASSWORD');
  }

  const dbName = parsed.pathname.replace(/^\//, '');
  if (dbName !== envMap.POSTGRES_DB) {
    fail('database_url', 'DATABASE_URL database name must match POSTGRES_DB');
  }
}

function checkRedisUrl(envMap) {
  const redisUrl = envMap.REDIS_URL;
  if (!redisUrl) {
    return;
  }

  let parsed;
  try {
    parsed = new URL(redisUrl);
  } catch {
    fail('redis_url', 'REDIS_URL is not a valid URL');
    return;
  }

  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    fail('redis_url', 'REDIS_URL must use redis:// or rediss://');
  }
  if (parsed.hostname !== 'redis') {
    fail('redis_url', 'REDIS_URL host must be redis inside compose.prod.yml');
  }

  if (envMap.REDIS_PASSWORD && decodeURIComponent(parsed.password) !== envMap.REDIS_PASSWORD) {
    fail('redis_url', 'REDIS_URL password must match REDIS_PASSWORD when REDIS_PASSWORD is set');
  }
  if (!envMap.REDIS_PASSWORD) {
    warn('redis_password', 'REDIS_PASSWORD is empty; acceptable for MVP only if Redis is not exposed outside Docker');
  }
}

function checkPublicUrlsAndDomains(envMap) {
  const webUrl = parseUrlOrFail('PUBLIC_WEB_URL', envMap.PUBLIC_WEB_URL);
  const apiUrl = parseUrlOrFail('PUBLIC_API_URL', envMap.PUBLIC_API_URL);

  if (webUrl && webUrl.protocol !== 'https:') {
    fail('public_url', 'PUBLIC_WEB_URL must use https:// in production');
  }
  if (apiUrl && apiUrl.protocol !== 'https:') {
    fail('public_url', 'PUBLIC_API_URL must use https:// in production');
  }
  if (webUrl && webUrl.hostname !== envMap.CADDY_WEB_DOMAIN) {
    fail('domain_match', 'PUBLIC_WEB_URL host must match CADDY_WEB_DOMAIN');
  }
  if (apiUrl && apiUrl.hostname !== envMap.CADDY_API_DOMAIN) {
    fail('domain_match', 'PUBLIC_API_URL host must match CADDY_API_DOMAIN');
  }
  if (envMap.CADDY_WEB_DOMAIN === envMap.CADDY_API_DOMAIN) {
    fail('domain_match', 'CADDY_WEB_DOMAIN and CADDY_API_DOMAIN must be different');
  }

  for (const name of ['CADDY_WEB_DOMAIN', 'CADDY_API_DOMAIN']) {
    const value = envMap[name];
    if (value && /https?:\/\//i.test(value)) {
      fail('domain_format', `${name} must be a hostname, not a URL`);
    }
  }
}

async function checkDns(envMap) {
  if (!requireDns) {
    warn('dns', 'DNS check skipped by --skip-dns');
    return;
  }

  for (const name of ['CADDY_WEB_DOMAIN', 'CADDY_API_DOMAIN']) {
    const domain = envMap[name];
    if (!domain || looksPlaceholder(domain)) {
      continue;
    }

    try {
      const [v4, v6] = await Promise.allSettled([dns.resolve4(domain), dns.resolve6(domain)]);
      const addresses = [
        ...(v4.status === 'fulfilled' ? v4.value : []),
        ...(v6.status === 'fulfilled' ? v6.value : [])
      ];

      if (addresses.length === 0) {
        fail('dns', `${name} does not resolve to A/AAAA records`);
      } else {
        pass('dns', `${name} resolves`);
      }
    } catch {
      fail('dns', `${name} DNS lookup failed`);
    }
  }
}

async function checkRequiredPorts() {
  if (!checkPorts) {
    warn('ports', 'port availability check skipped by --skip-ports');
    return;
  }

  for (const port of [80, 443]) {
    const available = await portAppearsFree(port);
    if (available) {
      pass('ports', `port ${port} is available for Caddy`);
    } else {
      fail('ports', `port ${port} is already in use or cannot be bound; Caddy needs it`);
    }
  }
}

function checkComposeConfig() {
  if (!existsSync('compose.prod.yml')) {
    fail('compose_config', 'compose.prod.yml is missing');
    return;
  }

  try {
    execFileSync('docker', ['compose', '-p', 'nested-api-relay', '--env-file', envFile, '-f', 'compose.prod.yml', 'config'], {
      cwd: process.cwd(),
      stdio: 'ignore',
      windowsHide: true
    });
    pass('compose_config');
  } catch {
    fail('compose_config', 'docker compose production config did not render successfully');
  }
}

function checkLocalCommand(command, commandArgs, name) {
  try {
    execFileSync(command, commandArgs, { stdio: 'ignore', windowsHide: true });
    pass(name);
  } catch {
    fail(name, `${command} ${commandArgs.join(' ')} failed or is unavailable`);
  }
}

function parseUrlOrFail(name, value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    fail('public_url', `${name} is not a valid URL`);
    return null;
  }
}

function portAppearsFree(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 1500 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', (error) => {
      resolve(error.code === 'ECONNREFUSED');
    });
  });
}

function parseEnv(content) {
  const output = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  }
  return output;
}

function parseArgs(argv) {
  const parsed = {
    envFile: '.env',
    requireDns: true,
    checkPorts: true,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env-file') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
        console.error('--env-file requires a file path');
        process.exit(2);
      }
      parsed.envFile = argv[index + 1];
      index += 1;
    } else if (arg === '--skip-dns') {
      parsed.requireDns = false;
    } else if (arg === '--skip-ports') {
      parsed.checkPorts = false;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('usage: node ops/deploy/preflight.mjs [--env-file .env] [--skip-dns] [--skip-ports] [--json]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }

  return parsed;
}

function looksPlaceholder(value) {
  return /placeholder|replace_with|change-me|example\.com|localhost|127\.0\.0\.1|your-|real-password|admin_user/i.test(value);
}

function pass(name, detail = '') {
  results.push({ status: 'pass', name, detail });
}

function warn(name, detail) {
  results.push({ status: 'warn', name, detail });
}

function fail(name, detail) {
  results.push({ status: 'fail', name, detail });
}

function finish() {
  const failed = results.filter((item) => item.status === 'fail');
  const warned = results.filter((item) => item.status === 'warn');
  const payload = { ok: failed.length === 0, envFile: path.normalize(envFile), failed: failed.length, warned: warned.length, results };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    for (const item of results) {
      const detail = item.detail ? ` - ${item.detail}` : '';
      console.log(`${item.status.toUpperCase()} ${item.name}${detail}`);
    }
    console.log(`summary: ok=${payload.ok} failed=${payload.failed} warned=${payload.warned}`);
  }

  process.exit(failed.length > 0 ? 1 : 0);
}
