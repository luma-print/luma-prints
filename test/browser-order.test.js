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
