const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-orders-'));
process.env.DATA_DIR = dir;
process.env.SHIPPING_FEE = '5.00';
process.env.PORT = '0';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_ENC;
delete process.env.BREVO_API_KEY;
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;

const { app } = require('../server');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let server, base;
test.before(async () => {
  server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { if (server) await new Promise(r => server.close(r)); });

async function post(items, extra = {}) {
  const fd = new FormData();
  fd.set('name', extra.name || 'QA Size');
  fd.set('email', extra.email || 'qa-size@example.com');
  fd.set('delivery', extra.delivery || 'pickup');
  if (extra.address) fd.set('address', extra.address);
  fd.set('payMethod', extra.payMethod || 'venmo');
  items.forEach((item, i) => fd.append('photos', new Blob([PNG], { type: 'image/png' }), `p${i}.png`));
  fd.set('items', JSON.stringify(items));
  const res = await fetch(base + '/api/orders', { method: 'POST', body: fd });
  const json = await res.json();
  return { status: res.status, json };
}
function saved(id) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'orders', id + '.json'), 'utf8'));
}
function idFrom(json) {
  const m = String(json.redirect || '').match(/order=([^&]+)/);
  assert.ok(m, 'expected an order id redirect');
  return decodeURIComponent(m[1]);
}

test('checkout stores the catalog price for the selected size and ignores a tampered unit', async () => {
  const { status, json } = await post([{ finish: 'standard', size: '8x10', qty: 2, unit: 0.01, lineTotal: 0.02 }]);
  assert.equal(status, 200);
  const order = saved(idFrom(json));
  assert.equal(order.items[0].size, '8x10');
  assert.equal(order.items[0].qty, 2);
  assert.equal(order.items[0].unit, 4);
  assert.equal(order.items[0].lineTotal, 8);
  assert.equal(order.items[0].priceTBD, false);
  assert.equal(order.subtotal, 8);
  assert.equal(order.shipping, 0);
  assert.equal(order.total, 8);
  assert.equal(order.payment, 'awaiting Venmo');
  assert.doesNotMatch(order.payment, /paid/i);
});

test('glossy uses the same price and shipping stays the flat $5', async () => {
  const { status, json } = await post([{ finish: 'glossy', size: '4x6', qty: 3, unit: 99 }], { delivery: 'shipping', address: '1 Test Dock, Ogden UT' });
  assert.equal(status, 200);
  const order = saved(idFrom(json));
  assert.equal(order.items[0].unit, 0.69);
  assert.equal(order.items[0].lineTotal, 2.07);
  assert.equal(order.shipping, 5);
  assert.equal(order.total, 7.07);
});

test('invalid size, quantity, and flyer minimum are rejected', async () => {
  const badSize = await post([{ finish: 'standard', size: '2x3', qty: 1, unit: 0.01 }]);
  assert.equal(badSize.status, 400);
  assert.match(badSize.json.error, /Invalid size/);
  const badQty = await post([{ finish: 'standard', size: '4x6', qty: 0 }]);
  assert.equal(badQty.status, 400);
  const tooMany = await post([{ finish: 'glossy', size: '5x7', qty: 1000 }]);
  assert.equal(tooMany.status, 400);
  const fewFlyers = await post([{ finish: 'flyers', size: 'Small batch', qty: 24, unit: 0.8 }]);
  assert.equal(fewFlyers.status, 400);
  assert.match(fewFlyers.json.error, /minimum of 25/i);
});

test('flyer tiers stay quotes, including gaps, and a client price is not charged', async () => {
  const cases = [
    [25, 'Small batch', false, '$0.80–$1.12 per flyer', '$20.00–$28.00'],
    [50, 'Small batch', false, '$0.80–$1.12 per flyer', '$40.00–$56.00'],
    [51, 'Custom quantity (quote)', true, 'No published rate', 'Quote required'],
    [99, 'Custom quantity (quote)', true, 'No published rate', 'Quote required'],
    [100, 'Medium batch', false, '$0.28–$0.65 per flyer', '$28.00–$65.00'],
    [500, 'Medium batch', false, '$0.28–$0.65 per flyer', '$140.00–$325.00'],
    [501, 'Custom quantity (quote)', true, 'No published rate', 'Quote required'],
    [999, 'Custom quantity (quote)', true, 'No published rate', 'Quote required'],
    [1000, 'Large bulk', false, '$0.04–$0.16 per flyer', '$40.00–$160.00'],
    [5000, 'Large bulk', false, '$0.04–$0.16 per flyer', '$200.00–$800.00']
  ];
  for (const [qty, size, gap, unitText, totalText] of cases) {
    const { status, json } = await post([{ finish: 'flyers', size: '16x20', qty, unit: 0.01, lineTotal: 1 }]);
    assert.equal(status, 200, JSON.stringify(json));
    const order = saved(idFrom(json));
    const item = order.items[0];
    assert.equal(item.size, size, 'qty ' + qty);
    assert.equal(item.qty, qty);
    assert.equal(item.unit, null);
    assert.equal(item.lineTotal, 0);
    assert.equal(item.priceTBD, true);
    assert.equal(item.quoteGap, gap);
    assert.equal(item.unitText, unitText);
    assert.equal(item.totalText, totalText);
    assert.equal(order.subtotal, 0);
    assert.equal(order.total, 0);
    assert.equal(order.payment, 'inquiry - price to be confirmed');
    assert.match(json.redirect, /quote=1/);
  }
  const over = await post([{ finish: 'flyers', qty: 20001 }]);
  assert.equal(over.status, 400);
});

test('a mixed order prices the photo from the catalog and leaves the flyer as a quote', async () => {
  const { status, json } = await post([
    { finish: 'standard', size: '11x14', qty: 1, unit: 0.5 },
    { finish: 'flyers', size: 'Small batch', qty: 30, unit: 9 }
  ]);
  assert.equal(status, 200);
  const order = saved(idFrom(json));
  assert.equal(order.items[0].size, '11x14');
  assert.equal(order.items[0].unit, 9);
  assert.equal(order.items[0].lineTotal, 9);
  assert.equal(order.items[1].size, 'Small batch');
  assert.equal(order.items[1].unit, null);
  assert.equal(order.subtotal, 9);
  assert.equal(order.payment, 'inquiry - price to be confirmed');
});
