const express = require('express'), multer = require('multer'), path = require('path'), fs = require('fs'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const ORDERS = path.join(DATA, 'orders'), UPLOADS = path.join(DATA, 'uploads');
[ORDERS, UPLOADS].forEach(d => fs.mkdirSync(d, { recursive: true }));
// required for /admin (no default). Falls back to a Render secret file if the env var is unset.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (() => { try { return fs.readFileSync(process.env.ADMIN_PASSWORD_FILE || '/etc/secrets/admin_password', 'utf8').trim() || undefined; } catch { return undefined; } })();
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SHIPPING_FEE = parseFloat(process.env.SHIPPING_FEE || '5.00');
const PRICES = require('./public/prices.js');
const { priceOrderItem } = require('./public/pricing.js');
const MESSAGES = path.join(DATA, 'messages'); fs.mkdirSync(MESSAGES, { recursive: true });
// details for photos uploaded one at a time before the order is placed
const UPLOAD_META = path.join(DATA, 'upload-meta'); fs.mkdirSync(UPLOAD_META, { recursive: true });
const MAX_LINES = 5000;
const UPLOAD_TTL_DAYS = parseFloat(process.env.UPLOAD_TTL_DAYS || '7');
// Secret for the email bot: Bearer token for the confirm API and key for signed links.
const FILES_CONFIRM_TOKEN = (process.env.FILES_CONFIRM_TOKEN || '').trim();
const sign = msg => crypto.createHmac('sha256', FILES_CONFIRM_TOKEN).update(msg).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
const confirmSig = id => sign('confirm-received:' + id);
const fileSig = (id, f) => sign('file:' + id + ':' + f);
const confirmLink = id => `${BASE_URL}/orders/${encodeURIComponent(id)}/confirm-received?sig=${confirmSig(id)}`;
const fileLink = (id, f) => `${BASE_URL}/files/${encodeURIComponent(id)}/${encodeURIComponent(f)}?sig=${fileSig(id, f)}`;
function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(p).on('error', reject).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex')));
  });
}
function stripeSecret() {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;
  if (process.env.STRIPE_SECRET_KEY_ENC) {
    try { return Buffer.from(process.env.STRIPE_SECRET_KEY_ENC.split('').reverse().join(''), 'hex').toString('utf8'); }
    catch (e) { return ''; }
  }
  return '';
}
const STRIPE_KEY = stripeSecret();
const stripe = STRIPE_KEY ? require('stripe')(STRIPE_KEY) : null;
const VENMO_USERNAME = (process.env.VENMO_USERNAME || 'moroni-guerrero').replace(/^@/, '');
const X_MONEY_HANDLE = (process.env.X_MONEY_HANDLE || 'm59676').replace(/^@/, '');

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'Luma.prints1@gmail.com';
const MAX_ATTACH = (parseFloat(process.env.MAX_ATTACH_MB || '10')) * 1024 * 1024;
let mailer = null;
if (process.env.SMTP_HOST) {
  const port = +(process.env.SMTP_PORT || 465);
  mailer = require('nodemailer').createTransport({ host: process.env.SMTP_HOST, port, secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    tls: process.env.SMTP_INSECURE_TLS === 'true' ? { rejectUnauthorized: false } : undefined });
}
const FROM = () => `"Luma Prints" <${process.env.SMTP_FROM || process.env.SMTP_USER || OWNER_EMAIL}>`;
const money = v => '$' + v.toFixed(2);
const itemLine = i => `${i.photo ? 'Photo ' + i.photo + ': ' : ''}${i.qty} x ${i.size} – ${(PRICES[i.finish] || {}).label || i.finish} – ${i.originalName} – ${i.priceTBD ? 'price TBD' + (i.unitText ? ' (' + i.unitText + (i.totalText ? '; published total ' + i.totalText : '') + ')' : '') : money(i.lineTotal)}`;
const summary = o => `Order: ${o.id}\nCustomer: ${o.customer.name}\nEmail: ${o.customer.email}\nPhone: ${o.customer.phone || '-'}\n` +
  `Delivery: ${o.delivery === 'shipping' ? 'SHIPPING to:\n' + o.address : 'PICKUP'}\n${o.notes ? 'Notes: ' + o.notes + '\n' : ''}\nItems:\n` +
  o.items.map(itemLine).join('\n') + `\n\nSubtotal: ${money(o.subtotal)}\nShipping: ${money(o.shipping)}\nTotal: ${money(o.total)}${o.items.some(i => i.priceTBD) ? ' (quote items are not included in this dollar total)' : ''}\nPayment: ${o.payment}`;
