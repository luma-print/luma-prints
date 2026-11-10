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
process.env.FILES_CONFIRM_TOKEN = 'test-only-confirm-token';
process.env.ADMIN_PASSWORD = 'test-only-admin';

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

async function postShared(fileCount, items, extra = {}) {
  const fd = new FormData();
  fd.set('name', 'QA Multi');
  fd.set('email', 'qa-multi@example.com');
  fd.set('delivery', extra.delivery || 'pickup');
  if (extra.address) fd.set('address', extra.address);
  fd.set('payMethod', 'venmo');
  for (let i = 0; i < fileCount; i++) fd.append('photos', new Blob([PNG], { type: 'image/png' }), `shared${i}.png`);
  fd.set('items', JSON.stringify(items));
  const res = await fetch(base + '/api/orders', { method: 'POST', body: fd });
  return { status: res.status, json: await res.json() };
}

test('one uploaded photo can be ordered in several sizes without uploading it twice', async () => {
  const before = fs.readdirSync(path.join(dir, 'uploads')).length;
  const { status, json } = await postShared(1, [
    { finish: 'standard', size: '4x6', qty: 2, fileIndex: 0, unit: 0.01 },
    { finish: 'glossy', size: '8x10', qty: 1, fileIndex: 0 }
  ], { delivery: 'shipping', address: 'Test address' });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(fs.readdirSync(path.join(dir, 'uploads')).length, before + 1, 'file stored once');
  const order = saved(idFrom(json));
  assert.equal(order.items.length, 2);
  assert.equal(order.items[0].file, order.items[1].file);
  assert.equal(order.items[0].originalName, 'shared0.png');
  assert.deepEqual(order.items.map(i => [i.size, i.finish, i.qty, i.unit, i.lineTotal, i.photo]), [
    ['4x6', 'standard', 2, 0.69, 1.38, 1],
    ['8x10', 'glossy', 1, 4, 4, 1]
  ]);
  assert.equal(order.subtotal, 5.38);
  assert.equal(order.total, 10.38);

  const { stripeLineItems, photoGroups, summary } = require('../server');
  const li = stripeLineItems(order.items, order.shipping);
  assert.deepEqual(li.map(l => [l.quantity, l.price_data.unit_amount, l.price_data.product_data.name]), [
    [2, 69, '4x6 – Photo Print (Matte) (Photo 1)'],
    [1, 400, '8x10 – Photo Print (Glossy) (Photo 1)'],
    [1, 500, 'Shipping']
  ]);
  const groups = photoGroups(order.items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].lines.length, 2);
  const text = summary(order);
  assert.match(text, /Photo 1: 2 x 4x6 .* shared0\.png .* \$1\.38/);
  assert.match(text, /Photo 1: 1 x 8x10 .* shared0\.png .* \$4\.00/);
});

test('two photos where only the first has extra sizes keep each line on the right file', async () => {
  const { status, json } = await postShared(2, [
    { finish: 'standard', size: '4x6', qty: 1, fileIndex: 0 },
    { finish: 'standard', size: '5x7', qty: 3, fileIndex: 0 },
    { finish: 'standard', size: '8x10', qty: 1, fileIndex: 1 }
  ]);
  assert.equal(status, 200, JSON.stringify(json));
  const order = saved(idFrom(json));
  assert.deepEqual(order.items.map(i => [i.originalName, i.size, i.photo]), [
    ['shared0.png', '4x6', 1], ['shared0.png', '5x7', 1], ['shared1.png', '8x10', 2]
  ]);
  assert.notEqual(order.items[0].file, order.items[2].file);
  assert.equal(order.subtotal, 6.94);
});

test('bad file references are rejected', async () => {
  const outOfRange = await postShared(1, [{ finish: 'standard', size: '4x6', qty: 1, fileIndex: 1 }]);
  assert.equal(outOfRange.status, 400);
  const unused = await postShared(2, [{ finish: 'standard', size: '4x6', qty: 1, fileIndex: 0 }, { finish: 'standard', size: '5x7', qty: 1, fileIndex: 0 }]);
  assert.equal(unused.status, 400);
  assert.match(unused.json.error, /needs at least one print size/);
  const notInt = await postShared(1, [{ finish: 'standard', size: '4x6', qty: 1, fileIndex: '0' }]);
  assert.equal(notInt.status, 400);
});

async function stage(name) {
  const fd = new FormData();
  fd.append('photo', new Blob([PNG], { type: 'image/png' }), name);
  const res = await fetch(base + '/api/uploads', { method: 'POST', body: fd });
  return { status: res.status, json: await res.json() };
}
async function orderStaged(ids, items) {
  const fd = new FormData();
  fd.set('name', 'QA Batch');
  fd.set('email', 'qa-batch@example.com');
  fd.set('delivery', 'pickup');
  fd.set('payMethod', 'venmo');
  fd.set('uploads', JSON.stringify(ids));
  fd.set('items', JSON.stringify(items));
  const res = await fetch(base + '/api/orders', { method: 'POST', body: fd });
  return { status: res.status, json: await res.json() };
}

