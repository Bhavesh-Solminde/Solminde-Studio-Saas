import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lineCommission, slabRate, periodCommission, paise } from '../dist/index.js';

const flat = { kind: 'flat', serviceRate: 30, retailRate: 10 };

test('flat rule: service line commission is the service rate on net', () => {
  // 30% of ₹500 net = ₹150.
  assert.equal(lineCommission(flat, 'service', paise(50000)), 15000);
});

test('flat rule: product line uses the retail rate, not the service rate', () => {
  // 10% of ₹300 net = ₹30.
  assert.equal(lineCommission(flat, 'product', paise(30000)), 3000);
});

test('flat rule: a package/membership line earns no per-line commission', () => {
  assert.equal(lineCommission(flat, 'package', paise(50000)), 0);
});

test('slab rule snapshots zero per line — it is settled at read time', () => {
  const slab = { kind: 'slab', serviceRate: 0, retailRate: 0, slabs: [{ uptoPaise: null, rate: 25 }] };
  assert.equal(lineCommission(slab, 'service', paise(50000)), 0);
});

test('slabRate picks the first tier the revenue fits under', () => {
  const slabs = [
    { uptoPaise: 5000000, rate: 20 }, // up to ₹50k -> 20%
    { uptoPaise: 10000000, rate: 30 }, // up to ₹1L -> 30%
    { uptoPaise: null, rate: 40 }, // beyond -> 40%
  ];
  assert.equal(slabRate(slabs, 4000000), 20);
  assert.equal(slabRate(slabs, 5000000), 20); // boundary is inclusive
  assert.equal(slabRate(slabs, 8000000), 30);
  assert.equal(slabRate(slabs, 20000000), 40);
});

test('flat period: base is the sum of snapshots, immune to rate re-derivation', () => {
  const result = periodCommission(flat, {
    serviceNetPaise: 100000,
    retailNetPaise: 30000,
    snapshotSumPaise: 33000, // whatever was snapshotted at bill time
  });
  assert.equal(result.base, 33000);
  assert.equal(result.bonus, 0);
  assert.equal(result.total, 33000);
});

test('slab period: base is computed from total net revenue', () => {
  const slab = {
    kind: 'slab',
    serviceRate: 0,
    retailRate: 0,
    slabs: [
      { uptoPaise: 5000000, rate: 20 },
      { uptoPaise: null, rate: 30 },
    ],
  };
  // ₹80k net total lands in the 30% tier -> ₹24k.
  const result = periodCommission(slab, {
    serviceNetPaise: 8000000,
    retailNetPaise: 0,
    snapshotSumPaise: 0,
  });
  assert.equal(result.base, 2400000);
});

test('target bonus is added once the period net reaches the target', () => {
  const withTarget = { ...flat, targetBonus: { targetPaise: 10000000, bonusPaise: 500000 } };

  const below = periodCommission(withTarget, { serviceNetPaise: 5000000, retailNetPaise: 0, snapshotSumPaise: 1500000 });
  assert.equal(below.bonus, 0);

  const at = periodCommission(withTarget, { serviceNetPaise: 10000000, retailNetPaise: 0, snapshotSumPaise: 3000000 });
  assert.equal(at.bonus, 500000);
  assert.equal(at.total, 3500000);
});