const BREVO_KEY = process.env.BREVO_API_KEY;
const BREVO_URL = process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email';
const canMail = () => !!(BREVO_KEY || mailer);
async function sendBrevo(msg) {
  const body = { sender: { name: 'Luma Prints', email: process.env.SMTP_FROM || OWNER_EMAIL }, to: [{ email: msg.to }], subject: msg.subject, textContent: msg.text };
  if (msg.replyTo) body.replyTo = { email: msg.replyTo };
  if (msg.attachments && msg.attachments.length) body.attachment = msg.attachments.map(a => ({ name: a.filename, content: fs.readFileSync(a.path).toString('base64') }));
  const r = await fetch(BREVO_URL, { method: 'POST', headers: { 'api-key': BREVO_KEY, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}
async function send(msg) {
  if (!canMail()) return;
  try { if (BREVO_KEY) await sendBrevo(msg); else await mailer.sendMail({ from: FROM(), ...msg }); }
  catch (e) { console.error('Email failed:', e.message); }
}
async function notify(order, why) {
  if (!canMail()) return;
  if (why === 'PAID') return send({ to: OWNER_EMAIL, subject: `PAID: Luma Prints order ${order.id} (${money(order.total)})`, text: summary(order) + `\n\nAdmin: ${BASE_URL}/admin` });
  // owner email with photos attached up to MAX_ATTACH; the rest as admin links
  let used = 0; const attachments = [], links = [];
  // one attachment per uploaded file, even when that photo is ordered in several sizes
  for (const g of photoGroups(order.items)) {
    const p = path.join(UPLOADS, g.file), size = fs.statSync(p).size;
    const sizes = g.lines.map(i => `${i.qty}x_${i.size}_${i.finish}`).join('+');
    if (used + size <= MAX_ATTACH) { used += size; attachments.push({ filename: `${sizes}_${g.originalName}`, path: p }); }
    else links.push(`${g.photo ? 'Photo ' + g.photo + ' ' : ''}${g.originalName}: ${FILES_CONFIRM_TOKEN ? fileLink(order.id, g.file) : BASE_URL + '/admin/file/' + g.file}`);
  }
  const extra = links.length ? `\n\nNot attached (over ${MAX_ATTACH / 1048576} MB) – download here${FILES_CONFIRM_TOKEN ? '' : ' from admin (password required)'}:\n${links.join('\n')}` : '';
  await send({ to: OWNER_EMAIL, replyTo: order.customer.email, subject: `New Luma Prints order ${order.id} – ${order.customer.name} – ${money(order.total)} (${why})`,
    text: summary(order) + extra + manifestText(order) + `\n\nAll orders: ${BASE_URL}/admin`, attachments });
  await send({ to: order.customer.email, replyTo: OWNER_EMAIL, subject: `We received your Luma Prints order ${order.id}`,
    text: `Hi ${order.customer.name},\n\nThank you for your order! Here is a summary:\n\n` + summary(order) +
      `\n\n${order.paymentMethod === 'venmo' ? 'Please send ' + money(order.total) + ' on Venmo to @' + VENMO_USERNAME + ' and put ' + order.id + ' in the note. Then open your order link and tap I\'ve paid.' : order.paymentMethod === 'xmoney' ? 'Please send ' + money(order.total) + ' with X Money to @' + X_MONEY_HANDLE + ' and put ' + order.id + ' in the note.' : order.payment === 'pending' ? 'Once your payment is complete we will start printing.' : order.payment === 'paid' || String(order.payment).includes('customer reported') ? 'Your payment is confirmed or reported. We will verify and start printing.' : 'We will contact you to arrange payment.'}\nQuestions? Just reply to this email.\n\nLuma Prints` });
}
// what the email bot should have received for this order
function manifestOf(o) {
  return (o.files || []).map(f => ({ file: f.file, originalName: f.originalName, attachmentName: f.attachmentName, photo: f.photo, bytes: f.bytes, sha256: f.sha256 }));
}
function manifestText(o) {
  const m = manifestOf(o);
  if (!m.length) return '';
  return `\n\nFILE MANIFEST (${m.length} file${m.length === 1 ? '' : 's'}; the website keeps them until you confirm):\n` +
    m.map((f, i) => `${i + 1}. ${f.originalName} | ${f.bytes} bytes | sha256 ${f.sha256} | id ${f.file}`).join('\n') +
    (FILES_CONFIRM_TOKEN ? `\n\nAfter checking every file, confirm here (this deletes them from the website): ${confirmLink(o.id)}` : `\n\nAfter checking every file, confirm in admin: ${BASE_URL}/admin`);
}
async function buildManifest(lines) {
  const out = [];
  for (const g of photoGroups(lines)) {
    const p = path.join(UPLOADS, g.file);
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(metaPath(g.file), 'utf8')); } catch { /* old one-request upload */ }
    const bytes = fs.statSync(p).size;
    const sha256 = meta && meta.sha256 && meta.size === bytes ? meta.sha256 : await sha256File(p);
    out.push({ file: g.file, originalName: g.originalName, attachmentName: `${g.lines.map(i => `${i.qty}x_${i.size}_${i.finish}`).join('+')}_${g.originalName}`, photo: g.photo || 0, bytes, sha256 });
  }
  return out;
}
// Check every held file against the recorded size and sha256. Returns problems ([] = all good).
async function verifyOrderFiles(o, received) {
  const problems = [];
  const files = o.files || [];
  if (!files.length) problems.push({ error: 'This order has no file manifest.' });
  for (const f of files) {
    const p = path.join(UPLOADS, path.basename(f.file));
    if (!fs.existsSync(p)) { problems.push({ file: f.file, originalName: f.originalName, error: 'missing on server' }); continue; }
    const bytes = fs.statSync(p).size;
    if (bytes !== f.bytes) { problems.push({ file: f.file, originalName: f.originalName, error: `size ${bytes} does not match recorded ${f.bytes}` }); continue; }
    if (await sha256File(p) !== f.sha256) problems.push({ file: f.file, originalName: f.originalName, error: 'sha256 does not match recorded value' });
  }
  if (Array.isArray(received)) {
    // optional: what the bot says it received must match the manifest exactly
    const want = new Set(files.map(f => f.sha256 + ':' + f.bytes));
    const got = new Set(received.map(r => String((r || {}).sha256 || '').toLowerCase() + ':' + Number((r || {}).bytes)));
    for (const f of files) if (!got.has(f.sha256 + ':' + f.bytes)) problems.push({ file: f.file, originalName: f.originalName, error: 'not in the list of files you received' });
    for (const g of got) if (!want.has(g)) problems.push({ error: 'received a file that is not part of this order: ' + g });
  }
  return problems;
}
const orderLocks = new Set();
// Delete an order's photos after the email bot (or owner) confirms it received all of them.
async function confirmFilesReceived(id, by, received) {
  const o = loadOrder(id);
  if (o.filesDeleted) return { status: 200, body: { ok: true, already: true, orderId: o.id, filesReceivedAt: o.filesReceivedAt, manifest: manifestOf(o) } };
  if (orderLocks.has(o.id)) return { status: 409, body: { ok: false, error: 'Confirmation already in progress.' } };
  orderLocks.add(o.id);
  try {
    const problems = await verifyOrderFiles(o, received);
    if (problems.length) return { status: 409, body: { ok: false, error: 'Files did not verify. Nothing was deleted.', problems, manifest: manifestOf(o) } };
    for (const f of o.files) {
      fs.rmSync(path.join(UPLOADS, path.basename(f.file)), { force: true });
      fs.rmSync(metaPath(path.basename(f.file)), { force: true });
    }
    const now = new Date().toISOString();
    o.filesReceivedAt = now; o.filesDeleted = true; o.filesDeletedAt = now; o.filesConfirmedBy = by;
    saveOrder(o);
    return { status: 200, body: { ok: true, already: false, orderId: o.id, filesReceivedAt: now, deleted: o.files.length, manifest: manifestOf(o) } };
  } finally { orderLocks.delete(o.id); }
}
function bearerOk(req) {
  const h = String(req.headers.authorization || '');
  return !!FILES_CONFIRM_TOKEN && h.startsWith('Bearer ') && safeEq(h.slice(7).trim(), FILES_CONFIRM_TOKEN);
}
const cleanId = s => String(s || '').replace(/[^\w-]/g, '');
const orderExists = id => !!id && fs.existsSync(path.join(ORDERS, id + '.json'));
// group saved lines by their uploaded file (older orders have one file per line)
function photoGroups(items) {
  const map = new Map();
  items.forEach(i => { if (!map.has(i.file)) map.set(i.file, { file: i.file, originalName: i.originalName, photo: i.photo || 0, lines: [] }); map.get(i.file).lines.push(i); });
  return [...map.values()];
}
// Each submitted line names the uploaded file it uses (fileIndex), so one photo can be
// ordered in several sizes while the file is uploaded once. Old clients sent one file per
// line with no fileIndex; that still works.
function buildLines(files, items) {
  if (!Array.isArray(items) || !files.length || !items.length) throw new Error('Please upload at least one photo or design file.');
  if (items.length > MAX_LINES) throw new Error(`An order can have up to ${MAX_LINES} size lines. Please split it into two orders.`);
  const indexed = items.some(it => it && it.fileIndex !== undefined);
  let refs;
  if (indexed) {
    refs = items.map(it => (it || {}).fileIndex);
    if (!refs.every(n => Number.isInteger(n) && n >= 0 && n < files.length)) throw new Error('Each order line must point to one of the uploaded files.');
    if (new Set(refs).size !== files.length) throw new Error('Every uploaded file needs at least one print size.');
  } else {
    if (files.length !== items.length) throw new Error('Please upload at least one photo or design file.');
    refs = items.map((_, i) => i);
  }
  const multi = new Set(refs).size !== refs.length;
  return items.map((src, i) => {
    const f = files[refs[i]];
    const priced = priceOrderItem({ finish: (src || {}).finish, size: (src || {}).size, qty: (src || {}).qty });
    if (!priced.ok) throw new Error(priced.error);
    const line = { file: f.filename, originalName: f.originalname, finish: priced.finish, size: priced.size, qty: priced.qty, unit: priced.unit, lineTotal: priced.lineTotal, priceTBD: priced.priceTBD, quoteGap: !!priced.gap, unitText: priced.unitText || '', totalText: priced.totalText || '' };
    if (multi) { line.photo = refs[i] + 1; line.fileIndex = refs[i]; }
    return line;
  });
}
function stripeLineItems(lines, shipping) {
  const items = lines.map(l => ({ quantity: l.qty, price_data: { currency: 'usd', unit_amount: Math.round(l.unit * 100), product_data: { name: `${l.size} – ${PRICES[l.finish].label}${l.photo ? ' (Photo ' + l.photo + ')' : ''}` } } }));
  if (shipping) items.push({ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(shipping * 100), product_data: { name: 'Shipping' } } });
  return items;
}
const loadOrder = id => JSON.parse(fs.readFileSync(path.join(ORDERS, id + '.json')));
const saveOrder = o => fs.writeFileSync(path.join(ORDERS, o.id + '.json'), JSON.stringify(o, null, 2));
const allOrders = () => fs.readdirSync(ORDERS).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(ORDERS, f)))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const upload = multer({
  storage: multer.diskStorage({ destination: UPLOADS, filename: (r, f, cb) => cb(null, crypto.randomBytes(8).toString('hex') + path.extname(f.originalname).toLowerCase()) }),
  // 50 MB per file; no cap on how many photos an order can have. Files stream straight to disk.
  limits: { fileSize: 50 * 1024 * 1024, fieldSize: 5 * 1024 * 1024 },
  fileFilter: (r, f, cb) => cb(null, /^image\/|^application\/pdf$/i.test(f.mimetype))
});
const UPLOAD_ID = /^[a-f0-9]{16}(\.[a-z0-9]{1,10})?$/;
const metaPath = id => path.join(UPLOAD_META, id + '.json');
function stagedFile(id) {
  if (typeof id !== 'string' || !UPLOAD_ID.test(id)) throw new Error('A photo upload is missing. Please upload it again.');
  let m;
  try { m = JSON.parse(fs.readFileSync(metaPath(id), 'utf8')); } catch { throw new Error('A photo upload expired or is missing. Please upload it again.'); }
  if (!fs.existsSync(path.join(UPLOADS, m.file))) throw new Error('A photo upload expired or is missing. Please upload it again.');
  return { filename: m.file, originalname: m.originalName };
}
// remove photos that were uploaded but never used in an order (abandoned carts)
function cleanupStaged() {
  try {
    if (!(UPLOAD_TTL_DAYS > 0)) return;
    const used = new Set();
    for (const f of fs.readdirSync(ORDERS)) if (f.endsWith('.json')) {
      try { const o = JSON.parse(fs.readFileSync(path.join(ORDERS, f), 'utf8')); (o.items || []).forEach(i => used.add(i.file)); (o.files || []).forEach(x => used.add(x.file)); }
      catch { return; /* an unreadable order: skip cleanup entirely rather than risk its files */ }
    }
    const cutoff = Date.now() - UPLOAD_TTL_DAYS * 86400000;
    for (const f of fs.readdirSync(UPLOAD_META)) {
      if (!f.endsWith('.json')) continue;
      try {
        const m = JSON.parse(fs.readFileSync(path.join(UPLOAD_META, f), 'utf8'));
        // files that belong to an order are never removed by time, only by confirm-received
        if (m.order || used.has(m.file) || !(Date.parse(m.createdAt) <= cutoff)) continue;
        fs.rmSync(path.join(UPLOADS, path.basename(m.file)), { force: true });
        fs.rmSync(path.join(UPLOAD_META, f), { force: true });
      } catch { /* skip */ }
    }
  } catch (e) { console.error('Upload cleanup failed:', e.message); }
}

