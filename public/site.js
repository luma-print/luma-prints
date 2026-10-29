// Renders the pricing menu (#menu) from prices.js
function lumaFmt(v){return v==null?'<span class="ph">[SET PRICE]</span>':'$'+v.toFixed(2)}
document.addEventListener('DOMContentLoaded',function(){var m=document.getElementById('menu');if(!m)return;
 m.innerHTML=Object.keys(LUMA_PRICES).map(function(k){var c=LUMA_PRICES[k];
  var desc='<p>'+c.desc.replace(/\[(OWNER[^\]]*)\]/,'<span class="ph">[$1]</span>')+'</p>';
  if(k==='glossy')return '<div class="cat"><h3>'+c.label+'</h3>'+desc+'<div class="row"><span>All standard sizes</span><b>No extra charge</b></div><div class="row"><span>Matte or glossy</span><b>Your choice</b></div></div>';
  return '<div class="cat '+(k==='standard'?'std':'')+'"><h3>'+c.label+'</h3>'+desc+'<div class="rows">'+Object.keys(c.sizes).map(function(s){return '<div class="row"><span>'+s.replace('x','×')+'</span><b>'+lumaFmt(c.sizes[s])+'</b></div>'}).join('')+'</div></div>'}).join('')});
