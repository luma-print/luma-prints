let cfg, list = [], sel = 0, nextSrc = 1;
const $ = s => document.querySelector(s);
const P = LUMA_PRICES, PR = LUMA_PRODUCTS, RP = LUMA_PRICING;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const types = { photo: 1, invitations: 1, flyers: 1 };
const params = new URLSearchParams(location.search);
let defType = (params.get('type') || 'photo').toLowerCase();
if (!types[defType]) defType = 'photo';
const urlFinish = params.get('finish') || '';
const urlSize = params.get('size') || '';
const PDF_SVG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="72" height="72" rx="12" fill="#F3EDE4"/><path d="M24 14h18l10 10v34H24z" fill="#fff" stroke="#6E6861" stroke-width="2"/><path d="M42 14v10h10" fill="none" stroke="#6E6861" stroke-width="2"/><rect x="18" y="38" width="30" height="13" rx="3" fill="#1F4E3D"/><text x="33" y="48" font-family="Arial,sans-serif" font-size="9" font-weight="700" fill="#fff" text-anchor="middle">PDF</text></svg>');
const keyOf = it => PR[it.type].keys[it.fin];
const pretty = s => String(s || '').replace(/(\d+)x(\d+)/g, '$1×$2');
const fmt = (k, s) => { const v = P[k].sizes[s]; if (v != null) return '$' + v.toFixed(2); return (P[k].displayRates && P[k].displayRates[s]) || 'Quote'; };
const finsOf = t => Object.keys(PR[t].keys);
function defaultFin(t) {
  const fins = finsOf(t);
  if (fins.includes(urlFinish)) return urlFinish;
  if (t === 'photo' && fins.includes('Matte')) return 'Matte';
  return fins[0];
}
function sizesOf(t, fin) { return Object.keys(P[PR[t].keys[fin]].sizes); }
function defaultSize(t, fin) {
  if (t === 'flyers') return RP.describeFlyer(P.flyers.minQty).size;
  const sizes = sizesOf(t, fin);
  if (sizes.includes(urlSize)) return urlSize;
  if (t === 'photo' && sizes.includes('4x6')) return '4x6';
  return sizes[0];
}
const pending = { fin: defaultFin(defType), size: defaultSize(defType, defaultFin(defType)), qty: defType === 'flyers' ? P.flyers.minQty : 1 };
let studioMode = '';

const pp = $('#prodpick');
function renderPick() {
  pp.innerHTML = '<span class="mute" style="align-self:center;font-size:.88rem;margin-right:4px">New uploads:</span>' + Object.entries(PR).map(([k, v]) => `<button type="button" class="btn sm ${k === defType ? '' : 'ghost'}" data-t="${k}" aria-pressed="${k === defType}">${esc(v.label)}</button>`).join('');
  pp.querySelectorAll('button').forEach(b => b.onclick = () => {
    defType = b.dataset.t;
    pending.fin = defaultFin(defType);
    pending.size = defaultSize(defType, pending.fin);
    if (defType === 'flyers' && !(pending.qty >= P.flyers.minQty)) pending.qty = P.flyers.minQty;
    if (defType !== 'flyers') pending.qty = 1;
    renderPick();
    studioMode = '';
    renderStudio(true);
    updatePreview();
  });
}
renderPick();

fetch('/api/config').then(r => r.json()).then(c => {
  cfg = c;
  $('#sf').textContent = c.shippingFee.toFixed(2);
  $('#demo').hidden = !c.demo;
  const xm = $('#pay-xmoney'), xn = $('#xmoney-note');
  if (c.xMoneyHandle) { xm.disabled = false; xn.textContent = '@' + c.xMoneyHandle; } else { xm.disabled = true; xn.textContent = 'coming soon'; }
  if (c.stripe) { $('#pay-card').disabled = false; $('#pay-apple').disabled = false; }
  else { $('#pay-card').parentElement.querySelector('small').textContent = 'Not available yet'; $('#pay-apple').parentElement.querySelector('small').textContent = 'Not available yet'; }
  render();
}).catch(() => { cfg = { shippingFee: 5, demo: true, stripe: false, xMoneyHandle: null }; render(); });
if (location.search.includes('canceled')) $('#cancel').hidden = false;