const app = express();
const PUBLIC = path.join(__dirname, 'public');
const GOOGLE_SITE_VERIFICATION = (process.env.GOOGLE_SITE_VERIFICATION || '').trim();
const escAttr = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function sendPublicHtml(file) {
  return (req, res) => {
    let html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    if (GOOGLE_SITE_VERIFICATION && !/name=["']google-site-verification["']/i.test(html)) {
      html = html.replace(/<\/head>/i, `<meta name="google-site-verification" content="${escAttr(GOOGLE_SITE_VERIFICATION)}">\n</head>`);
    }
    res.type('html').send(html);
  };
}
app.get('/robots.txt', (req, res) => res.type('text/plain').sendFile(path.join(PUBLIC, 'robots.txt')));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').sendFile(path.join(PUBLIC, 'sitemap.xml')));
app.get('/', sendPublicHtml('index.html'));
app.get('/index.html', sendPublicHtml('index.html'));
app.get('/order.html', sendPublicHtml('order.html'));
app.get('/contact.html', sendPublicHtml('contact.html'));
app.get('/success.html', sendPublicHtml('success.html'));
app.use(express.static(PUBLIC));
app.get('/api/config', (q, r) => r.json({ shippingFee: SHIPPING_FEE, demo: !stripe, stripe: !!stripe, venmoUsername: VENMO_USERNAME, xMoneyHandle: X_MONEY_HANDLE || null }));
app.post('/api/contact', express.urlencoded({ extended: false }), express.json(), (req, res) => {
  const { name, email, phone, message } = req.body || {};
  if (!name || !email || !message) return res.status(400).json({ error: 'Name, email and message are required.' });
  const m = { id: 'MSG-' + Date.now().toString(36).toUpperCase(), createdAt: new Date().toISOString(), name, email, phone: phone || '', message: String(message).slice(0, 5000) };
  fs.writeFileSync(path.join(MESSAGES, m.id + '.json'), JSON.stringify(m, null, 2));
  send({ to: OWNER_EMAIL, replyTo: email, subject: `Luma Prints message from ${name}`, text: `${name} <${email}> ${m.phone}\n\n${m.message}` });
  res.json({ ok: true });
});

// One photo per request, so big orders never become one huge upload. The order then
// refers to these uploads by id.
app.post('/api/uploads', (req, res) => {
  upload.single('photo')(req, res, err => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 50 MB or smaller.' : 'Upload failed. Please try again.' });
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'Please choose a JPG, PNG, WebP or PDF file.' });
    sha256File(f.path).then(sha256 => {
      const meta = { id: f.filename, file: f.filename, originalName: f.originalname, mimetype: f.mimetype, size: f.size, sha256, createdAt: new Date().toISOString() };
      fs.writeFileSync(metaPath(f.filename), JSON.stringify(meta));
      res.json({ id: f.filename, name: f.originalname, size: f.size, sha256 });
    }, () => res.status(500).json({ error: 'Upload failed. Please try again.' }));
  });
});

