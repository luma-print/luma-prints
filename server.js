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
const MESSAGES = path.join(DATA, 'messages'); fs.mkdirSync(MESSAGES, { recursive: true });
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

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
const itemLine = i => `${i.qty} x ${i.size} ${i.finish} – ${i.originalName} – ${i.priceTBD ? 'price TBD' : money(i.lineTotal)}`;
const summary = o => `Order: ${o.id}\nCustomer: ${o.customer.name}\nEmail: ${o.customer.email}\nPhone: ${o.customer.phone || '-'}\n` +
  `Delivery: ${o.delivery === 'shipping' ? 'SHIPPING to:\n' + o.address : 'PICKUP'}\n${o.notes ? 'Notes: ' + o.notes + '\n' : ''}\nItems:\n` +
  o.items.map(itemLine).join('\n') + `\n\nSubtotal: ${money(o.subtotal)}\nShipping: ${money(o.shipping)}\nTotal: ${money(o.total)}\nPayment: ${o.payment}`;
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
  for (const i of order.items) {
    const p = path.join(UPLOADS, i.file), size = fs.statSync(p).size;
    if (used + size <= MAX_ATTACH) { used += size; attachments.push({ filename: `${i.qty}x_${i.size}_${i.finish}_${i.originalName}`, path: p }); }
    else links.push(`${i.originalName}: ${BASE_URL}/admin/file/${i.file}`);
  }
  const extra = links.length ? `\n\nNot attached (over ${MAX_ATTACH / 1048576} MB) – download from admin (password required):\n${links.join('\n')}` : '';
  await send({ to: OWNER_EMAIL, replyTo: order.customer.email, subject: `New Luma Prints order ${order.id} – ${order.customer.name} – ${money(order.total)} (${why})`,
    text: summary(order) + extra + `\n\nAll orders: ${BASE_URL}/admin`, attachments });
  await send({ to: order.customer.email, replyTo: OWNER_EMAIL, subject: `We received your Luma Prints order ${order.id}`,
    text: `Hi ${order.customer.name},\n\nThank you for your order! Here is a summary:\n\n` + summary(order) +
      `\n\n${order.payment === 'pending' ? 'Once your payment is complete we will start printing.' : order.payment === 'paid' ? 'Your payment is confirmed.' : 'We will contact you to arrange payment.'}\nQuestions? Just reply to this email.\n\nLuma Prints` });
}
const loadOrder = id => JSON.parse(fs.readFileSync(path.join(ORDERS, id + '.json')));
const saveOrder = o => fs.writeFileSync(path.join(ORDERS, o.id + '.json'), JSON.stringify(o, null, 2));
const allOrders = () => fs.readdirSync(ORDERS).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(ORDERS, f)))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const upload = multer({
  storage: multer.diskStorage({ destination: UPLOADS, filename: (r, f, cb) => cb(null, crypto.randomBytes(8).toString('hex') + path.extname(f.originalname).toLowerCase()) }),
  limits: { fileSize: 50 * 1024 * 1024, files: 100 },
  fileFilter: (r, f, cb) => cb(null, /^image\//.test(f.mimetype))
});

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/config', (q, r) => r.json({ shippingFee: SHIPPING_FEE, demo: !stripe }));
app.post('/api/contact', express.urlencoded({ extended: false }), express.json(), (req, res) => {
  const { name, email, phone, message } = req.body || {};
  if (!name || !email || !message) return res.status(400).json({ error: 'Name, email and message are required.' });
  const m = { id: 'MSG-' + Date.now().toString(36).toUpperCase(), createdAt: new Date().toISOString(), name, email, phone: phone || '', message: String(message).slice(0, 5000) };
  fs.writeFileSync(path.join(MESSAGES, m.id + '.json'), JSON.stringify(m, null, 2));
  send({ to: OWNER_EMAIL, replyTo: email, subject: `Luma Prints message from ${name}`, text: `${name} <${email}> ${m.phone}\n\n${m.message}` });
  res.json({ ok: true });
});

app.post('/api/orders', upload.array('photos'), async (req, res) => {
  try {
    const b = req.body, files = req.files || [];
    const items = JSON.parse(b.items || '[]');
    if (!files.length || files.length !== items.length) throw new Error('Please upload at least one photo.');
    if (!b.name || !b.email) throw new Error('Name and email are required.');
    const delivery = b.delivery === 'shipping' ? 'shipping' : 'pickup';
    if (delivery === 'shipping' && !b.address) throw new Error('Shipping address is required.');
    const lines = files.map((f, i) => {
      const finish = items[i].finish || 'standard', size = items[i].size, qty = Math.max(1, Math.min(999, parseInt(items[i].qty) || 1));
      if (!PRICES[finish] || !(size in PRICES[finish].sizes)) throw new Error('Invalid size/finish');
      const unit = PRICES[finish].sizes[size];
      return { file: f.filename, originalName: f.originalname, finish, size, qty, unit, lineTotal: unit == null ? 0 : +(unit * qty).toFixed(2), priceTBD: unit == null };
    });
    const tbd = lines.some(l => l.priceTBD);
    const subtotal = +lines.reduce((s, l) => s + l.lineTotal, 0).toFixed(2);
    const shipping = delivery === 'shipping' ? SHIPPING_FEE : 0;
    const order = { id: 'LP-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase(),
      createdAt: new Date().toISOString(), customer: { name: b.name, email: b.email, phone: b.phone || '' },
      delivery, address: delivery === 'shipping' ? b.address : '', notes: b.notes || '', items: lines, subtotal, shipping,
      total: +(subtotal + shipping).toFixed(2), payment: tbd ? 'inquiry - price to be confirmed' : stripe ? 'pending' : 'unpaid - payment pending (demo mode)', status: 'new' };
    saveOrder(order);
    if (tbd) { notify(order, 'new inquiry (price to confirm)'); return res.json({ redirect: `/success.html?order=${order.id}&quote=1` }); }
    if (!stripe) { notify(order, 'new order (unpaid, demo mode)'); return res.json({ redirect: `/success.html?order=${order.id}&demo=1` }); }
    const line_items = lines.map(l => ({ quantity: l.qty, price_data: { currency: 'usd', unit_amount: Math.round(l.unit * 100), product_data: { name: `${l.size} ${PRICES[l.finish].label}` } } }));
    if (shipping) line_items.push({ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(shipping * 100), product_data: { name: 'Shipping' } } });
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

// ---- admin (HTTP Basic auth) ----
function auth(req, res, next) {
  const [u, p] = Buffer.from((req.headers.authorization || '').split(' ')[1] || '', 'base64').toString().split(':');
  if (!ADMIN_PASSWORD) return res.status(503).send('Admin disabled: set the ADMIN_PASSWORD environment variable.');
  if (p === ADMIN_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="Luma Prints Admin"').status(401).send('Authentication required');
}
app.get('/admin', auth, (req, res) => {
  const rows = allOrders().map(o => `<div class="card"><div class="hd"><b>${esc(o.id)}</b> <span>${new Date(o.createdAt).toLocaleString()}</span>
   <span class="pill ${o.payment === 'paid' ? 'ok' : 'warn'}">${esc(o.payment)}</span></div>
   <p>${esc(o.customer.name)} · <a href="mailto:${esc(o.customer.email)}">${esc(o.customer.email)}</a> · ${esc(o.customer.phone)}<br>
   <b>${o.delivery === 'shipping' ? 'Ship to:' : 'Pickup'}</b> ${esc(o.address)} ${o.notes ? '<br><i>Notes: ' + esc(o.notes) + '</i>' : ''}</p>
   <ul>${o.items.map(i => `<li>${i.qty} × ${i.size} <i>${esc(i.finish)}</i> — <a href="/admin/file/${esc(i.file)}" download="${esc(i.originalName)}">${esc(i.originalName)}</a> (${i.priceTBD ? '[price TBD]' : '$' + i.lineTotal.toFixed(2)})</li>`).join('')}</ul>
   <p>Total: <b>$${o.total.toFixed(2)}</b></p>
   <form method="post" action="/admin/orders/${esc(o.id)}/status"><select name="status">${['new', 'printing', 'ready', 'shipped', 'completed'].map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
   <label><input type="checkbox" name="paid" ${o.payment === 'paid' ? 'checked' : ''}> paid</label> <button>Update</button></form></div>`).join('') || '<p>No orders yet.</p>';
  const msgs = fs.readdirSync(MESSAGES).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(MESSAGES, f)))).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(m => `<div class="card"><b>${esc(m.name)}</b> · <a href="mailto:${esc(m.email)}">${esc(m.email)}</a> ${esc(m.phone)} · ${new Date(m.createdAt).toLocaleString()}<p style="white-space:pre-wrap">${esc(m.message)}</p></div>`).join('') || '<p>No messages yet.</p>';
  res.send(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Admin · Luma Prints</title><link rel=stylesheet href="/style.css">
  <style>.card{background:#fff;border-radius:12px;padding:16px;margin:12px 0;box-shadow:0 2px 8px #0001}.hd{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.pill{padding:2px 10px;border-radius:99px;font-size:.8em}.ok{background:#d1fae5}.warn{background:#fee2e2}.card a{color:#8a5a3b}</style>
  <main class="wrap"><h1>Orders</h1>${rows}<h1>Contact messages</h1>${msgs}</main>`);
});
app.post('/admin/orders/:id/status', auth, express.urlencoded({ extended: false }), (req, res) => {
  const o = loadOrder(req.params.id.replace(/[^\w-]/g, ''));
  o.status = req.body.status || o.status;
  if (req.body.paid) o.payment = 'paid'; else if (o.payment === 'paid') o.payment = 'unpaid';
  saveOrder(o); res.redirect('/admin');
});
app.get('/admin/file/:f', auth, (req, res) => res.download(path.join(UPLOADS, path.basename(req.params.f))));

app.listen(PORT, '0.0.0.0', () => console.log(`Luma Prints on ${BASE_URL} ${stripe ? '(Stripe live/test key loaded)' : '(DEMO MODE: no STRIPE_SECRET_KEY, orders saved as unpaid)'}`));