function applyProduct(it, t) {
  it.qtyByType = it.qtyByType || {};
  it.finByType = it.finByType || {};
  if (it.type) { it.qtyByType[it.type] = it.qty; it.finByType[it.type] = it.fin; }
  it.type = t;
  const fins = finsOf(t);
  it.fin = fins.includes(it.finByType[t]) ? it.finByType[t] : (fins.includes(it.fin) ? it.fin : fins[0]);
  const remembered = it.qtyByType[t];
  if (t === 'flyers') {
    const q = Number.isInteger(remembered) ? remembered : it.qty;
    const d = RP.describeFlyer(q);
    it.qty = d.ok ? q : P.flyers.minQty;
    const priced = RP.describeFlyer(it.qty);
    it.size = priced.ok ? priced.size : 'Custom quantity (quote)';
  } else {
    const q = Number.isInteger(remembered) ? remembered : it.qty;
    it.qty = Number.isInteger(q) && q >= 1 && q <= 999 ? q : 1;
    const sizes = sizesOf(t, it.fin);
    if (!sizes.includes(it.size)) it.size = t === 'photo' && sizes.includes('4x6') ? '4x6' : sizes[0];
  }
}

// Every line points at one uploaded file (it.src). Extra sizes of the same photo are
// separate lines that share that file, so the file is uploaded only once.
const linesOf = src => list.filter(it => it.src === src);
const uniqueSources = () => { const seen = new Map(); list.forEach(it => { if (!seen.has(it.src)) seen.set(it.src, it); }); return [...seen.values()]; };
function nextFreeSize(it) {
  const sizes = sizesOf(it.type, it.fin);
  const used = new Set(linesOf(it.src).filter(o => o.type === it.type && o.fin === it.fin).map(o => o.size));
  const start = Math.max(0, sizes.indexOf(it.size));
  for (let k = 1; k <= sizes.length; k++) { const s = sizes[(start + k) % sizes.length]; if (!used.has(s)) return s; }
  return it.size;
}
function addSizeLine(i) {
  const base = list[i];
  if (!base || base.type === 'flyers') return;
  const copy = { file: base.file, src: base.src, url: base.url, pdf: base.pdf, type: base.type, fin: base.fin, size: base.size, qty: 1, qtyByType: {}, finByType: {} };
  copy.size = nextFreeSize(base);
  const group = linesOf(base.src);
  const at = list.indexOf(group[group.length - 1]) + 1;
  list.splice(at, 0, copy);
  sel = at;
  pending.size = copy.size;
  studioMode = '';
  render();
  const el = document.querySelectorAll('.item')[at];
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
const UPLOAD_PARALLEL = 3;
const uploadIds = new Map(); // photo src -> server upload id
async function uploadOne(it) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = new FormData();
      fd.append('photo', it.file, it.file.name);
      const r = await fetch('/api/uploads', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.id) { uploadIds.set(it.src, j.id); return; }
      last = new Error(j.error || 'Upload failed.');
      if (r.status === 413 || r.status === 400) break;
    } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
  }
  throw new Error(`"${it.file.name}" didn't upload (${last && last.message ? last.message : 'network error'}). Your other photos are saved — tap the button again to retry.`);
}
async function uploadAll(srcs) {
  const todo = srcs.filter(it => !uploadIds.has(it.src));
  const doneBefore = srcs.length - todo.length;
  let done = 0, failed = null;
  const show = () => { $('#pay').textContent = `Uploading ${Math.min(doneBefore + done + 1, srcs.length)} of ${srcs.length}…`; };
  show();
  let next = 0;
  async function worker() {
    while (next < todo.length && !failed) {
      const it = todo[next++];
      try { await uploadOne(it); done++; show(); } catch (e) { failed = failed || e; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(UPLOAD_PARALLEL, todo.length) }, worker));
  if (failed) throw failed;
}
const add = files => {
  [...files].filter(f => f.type.startsWith('image/') || f.type === 'application/pdf').forEach(f => {
    const it = { file: f, src: nextSrc++, type: '', qty: pending.qty, fin: pending.fin, size: pending.size, qtyByType: {}, finByType: {}, pdf: f.type === 'application/pdf' };
    it.url = it.pdf ? PDF_SVG : URL.createObjectURL(f);
    applyProduct(it, defType);
    if (defType !== 'flyers') {
      const sizes = sizesOf(defType, it.fin);
      if (sizes.includes(pending.size)) it.size = pending.size;
      it.fin = finsOf(defType).includes(pending.fin) ? pending.fin : it.fin;
    }
    list.push(it);
    sel = list.length - 1;
  });
  render();
};
$('#files').onchange = e => { add(e.target.files); e.target.value = ''; };
const d = $('#drop');
d.ondragover = e => { e.preventDefault(); d.classList.add('over'); };
d.ondragleave = () => d.classList.remove('over');
d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); add(e.dataTransfer.files); };