app.post('/api/orders', (req, res, next) => upload.array('photos')(req, res, err => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 50 MB or smaller.' : 'Upload failed. Please try again.' });
  next();
}), async (req, res) => {
  try {
    const b = req.body;
    const staged = b.uploads ? JSON.parse(b.uploads) : null;
    if (staged && !Array.isArray(staged)) throw new Error('Please upload at least one photo or design file.');
    const files = staged ? staged.map(stagedFile) : (req.files || []);
    const items = JSON.parse(b.items || '[]');
    if (!b.name || !b.email) throw new Error('Name and email are required.');
    const delivery = b.delivery === 'shipping' ? 'shipping' : 'pickup';
    if (delivery === 'shipping' && !b.address) throw new Error('Shipping address is required.');
    const lines = buildLines(files, items);
    const tbd = lines.some(l => l.priceTBD);
    const subtotal = +lines.reduce((s, l) => s + l.lineTotal, 0).toFixed(2);
    const shipping = delivery === 'shipping' ? SHIPPING_FEE : 0;
    const payMethod = ['venmo', 'xmoney', 'card', 'applepay'].includes(b.payMethod) ? b.payMethod : 'venmo';
    if (payMethod === 'xmoney' && !X_MONEY_HANDLE) throw new Error('X Money is not available yet.');
    if ((payMethod === 'card' || payMethod === 'applepay') && !stripe) throw new Error('Card and Apple Pay need Stripe. Choose Venmo for now.');
    const accessToken = crypto.randomBytes(24).toString('hex');
    let paymentStatus;
    if (tbd) paymentStatus = 'inquiry - price to be confirmed';
    else if (payMethod === 'venmo') paymentStatus = 'awaiting Venmo';
    else if (payMethod === 'xmoney') paymentStatus = 'awaiting X Money';
    else paymentStatus = 'pending';
    const order = { id: 'LP-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase(),
      createdAt: new Date().toISOString(), customer: { name: b.name, email: b.email, phone: b.phone || '' },
      delivery, address: delivery === 'shipping' ? b.address : '', notes: b.notes || '', items: lines, subtotal, shipping,
      total: +(subtotal + shipping).toFixed(2), payment: paymentStatus, paymentMethod: payMethod, accessToken, status: 'new' };
    // record size + sha256 of every file; files stay on disk until confirm-received
    order.files = await buildManifest(lines);
    order.filesDeleted = false;
    saveOrder(order);
    for (const f of order.files) {
      try { const mp = metaPath(f.file); if (fs.existsSync(mp)) { const m = JSON.parse(fs.readFileSync(mp, 'utf8')); m.order = order.id; fs.writeFileSync(mp, JSON.stringify(m)); } } catch { /* order JSON already protects it */ }
    }
    if (tbd) { notify(order, 'new inquiry (price to confirm)'); return res.json({ redirect: `/success.html?order=${order.id}&quote=1` }); }
    if (payMethod === 'venmo' || payMethod === 'xmoney') {
      const who = payMethod === 'venmo' ? `Venmo @${VENMO_USERNAME}` : `X Money @${X_MONEY_HANDLE}`;
      const payHint = `

CUSTOMER PAYMENT: ask them to send ${money(order.total)} via ${who}. Note/memo: ${order.id}
Success page: ${BASE_URL}/success.html?order=${order.id}&t=${accessToken}&method=${payMethod}`;
      notify(order, `new order (awaiting ${payMethod === 'venmo' ? 'Venmo' : 'X Money'})`);
      // Extra owner tip with pay link (notify already sent summary)
      send({ to: OWNER_EMAIL, replyTo: order.customer.email, subject: `Pay instructions for ${order.id}`,
        text: `Customer should pay ${money(order.total)} via ${who}.
Note: ${order.id}${payHint}` });
      return res.json({ redirect: `/success.html?order=${order.id}&t=${accessToken}&method=${payMethod}` });
    }
    const line_items = stripeLineItems(lines, shipping);
    const session = await stripe.checkout.sessions.create({ mode: 'payment', line_items, customer_email: order.customer.email,
      client_reference_id: order.id, metadata: { orderId: order.id },
      success_url: `${BASE_URL}/api/stripe/return?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${BASE_URL}/order.html?canceled=1` });
    order.stripeSession = session.id; saveOrder(order); notify(order, 'awaiting Stripe payment');
    res.json({ redirect: session.url });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/stripe/return', async (req, res) => {
  try {
    const s = await stripe.checkout.sessions.retrieve(req.query.session_id);
    const o = loadOrder(s.metadata.orderId);
    if (s.payment_status === 'paid' && o.payment !== 'paid') { o.payment = 'paid'; saveOrder(o); notify(o, 'PAID'); }
    res.redirect(`/success.html?order=${o.id}`);
  } catch (e) { res.redirect('/success.html'); }
});

