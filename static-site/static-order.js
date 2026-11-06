// Product/finish/size selectors + estimate (static/Netlify version)
const P = LUMA_PRICES, PR = LUMA_PRODUCTS;
const fmt = (k, s) => { const v = P[k].sizes[s]; return v != null ? '$' + v.toFixed(2) : ((P[k].displayRates || {})[s] || 'Quote'); };
const t0 = (new URLSearchParams(location.search).get('type') || 'photo').toLowerCase();
document.querySelectorAll('.item.s').forEach(row => {
  const pt = row.querySelector('.prod'), fin = row.querySelector('.fin'), sz = row.querySelector('.sz'), fk = row.querySelector('.fk'), ql = row.querySelector('.ql');
  if (PR[t0]) pt.value = t0;
  const fillFin = () => { fin.innerHTML = Object.keys(PR[pt.value].keys).map(f => `<option>${f}</option>`).join(''); fin.disabled = fin.options.length < 2; fill(); };
  const fill = () => { const k = PR[pt.value].keys[fin.value]; fk.value = k; ql.textContent = P[k].pack ? 'Packs' : 'Qty'; const cur = sz.value; sz.innerHTML = Object.keys(P[k].sizes).map(s => `<option value="${s}">${s} – ${fmt(k, s)}</option>`).join(''); if ([...sz.options].some(o => o.value === cur)) sz.value = cur; else if (pt.value === 'photo') sz.value = '4x6'; est(); };
  pt.onchange = fillFin; fin.onchange = fill; fillFin();
});
function est() { let t = 0; document.querySelectorAll('.item.s').forEach(r => { if (!r.querySelector('[type=file]').files.length) return; const v = P[r.querySelector('.fk').value].sizes[r.querySelector('.sz').value]; t += (v || 0) * (+r.querySelector('[type=number]').value || 1); }); document.getElementById('est').textContent = '$' + t.toFixed(2); }
document.querySelector('form[name=order]').addEventListener('input', est); document.querySelector('form[name=order]').addEventListener('change', est);
