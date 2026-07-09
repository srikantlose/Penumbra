import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TruthStatus } from '@penumbra/core';
import { deriveTruthStatus, SYZYGY_MAX_PIECES } from './truth.js';

test('deriveTruthStatus is PROVEN when a proof exists, regardless of piece count', () => {
  assert.equal(deriveTruthStatus({ pieceCount: 32, hasProof: true, hasTablebaseProbe: false }), TruthStatus.PROVEN);
});

test('deriveTruthStatus is PROVEN when within tablebase range and a probe is cached', () => {
  assert.equal(
    deriveTruthStatus({ pieceCount: SYZYGY_MAX_PIECES, hasProof: false, hasTablebaseProbe: true }),
    TruthStatus.PROVEN
  );
});

test('deriveTruthStatus is EVALUATED when outside tablebase range even with a stray cached probe', () => {
  assert.equal(
    deriveTruthStatus({ pieceCount: SYZYGY_MAX_PIECES + 1, hasProof: false, hasTablebaseProbe: true }),
    TruthStatus.EVALUATED
  );
});

test('deriveTruthStatus is EVALUATED with neither a proof nor a cached probe', () => {
  assert.equal(deriveTruthStatus({ pieceCount: 3, hasProof: false, hasTablebaseProbe: false }), TruthStatus.EVALUATED);
});