app.get('/api/orders/:id', (req, res) => {
  try {
    const id = req.params.id.replace(/[^\w-]/g, '');
    const o = loadOrder(id);
    const t = String(req.query.t || '');
    if (!o.accessToken || t !== o.accessToken) return res.status(403).json({ error: 'Invalid or missing link.' });
    res.json({ id: o.id, total: o.total, totalLabel: money(o.total), payment: o.payment, paymentMethod: o.paymentMethod || 'venmo',
      venmoUsername: VENMO_USERNAME, xMoneyHandle: X_MONEY_HANDLE || null });
  } catch { res.status(404).json({ error: 'Order not found.' }); }
});
app.post('/api/orders/:id/paid', express.json(), async (req, res) => {
  try {
    const id = req.params.id.replace(/[^\w-]/g, '');
    const o = loadOrder(id);
    const t = String((req.body && req.body.t) || '');
    if (!o.accessToken || t !== o.accessToken) return res.status(403).json({ error: 'Invalid or missing link.' });
    if (o.payment === 'paid' || (o.stripeSession && o.payment === 'paid')) return res.status(400).json({ error: 'This order is already paid via Stripe.' });
    if (String(o.payment).includes('customer reported')) return res.json({ ok: true, already: true });
    const method = (req.body && req.body.method) || o.paymentMethod || 'venmo';
    const label = method === 'xmoney' ? 'paid - X Money (customer reported)' : 'paid - Venmo (customer reported)';
    o.payment = label; o.customerReportedPaidAt = new Date().toISOString();
    saveOrder(o);
    await send({ to: OWNER_EMAIL, replyTo: o.customer.email, subject: `Customer reported paid: ${o.id} (${money(o.total)})`,
      text: summary(o) + `\n\nCustomer tapped "I've paid" (${label}). Verify in your Venmo/X Money app before printing.\nAdmin: ${BASE_URL}/admin` });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message || 'Could not update order.' }); }
});

