import crypto from 'crypto';

export function canonicalizeJSON(obj: any): string {
  return JSON.stringify(sortKeysRecursive(obj));
}

function sortKeysRecursive(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(sortKeysRecursive);
  }

  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, any> = {};
    const keys = Object.keys(obj).sort();

    for (const key of keys) {
      sorted[key] = sortKeysRecursive(obj[key]);
    }

    return sorted;
  }

  return obj;
}

export function computeCertificateSHA256(cert: any): string {
  const canonical = canonicalizeJSON(cert);
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  return '0x' + hash;
}

export function verifyCertificateIntegrity(cert: any, expectedHash: string): boolean {
  const computed = computeCertificateSHA256(cert);
  return computed === expectedHash;
}

export function parseHexHash(hex: string): Buffer {
  if (!hex.startsWith('0x')) {
    throw new Error('Hash must be hex string starting with 0x');
  }
  return Buffer.from(hex.slice(2), 'hex');
}