const ship = () => $('[name=delivery]:checked').value === 'shipping';
document.querySelectorAll('[name=delivery]').forEach(r => r.onchange = () => { $('#addr').hidden = !ship(); $('#addr').required = ship(); total(); });
const payMethod = () => ($('[name=payMethod]:checked') || {}).value || 'venmo';
const active = () => list[sel] || null;
function ctx() {
  const it = active();
  if (it) return { type: it.type, fin: it.fin, size: it.size, qty: it.qty, item: it };
  return { type: defType, fin: pending.fin, size: pending.size, qty: pending.qty, item: null };
}
function setCtxSize(size) {
  const it = active();
  if (it && it.type !== 'flyers') { it.size = size; pending.size = size; }
  else if (!it && defType !== 'flyers') pending.size = size;
  syncSizePressed();
  updatePreview();
  total();
}
function setCtxFin(fin) {
  const it = active();
  if (it) {
    if (!finsOf(it.type).includes(fin)) return;
    it.fin = fin;
    if (it.type !== 'flyers' && !sizesOf(it.type, fin).includes(it.size)) it.size = defaultSize(it.type, fin);
  } else {
    pending.fin = fin;
    if (defType !== 'flyers' && !sizesOf(defType, fin).includes(pending.size)) pending.size = defaultSize(defType, fin);
  }
  render();
}

