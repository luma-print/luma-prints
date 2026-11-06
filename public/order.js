let cfg, list = [];
const $ = s => document.querySelector(s), P = LUMA_PRICES, PR = LUMA_PRODUCTS;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const types = { photo: 1, invitations: 1, flyers: 1 };
let defType = (new URLSearchParams(location.search).get('type') || 'photo').toLowerCase();
if (!types[defType]) defType = 'photo';
const PDF_SVG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="72" height="72" rx="12" fill="#F4F4F5"/><path d="M24 14h18l10 10v34H24z" fill="#fff" stroke="#A1A1AA" stroke-width="2"/><path d="M42 14v10h10" fill="none" stroke="#A1A1AA" stroke-width="2"/><rect x="18" y="38" width="30" height="13" rx="3" fill="#B45309"/><text x="33" y="48" font-family="Arial,sans-serif" font-size="9" font-weight="700" fill="#fff" text-anchor="middle">PDF</text></svg>');
const keyOf = it => PR[it.type].keys[it.fin];
const fmt = (k, s) => { const v = P[k].sizes[s]; if (v != null) return '$' + v.toFixed(2); return (P[k].displayRates && P[k].displayRates[s]) || 'Quote'; };
function setType(it, t) { it.type = t; const fins = Object.keys(PR[t].keys); if (!fins.includes(it.fin)) it.fin = fins[0]; const sz = Object.keys(P[keyOf(it)].sizes); if (!sz.includes(it.size)) it.size = t === 'photo' ? '4x6' : sz[0]; }
// default product picker
const pp = $('#prodpick');
function renderPick() { pp.innerHTML = '<span class="mute" style="align-self:center;font-size:.88rem;margin-right:4px">New uploads:</span>' + Object.entries(PR).map(([k, v]) => `<button type="button" class="btn sm ${k === defType ? '' : 'ghost'}" data-t="${k}" aria-pressed="${k === defType}">${esc(v.label)}</button>`).join(''); pp.querySelectorAll('button').forEach(b => b.onclick = () => { defType = b.dataset.t; renderPick(); }); }
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
});
if (location.search.includes('canceled')) $('#cancel').hidden = false;
const add = files => {
  [...files].filter(f => f.type.startsWith('image/') || f.type === 'application/pdf').forEach(f => {
    const it = { file: f, qty: 1, fin: 'Matte', size: '', pdf: f.type === 'application/pdf' };
    it.url = it.pdf ? PDF_SVG : URL.createObjectURL(f);
    setType(it, defType); list.push(it);
  });
  render();
};
$('#files').onchange = e => { add(e.target.files); e.target.value = ''; };
const d = $('#drop');
d.ondragover = e => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over');
d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); add(e.dataTransfer.files); };
const ship = () => $('[name=delivery]:checked').value === 'shipping';
document.querySelectorAll('[name=delivery]').forEach(r => r.onchange = () => { $('#addr').hidden = !ship(); $('#addr').required = ship(); total(); });
const payMethod = () => ($('[name=payMethod]:checked') || {}).value || 'venmo';
function render() {
  if (!cfg) return;
  $('#items').innerHTML = '';
  list.forEach((it, i) => {
    const k = keyOf(it), packs = !!P[k].pack, fins = Object.keys(PR[it.type].keys);
    const el = document.createElement('div'); el.className = 'item';
    el.innerHTML = `<img class="th" src="${it.url}" alt=""><div style="min-width:0"><div class="nm"></div><div class="ctl">
<div><label>Product</label><select class="pt">${Object.entries(PR).map(([t, v]) => `<option value="${t}" ${t === it.type ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
<div><label>Finish</label><select class="fin" ${fins.length < 2 ? 'disabled' : ''}>${fins.map(f => `<option ${f === it.fin ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
<div><label>${packs ? 'Size / Pack' : 'Size'}</label><select class="sz">${Object.keys(P[k].sizes).map(s => `<option value="${esc(s)}" ${s === it.size ? 'selected' : ''}>${esc(s.replace(/(\d)x(\d)/, '$1×$2'))} – ${esc(fmt(k, s))}</option>`).join('')}</select></div>
<div><label>${packs ? 'Packs' : 'Qty'}</label><input type="number" min="1" max="999" value="${it.qty}"></div></div></div>
<div class="side"><b class="lt"></b><button type="button" class="rm" aria-label="Remove">✕</button></div>`;
    el.querySelector('.nm').textContent = it.file.name;
    el.querySelector('.pt').onchange = e => { setType(it, e.target.value); render(); };
    el.querySelector('.fin').onchange = e => { it.fin = e.target.value; total(); };
    el.querySelector('.sz').onchange = e => { it.size = e.target.value; total(); };
    el.querySelector('input').oninput = e => { it.qty = Math.max(1, Math.min(999, parseInt(e.target.value) || 1)); total(); };
    el.querySelector('.rm').onclick = () => { list.splice(i, 1); render(); };
    $('#items').append(el);
  });
  total();
}
function total() {
  let n = 0, t = 0, tbd = false;
  document.querySelectorAll('.item').forEach((el, i) => { const it = list[i], u = P[keyOf(it)].sizes[it.size]; if (u == null) tbd = true; el.querySelector('.lt').textContent = u == null ? 'Quote' : '$' + (u * it.qty).toFixed(2); n += it.qty; t += (u || 0) * it.qty; });
  if (ship() && list.length) t += cfg.shippingFee;
  $('#tbd').hidden = !tbd;
  $('#count').textContent = `${list.length} file${list.length === 1 ? '' : 's'} · ${n} item${n === 1 ? '' : 's'}${ship() && list.length ? ' + shipping' : ''}${tbd ? ' · quote' : ''}`;
  $('#total').textContent = '$' + t.toFixed(2) + (tbd ? '+' : ''); $('#pay').disabled = !list.length;
  const m = payMethod();
  $('#pay').textContent = tbd ? 'Send inquiry' : (m === 'card' || m === 'applepay') && cfg.stripe ? 'Pay & place order' : 'Place order';
}
document.querySelectorAll('[name=payMethod]').forEach(r => r.onchange = total);
$('#f').onsubmit = async e => {
  e.preventDefault(); $('#err').hidden = true; $('#pay').disabled = true; $('#pay').textContent = 'Uploading…';
  const fd = new FormData($('#f'));
  list.forEach(it => fd.append('photos', it.file, it.file.name));
  fd.append('items', JSON.stringify(list.map(it => ({ finish: keyOf(it), size: it.size, qty: it.qty }))));
  fd.append('payMethod', payMethod());
  try { const r = await fetch('/api/orders', { method: 'POST', body: fd }), j = await r.json(); if (!r.ok) throw new Error(j.error); location.href = j.redirect; }
  catch (x) { $('#err').textContent = x.message; $('#err').hidden = false; total(); }
};