// ---- email bot: confirm all files received, then delete them from the website ----
// API: POST /api/orders/:id/confirm-received with "Authorization: Bearer FILES_CONFIRM_TOKEN"
// (or the signed "sig" from the order email). Optional JSON body { received: [{ sha256, bytes }] }.
app.get('/api/orders/:id/manifest', (req, res) => {
  const id = cleanId(req.params.id);
  if (!orderExists(id)) return res.status(404).json({ error: 'Order not found.' });
  if (!bearerOk(req) && !(FILES_CONFIRM_TOKEN && safeEq(req.query.sig, confirmSig(id)))) return res.status(401).json({ error: 'Not authorized.' });
  const o = loadOrder(id);
  res.json({ orderId: o.id, filesDeleted: !!o.filesDeleted, filesReceivedAt: o.filesReceivedAt || null, manifest: manifestOf(o) });
});
app.post('/api/orders/:id/confirm-received', express.json(), express.urlencoded({ extended: false }), async (req, res) => {
  const id = cleanId(req.params.id);
  if (!FILES_CONFIRM_TOKEN) return res.status(503).json({ error: 'Confirm is disabled: set FILES_CONFIRM_TOKEN.' });
  const viaBearer = bearerOk(req), viaSig = orderExists(id) && safeEq((req.body || {}).sig, confirmSig(id));
  if (!viaBearer && !viaSig) return res.status(401).json({ error: 'Not authorized.' });
  if (!orderExists(id)) return res.status(404).json({ error: 'Order not found.' });
  let received = (req.body || {}).received;
  if (typeof received === 'string') { try { received = JSON.parse(received); } catch { return res.status(400).json({ error: 'received must be a JSON list.' }); } }
  try {
    const r = await confirmFilesReceived(id, viaBearer ? 'email bot (API)' : 'confirm link', received);
    if (!viaBearer && req.is('application/x-www-form-urlencoded')) return res.status(r.status).type('html').send(confirmPage(loadOrder(id), null, r.body));
    res.status(r.status).json(r.body);
  } catch (e) { res.status(500).json({ error: 'Could not confirm: ' + e.message }); }
});
function confirmPage(o, sig, result) {
  const m = manifestOf(o);
  const rows = m.map((f, i) => `<tr><td>${i + 1}</td><td>${esc(f.originalName)}</td><td>${f.bytes.toLocaleString()} bytes</td><td><code style="font-size:.72em;word-break:break-all">${esc(f.sha256)}</code></td></tr>`).join('');
  let body;
  if (result && result.ok) body = `<p class="banner">${result.already ? 'Already confirmed' : 'Confirmed'}: all ${m.length} file(s) were received, and they have been deleted from the website.</p>`;
  else if (result) body = `<p class="banner">${esc(result.error)}</p><ul>${(result.problems || []).map(p => `<li>${esc(p.originalName || '')} ${esc(p.error)}</li>`).join('')}</ul>`;
  else if (o.filesDeleted) body = `<p class="banner">Files were already confirmed received on ${esc(new Date(o.filesReceivedAt).toLocaleString())} and deleted from the website.</p>`;
  else body = `<p>Check that you received every file below. Confirming deletes them from the website. The order record stays.</p>
    <form method="post" action="/api/orders/${esc(o.id)}/confirm-received"><input type="hidden" name="sig" value="${esc(sig)}"><button class="btn" type="submit">Confirm all ${m.length} file(s) received</button></form>`;
  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Confirm files · ${esc(o.id)}</title><link rel=stylesheet href="/style.css">
  <main class="wrap" style="padding:32px 22px"><h1 style="font-size:2rem">Order ${esc(o.id)} files</h1>${body}
  <table style="width:100%;border-collapse:collapse;margin-top:18px;font-size:.9rem"><tr><th align=left>#</th><th align=left>File</th><th align=left>Size</th><th align=left>sha256</th></tr>${rows}</table></main>`;
}
// GET only shows the page; deleting needs the POST button (link scanners only GET).
app.get('/orders/:id/confirm-received', (req, res) => {
  const id = cleanId(req.params.id);
  if (!FILES_CONFIRM_TOKEN || !orderExists(id) || !safeEq(req.query.sig, confirmSig(id))) return res.status(404).send('Link not valid.');
  res.set('Cache-Control', 'no-store').type('html').send(confirmPage(loadOrder(id), String(req.query.sig)));
});
// signed download link for files too big to attach to the owner email
app.get('/files/:id/:f', (req, res) => {
  const id = cleanId(req.params.id), f = path.basename(req.params.f);
  if (!FILES_CONFIRM_TOKEN || !orderExists(id) || !safeEq(req.query.sig, fileSig(id, f))) return res.status(404).send('Link not valid.');
  const o = loadOrder(id), entry = (o.files || []).find(x => x.file === f);
  if (!entry) return res.status(404).send('Link not valid.');
  const p = path.join(UPLOADS, f);
  if (o.filesDeleted || !fs.existsSync(p)) return res.status(410).send(o.filesDeleted ? `This file was confirmed received on ${new Date(o.filesReceivedAt).toLocaleString()} and has been deleted from the website.` : 'This file is missing from the website.');
  res.download(p, entry.originalName);
});

