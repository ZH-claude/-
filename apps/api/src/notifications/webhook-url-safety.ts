import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const DNS_LOOKUP_TIMEOUT_MS = 3000;
const PRIVATE_WEBHOOK_ADDRESS_ERROR = 'Private or local webhook address is not allowed';
const BLOCKED_WEBHOOK_HOSTNAMES = new Set(['localhost', 'host.docker.internal', 'metadata.google.internal']);

export async function normalizeAndValidateWebhookUrl(value: unknown) {
  if (typeof value !== 'string' || value.trim().length < 8 || value.trim().length > 2048) {
    throw new BadRequestException('webhookUrl must be a valid http or https URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new BadRequestException('webhookUrl must be a valid http or https URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('webhookUrl must use http or https');
  }

  if (parsed.username || parsed.password) {
    throw new BadRequestException('webhookUrl must not include credentials');
  }

  parsed.hash = '';
  const normalized = parsed.toString();
  const addressError = await getPublicWebhookAddressError(normalized);
  if (addressError) {
    throw new BadRequestException(addressError);
  }

  return normalized;
}

export function maskWebhookUrl(webhookUrl: string) {
  const parsed = new URL(webhookUrl);
  const hasPath = parsed.pathname !== '/';
  return `${parsed.protocol}//${parsed.host}${hasPath ? '/...' : ''}${parsed.search ? '?...' : ''}`;
}

async function getPublicWebhookAddressError(webhookUrl: string) {
  const parsed = new URL(webhookUrl);
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (isBlockedWebhookHostname(hostname)) {
    return PRIVATE_WEBHOOK_ADDRESS_ERROR;
  }

  if (isIP(hostname)) {
    return isPrivateOrLocalAddress(hostname) ? PRIVATE_WEBHOOK_ADDRESS_ERROR : null;
  }

  try {
    const addresses = await lookupWebhookAddresses(hostname);
    if (!addresses.length) {
      return 'Webhook host could not be resolved';
    }

    return addresses.some((entry) => isPrivateOrLocalAddress(entry.address))
      ? PRIVATE_WEBHOOK_ADDRESS_ERROR
      : null;
  } catch (error) {
    return error instanceof Error && error.message ? truncateError(error.message) : 'Webhook host could not be resolved';
  }
}

async function lookupWebhookAddresses(hostname: string) {
  let lookupTimeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        lookupTimeout = setTimeout(() => reject(new Error('DNS lookup timed out')), DNS_LOOKUP_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (lookupTimeout) {
      clearTimeout(lookupTimeout);
    }
  }
}

function isBlockedWebhookHostname(hostname: string) {
  return BLOCKED_WEBHOOK_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
}

function isPrivateOrLocalAddress(address: string) {
  const normalized = address.toLowerCase();
  const ipv4Mapped = normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized;

  if (isIP(ipv4Mapped) === 4) {
    return isPrivateOrLocalIpv4(ipv4Mapped);
  }

  if (isIP(normalized) === 6) {
    return isPrivateOrLocalIpv6(normalized);
  }

  return false;
}

function isPrivateOrLocalIpv4(address: string) {
  const parts = address.split('.').map((part) => Number(part));
  const [first, second, third] = parts;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
}

function isPrivateOrLocalIpv6(address: string) {
  return (
    address === '::' ||
    address === '::1' ||
    address.startsWith('fc') ||
    address.startsWith('fd') ||
    address.startsWith('fe80:')
  );
}

function truncateError(message: string) {
  return message.length > 240 ? `${message.slice(0, 240)}...` : message;
}
