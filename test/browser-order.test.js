const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-browser-'));
const shots = path.join(dir, 'shots');
fs.mkdirSync(shots);
const PORT = 3477;
const STATIC_PORT = 3478;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
const pngPath = path.join(dir, 'tiny.png');
fs.writeFileSync(pngPath, PNG);
const PHOTO = ['3x5','4x4','4x6','5x7','8x8','8x10','8x12','8x24','10x20','11x14','11x17','12x12','12x16','12x18','12x24','12x36','13x19','14x18','16x16','16x20','16x24'];

let browser, server, staticServer;
function start(cmd, args, cwd) {
  const env = { ...process.env, DATA_DIR: dir, PORT: String(PORT), SHIPPING_FEE: '5.00' };
  delete env.STRIPE_SECRET_KEY;
  delete env.STRIPE_SECRET_KEY_ENC;
  delete env.BREVO_API_KEY;
  delete env.SMTP_HOST;
  delete env.SMTP_USER;
  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  child.log = () => log;
  return child;
}
async function waitFor(url) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok || r.status === 304) return; } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server did not start: ' + url);
}
async function shot(page, name) {
  const file = path.join(shots, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  return file;
}
async function setQty(page, value) {
  await page.$eval('.item .qty', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}

test.before(async () => {
  server = start(process.execPath, ['server.js'], path.join(__dirname, '..'));
  staticServer = start(process.execPath, ['test/serve-static.js', path.join(__dirname, '..', 'static-site'), String(STATIC_PORT)], path.join(__dirname, '..'));
  await waitFor(`http://127.0.0.1:${PORT}/order.html`);
  await waitFor(`http://127.0.0.1:${STATIC_PORT}/index.html`);
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
});
test.after(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
  if (staticServer) staticServer.kill();
});

async function pageAt(width, height, url) {
  const page = await browser.newPage();
  page.on('pageerror', err => { page.__errors = (page.__errors || []).concat(String(err)); });
  await page.setViewport({ width, height, isMobile: width < 700, hasTouch: width < 700 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}

test('homepage lists all 21 sizes once, with no portrait or landscape split', { timeout: 120000 }, async () => {
  for (const [label, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
    const page = await pageAt(width, height, `http://127.0.0.1:${PORT}/`);
    await page.waitForSelector('#size-list a');
    const info = await page.$eval('#sizes', root => ({
      text: root.innerText,
      hrefs: [...root.querySelectorAll('a.size-option')].map(a => a.getAttribute('href')),
      labels: [...root.querySelectorAll('a.size-option b')].map(b => b.textContent)
    }));
    assert.equal(info.hrefs.length, 21, label);
    assert.deepEqual(info.hrefs.map(h => new URL(h, 'http://localhost').searchParams.get('size')), PHOTO);
    assert.doesNotMatch(info.text, /Portrait|Landscape/);
    const chips = await page.$$eval('#home-sizes button', bs => bs.map(b => b.dataset.s));
    assert.deepEqual(chips, PHOTO);
    await page.click('#home-sizes button[data-s="12x18"]');
    const href = await page.$eval('#home-order', a => a.getAttribute('href'));
    assert.match(href, /size=12x18/);
    assert.match(href, /finish=Matte/);
    await page.click('#home-sizes button[data-s="8x8"]');
    const aspect = await page.$eval('#home-frame', el => el.dataset.aspect);
    assert.equal(aspect, '8/8');
    await shot(page, 'home-sizes-' + label);
    await page.close();
  }
});

test('direct order entry and homepage entry can change size before and after upload', { timeout: 120000 }, async () => {
  const desktop = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/order.html`);
  await desktop.waitForSelector('#studio-size button[data-size="4x6"]');
  let state = await desktop.evaluate(() => ({
    aspect: document.getElementById('live-frame').dataset.aspect,
    size: document.getElementById('live-size').textContent,
    price: document.getElementById('studio-price').textContent,
    count: document.querySelectorAll('#studio-size button[data-size]').length
  }));
  assert.equal(state.count, 21);
  assert.equal(state.aspect, '4/6');
  assert.match(state.price, /\$0\.69/);
  await desktop.click('#studio-size button[data-size="5x7"]');
  state = await desktop.evaluate(() => ({
    aspect: document.getElementById('live-frame').dataset.aspect,
    price: document.getElementById('studio-price').textContent,
    pressed: document.querySelector('#studio-size button[data-size="5x7"]').getAttribute('aria-checked')
  }));
  assert.equal(state.aspect, '5/7');
  assert.match(state.price, /\$0\.75/);
  assert.equal(state.pressed, 'true');
  await shot(desktop, 'order-direct-size-desktop');
  await desktop.close();

  const fromHome = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/order.html?type=photo&size=11x14&finish=Matte`);
  await fromHome.waitForSelector('#studio-size button[data-size="11x14"]');
  const arrived = await fromHome.evaluate(() => ({
    aspect: document.getElementById('live-frame').dataset.aspect,
    price: document.getElementById('studio-price').textContent,
    checked: document.querySelector('#studio-size button[data-size="11x14"]').getAttribute('aria-checked')
  }));
  assert.equal(arrived.aspect, '11/14');
  assert.match(arrived.price, /\$9\.00/);
  assert.equal(arrived.checked, 'true');

  const input = await fromHome.$('#files');
  await input.uploadFile(pngPath);
  await fromHome.waitForSelector('.item .nm');
  await fromHome.click('#studio-size button[data-size="16x20"]');
  await fromHome.waitForFunction(() => document.getElementById('live-frame').dataset.aspect === '16/20');
  let after = await fromHome.evaluate(() => ({
    name: document.querySelector('.item .nm').textContent,
    aspect: document.getElementById('live-frame').dataset.aspect,
    price: document.getElementById('studio-price').textContent,
    total: document.getElementById('total').textContent,
    line: document.querySelector('.lt').textContent,
    qty: document.querySelector('.qty').value,
    fin: document.querySelector('.fin').value,
    sizes: document.querySelectorAll('.item button[data-size]').length
  }));
  assert.equal(after.name, 'tiny.png');
  assert.equal(after.aspect, '16/20');
  assert.match(after.price, /\$18\.00/);
  assert.equal(after.total, '$18.00');
  assert.equal(after.line, '$18.00');
  assert.equal(after.qty, '1');
  assert.equal(after.fin, 'Matte');
  assert.equal(after.sizes, 21);
  await setQty(fromHome, 3);
  await fromHome.click('#studio-size .finish-tog button[data-fin="Glossy"]');
  await fromHome.waitForFunction(() => document.querySelector('.fin') && document.querySelector('.fin').value === 'Glossy');
  await fromHome.click('#studio-size button[data-size="8x10"]');
  await fromHome.waitForFunction(() => document.getElementById('total').textContent === '$12.00');
  after = await fromHome.evaluate(() => ({
    name: document.querySelector('.item .nm').textContent,
    aspect: document.getElementById('live-frame').dataset.aspect,
    total: document.getElementById('total').textContent,
    qty: document.querySelector('.qty').value,
    fin: document.querySelector('.fin').value,
    glossy: document.getElementById('live-frame').classList.contains('glossy')
  }));
  assert.equal(after.name, 'tiny.png');
  assert.equal(after.aspect, '8/10');
  assert.equal(after.total, '$12.00');
  assert.equal(after.qty, '3');
  assert.equal(after.fin, 'Glossy');
  assert.equal(after.glossy, true);
  await shot(fromHome, 'order-uploaded-size-desktop');

  const second = path.join(dir, 'second.png');
  fs.writeFileSync(second, PNG);
  const input2 = await fromHome.$('#files');
  await input2.uploadFile(second);
  await fromHome.waitForFunction(() => document.querySelectorAll('.item').length === 2);
  await fromHome.click('.item button[data-size="4x6"]');
  await fromHome.waitForFunction(() => document.querySelector('.lt').textContent === '$2.07');
  const both = await fromHome.evaluate(() => [...document.querySelectorAll('.item')].map(el => ({
    name: el.querySelector('.nm').textContent,
    size: el.querySelector('button[aria-checked="true"]').dataset.size,
    qty: el.querySelector('.qty').value
  })));
  assert.equal(both[0].name, 'tiny.png');
  assert.equal(both[0].size, '4x6');
  assert.equal(both[0].qty, '3');
  assert.equal(both[1].size, '8x10');
  assert.equal(both[1].qty, '1');

  await fromHome.click('.item.active button[data-size="8x10"]');
  await fromHome.type('input[name=name]', 'QA Size');
  await fromHome.type('input[name=email]', 'qa-size@example.com');
  await fromHome.click('#pay');
  await fromHome.waitForFunction(() => location.pathname.endsWith('/success.html'), { timeout: 10000 });
  const orders = fs.readdirSync(path.join(dir, 'orders')).filter(f => f.endsWith('.json'));
  assert.equal(orders.length, 1);
  const order = JSON.parse(fs.readFileSync(path.join(dir, 'orders', orders[0]), 'utf8'));
  assert.equal(order.items[0].size, '8x10');
  assert.equal(order.items[0].finish, 'glossy');
  assert.equal(order.items[0].qty, 3);
  assert.equal(order.items[0].unit, 4);
  assert.equal(order.items[0].lineTotal, 12);
  assert.equal(order.items[1].size, '8x10');
  assert.equal(order.items[1].unit, 4);
  assert.equal(order.items[1].qty, 1);
  assert.equal(order.total, 16);
  assert.equal(order.payment, 'awaiting Venmo');
  await fromHome.close();

  const mobile = await pageAt(390, 844, `http://127.0.0.1:${PORT}/order.html?type=photo&size=4x6`);
  await mobile.waitForSelector('#studio-size button[data-size="12x36"]');
  await mobile.click('#studio-size button[data-size="12x36"]');
  const mobileState = await mobile.evaluate(() => ({
    aspect: document.getElementById('live-frame').dataset.aspect,
    price: document.getElementById('studio-price').textContent
  }));
  assert.equal(mobileState.aspect, '12/36');
  assert.match(mobileState.price, /\$24\.00/);
  const file = await mobile.$('#files');
  await file.uploadFile(pngPath);
  await mobile.waitForSelector('.item .nm');
  await mobile.click('.item button[data-size="16x24"]');
  await mobile.waitForFunction(() => document.getElementById('total').textContent === '$21.00');
  const kept = await mobile.$eval('.item .nm', el => el.textContent);
  assert.equal(kept, 'tiny.png');
  await shot(mobile, 'order-uploaded-size-mobile');
  await mobile.close();
});

test('flyer minimum and published ranges update immediately and block invalid quantities', { timeout: 120000 }, async () => {
  for (const [label, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
    const page = await pageAt(width, height, `http://127.0.0.1:${PORT}/order.html?type=flyers`);
    await page.waitForSelector('#pending-flyer-qty');
    const initial = await page.$eval('#flyer-quote', el => el.innerText);
    assert.match(initial, /\$0\.80–\$1\.12 per flyer/);
    assert.match(initial, /\$20\.00–\$28\.00/);
    assert.match(initial, /Quote required/);
    await page.$eval('#pending-flyer-qty', el => { el.value = '1'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.$eval('#pending-flyer-qty', el => { el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const recovered = await page.$eval('#flyer-quote', el => el.innerText);
    assert.match(recovered, /\$0\.28–\$0\.65 per flyer/);
    assert.match(recovered, /\$28\.00–\$65\.00/);
    assert.match(recovered, /Quote required/);
    assert.doesNotMatch(recovered, /minimum of 25/i);
    await page.$eval('#pending-flyer-qty', el => { el.value = '24'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const low = await page.$eval('#flyer-quote', el => el.innerText);
    assert.match(low, /minimum of 25/i);
    await page.$eval('#pending-flyer-qty', el => { el.value = '25'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const file = await page.$('#files');
    await file.uploadFile(pngPath);
    await page.waitForSelector('.item .qty');
    async function qtyText(q) {
      await page.$eval('.item .qty', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, q);
      return page.$eval('.item .flyer-card', el => el.innerText);
    }
    assert.match(await qtyText(50), /\$40\.00–\$56\.00/);
    const gap = await qtyText(51);
    assert.match(gap, /No published rate/);
    assert.match(gap, /Quote required/);
    assert.doesNotMatch(gap, /\$\d/);
    assert.match(await qtyText(100), /\$0\.28–\$0\.65 per flyer/);
    assert.match(await qtyText(500), /\$140\.00–\$325\.00/);
    const gap2 = await qtyText(501);
    assert.match(gap2, /No published rate/);
    assert.match(await qtyText(1000), /\$0\.04–\$0\.16 per flyer/);
    assert.match(await qtyText(1000), /\$40\.00–\$160\.00/);
    await qtyText(24);
    const blocked = await page.evaluate(() => ({
      disabled: document.getElementById('pay').disabled,
      err: document.getElementById('err').textContent
    }));
    assert.equal(blocked.disabled, true);
    assert.match(blocked.err, /minimum of 25/i);
    const back = await qtyText(100);
    assert.match(back, /\$28\.00–\$65\.00/);
    assert.match(back, /Quote required/);
    assert.doesNotMatch(back, /minimum of 25/i);
    const open = await page.$eval('#pay', el => el.disabled);
    assert.equal(open, false);
    const name = await page.$eval('.item .nm', el => el.textContent);
    assert.equal(name, 'tiny.png');
    await shot(page, 'flyer-price-' + label);
    await page.close();
  }
});

test('static site mirrors the unified size list and flyer quote', { timeout: 120000 }, async () => {
  const home = await pageAt(1280, 900, `http://127.0.0.1:${STATIC_PORT}/`);
  await home.waitForSelector('#size-list a');
  const n = await home.$$eval('#size-list a', as => as.length);
  const text = await home.$eval('#sizes', el => el.innerText);
  assert.equal(n, 21);
  assert.doesNotMatch(text, /Portrait|Landscape/);
  await home.close();
  const order = await pageAt(390, 844, `http://127.0.0.1:${STATIC_PORT}/order.html?type=photo&size=16x20`);
  await order.waitForSelector('#studio-size button[data-size="16x20"]');
  const aspect = await order.$eval('#live-frame', el => el.dataset.aspect);
  assert.equal(aspect, '16/20');
  await order.select('.prod', 'flyers');
  await order.waitForSelector('.flyer-unit');
  const flyer = await order.$eval('.flyer-card', el => el.innerText);
  assert.match(flyer, /\$0\.80–\$1\.12 per flyer/);
  assert.match(flyer, /minimum 25|Quote required|\$20\.00–\$28\.00/i);
  await order.close();
  const pub = ['index.html', 'prices.js', 'pricing.js', 'site.js', 'style.css'];
  for (const f of pub) {
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', f));
    const b = fs.readFileSync(path.join(__dirname, '..', 'static-site', f));
    assert.equal(a.equals(b), true, f + ' drifted from public');
  }
});

async function tap(page, sel) {
  await page.$eval(sel, el => { el.scrollIntoView({ block: 'center' }); el.click(); });
}
test('one photo can be ordered in two sizes with Add another size, uploaded once', { timeout: 120000 }, async () => {
  const before = fs.readdirSync(path.join(dir, 'orders')).filter(f => f.endsWith('.json'));
  for (const [label, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
    const page = await pageAt(width, height, `http://127.0.0.1:${PORT}/order.html?type=photo`);
    await page.waitForSelector('#studio-size button[data-size="4x6"]');
    await (await page.$('#files')).uploadFile(pngPath);
    await page.waitForSelector('.item .add-size');
    await tap(page, '.item button[data-size="4x6"]');
    await setQty(page, 2);
    await tap(page, '.item .add-size');
    await page.waitForFunction(() => document.querySelectorAll('.item').length === 2);
    await tap(page, '.item:nth-child(2) button[data-size="8x10"]');
    await page.waitForFunction(() => document.getElementById('total').textContent === '$5.38');
    const st = await page.evaluate(() => ({
      lines: [...document.querySelectorAll('.item')].map(el => ({
        name: el.querySelector('.nm').textContent,
        tag: (el.querySelector('.size-tag') || {}).textContent,
        size: el.querySelector('button[aria-checked="true"]').dataset.size,
        qty: el.querySelector('.qty').value,
        lt: el.querySelector('.lt').textContent
      })),
      count: document.getElementById('count').textContent,
      studio: document.getElementById('studio-price').textContent
    }));
    assert.deepEqual(st.lines, [
      { name: 'tiny.png', tag: 'Photo 1 · size 1 of 2', size: '4x6', qty: '2', lt: '$1.38' },
      { name: 'tiny.png', tag: 'Photo 1 · size 2 of 2', size: '8x10', qty: '1', lt: '$4.00' }
    ]);
    assert.equal(st.count, '1 file · 2 sizes · 3 items');
    assert.match(st.studio, /8×10 · \$4\.00 each/);
    // removing one size keeps the other line and the photo
    await page.$eval('#items', el => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -90));
    await shot(page, 'same-photo-two-sizes-' + label);
    assert.deepEqual(page.__errors || [], []);
    if (label === 'desktop') {
      await page.type('input[name=name]', 'QA Two Sizes');
      await page.type('input[name=email]', 'qa-two@example.com');
      const uploadsBefore = fs.readdirSync(path.join(dir, 'uploads')).length;
      await page.click('#pay');
      await page.waitForFunction(() => location.pathname.endsWith('/success.html'), { timeout: 15000 });
      assert.equal(fs.readdirSync(path.join(dir, 'uploads')).length, uploadsBefore + 1);
      const now = fs.readdirSync(path.join(dir, 'orders')).filter(f => f.endsWith('.json') && !before.includes(f));
      assert.equal(now.length, 1);
      const order = JSON.parse(fs.readFileSync(path.join(dir, 'orders', now[0]), 'utf8'));
      assert.deepEqual(order.items.map(i => [i.size, i.qty, i.lineTotal, i.originalName, i.photo]), [['4x6', 2, 1.38, 'tiny.png', 1], ['8x10', 1, 4, 'tiny.png', 1]]);
      assert.equal(order.items[0].file, order.items[1].file);
      assert.equal(order.total, 5.38);
    } else {
      await tap(page, '.item:nth-child(1) .rm');
      await page.waitForFunction(() => document.querySelectorAll('.item').length === 1);
      const left = await page.evaluate(() => ({ size: document.querySelector('.item button[aria-checked="true"]').dataset.size, total: document.getElementById('total').textContent, tag: !!document.querySelector('.size-tag') }));
      assert.deepEqual(left, { size: '8x10', total: '$4.00', tag: false });
    }
    await page.close();
  }
});



test('photo finish choices include Satin at the same price; invitations offer Matte and Satin', { timeout: 120000 }, async () => {
  const before = fs.readdirSync(path.join(dir, 'orders')).filter(f => f.endsWith('.json'));
  const page = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/order.html?type=photo&size=4x6`);
  await page.waitForSelector('#studio-size .finish-tog button[data-fin="Satin"]');
  const fins = await page.$$eval('#studio-size .finish-tog button[data-fin]', bs => bs.map(b => [b.dataset.fin, b.getAttribute('aria-pressed')]));
  assert.deepEqual(fins, [['Matte', 'true'], ['Glossy', 'false'], ['Satin', 'false']]);
  await (await page.$('#files')).uploadFile(pngPath);
  await page.waitForSelector('.item .fin');
  const options = await page.$$eval('.item .fin option', os => os.map(o => o.value));
  assert.deepEqual(options, ['Matte', 'Glossy', 'Satin']);
  assert.equal(await page.$eval('#total', el => el.textContent), '$0.69');
  await page.click('#studio-size .finish-tog button[data-fin="Satin"]');
  await page.waitForFunction(() => document.querySelector('.fin') && document.querySelector('.fin').value === 'Satin');
  const after = await page.evaluate(() => ({
    fin: document.querySelector('.fin').value,
    total: document.getElementById('total').textContent,
    satin: document.getElementById('live-frame').classList.contains('satin'),
    glossy: document.getElementById('live-frame').classList.contains('glossy'),
    label: document.getElementById('live-fin').textContent
  }));
  assert.equal(after.fin, 'Satin');
  assert.equal(after.total, '$0.69');
  assert.equal(after.satin, true);
  assert.equal(after.glossy, false);
  assert.equal(after.label, 'Satin');
  await page.type('input[name=name]', 'QA Satin');
  await page.type('input[name=email]', 'qa-satin@example.com');
  await page.click('#pay');
  await page.waitForFunction(() => location.pathname.endsWith('/success.html'), { timeout: 15000 });
  const now = fs.readdirSync(path.join(dir, 'orders')).filter(f => f.endsWith('.json') && !before.includes(f));
  const order = JSON.parse(fs.readFileSync(path.join(dir, 'orders', now[0]), 'utf8'));
  assert.equal(order.items[0].finish, 'satin');
  assert.equal(order.items[0].unit, 0.69);
  assert.equal(order.items[0].lineTotal, 0.69);
  await page.close();

  const inv = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/order.html?type=invitations`);
  await inv.waitForSelector('#studio-size .finish-tog button[data-fin="Matte"]');
  const invFins = await inv.$$eval('#studio-size .finish-tog button[data-fin]', bs => bs.map(b => b.dataset.fin));
  assert.deepEqual(invFins, ['Matte', 'Satin']);
  assert.equal(await inv.$('#studio-size .finish-tog button[data-fin="Glossy"]'), null);
  await inv.close();

  const home = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/`);
  await home.waitForSelector('.finish-tog button[data-fin="Satin"]');
  const homeFins = await home.$$eval('.finish-tog button[data-fin]', bs => bs.map(b => b.dataset.fin));
  assert.deepEqual(homeFins, ['Matte', 'Glossy', 'Satin']);
  const photoIntro = await home.$eval('#p-photo .intro', el => el.innerText);
  assert.match(photoIntro, /Matte, Glossy and Satin are the same price/);
  await home.close();
});

test('invitation lines offer 100 lb or 120 lb card stock at the same pack price', { timeout: 120000 }, async () => {
  const before = fs.readdirSync(path.join(dir, 'orders')).filter(f => f.endsWith('.json'));
  const desktop = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/order.html?type=invitations`);
  await desktop.waitForSelector('#studio-size button[data-paper="Card stock 100 lb"]');
  const pending = await desktop.evaluate(() => ({
    papers: [...document.querySelectorAll('#studio-size button[data-paper]')].map(b => [b.dataset.paper, b.getAttribute('aria-pressed')])
  }));
  assert.deepEqual(pending.papers, [['Card stock 100 lb', 'true'], ['Card stock 120 lb', 'false']]);
  await (await desktop.$('#files')).uploadFile(pngPath);
  await desktop.waitForSelector('.item .paper');
  const line = await desktop.evaluate(() => ({
    product: document.querySelector('.pt').value,
    fin: document.querySelector('.fin').value,
    paper: document.querySelector('.paper').value,
    options: [...document.querySelector('.paper').options].map(o => o.value),
    size: document.querySelector('.item button[aria-checked="true"]').dataset.size,
    total: document.getElementById('total').textContent,
    preview: document.getElementById('live-paper') && document.getElementById('live-paper').textContent,
    wrapHidden: document.getElementById('live-paper-wrap').hidden
  }));
  const invFins = await desktop.$$eval('.item .fin option', os => os.map(o => o.value));
  assert.deepEqual(invFins, ['Matte', 'Satin']);
  assert.equal(line.product, 'invitations');
  assert.equal(line.fin, 'Matte');
  assert.equal(line.paper, 'Card stock 100 lb');
  assert.deepEqual(line.options, ['Card stock 100 lb', 'Card stock 120 lb']);
  assert.equal(line.size, '4x6 (Pack of 25)');
  assert.equal(line.total, '$17.00');
  assert.equal(line.preview, 'Card stock 100 lb');
  assert.equal(line.wrapHidden, false);
  await desktop.select('.paper', 'Card stock 120 lb');
  await desktop.waitForFunction(() => document.querySelector('.paper') && document.querySelector('.paper').value === 'Card stock 120 lb');
  const afterPaper = await desktop.evaluate(() => ({
    paper: document.querySelector('.paper').value,
    total: document.getElementById('total').textContent,
    preview: document.getElementById('live-paper').textContent,
    studio: document.querySelector('#studio-size button[data-paper="Card stock 120 lb"]').getAttribute('aria-pressed')
  }));
  assert.equal(afterPaper.paper, 'Card stock 120 lb');
  assert.equal(afterPaper.total, '$17.00');
  assert.equal(afterPaper.preview, 'Card stock 120 lb');
  assert.equal(afterPaper.studio, 'true');
  await desktop.click('#studio-size .finish-tog button[data-fin="Satin"]');
  await desktop.waitForFunction(() => document.querySelector('.fin') && document.querySelector('.fin').value === 'Satin');
  const afterFin = await desktop.evaluate(() => ({
    fin: document.querySelector('.fin').value,
    total: document.getElementById('total').textContent,
    options: [...document.querySelector('.fin').options].map(o => o.value),
    glossyBtn: !!document.querySelector('#studio-size .finish-tog button[data-fin="Glossy"]')
  }));
  assert.equal(afterFin.fin, 'Satin');
  assert.equal(afterFin.total, '$17.00');
  assert.deepEqual(afterFin.options, ['Matte', 'Satin']);
  assert.equal(afterFin.glossyBtn, false);
  await desktop.select('.pt', 'photo');
  await desktop.waitForFunction(() => document.querySelector('.pt').value === 'photo');
  assert.equal(await desktop.$('.paper'), null);
  assert.equal(await desktop.$eval('#live-paper-wrap', el => el.hidden), true);
  await desktop.select('.pt', 'invitations');
  await desktop.waitForSelector('.item .paper');
  assert.equal(await desktop.$eval('.paper', el => el.value), 'Card stock 120 lb');
  await desktop.type('input[name=name]', 'QA Invite Paper');
  await desktop.type('input[name=email]', 'qa-invite-paper@example.com');
  await desktop.click('#pay');
  await desktop.waitForFunction(() => location.pathname.endsWith('/success.html'), { timeout: 15000 });
  const now = fs.readdirSync(path.join(dir, 'orders')).filter(f => f.endsWith('.json') && !before.includes(f));
  assert.equal(now.length, 1);
  const order = JSON.parse(fs.readFileSync(path.join(dir, 'orders', now[0]), 'utf8'));
  assert.equal(order.items[0].finish, 'invitations_satin');
  assert.equal(order.items[0].size, '4x6 (Pack of 25)');
  assert.equal(order.items[0].paper, 'Card stock 120 lb');
  assert.equal(order.items[0].unit, 17);
  assert.equal(order.items[0].lineTotal, 17);
  assert.equal(order.total, 17);
  await desktop.close();

  const menu = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/`);
  await menu.waitForSelector('#menu button[data-t="p-inv"]');
  await menu.click('#menu button[data-t="p-inv"]');
  await menu.waitForSelector('#p-inv:not([hidden])');
  const intro = await menu.$eval('#p-inv .intro', el => el.innerText);
  assert.match(intro, /100 lb or 120 lb card stock/i);
  assert.match(intro, /Matte or Satin/);
  assert.match(intro, /same price/i);
  await menu.close();
});

test('a 150-photo order uploads in small requests and is saved in full', { timeout: 180000 }, async () => {
  const bulk = path.join(dir, 'bulk');
  fs.mkdirSync(bulk, { recursive: true });
  const paths = Array.from({ length: 150 }, (_, i) => { const p = path.join(bulk, `img${String(i).padStart(3, '0')}.png`); fs.writeFileSync(p, PNG); return p; });
  const before = fs.readdirSync(path.join(dir, 'orders')).filter(f => f.endsWith('.json'));
  const page = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/order.html?type=photo&size=4x6`);
  await page.waitForSelector('#studio-size button[data-size="4x6"]');
  await (await page.$('#files')).uploadFile(...paths);
  await page.waitForFunction(() => document.querySelectorAll('.item').length === 150);
  assert.equal(await page.$eval('#total', el => el.textContent), '$103.50');
  await page.type('input[name=name]', 'QA Bulk');
  await page.type('input[name=email]', 'qa-bulk@example.com');
  let uploadCalls = 0;
  page.on('request', r => { if (r.url().endsWith('/api/uploads')) uploadCalls++; });
  await page.click('#pay');
  await page.waitForFunction(() => location.pathname.endsWith('/success.html'), { timeout: 120000 });
  assert.equal(uploadCalls, 150);
  const now = fs.readdirSync(path.join(dir, 'orders')).filter(f => f.endsWith('.json') && !before.includes(f));
  const order = JSON.parse(fs.readFileSync(path.join(dir, 'orders', now[0]), 'utf8'));
  assert.equal(order.items.length, 150);
  assert.equal(new Set(order.items.map(i => i.file)).size, 150);
  assert.equal(order.total, 103.5);
  await page.close();
});

test('customers can message about a different paper type', { timeout: 120000 }, async () => {
  const photo = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/order.html?type=photo`);
  await photo.waitForSelector('#studio-size .paper-note a');
  const photoNote = await photo.$eval('#studio-size .paper-note', el => ({ text: el.innerText, href: el.querySelector('a').getAttribute('href') }));
  assert.match(photoNote.text, /Want a different paper type/i);
  assert.match(photoNote.text, /we.?ll let you know what.?s possible/i);
  assert.equal(photoNote.href, 'contact.html?topic=paper');
  await photo.close();

  const inv = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/order.html?type=invitations`);
  await inv.waitForSelector('#studio-size .paper-note a');
  assert.match(await inv.$eval('#studio-size .paper-note', el => el.innerText), /Want a different paper type/i);
  await (await inv.$('#files')).uploadFile(pngPath);
  await inv.waitForSelector('.item .paper-note a');
  const line = await inv.evaluate(() => ({
    text: document.querySelector('.item .paper-note').innerText,
    href: document.querySelector('.item .paper-note a').getAttribute('href'),
    afterPaper: !!(document.querySelector('.item .paper') && document.querySelector('.item .paper').closest('.ctl').nextElementSibling && document.querySelector('.item .paper').closest('.ctl').nextElementSibling.classList.contains('paper-note'))
  }));
  assert.match(line.text, /Want a different paper type/i);
  assert.equal(line.href, 'contact.html?topic=paper');
  assert.equal(line.afterPaper, true);
  await inv.select('.pt', 'photo');
  await inv.waitForFunction(() => document.querySelector('.pt') && document.querySelector('.pt').value === 'photo');
  assert.equal(await inv.$('.item .paper-note'), null);
  assert.ok(await inv.$('#studio-size .paper-note'));
  await inv.close();

  const fly = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/order.html?type=flyers`);
  await fly.waitForSelector('#studio-size .flyer-card');
  assert.equal(await fly.$('#studio-size .paper-note'), null);
  await fly.close();

  const home = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/`);
  await home.waitForSelector('#p-photo .paper-note a');
  const photoIntro = await home.$eval('#p-photo .paper-note', el => ({ text: el.innerText, href: el.querySelector('a').getAttribute('href') }));
  assert.match(photoIntro.text, /Want a different paper type/i);
  assert.match(photoIntro.text, /we.?ll let you know what.?s possible/i);
  assert.equal(photoIntro.href, 'contact.html?topic=paper');
  await home.click('#menu button[data-t="p-inv"]');
  await home.waitForSelector('#p-inv:not([hidden]) .paper-note a');
  assert.match(await home.$eval('#p-inv .paper-note', el => el.innerText), /Want a different paper type/i);
  await home.click('#menu button[data-t="p-fly"]');
  await home.waitForSelector('#p-fly:not([hidden])');
  assert.equal(await home.$('#p-fly .paper-note'), null);
  await home.close();

  const contact = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/contact.html?topic=paper`);
  await contact.waitForSelector('form[name="contact"] textarea[name="message"]');
  const filled = await contact.$eval('form[name="contact"] textarea[name="message"]', el => el.value);
  assert.match(filled, /different paper type/i);
  assert.match(filled, /what.?s possible/i);
  await contact.close();

  const blank = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/contact.html`);
  await blank.waitForSelector('form[name="contact"] textarea[name="message"]');
  assert.equal(await blank.$eval('form[name="contact"] textarea[name="message"]', el => el.value), '');
  await blank.close();

  const staticContact = await pageAt(1280, 900, `http://127.0.0.1:${STATIC_PORT}/contact.html?topic=paper`);
  await staticContact.waitForSelector('form[name="contact"] textarea[name="message"]');
  assert.match(await staticContact.$eval('form[name="contact"] textarea[name="message"]', el => el.value), /different paper type/i);
  await staticContact.close();
});

test('phone order lines keep product, finish, paper and qty values readable', { timeout: 120000 }, async () => {
  function ctlInfo() {
    const ctl = document.querySelector('.item .ctl');
    const style = getComputedStyle(ctl);
    const fields = [...ctl.children].map(div => {
      const control = div.querySelector('select,input');
      const label = (div.querySelector('label') || {}).textContent || '';
      const text = control.tagName === 'SELECT' ? control.options[control.selectedIndex].text : String(control.value);
      return {
        label,
        text,
        width: Math.round(control.getBoundingClientRect().width),
        colSpan: getComputedStyle(div).gridColumnStart === '1' && getComputedStyle(div).gridColumnEnd === '-1'
      };
    });
    return {
      columns: style.gridTemplateColumns.split(' ').filter(Boolean).length,
      hasPaper: ctl.classList.contains('has-paper'),
      fields
    };
  }

  const desktop = await pageAt(1280, 900, `http://127.0.0.1:${PORT}/order.html?type=invitations`);
  await (await desktop.$('#files')).uploadFile(pngPath);
  await desktop.waitForSelector('.item .ctl.has-paper');
  const desk = await desktop.evaluate(ctlInfo);
  assert.equal(desk.columns, 4);
  assert.equal(desk.hasPaper, true);
  await desktop.close();

  const inv = await pageAt(390, 844, `http://127.0.0.1:${PORT}/order.html?type=invitations`);
  await (await inv.$('#files')).uploadFile(pngPath);
  await inv.waitForSelector('.item .ctl.has-paper');
  await inv.select('.paper', 'Card stock 120 lb');
  await inv.waitForFunction(() => document.querySelector('.paper') && document.querySelector('.paper').value === 'Card stock 120 lb');
  const phoneInv = await inv.evaluate(ctlInfo);
  assert.equal(phoneInv.columns, 1);
  assert.equal(phoneInv.fields.length, 4);
  assert.equal(phoneInv.fields[0].text, 'Invitations & Announcements');
  assert.equal(phoneInv.fields[1].text, 'Matte');
  assert.equal(phoneInv.fields[2].text, 'Card stock 120 lb');
  for (const f of phoneInv.fields) assert.ok(f.width >= 280, f.label + ' too narrow: ' + f.width);
  await inv.close();

  const photo = await pageAt(390, 844, `http://127.0.0.1:${PORT}/order.html?type=photo`);
  await (await photo.$('#files')).uploadFile(pngPath);
  await photo.waitForSelector('.item .ctl');
  const phonePhoto = await photo.evaluate(ctlInfo);
  assert.equal(phonePhoto.columns, 1);
  assert.equal(phonePhoto.hasPaper, false);
  assert.equal(phonePhoto.fields[0].text, 'Photo Prints');
  assert.equal(phonePhoto.fields[1].text, 'Matte');
  for (const f of phonePhoto.fields) assert.ok(f.width >= 280, f.label + ' too narrow: ' + f.width);
  await photo.close();

  const fly = await pageAt(390, 844, `http://127.0.0.1:${PORT}/order.html?type=flyers`);
  await (await fly.$('#files')).uploadFile(pngPath);
  await fly.waitForSelector('.item .ctl');
  const phoneFly = await fly.evaluate(ctlInfo);
  assert.equal(phoneFly.columns, 1);
  assert.equal(phoneFly.fields[0].text, 'Flyers');
  for (const f of phoneFly.fields) assert.ok(f.width >= 280, f.label + ' too narrow: ' + f.width);
  await fly.close();
});
