import crypto from 'node:crypto';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;

// Unlike the DB/Redis/Minio dev-credential fallbacks in context.ts, this key
// protects a real bearer credential (the user's Lichess access token) --
// there is no safe default to fall back to, so this throws instead the
// moment a route actually needs it (same pattern as PENUMBRA_API_KEY in
// apps/web/src/lib/api.ts).
function encryptionKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error('TOKEN_ENCRYPTION_KEY is not set on the api server');

  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  return key;
}

/** AES-256-GCM, stored as `iv:authTag:ciphertext` (all hex) -- the users.oauth_tokens "encrypted at rest" column. */
export function encryptOAuthToken(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((buf) => buf.toString('hex')).join(':');
}

export function decryptOAuthToken(stored: string): string {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) throw new Error('malformed encrypted oauth token');

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, encryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8');
}
