import { describe, it, expect } from 'vitest';
import { computeEntryHash, LEDGER_GENESIS_PREV_HASH } from './ledger.js';

describe('computeEntryHash', () => {
  const payload = { type: 'proof_published', proof_sha256: '0xabc', epd: '8/8/8/8/8/8/8/8 w - -' };

  it('is deterministic for the same prevHash + payload', () => {
    expect(computeEntryHash(LEDGER_GENESIS_PREV_HASH, payload)).toBe(computeEntryHash(LEDGER_GENESIS_PREV_HASH, payload));
  });

  it('produces a well-formed 0x-prefixed sha256 hex string', () => {
    expect(computeEntryHash(LEDGER_GENESIS_PREV_HASH, payload)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('changes when the payload changes', () => {
    const a = computeEntryHash(LEDGER_GENESIS_PREV_HASH, { type: 'a' });
    const b = computeEntryHash(LEDGER_GENESIS_PREV_HASH, { type: 'b' });
    expect(a).not.toBe(b);
  });

  it('changes when prevHash changes -- this is what makes it a chain', () => {
    const a = computeEntryHash(LEDGER_GENESIS_PREV_HASH, payload);
    const b = computeEntryHash('0x' + '11'.repeat(32), payload);
    expect(a).not.toBe(b);
  });

  it('is insensitive to JS object key insertion order (JCS canonicalization)', () => {
    const a = computeEntryHash(LEDGER_GENESIS_PREV_HASH, { type: 'x', epd: 'y' });
    const b = computeEntryHash(LEDGER_GENESIS_PREV_HASH, { epd: 'y', type: 'x' });
    expect(a).toBe(b);
  });
});
