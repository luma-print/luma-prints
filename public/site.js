// Mobile nav + Services & Pricing tabs (rendered from prices.js)
(function(){
var t=document.querySelector('.menu-t'),l=document.querySelector('.links');
if(t&&l){t.onclick=function(){var o=l.classList.toggle('open');t.setAttribute('aria-expanded',o)};l.addEventListener('click',function(e){if(e.target.tagName==='A')l.classList.remove('open')})}
var P=typeof LUMA_PRICES!=='undefined'?LUMA_PRICES:null,m=document.getElementById('menu');if(!P)return;
function f(v){return '$'+v.toFixed(2)}
function x(s){return s.replace(/(\d)x(\d)/g,'$1×$2')}
var sizeList=document.getElementById('size-list');
if(sizeList){
  sizeList.innerHTML=Object.keys(P.standard.sizes).map(function(s){
    var parts=s.split('x'), ratio=parts.length===2?(+parts[0])+' / '+(+parts[1]):'1 / 1';
    return '<a class="size-option" role="listitem" href="order.html?type=photo&amp;size='+encodeURIComponent(s)+'"><span class="size-swatch" style="aspect-ratio:'+ratio+'" aria-hidden="true"></span><span class="size-option-copy"><b>'+x(s)+'</b><small>'+f(P.standard.sizes[s])+'</small></span></a>';
  }).join('');
}
if(!m)return;
var photo=Object.keys(P.standard.sizes).map(function(s){return '<div class="cell"><span>'+x(s)+'</span><b>'+f(P.standard.sizes[s])+'</b></div>'}).join('');
var inv=Object.keys(P.invitations_matte.sizes).map(function(s){var mm=s.match(/^(\S+) \(Pack of (\d+)\)/),v=P.invitations_matte.sizes[s];return '<div class="cell"><small>'+x(mm[1])+' · pack of '+mm[2]+'</small><b>'+f(v)+'</b><small>$'+(v/+mm[2]).toFixed(2)+' each</small></div>'}).join('');
var fl=(P.flyers.tiers||[]).map(function(t){
  var rate='$'+t.unitLow.toFixed(2)+' – $'+t.unitHigh.toFixed(2);
  return '<div class="cell"><small>'+t.size+' · '+t.rangeLabel+' flyers</small><b>'+rate+'</b><small>per flyer · quote</small></div>';
}).join('');
m.innerHTML='<div class="tabs" role="tablist"><button role="tab" aria-selected="true" data-t="p-photo">Photo Prints</button><button role="tab" aria-selected="false" data-t="p-inv">Invitations &amp; Announcements</button><button role="tab" aria-selected="false" data-t="p-fly">Flyers</button></div>'+
'<div class="panel" id="p-photo"><div class="intro"><h3>Photo Prints</h3><p>21 sizes from wallet-friendly 3×5s to statement 16×24s. <b>Matte and Glossy are the same price</b> — just pick your finish.</p><a class="btn" href="order.html?type=photo">Order Photo Prints</a></div><div class="ptable">'+photo+'</div></div>'+
'<div class="panel" id="p-inv" hidden><div class="intro"><h3>Invitations &amp; Announcements</h3><p>Weddings, graduations, birth announcements, parties and holiday cards. Printed in packs, Matte or Glossy at the same price. Upload your design as JPG, PNG or PDF.</p><a class="btn" href="order.html?type=invitations">Order Invitations</a></div><div class="ptable wide">'+inv+'</div></div>'+
'<div class="panel" id="p-fly" hidden><div class="intro"><h3>Flyers</h3><p>Events, menus, promotions and business handouts. Minimum 25. The published rate is a range, so we confirm the exact total by email before you pay.</p><a class="btn" href="order.html?type=flyers">Order Flyers</a></div><div><div class="ptable wide">'+fl+'</div><p class="note">These ranges are not charged online. Quantities 51–99 and 501–999 have no published rate and stay quote-only too.</p></div></div>';
var b=m.querySelectorAll('.tabs button');b.forEach(function(btn){btn.onclick=function(){b.forEach(function(o){o.setAttribute('aria-selected',o===btn);document.getElementById(o.dataset.t).hidden=o!==btn})}});
})();
