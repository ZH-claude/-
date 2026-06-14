import { InternalServerErrorException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const CIPHER_VERSION = 'v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const REQUIRED_SECRET_LENGTH = 32;

export function encryptNotificationSecret(value: string) {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    CIPHER_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url')
  ].join(':');
}

export function decryptNotificationSecret(encryptedValue: string) {
  const [version, ivValue, authTagValue, encryptedSecret] = encryptedValue.split(':');
  if (version !== CIPHER_VERSION || !ivValue || !authTagValue || !encryptedSecret) {
    throw new InternalServerErrorException('Notification secret ciphertext format is invalid');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivValue, 'base64url'), {
      authTagLength: AUTH_TAG_BYTES
    });
    decipher.setAuthTag(Buffer.from(authTagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedSecret, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    throw new InternalServerErrorException('Notification secret could not be decrypted');
  }
}

function getEncryptionKey() {
  const secret = process.env.NOTIFICATION_SECRET_ENCRYPTION_SECRET ?? process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < REQUIRED_SECRET_LENGTH) {
    throw new InternalServerErrorException(
      'NOTIFICATION_SECRET_ENCRYPTION_SECRET or UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters'
    );
  }

  return createHash('sha256').update(secret).digest();
}
