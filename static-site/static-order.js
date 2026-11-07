// Static/Netlify order form: same size list, crop preview, and flyer quote rules as the full site.
const P = LUMA_PRICES, PR = LUMA_PRODUCTS, RP = LUMA_PRICING;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pretty = s => String(s || '').replace(/(\d+)x(\d+)/g, '$1×$2');
const params = new URLSearchParams(location.search);
let defType = (params.get('type') || 'photo').toLowerCase();
if (!PR[defType]) defType = 'photo';
const urlFinish = params.get('finish') || '';
const urlSize = params.get('size') || '';
const rows = [...document.querySelectorAll('.item.s')];
let active = 0;

function finsOf(t) { return Object.keys(PR[t].keys); }
function keyOf(t, fin) { return PR[t].keys[fin]; }
function defaultFin(t) {
  const fins = finsOf(t);
  if (fins.includes(urlFinish)) return urlFinish;
  if (t === 'photo' && fins.includes('Matte')) return 'Matte';
  return fins[0];
}
function defaultSize(t, fin) {
  if (t === 'flyers') return RP.describeFlyer(P.flyers.minQty).size;
  const sizes = Object.keys(P[keyOf(t, fin)].sizes);
  if (sizes.includes(urlSize)) return urlSize;
  if (t === 'photo' && sizes.includes('4x6')) return '4x6';
  return sizes[0];
}
function fitFrame(size, flyer) {
  const frame = document.getElementById('live-frame');
  if (!frame) return;
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
function rowState(row) {
  const type = row.querySelector('.prod').value;
  const fin = row.querySelector('.fin').value;
  const qty = parseInt(row.querySelector('.qty').value, 10);
  const size = row.querySelector('.sz').value;
  return { type, fin, qty, size };
}
function paintRow(row) {
  const { type, fin, qty, size } = rowState(row);
  const block = row.querySelector('.size-block');
  const note = row.querySelector('.line-note');
  const err = row.querySelector('.field-error');
  const qtyInput = row.querySelector('.qty');
  const ql = row.querySelector('.ql');
  if (type === 'flyers') {
    qtyInput.min = P.flyers.minQty;
    qtyInput.max = P.flyers.maxQty;
    ql.textContent = 'Flyers';
    const d = RP.describeFlyer(qty);
    row.querySelector('.sz').value = d.ok ? d.size : '';
    row.querySelector('.fk').value = 'flyers';
    block.innerHTML = d.ok
      ? `<div class="flyer-card"><p class="flyer-kicker">${esc(d.gap ? 'Outside published tiers' : d.size)}</p><p class="flyer-unit">Unit <b>${esc(d.unitText)}</b></p><p class="flyer-total">Total <b>${esc(d.totalText)}</b></p><p class="flyer-range">${esc(d.rangeText || d.detail)}</p></div>`
      : `<div class="flyer-card"><p class="flyer-unit">Unit <b>Minimum ${P.flyers.minQty}</b></p><p class="flyer-total">Total <b>Not available</b></p><p class="field-error">${esc(d.error)}</p></div>`;
    note.textContent = d.ok ? (d.unitText + ' · ' + d.totalText) : '';
    err.hidden = d.ok;
    err.textContent = d.ok ? '' : d.error;
    return;
  }
  const spec = P[keyOf(type, fin)];
  qtyInput.min = 1;
  qtyInput.max = 999;
  ql.textContent = spec.pack ? 'Packs' : 'Qty';
  row.querySelector('.fk').value = keyOf(type, fin);
  const sizes = Object.keys(spec.sizes);
  if (!sizes.includes(size)) row.querySelector('.sz').value = defaultSize(type, fin);
  const current = row.querySelector('.sz').value;
  block.innerHTML = `<div class="size-picker${spec.pack ? ' packs' : ''}" role="radiogroup" aria-label="${spec.pack ? 'Pack' : 'Print size'}">${sizes.map(s => {
    const on = s === current;
    const price = spec.sizes[s];
    const label = price == null ? 'Quote' : '$' + price.toFixed(2);
    return `<button type="button" class="size-opt" role="radio" data-size="${esc(s)}" aria-checked="${on}" aria-pressed="${on}"><span>${esc(pretty(s))}</span><small>${label}</small></button>`;
  }).join('')}</div>`;
  block.querySelectorAll('.size-opt').forEach(b => b.onclick = () => {
    row.querySelector('.sz').value = b.dataset.size;
    active = rows.indexOf(row);
    paintRow(row);
    paintStudio();
    preview();
    estimate();
  });
  const priced = RP.priceOrderItem({ finish: keyOf(type, fin), size: current, qty: qty });
  note.textContent = priced.ok ? (priced.unitText + (priced.qty > 1 ? ' · ' + priced.totalText : '')) : '';
  err.hidden = priced.ok;
  err.textContent = priced.ok ? '' : priced.error;
}
function paintStudio() {
  const row = rows[active] || rows[0];
  const { type, fin, size, qty } = rowState(row);
  const host = document.getElementById('studio-size');
  const price = document.getElementById('studio-price');
  if (!host) return;
  if (type === 'flyers') {
    const d = RP.describeFlyer(qty);
    host.innerHTML = d.ok
      ? `<div class="flyer-card"><p class="flyer-kicker">${esc(d.gap ? 'Outside published tiers' : d.size)}</p><p class="flyer-unit">Unit <b>${esc(d.unitText)}</b></p><p class="flyer-total">Total <b>${esc(d.totalText)}</b></p><p class="flyer-range">${esc(d.rangeText || d.detail)}</p></div>`
      : `<div class="flyer-card"><p class="field-error">${esc(d.error)}</p></div>`;
    if (price) price.textContent = '';
    return;
  }
  const spec = P[keyOf(type, fin)];
  host.innerHTML = `<div class="size-picker${spec.pack ? ' packs' : ''}" role="radiogroup" aria-label="Print size">${Object.keys(spec.sizes).map(s => {
    const on = s === size;
    const v = spec.sizes[s];
    return `<button type="button" class="size-opt" role="radio" data-size="${esc(s)}" aria-checked="${on}" aria-pressed="${on}"><span>${esc(pretty(s))}</span><small>${v == null ? 'Quote' : '$' + v.toFixed(2)}</small></button>`;
  }).join('')}</div>`;
  host.querySelectorAll('.size-opt').forEach(b => b.onclick = () => {
    row.querySelector('.sz').value = b.dataset.size;
    paintRow(row);
    paintStudio();
    preview();
    estimate();
  });
  if (price) {
    const unit = spec.sizes[size];
    price.textContent = pretty(size).replace(/\s*\(.*/, '') + ' · ' + (unit == null ? 'Quote' : '$' + unit.toFixed(2) + ' each');
  }
}
function preview() {
  const row = rows[active] || rows[0];
  const { type, fin, size, qty } = rowState(row);
  const frame = document.getElementById('live-frame');
  const img = document.getElementById('live-preview');
  const file = row.querySelector('[type=file]').files[0];
  if (img && file && file.type.startsWith('image/')) img.src = URL.createObjectURL(file);
  else if (img && !file) img.src = 'img/hero.jpg';
  if (frame) {
    frame.classList.toggle('glossy', /glossy/i.test(fin) && type !== 'flyers');
    frame.classList.toggle('matte', type === 'flyers' || !/glossy/i.test(fin));
  }
  fitFrame(size, type === 'flyers');
  const finEl = document.getElementById('live-fin');
  const sizeEl = document.getElementById('live-size');
  if (finEl) finEl.textContent = type === 'flyers' ? 'Standard' : fin;
  if (sizeEl) sizeEl.textContent = type === 'flyers' ? ((Number.isInteger(qty) ? qty : '—') + ' flyers') : pretty(size).replace(/\s*\(.*/, '');
}
function estimate() {
  let t = 0, quote = false;
  rows.forEach(row => {
    if (!row.querySelector('[type=file]').files.length) return;
    const { type, fin, size, qty } = rowState(row);
    const priced = RP.priceOrderItem({ finish: type === 'flyers' ? 'flyers' : keyOf(type, fin), size, qty });
    if (!priced.ok) return;
    if (priced.priceTBD) quote = true;
    t += priced.lineTotal || 0;
  });
  const el = document.getElementById('est');
  if (el) el.textContent = quote && t === 0 ? 'Quote' : '$' + t.toFixed(2) + (quote ? '+' : '');
  const banner = document.getElementById('tbd');
  if (banner) banner.hidden = !quote;
}
function fillFin(row, keep) {
  const type = row.querySelector('.prod').value;
  const fin = row.querySelector('.fin');
  const prev = keep || fin.value;
  fin.innerHTML = finsOf(type).map(f => `<option ${f === prev ? 'selected' : ''}>${esc(f)}</option>`).join('');
  fin.disabled = fin.options.length < 2;
  if (![...fin.options].some(o => o.value === prev)) fin.value = defaultFin(type);
  else fin.value = prev;
}
function initRow(row, i) {
  const prod = row.querySelector('.prod');
  prod.value = defType;
  fillFin(row, i === 0 ? defaultFin(defType) : '');
  const type = prod.value;
  const fin = row.querySelector('.fin').value;
  const qty = row.querySelector('.qty');
  if (type === 'flyers') qty.value = P.flyers.minQty;
  row.querySelector('.sz').value = i === 0 ? defaultSize(type, fin) : defaultSize(type, fin);
  prod.onchange = () => {
    const next = prod.value;
    fillFin(row);
    if (next === 'flyers' && parseInt(qty.value, 10) < P.flyers.minQty) qty.value = P.flyers.minQty;
    if (next !== 'flyers' && !Object.keys(P[keyOf(next, row.querySelector('.fin').value)].sizes).includes(row.querySelector('.sz').value)) {
      row.querySelector('.sz').value = defaultSize(next, row.querySelector('.fin').value);
    }
    active = rows.indexOf(row);
    paintRow(row); paintStudio(); preview(); estimate();
  };
  row.querySelector('.fin').onchange = () => {
    active = rows.indexOf(row);
    const t = prod.value, f = row.querySelector('.fin').value;
    if (t !== 'flyers' && !Object.keys(P[keyOf(t, f)].sizes).includes(row.querySelector('.sz').value)) row.querySelector('.sz').value = defaultSize(t, f);
    paintRow(row); paintStudio(); preview(); estimate();
  };
  qty.oninput = () => { active = rows.indexOf(row); paintRow(row); paintStudio(); preview(); estimate(); };
  row.querySelector('[type=file]').onchange = () => { active = rows.indexOf(row); preview(); estimate(); };
  paintRow(row);
}
rows.forEach(initRow);
paintStudio();
preview();
estimate();
document.querySelector('form[name=order]').addEventListener('submit', e => {
  const bad = rows.find(row => {
    if (!row.querySelector('[type=file]').files.length) return false;
    const { type, fin, size, qty } = rowState(row);
    const priced = RP.priceOrderItem({ finish: type === 'flyers' ? 'flyers' : keyOf(type, fin), size, qty });
    return !priced.ok;
  });
  const err = document.getElementById('err');
  if (bad) {
    e.preventDefault();
    const priced = RP.priceOrderItem({ finish: 'flyers', qty: parseInt(bad.querySelector('.qty').value, 10) });
    if (err) { err.hidden = false; err.textContent = priced.ok ? 'Check the quantity on each file.' : priced.error; }
  }
});
