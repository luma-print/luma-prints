const test = require('node:test');
const assert = require('node:assert/strict');
const PRICES = require('../public/prices.js');
const { describeFlyer, priceOrderItem } = require('../public/pricing.js');

const PHOTO = {
  '3x5': 0.45, '4x4': 0.50, '4x6': 0.69, '5x7': 0.75, '8x8': 3.00, '8x10': 4.00, '8x12': 5.00,
  '8x24': 11.00, '10x20': 11.00, '11x14': 9.00, '11x17': 10.00, '12x12': 8.00, '12x16': 11.00,
  '12x18': 12.00, '12x24': 16.00, '12x36': 24.00, '13x19': 14.00, '14x18': 14.00, '16x16': 14.00,
  '16x20': 18.00, '16x24': 21.00
};

test('photo catalog keeps all 21 sizes and prices', () => {
  assert.deepEqual(PRICES.standard.sizes, PHOTO);
  assert.equal(Object.keys(PRICES.standard.sizes).length, 21);
  assert.equal(PRICES.glossy.sizes, PRICES.standard.sizes);
  assert.equal(PRICES.invitations_glossy.sizes, PRICES.invitations_matte.sizes);
});

test('flyer tiers keep published ranges and no exact unit', () => {
  assert.equal(PRICES.flyers.minQty, 25);
  assert.deepEqual(PRICES.flyers.tiers.map(t => [t.size, t.min, t.max, t.unitLow, t.unitHigh, t.exactUnit]), [
    ['Small batch', 25, 50, 0.80, 1.12, null],
    ['Medium batch', 100, 500, 0.28, 0.65, null],
    ['Large bulk', 1000, null, 0.04, 0.16, null]
  ]);
  for (const size of Object.keys(PRICES.flyers.sizes)) assert.equal(PRICES.flyers.sizes[size], null);
});

test('flyer quantity boundaries', () => {
  assert.equal(describeFlyer(24).ok, false);
  const q25 = describeFlyer(25);
  assert.equal(q25.ok && q25.quote && !q25.gap && q25.size, 'Small batch');
  assert.equal(q25.unit, null);
  assert.equal(q25.lineTotal, 0);
  assert.equal(q25.unitText, '$0.80–$1.12 per flyer');
  assert.equal(q25.totalText, '$20.00–$28.00');
  assert.equal(describeFlyer(50).size, 'Small batch');
  assert.match(describeFlyer(50).totalText, /\$40\.00–\$56\.00/);
  const q51 = describeFlyer(51);
  assert.equal(q51.gap && q51.quote && q51.size, 'Custom quantity (quote)');
  assert.equal(q51.unitText, 'No published rate');
  assert.equal(q51.totalText, 'Quote required');
  assert.doesNotMatch(q51.totalText, /\$\d/);
  assert.equal(describeFlyer(99).gap, true);
  const q100 = describeFlyer(100);
  assert.equal(q100.size, 'Medium batch');
  assert.equal(q100.unitText, '$0.28–$0.65 per flyer');
  assert.equal(q100.totalText, '$28.00–$65.00');
  assert.equal(describeFlyer(500).size, 'Medium batch');
  assert.equal(describeFlyer(501).gap, true);
  assert.equal(describeFlyer(999).gap, true);
  const q1000 = describeFlyer(1000);
  assert.equal(q1000.size, 'Large bulk');
  assert.equal(q1000.unitText, '$0.04–$0.16 per flyer');
  assert.equal(q1000.totalText, '$40.00–$160.00');
  assert.equal(describeFlyer(5000).size, 'Large bulk');
  assert.equal(describeFlyer(20000).size, 'Large bulk');
  assert.equal(describeFlyer(20001).ok, false);
});

test('server pricing ignores client unit and uses the catalog', () => {
  const tampered = priceOrderItem({ finish: 'standard', size: '16x20', qty: 2, unit: 0.01, price: 0.01, lineTotal: 0.02 });
  assert.equal(tampered.ok, true);
  assert.equal(tampered.unit, 18);
  assert.equal(tampered.lineTotal, 36);
  assert.equal(tampered.priceTBD, false);
  assert.equal(tampered.size, '16x20');
  const glossy = priceOrderItem({ finish: 'glossy', size: '8x10', qty: 3, unit: 0 });
  assert.equal(glossy.unit, 4);
  assert.equal(glossy.lineTotal, 12);
  const flyer = priceOrderItem({ finish: 'flyers', size: '16x20', qty: 25, unit: 0.05, lineTotal: 1.25 });
  assert.equal(flyer.priceTBD, true);
  assert.equal(flyer.unit, null);
  assert.equal(flyer.lineTotal, 0);
  assert.equal(flyer.size, 'Small batch');
  assert.equal(priceOrderItem({ finish: 'standard', size: 'nope', qty: 1 }).ok, false);
  assert.equal(priceOrderItem({ finish: 'standard', size: '4x6', qty: 0 }).ok, false);
  assert.equal(priceOrderItem({ finish: 'standard', size: '4x6', qty: 1000 }).ok, false);
  assert.equal(priceOrderItem({ finish: 'flyers', qty: 24, unit: 1 }).ok, false);
  const invite = priceOrderItem({ finish: 'invitations_matte', size: '5x7 (Pack of 25)', qty: 2, unit: 1 });
  assert.equal(invite.unit, 18);
  assert.equal(invite.lineTotal, 36);
});