function sizeButtons(type, fin, current) {
  const k = PR[type].keys[fin];
  const pack = !!P[k].pack;
  return `<div class="size-picker${pack ? ' packs' : ''}" role="radiogroup" aria-label="${pack ? 'Pack' : 'Print size'}">${Object.keys(P[k].sizes).map(s => {
    const on = s === current;
    return `<button type="button" class="size-opt" role="radio" data-size="${esc(s)}" aria-checked="${on}" aria-pressed="${on}"><span>${esc(pretty(s))}</span><small>${esc(fmt(k, s))}</small></button>`;
  }).join('')}</div>`;
}
function flyerCard(qty, withInput) {
  const d = RP.describeFlyer(qty);
  const rootId = withInput ? ' id="flyer-quote"' : '';
  const copyId = withInput ? ' id="flyer-quote-copy"' : '';
  const input = withInput ? `<label class="f" for="pending-flyer-qty">Quantity <span class="mute">minimum ${P.flyers.minQty}</span></label><input id="pending-flyer-qty" class="flyer-qty" type="number" inputmode="numeric" min="${P.flyers.minQty}" max="${P.flyers.maxQty}" step="1" value="${Number.isInteger(qty) ? qty : ''}" aria-describedby="flyer-quote-copy">` : '';
  if (!d.ok) {
    return `<div class="flyer-card"${rootId}>${input}<p class="flyer-unit">Unit <b>Minimum ${P.flyers.minQty}</b></p><p class="flyer-total">Total <b>Not available</b></p><p class="flyer-note field-error"${copyId}>${esc(d.error)}</p></div>`;
  }
  return `<div class="flyer-card"${rootId}>${input}
    <p class="flyer-kicker">${esc(d.gap ? 'Outside published tiers' : d.size)}</p>
    <p class="flyer-unit">Unit <b>${esc(d.unitText)}</b></p>
    <p class="flyer-total">Total <b>${esc(d.totalText)}</b></p>
    <p class="flyer-note flyer-range"${copyId}>${esc(d.rangeText || d.detail)}</p>
  </div>`;
}
function bindSizeGroup(root, onPick) {
  if (!root) return;
  root.querySelectorAll('.size-opt').forEach(b => b.onclick = () => onPick(b.dataset.size));
}
function renderStudio(force) {
  const c = ctx();
  const host = $('#studio-size');
  if (!host) return;
  const mode = c.type + ':' + (c.item ? 'item' + sel : 'pending') + ':' + c.fin;
  if (force || studioMode !== mode) {
    studioMode = mode;
    const fins = finsOf(c.type);
    const finTog = fins.length > 1 ? `<div class="finish-tog" role="group" aria-label="Finish">${fins.map(f => `<button type="button" data-fin="${esc(f)}" aria-pressed="${f === c.fin}">${esc(f)}</button>`).join('')}</div>` : '';
    if (c.type === 'flyers') host.innerHTML = finTog + flyerCard(c.qty, !c.item);
    else host.innerHTML = finTog + sizeButtons(c.type, c.fin, c.size);
    host.querySelectorAll('.finish-tog button').forEach(b => b.onclick = () => setCtxFin(b.dataset.fin));
    bindSizeGroup(host, setCtxSize);
    const pq = $('#pending-flyer-qty');
    if (pq) pq.oninput = () => { pending.qty = parseInt(pq.value, 10); refreshFlyerCopy(pending.qty); updatePreview(); };
  }
  syncSizePressed();
  refreshFlyerCopy(c.qty);
}
function syncSizePressed() {
  const c = ctx();
  document.querySelectorAll('.item').forEach((el, i) => {
    const it = list[i];
    el.querySelectorAll('.size-opt').forEach(b => {
      const on = !!(it && b.dataset.size === it.size);
      b.setAttribute('aria-checked', on);
      b.setAttribute('aria-pressed', on);
    });
  });
  const studio = $('#studio-size');
  if (studio) studio.querySelectorAll('.size-opt').forEach(b => {
    const on = c.type !== 'flyers' && b.dataset.size === c.size;
    b.setAttribute('aria-checked', on);
    b.setAttribute('aria-pressed', on);
  });
  const price = $('#studio-price');
  if (!price) return;
  if (c.type === 'flyers') { price.textContent = ''; return; }
  const k = PR[c.type].keys[c.fin];
  const unit = P[k].sizes[c.size];
  const each = unit == null ? 'Quote' : '$' + unit.toFixed(2) + ' each';
  let line = '';
  if (c.item && unit != null) line = ' · ' + RP.money(unit * c.item.qty);
  price.textContent = pretty(c.size).replace(/\s*\(.*/, '') + ' · ' + each + line;
}
function refreshFlyerCopy(qty) {
  const card = document.querySelector('#studio-size .flyer-card');
  if (!card || ctx().type !== 'flyers') return;
  const d = RP.describeFlyer(qty);
  const unit = card.querySelector('.flyer-unit b');
  const total = card.querySelector('.flyer-total b');
  const note = card.querySelector('.flyer-note');
  const kicker = card.querySelector('.flyer-kicker');
  if (!d.ok) {
    if (unit) unit.textContent = 'Minimum ' + P.flyers.minQty;
    if (total) total.textContent = 'Not available';
    if (note) { note.textContent = d.error; note.className = 'flyer-note field-error'; }
    if (kicker) kicker.textContent = 'Check quantity';
    return;
  }
  if (kicker) kicker.textContent = d.gap ? 'Outside published tiers' : d.size;
  if (unit) unit.textContent = d.unitText;
  if (total) total.textContent = d.totalText;
  if (note) { note.className = 'flyer-note flyer-range'; note.textContent = d.rangeText || d.detail; }
}

function render() {
  renderStudio(false);
  if (!cfg) { updatePreview(); return; }
  const host = $('#items');
  host.innerHTML = '';
  list.forEach((it, i) => {
    const packs = it.type !== 'flyers' && !!P[keyOf(it)].pack;
    const fins = finsOf(it.type);
    const min = it.type === 'flyers' ? P.flyers.minQty : 1;
    const max = it.type === 'flyers' ? P.flyers.maxQty : 999;
    const el = document.createElement('div');
    const group = linesOf(it.src);
    const pos = group.indexOf(it);
    const photoNo = uniqueSources().findIndex(o => o.src === it.src) + 1;
    el.className = 'item' + (i === sel ? ' active' : '') + (pos > 0 ? ' same-photo' : '');
    el.dataset.photo = photoNo;
    el.innerHTML = `<img class="th" src="${it.url}" alt="" loading="lazy" decoding="async"><div class="item-main"><div class="nm"></div><div class="ctl">
<div><label>Product</label><select class="pt">${Object.entries(PR).map(([t, v]) => `<option value="${t}" ${t === it.type ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
<div><label>Finish</label><select class="fin" ${fins.length < 2 ? 'disabled' : ''}>${fins.map(f => `<option ${f === it.fin ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></div>
<div><label>${it.type === 'flyers' ? 'Flyers' : packs ? 'Packs' : 'Qty'}</label><input class="qty" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${Number.isInteger(it.qty) ? it.qty : ''}" aria-label="${it.type === 'flyers' ? 'Flyer quantity, minimum ' + min : 'Quantity'}"></div>
</div><div class="size-block">${it.type === 'flyers' ? flyerCard(it.qty, false).replace(' id="flyer-quote"', '') : sizeButtons(it.type, it.fin, it.size)}</div><p class="line-note"></p><p class="field-error" hidden></p>${it.type === 'flyers' ? '' : `<button type="button" class="add-size" aria-label="Add another size of this photo"><span aria-hidden="true">＋</span> Add another size</button>`}</div>
<div class="side"><b class="lt"></b><button type="button" class="rm" aria-label="Remove">✕</button></div>`;
    el.querySelector('.nm').textContent = it.file.name;
    if (group.length > 1) {
      const tag = document.createElement('span');
      tag.className = 'size-tag';
      tag.textContent = `Photo ${photoNo} · size ${pos + 1} of ${group.length}`;
      el.querySelector('.nm').after(tag);
    }
    const addBtn = el.querySelector('.add-size');
    if (addBtn) addBtn.onclick = () => addSizeLine(i);
    el.querySelector('.pt').onchange = e => { applyProduct(it, e.target.value); sel = i; studioMode = ''; render(); };
    el.querySelector('.fin').onchange = e => { it.fin = e.target.value; if (it.type !== 'flyers' && !sizesOf(it.type, it.fin).includes(it.size)) it.size = defaultSize(it.type, it.fin); sel = i; studioMode = ''; render(); };
    bindSizeGroup(el, size => { it.size = size; pending.size = size; sel = i; studioMode = ''; render(); });
    el.addEventListener('click', ev => { if (ev.target.closest('button,select,input,a')) return; sel = i; studioMode = ''; render(); });
    el.querySelector('.qty').oninput = e => {
      it.qty = parseInt(e.target.value, 10);
      if (it.type === 'flyers') {
        const d = RP.describeFlyer(it.qty);
        if (d.ok) it.size = d.size;
        const card = el.querySelector('.flyer-card');
        if (card) {
          const live = RP.describeFlyer(it.qty);
          const unit = card.querySelector('.flyer-unit b');
          const tot = card.querySelector('.flyer-total b');
          const note = card.querySelector('.flyer-note');
          const kicker = card.querySelector('.flyer-kicker');
          if (!live.ok) {
            if (unit) unit.textContent = 'Minimum ' + P.flyers.minQty;
            if (tot) tot.textContent = 'Not available';
            if (note) { note.className = 'flyer-note field-error'; note.textContent = live.error; }
          } else {
            if (kicker) kicker.textContent = live.gap ? 'Outside published tiers' : live.size;
            if (unit) unit.textContent = live.unitText;
            if (tot) tot.textContent = live.totalText;
            if (note) { note.className = 'flyer-note flyer-range'; note.textContent = live.rangeText || live.detail; }
          }
        }
        if (i === sel) refreshFlyerCopy(it.qty);
      }
      sel = i;
      updatePreview();
      total();
    };
    el.querySelector('.rm').setAttribute('aria-label', group.length > 1 ? 'Remove this size' : 'Remove');
    el.querySelector('.rm').onclick = () => { list.splice(i, 1); if (sel >= list.length) sel = Math.max(0, list.length - 1); studioMode = ''; render(); };
    host.append(el);
  });
  updatePreview();
  total();
}
function fitFrame(frame, size, flyer) {
  if (flyer) {
    frame.style.width = '220px';
    frame.style.aspectRatio = '8.5 / 11';
    frame.dataset.aspect = 'flyer';
    return;
  }
  const m = String(size || '').match(/(\d+)\s*[x×]\s*(\d+)/);
  const w = m ? +m[1] : 4, h = m ? +m[2] : 6;
  const scale = Math.min(260 / w, 340 / h);
  frame.style.width = Math.max(96, Math.round(w * scale)) + 'px';
  frame.style.aspectRatio = w + ' / ' + h;
  frame.dataset.aspect = w + '/' + h;
}
function updatePreview() {
  const frame = $('#live-frame'), img = $('#live-preview'), finEl = $('#live-fin'), sizeEl = $('#live-size');
  if (!frame || !img) return;
  const c = ctx();
  const it = c.item;
  img.src = it ? it.url : 'img/hero.jpg';
  const glossy = /glossy/i.test(c.fin || '');
  frame.classList.toggle('glossy', glossy && c.type !== 'flyers');
  frame.classList.toggle('matte', !glossy || c.type === 'flyers');
  fitFrame(frame, c.size, c.type === 'flyers');
  if (finEl) finEl.textContent = c.type === 'flyers' ? 'Standard' : (c.fin || '—');
  if (sizeEl) sizeEl.textContent = c.type === 'flyers' ? (Number.isInteger(c.qty) ? c.qty + ' flyers' : 'Flyers') : pretty(c.size).replace(/\s*\(.*/, '');
  document.querySelectorAll('.item').forEach((el, i) => el.classList.toggle('active', i === sel));
  syncSizePressed();
}
function lineFor(it) {
  return RP.priceOrderItem({ finish: keyOf(it), size: it.size, qty: it.qty });
}
function total() {
  if (!cfg) return;
  let n = 0, t = 0, tbd = false, invalid = '', gap = false;
  document.querySelectorAll('.item').forEach((el, i) => {
    const it = list[i];
    const priced = lineFor(it);
    const err = el.querySelector('.field-error');
    const note = el.querySelector('.line-note');
    if (!priced.ok) {
      invalid = priced.error;
      el.querySelector('.lt').textContent = '—';
      if (err) { err.hidden = false; err.textContent = priced.error; }
      if (note) note.textContent = '';
      return;
    }
    if (err) { err.hidden = true; err.textContent = ''; }
    if (priced.priceTBD) { tbd = true; if (priced.gap) gap = true; }
    el.querySelector('.lt').textContent = priced.priceTBD ? 'Quote' : '$' + priced.lineTotal.toFixed(2);
    if (note) note.textContent = priced.priceTBD ? (priced.unitText + ' · ' + priced.totalText) : (priced.unitText + (it.qty > 1 ? ' · ' + priced.totalText : ''));
    n += priced.qty;
    t += priced.lineTotal || 0;
  });
  const shippingOn = ship() && list.length;
  if (shippingOn) t += cfg.shippingFee;
  const quoteOnly = tbd && list.length && list.every(it => { const p = lineFor(it); return p.ok && p.priceTBD; });
  const tbdEl = $('#tbd');
  tbdEl.hidden = !tbd;
  tbdEl.textContent = gap
    ? 'Some flyer quantities have no published rate. Those stay quote-required — we will not estimate a price. Nothing is charged now.'
    : 'Flyer rates are published as a range, not an exact price. We email the exact total before you pay. Nothing is charged now.';
  const files = uniqueSources().length;
  $('#count').textContent = `${files} file${files === 1 ? '' : 's'}${list.length > files ? ' · ' + list.length + ' sizes' : ''} · ${n || 0} item${n === 1 ? '' : 's'}${shippingOn ? ' + shipping' : ''}${tbd ? ' · quote' : ''}`;
  $('#total').textContent = invalid ? '—' : quoteOnly ? (shippingOn ? '$' + cfg.shippingFee.toFixed(2) + '+' : 'Quote') : '$' + t.toFixed(2) + (tbd ? '+' : '');
  const m = payMethod();
  $('#pay').disabled = !list.length || !!invalid;
  $('#pay').textContent = invalid ? 'Check quantity' : tbd ? 'Send inquiry' : (m === 'card' || m === 'applepay') && cfg.stripe ? 'Pay & place order' : 'Place order';
  const err = $('#err');
  if (invalid) { err.textContent = invalid; err.hidden = false; }
  else if (err.textContent === invalid || /Flyers require|Quantity must|Flyer quantity/.test(err.textContent)) err.hidden = true;
}
document.querySelectorAll('[name=payMethod]').forEach(r => r.onchange = total);
$('#f').onsubmit = async e => {
  e.preventDefault();
  $('#err').hidden = true;
  for (const it of list) {
    const priced = lineFor(it);
    if (!priced.ok) { $('#err').textContent = priced.error; $('#err').hidden = false; total(); return; }
  }
  $('#pay').disabled = true;
  const srcs = uniqueSources();
  try {
    // Upload photos one at a time (a few in parallel) so large orders don't become one
    // giant request. Finished uploads are remembered, so a retry only sends what is left.
    await uploadAll(srcs);
    $('#pay').textContent = 'Placing order…';
    const fd = new FormData($('#f'));
    fd.append('uploads', JSON.stringify(srcs.map(it => uploadIds.get(it.src))));
    fd.append('items', JSON.stringify(list.map(it => ({ finish: keyOf(it), size: it.size, qty: it.qty, fileIndex: srcs.findIndex(o => o.src === it.src) }))));
    fd.append('payMethod', payMethod());
    const r = await fetch('/api/orders', { method: 'POST', body: fd }), j = await r.json();
    if (!r.ok) {
      if (/upload (expired|is missing)/i.test(j.error || '')) uploadIds.clear();
      throw new Error(j.error);
    }
    location.href = j.redirect;
  } catch (x) { $('#err').textContent = x.message; $('#err').hidden = false; total(); }
};
renderStudio(true);
updatePreview();
