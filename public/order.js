let cfg, list = [];
const $ = s => document.querySelector(s), P = LUMA_PRICES;
fetch('/api/config').then(r => r.json()).then(c => { cfg = c; $('#sf').textContent = c.shippingFee.toFixed(2); $('#demo').hidden = !c.demo; render(); });
if (location.search.includes('canceled')) $('#cancel').hidden = false;
const add = files => { [...files].filter(f => f.type.startsWith('image/')).forEach(f => list.push({ file: f, finish: 'standard', size: '4x6', qty: 1, url: URL.createObjectURL(f) })); render(); };
$('#files').onchange = e => { add(e.target.files); e.target.value = ''; };
const d = $('#drop');
d.ondragover = e => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over');
d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); add(e.dataTransfer.files); };
document.querySelectorAll('[name=delivery]').forEach(r => r.onchange = () => { $('#addr').hidden = !ship(); $('#addr').required = ship(); total(); });
const ship = () => $('[name=delivery]:checked').value === 'shipping';
const fmt = v => v == null ? '[SET PRICE]' : '$' + v.toFixed(2);
const sizeOpts = it => Object.entries(P[it.finish].sizes).map(([k, v]) => `<option value="${k}" ${k === it.size ? 'selected' : ''}>${k} – ${fmt(v)}</option>`).join('');
function render() {
  if (!cfg) return;
  $('#items').innerHTML = '';
  list.forEach((it, i) => {
    const el = document.createElement('div'); el.className = 'item';
    el.innerHTML = `<img src="${it.url}" alt=""><div class="nm"></div><select class="fin" aria-label="Finish"><option value="standard">Matte (standard)</option><option value="glossy">Glossy</option></select><select class="sz" aria-label="Size">${sizeOpts(it)}</select><input type="number" min="1" max="999" value="${it.qty}" aria-label="Quantity"><b class="lt"></b><button type="button" class="rm" aria-label="Remove">✕</button>`;
    el.querySelector('.nm').textContent = it.file.name;
    el.querySelector('.fin').value = it.finish;
    el.querySelector('.fin').onchange = e => { it.finish = e.target.value; if (!(it.size in P[it.finish].sizes)) it.size = Object.keys(P[it.finish].sizes)[0]; render(); };
    el.querySelector('.sz').onchange = e => { it.size = e.target.value; total(); };
    el.querySelector('input').oninput = e => { it.qty = Math.max(1, parseInt(e.target.value) || 1); total(); };
    el.querySelector('.rm').onclick = () => { list.splice(i, 1); render(); };
    $('#items').append(el);
  });
  total();
}
function total() {
  let n = 0, t = 0, tbd = false;
  document.querySelectorAll('.item').forEach((el, i) => { const it = list[i], u = P[it.finish].sizes[it.size]; if (u == null) tbd = true; el.querySelector('.lt').textContent = u == null ? 'TBD' : '$' + (u * it.qty).toFixed(2); n += it.qty; t += (u || 0) * it.qty; });
  if (ship() && list.length) t += cfg.shippingFee;
  $('#tbd').hidden = !tbd;
  $('#count').textContent = `${n} print${n === 1 ? '' : 's'}${ship() && list.length ? ' + shipping' : ''}${tbd ? ' · price TBD' : ''}`;
  $('#total').textContent = '$' + t.toFixed(2) + (tbd ? '+' : ''); $('#pay').disabled = !list.length;
  $('#pay').textContent = tbd ? 'Send inquiry' : cfg.demo ? 'Place order' : 'Pay & place order';
}
$('#f').onsubmit = async e => {
  e.preventDefault(); $('#err').hidden = true; $('#pay').disabled = true; $('#pay').textContent = 'Uploading…';
  const fd = new FormData($('#f'));
  list.forEach(it => fd.append('photos', it.file, it.file.name));
  fd.append('items', JSON.stringify(list.map(it => ({ finish: it.finish, size: it.size, qty: it.qty }))));
  try { const r = await fetch('/api/orders', { method: 'POST', body: fd }), j = await r.json(); if (!r.ok) throw new Error(j.error); location.href = j.redirect; }
  catch (x) { $('#err').textContent = x.message; $('#err').hidden = false; total(); }
};