test('photos uploaded one at a time can be placed as a 160-photo order with extra sizes', async () => {
  const ids = [];
  for (let i = 0; i < 160; i++) {
    const r = await stage(`batch${i}.png`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    ids.push(r.json.id);
  }
  const items = ids.map((_, i) => ({ finish: 'standard', size: '4x6', qty: 1, fileIndex: i }));
  items.push({ finish: 'standard', size: '8x10', qty: 1, fileIndex: 0 });
  const { status, json } = await orderStaged(ids, items);
  assert.equal(status, 200, JSON.stringify(json));
  const order = saved(idFrom(json));
  assert.equal(order.items.length, 161);
  assert.equal(new Set(order.items.map(i => i.file)).size, 160);
  assert.equal(order.items[160].originalName, 'batch0.png');
  assert.equal(order.items[160].file, order.items[0].file);
  assert.equal(order.subtotal, +(160 * 0.69 + 4).toFixed(2));
});

test('the old one-request upload has no 100-file cap', async () => {
  const items = Array.from({ length: 120 }, () => ({ finish: 'standard', size: '3x5', qty: 1 }));
  const { status, json } = await post(items);
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(saved(idFrom(json)).items.length, 120);
});

test('staged upload ids are validated and unknown ids are rejected', async () => {
  const bad = await orderStaged(['../../etc/passwd'], [{ finish: 'standard', size: '4x6', qty: 1, fileIndex: 0 }]);
  assert.equal(bad.status, 400);
  const missing = await orderStaged(['0123456789abcdef.png'], [{ finish: 'standard', size: '4x6', qty: 1, fileIndex: 0 }]);
  assert.equal(missing.status, 400);
  assert.match(missing.json.error, /upload it again/i);
  const fd = new FormData();
  fd.append('photo', new Blob(['hi'], { type: 'text/plain' }), 'note.txt');
  const txt = await fetch(base + '/api/uploads', { method: 'POST', body: fd });
  assert.equal(txt.status, 400);
});

test('cleanup removes only old uploads that never made it into an order', async () => {
  const { cleanupStaged } = require('../server');
  const used = await stage('used.png');
  await orderStaged([used.json.id], [{ finish: 'standard', size: '4x6', qty: 1, fileIndex: 0 }]);
  const old = await stage('abandoned.png');
  const fresh = await stage('fresh.png');
  const age = id => { const p = path.join(dir, 'upload-meta', id + '.json'); const m = JSON.parse(fs.readFileSync(p)); m.createdAt = new Date(Date.now() - 30 * 86400000).toISOString(); fs.writeFileSync(p, JSON.stringify(m)); };
  age(used.json.id); age(old.json.id);
  cleanupStaged();
  assert.equal(fs.existsSync(path.join(dir, 'uploads', used.json.id)), true);
  assert.equal(fs.existsSync(path.join(dir, 'uploads', old.json.id)), false);
  assert.equal(fs.existsSync(path.join(dir, 'uploads', fresh.json.id)), true);
});

// ---- files are held until the email bot confirms they were received ----
const crypto = require('crypto');
const BEARER = { authorization: 'Bearer test-only-confirm-token' };
const ADMIN = { authorization: 'Basic ' + Buffer.from('admin:test-only-admin').toString('base64') };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const upPath = f => path.join(dir, 'uploads', f);
async function heldOrder(n = 2) {
  const ids = [];
  for (let i = 0; i < n; i++) ids.push((await stage(`held${i}.png`)).json.id);
  const items = ids.map((_, i) => ({ finish: 'standard', size: '4x6', qty: 1, fileIndex: i }));
  items.push({ finish: 'standard', size: '8x10', qty: 1, fileIndex: 0 });
  const { status, json } = await orderStaged(ids, items);
  assert.equal(status, 200, JSON.stringify(json));
  return saved(idFrom(json));
}
const confirm = (id, headers = BEARER, body) => fetch(`${base}/api/orders/${id}/confirm-received`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });

