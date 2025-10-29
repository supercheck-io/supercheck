import * as crypto from 'node:crypto';

const KEY_ENV = 'SECRET_ENCRYPTION_KEY';
const RAW_KEY_LENGTH = 32;
const DERIVED_KEY_LENGTH = 16; // AES-128
const IV_LENGTH = 12;
const HKDF_INFO = Buffer.from('supercheck:secret:v1');

export type SecretEnvelope = {
  encrypted: true;
  version: 1;
  payload: string;
  context?: string;
};

type RawEnvelope = {
  v: 1;
  iv: string;
  tag: string;
  data: string;
};

type EncryptionOptions = {
  context?: string;
};

function selectKey(): Buffer {
  const key = process.env[KEY_ENV];

  if (!key) {
    throw new Error(
      `${KEY_ENV} environment variable is not set. Please configure it to enable encryption.`,
    );
  }

  if (key.length < RAW_KEY_LENGTH) {
    throw new Error(
      `${KEY_ENV} must be at least ${RAW_KEY_LENGTH} characters long.`,
    );
  }

  const buffer =
    /^[0-9a-fA-F]+$/.test(key) && key.length >= RAW_KEY_LENGTH * 2
      ? Buffer.from(key.slice(0, RAW_KEY_LENGTH * 2), 'hex')
      : Buffer.from(key, 'utf8');

  if (buffer.length < RAW_KEY_LENGTH) {
    throw new Error(
      `${KEY_ENV} must resolve to at least ${RAW_KEY_LENGTH} bytes of key material.`,
    );
  }

  return buffer.subarray(0, RAW_KEY_LENGTH);
}

function deriveKey(baseKey: Buffer, context?: string): Buffer {
  if (!context) {
    return baseKey.subarray(0, DERIVED_KEY_LENGTH);
  }

  const salt = crypto.createHash('sha256').update(context).digest();
  const derived = crypto.hkdfSync(
    'sha256',
    baseKey,
    salt,
    HKDF_INFO,
    DERIVED_KEY_LENGTH,
  );

  return Buffer.isBuffer(derived) ? derived : Buffer.from(derived);
}

function encodeEnvelope(envelope: RawEnvelope): string {
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
}

function decodeEnvelope(payload: string): RawEnvelope {
  const decoded = Buffer.from(payload, 'base64').toString('utf8');
  const parsed = JSON.parse(decoded) as RawEnvelope;

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    parsed.v !== 1 ||
    typeof parsed.iv !== 'string' ||
    typeof parsed.tag !== 'string' ||
    typeof parsed.data !== 'string'
  ) {
    throw new Error('Invalid encrypted payload');
  }

  return parsed;
}

export function encryptSecret(
  value: string,
  options: EncryptionOptions = {},
): SecretEnvelope {
  const baseKey = selectKey();
  const key = deriveKey(baseKey, options.context);

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-128-gcm', key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const payload = encodeEnvelope({
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
  });

  return {
    encrypted: true,
    version: 1,
    payload,
    context: options.context,
  };
}

export function decryptSecret(
  envelope: SecretEnvelope,
  options: EncryptionOptions = {},
): string {
  if (!envelope?.encrypted) {
    throw new Error('Invalid encrypted envelope');
  }

  const baseKey = selectKey();
  const key = deriveKey(
    baseKey,
    options.context ?? envelope.context ?? undefined,
  );

  const raw = decodeEnvelope(envelope.payload);
  const iv = Buffer.from(raw.iv, 'base64');
  const tag = Buffer.from(raw.tag, 'base64');
  const data = Buffer.from(raw.data, 'base64');

  const decipher = crypto.createDecipheriv('aes-128-gcm', key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString('utf8');
}

export function encryptJson<T>(
  data: T,
  options: EncryptionOptions = {},
): SecretEnvelope {
  return encryptSecret(JSON.stringify(data), options);
}

export function decryptJson<T>(
  envelope: SecretEnvelope,
  options: EncryptionOptions = {},
): T {
  const json = decryptSecret(envelope, options);
  return JSON.parse(json) as T;
}

export function isSecretEnvelope(value: unknown): value is SecretEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<SecretEnvelope>).encrypted === true &&
    (value as Partial<SecretEnvelope>).version === 1 &&
    typeof (value as Partial<SecretEnvelope>).payload === 'string'
  );
}

export function maskSecret(value: string, visible = 4): string {
  if (!value) return '***';

  if (value.length <= visible) {
    return '*'.repeat(Math.max(3, value.length));
  }

  const prefix = value.slice(0, Math.floor(visible / 2));
  const suffix = value.slice(-Math.ceil(visible / 2));
  const stars = Math.max(3, value.length - visible);

  return `${prefix}${'*'.repeat(stars)}${suffix}`;
}