// ---- admin (HTTP Basic auth) ----
function auth(req, res, next) {
  const [u, p] = Buffer.from((req.headers.authorization || '').split(' ')[1] || '', 'base64').toString().split(':');
  if (!ADMIN_PASSWORD) return res.status(503).send('Admin disabled: set the ADMIN_PASSWORD environment variable.');
  if (p === ADMIN_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="Luma Prints Admin"').status(401).send('Authentication required');
}
function diskUsage() {
  let uploadBytes = 0, uploadCount = 0;
  for (const f of fs.readdirSync(UPLOADS)) { try { uploadBytes += fs.statSync(path.join(UPLOADS, f)).size; uploadCount++; } catch { /* gone */ } }
  let total = null, free = null;
  try { const s = fs.statfsSync(DATA); total = s.blocks * s.bsize; free = s.bavail * s.bsize; } catch { /* not supported */ }
  return { uploadBytes, uploadCount, total, free };
}
const mb = n => n == null ? '?' : (n / 1048576).toFixed(n < 10485760 ? 2 : 0) + ' MB';
const heldBytes = o => (o.files || []).reduce((s, f) => s + (f.bytes || 0), 0);
app.get('/admin', auth, (req, res) => {
  const orders = allOrders();
  const du = diskUsage();
  const holding = orders.filter(o => !o.filesDeleted);
  const diskCard = `<div class="card"><b>Disk</b><p>Photos on disk: <b>${du.uploadCount}</b> files, <b>${mb(du.uploadBytes)}</b>${du.total ? ` · Disk free: <b>${mb(du.free)}</b> of ${mb(du.total)} (${Math.round(100 - du.free / du.total * 100)}% used)` : ''}</p>
   <p>Orders still holding files: <b>${holding.length}</b></p>${holding.length ? `<ul>${holding.map(o => `<li><a href="#${esc(o.id)}">${esc(o.id)}</a> · ${esc(o.customer.name)} · ${(o.files || []).length || o.items.length} file(s) · ${mb(heldBytes(o))} · since ${new Date(o.createdAt).toLocaleString()}</li>`).join('')}</ul>` : ''}</div>`;
  const rows = orders.map(o => `<div class="card" id="${esc(o.id)}"><div class="hd"><b>${esc(o.id)}</b> <span>${new Date(o.createdAt).toLocaleString()}</span>
   <span class="pill ${o.payment === 'paid' ? 'ok' : 'warn'}">${esc(o.payment)}</span>
   <span class="pill ${o.filesDeleted ? 'ok' : 'warn'}">${o.filesDeleted ? 'Received &amp; deleted ' + esc(new Date(o.filesReceivedAt).toLocaleString()) : 'Files held'}</span></div>
   <p>${esc(o.customer.name)} · <a href="mailto:${esc(o.customer.email)}">${esc(o.customer.email)}</a> · ${esc(o.customer.phone)}<br>
   <b>${o.delivery === 'shipping' ? 'Ship to:' : 'Pickup'}</b> ${esc(o.address)} ${o.notes ? '<br><i>Notes: ' + esc(o.notes) + '</i>' : ''}</p>
   <ul>${o.items.map(i => `<li>${i.photo ? '<b>Photo ' + esc(i.photo) + '</b> · ' : ''}${i.qty} × ${i.size} <i>${esc(i.finish)}</i> — ${o.filesDeleted ? esc(i.originalName) + ' <span class="mute">(file deleted after confirmed received)</span>' : `<a href="/admin/file/${esc(i.file)}" download="${esc(i.originalName)}">${esc(i.originalName)}</a>`} (${i.priceTBD ? '[price TBD]' : '$' + i.lineTotal.toFixed(2)})</li>`).join('')}</ul>
   ${!o.filesDeleted && (o.files || []).length ? `<form method="post" action="/admin/orders/${esc(o.id)}/confirm-received" onsubmit="return confirm('Delete this order\'s ${o.files.length} file(s) from the website? Only do this after they were received.')"><button>Confirm files received &amp; delete from website</button></form>` : ''}
   <p>Total: <b>$${o.total.toFixed(2)}</b></p>
   <form method="post" action="/admin/orders/${esc(o.id)}/status"><select name="status">${['new', 'printing', 'ready', 'shipped', 'completed'].map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
   <label><input type="checkbox" name="paid" ${o.payment === 'paid' ? 'checked' : ''}> paid</label> <button>Update</button></form></div>`).join('') || '<p>No orders yet.</p>';
  const msgs = fs.readdirSync(MESSAGES).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(MESSAGES, f)))).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(m => `<div class="card"><b>${esc(m.name)}</b> · <a href="mailto:${esc(m.email)}">${esc(m.email)}</a> ${esc(m.phone)} · ${new Date(m.createdAt).toLocaleString()}<p style="white-space:pre-wrap">${esc(m.message)}</p></div>`).join('') || '<p>No messages yet.</p>';
  res.send(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Admin · Luma Prints</title><link rel=stylesheet href="/style.css">
  <style>.card{background:#fff;border-radius:12px;padding:16px;margin:12px 0;box-shadow:0 2px 8px #0001}.hd{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.pill{padding:2px 10px;border-radius:99px;font-size:.8em}.ok{background:#d1fae5}.warn{background:#fee2e2}.card a{color:#8a5a3b}</style>
  <main class="wrap"><h1>Orders</h1>${diskCard}${rows}<h1>Contact messages</h1>${msgs}</main>`);
});
app.post('/admin/orders/:id/status', auth, express.urlencoded({ extended: false }), (req, res) => {
  const o = loadOrder(req.params.id.replace(/[^\w-]/g, ''));
  o.status = req.body.status || o.status;
  if (req.body.paid) o.payment = 'paid'; else if (o.payment === 'paid') o.payment = 'unpaid';
  saveOrder(o); res.redirect('/admin');
});
app.post('/admin/orders/:id/confirm-received', auth, async (req, res) => {
  const id = cleanId(req.params.id);
  if (!orderExists(id)) return res.status(404).send('Order not found.');
  const r = await confirmFilesReceived(id, 'admin');
  if (r.status !== 200) return res.status(r.status).type('html').send(confirmPage(loadOrder(id), null, r.body));
  res.redirect('/admin#' + id);
});
app.get('/admin/file/:f', auth, (req, res) => {
  const f = path.basename(req.params.f), p = path.join(UPLOADS, f);
  if (fs.existsSync(p)) return res.download(p);
  const o = allOrders().find(x => (x.files || []).some(y => y.file === f) || x.items.some(i => i.file === f));
  if (o && o.filesDeleted) return res.status(410).send(`This file (order ${esc(o.id)}) was confirmed received on ${esc(new Date(o.filesReceivedAt).toLocaleString())} and has been deleted from the website.`);
  res.status(404).send('File not found.');
});

if (require.main === module) {
  cleanupStaged();
  setInterval(cleanupStaged, 6 * 3600000).unref();
  app.listen(PORT, '0.0.0.0', () => console.log(`Luma Prints on ${BASE_URL} ${stripe ? '(Stripe live/test key loaded)' : '(DEMO MODE: no STRIPE_SECRET_KEY, orders saved as unpaid)'}`));
}
module.exports = { app, buildLines, stripeLineItems, photoGroups, summary, cleanupStaged, manifestText, confirmSig, fileSig };