test('order files are held with a sha256 manifest and survive the time-based cleanup', async () => {
  const o = await heldOrder(2);
  assert.equal(o.files.length, 2, 'two unique files, three lines');
  assert.equal(o.filesDeleted, false);
  for (const f of o.files) { assert.equal(f.bytes, PNG.length); assert.equal(f.sha256, sha(PNG)); assert.ok(fs.existsSync(upPath(f.file))); }
  // make everything look 60 days old, including the order itself, then run cleanup
  const { cleanupStaged, manifestText } = require('../server');
  for (const f of o.files) { const mp = path.join(dir, 'upload-meta', f.file + '.json'); const m = JSON.parse(fs.readFileSync(mp)); assert.equal(m.order, o.id); m.createdAt = new Date(Date.now() - 60 * 86400000).toISOString(); fs.writeFileSync(mp, JSON.stringify(m)); }
  const legacy = await post([{ finish: 'standard', size: '4x6', qty: 1 }]);
  const lo = saved(idFrom(legacy.json));
  cleanupStaged();
  for (const f of o.files) assert.ok(fs.existsSync(upPath(f.file)), 'order file kept');
  assert.ok(fs.existsSync(upPath(lo.files[0].file)), 'one-request order file kept');
  const text = manifestText(o);
  assert.match(text, /FILE MANIFEST \(2 files/);
  assert.match(text, new RegExp(sha(PNG)));
  assert.match(text, new RegExp(`/orders/${o.id}/confirm-received\\?sig=[a-f0-9]{64}`));
  const man = await (await fetch(`${base}/api/orders/${o.id}/manifest`, { headers: BEARER })).json();
  assert.deepEqual(man.manifest.map(f => [f.sha256, f.bytes]), o.files.map(f => [f.sha256, f.bytes]));
});

test('bad tokens are rejected and the confirm link page does not delete on GET', async () => {
  const o = await heldOrder(1);
  assert.equal((await confirm(o.id, { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await confirm(o.id, {})).status, 401);
  assert.equal((await confirm(o.id, {}, { sig: 'a'.repeat(64) })).status, 401);
  assert.equal((await fetch(`${base}/api/orders/${o.id}/manifest`)).status, 401);
  assert.equal((await fetch(`${base}/orders/${o.id}/confirm-received?sig=bad`)).status, 404);
  const { confirmSig } = require('../server');
  const page = await fetch(`${base}/orders/${o.id}/confirm-received?sig=${confirmSig(o.id)}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Confirm all 1 file\(s\) received/);
  assert.ok(fs.existsSync(upPath(o.files[0].file)), 'GET must not delete');
  assert.equal(saved(o.id).filesDeleted, false);
  // the confirm page form (signed sig, POST) does delete
  const form = await fetch(`${base}/api/orders/${o.id}/confirm-received`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'sig=' + confirmSig(o.id) });
  assert.equal(form.status, 200);
  assert.match(await form.text(), /have been deleted from the website/);
  assert.equal(fs.existsSync(upPath(o.files[0].file)), false);
});

test('a checksum or size mismatch refuses deletion of every file in the order', async () => {
  const o = await heldOrder(2);
  const bad = Buffer.from(PNG); bad[bad.length - 1] ^= 0xff; // same size, different bytes
  fs.writeFileSync(upPath(o.files[1].file), bad);
  const r = await confirm(o.id);
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.match(j.error, /Nothing was deleted/);
  assert.match(j.problems[0].error, /sha256/);
  for (const f of o.files) assert.ok(fs.existsSync(upPath(f.file)));
  assert.equal(saved(o.id).filesDeleted, false);
  // the bot's own received list must match too
  fs.writeFileSync(upPath(o.files[1].file), PNG);
  const partial = await confirm(o.id, BEARER, { received: [{ sha256: sha(PNG), bytes: PNG.length + 1 }] });
  assert.equal(partial.status, 409);
  for (const f of o.files) assert.ok(fs.existsSync(upPath(f.file)));
});

test('confirm deletes the files, keeps the record, and repeating it is harmless', async () => {
  const o = await heldOrder(2);
  const r = await confirm(o.id, BEARER, { received: o.files.map(f => ({ sha256: f.sha256, bytes: f.bytes })) });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.already, false); assert.equal(j.deleted, 2);
  assert.equal(j.manifest.length, 2);
  for (const f of o.files) assert.equal(fs.existsSync(upPath(f.file)), false);
  const after = saved(o.id);
  assert.equal(after.filesDeleted, true);
  assert.ok(after.filesReceivedAt && after.filesDeletedAt);
  assert.equal(after.items.length, 3);
  assert.equal(after.total, o.total);
  const again = await (await confirm(o.id)).json();
  assert.equal(again.ok, true); assert.equal(again.already, true); assert.equal(again.filesReceivedAt, after.filesReceivedAt);
  const dl = await fetch(`${base}/admin/file/${o.files[0].file}`, { headers: ADMIN });
  assert.equal(dl.status, 410);
  assert.match(await dl.text(), /confirmed received .* deleted from the website/);
  const { fileSig } = require('../server');
  assert.equal((await fetch(`${base}/files/${o.id}/${o.files[0].file}?sig=${fileSig(o.id, o.files[0].file)}`)).status, 410);
  const admin = await (await fetch(`${base}/admin`, { headers: ADMIN })).text();
  assert.match(admin, /Received &amp; deleted/);
  assert.match(admin, /Files held/);
  assert.match(admin, /Orders still holding files/);
  assert.match(admin, /Photos on disk/);
});

test('signed download links work while files are held', async () => {
  const o = await heldOrder(1);
  const { fileSig } = require('../server');
  const ok = await fetch(`${base}/files/${o.id}/${o.files[0].file}?sig=${fileSig(o.id, o.files[0].file)}`);
  assert.equal(ok.status, 200);
  assert.equal(sha(Buffer.from(await ok.arrayBuffer())), o.files[0].sha256);
  assert.equal((await fetch(`${base}/files/${o.id}/${o.files[0].file}?sig=${'0'.repeat(64)}`)).status, 404);
  const viaAdmin = await fetch(`${base}/admin/orders/${o.id}/confirm-received`, { method: 'POST', headers: ADMIN, redirect: 'manual' });
  assert.equal(viaAdmin.status, 302);
  assert.equal(saved(o.id).filesDeleted, true);
});
