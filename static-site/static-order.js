// Fills size dropdowns from prices.js and shows an estimate (static/Netlify version)
const P = LUMA_PRICES, fmt = v => v == null ? '[SET PRICE]' : '$' + v.toFixed(2);
document.querySelectorAll('.item.s').forEach(row => {
  const fin = row.querySelector('.fin'), sz = row.querySelector('.sz');
  const fill = () => { const cur = sz.value; sz.innerHTML = Object.entries(P[fin.value].sizes).map(([k, v]) => `<option value="${k}">${k} – ${fmt(v)}</option>`).join(''); if ([...sz.options].some(o => o.value === cur)) sz.value = cur; else sz.value = '4x6'; est(); };
  fin.onchange = fill; fill();
});
function est() { let t = 0; document.querySelectorAll('.item.s').forEach(r => { if (!r.querySelector('[type=file]').files.length) return; const v = P[r.querySelector('.fin').value].sizes[r.querySelector('.sz').value]; t += (v || 0) * (+r.querySelector('[type=number]').value || 1); }); document.getElementById('est').textContent = '$' + t.toFixed(2); }
document.querySelector('form[name=order]').addEventListener('input', est); document.querySelector('form[name=order]').addEventListener('change', est);
