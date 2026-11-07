/* Shared price rules for the browser and the server.
   Photo and invitation totals come only from LUMA_PRICES.
   Flyer exactUnit is null in the catalog, so those lines stay quotes. */
(function (root, factory) {
  var api = factory(function () {
    if (typeof LUMA_PRICES !== 'undefined') return LUMA_PRICES;
    return require('./prices.js');
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LUMA_PRICING = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (getPrices) {
  function money(n) {
    return '$' + (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
  }
  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }
  function whole(n) {
    var q = typeof n === 'number' ? n : Number(String(n).trim());
    return Number.isInteger(q) ? q : null;
  }
  function describeFlyer(qty) {
    var spec = getPrices().flyers;
    var min = spec.minQty || 25;
    var max = spec.maxQty || 20000;
    var q = whole(qty);
    if (q == null || q < min) return { ok: false, error: 'Flyers require a minimum of ' + min + '.' };
    if (q > max) return { ok: false, error: 'Flyer quantity cannot exceed ' + max + '.' };
    var tier = (spec.tiers || []).find(function (t) { return q >= t.min && (t.max == null || q <= t.max); });
    if (!tier) {
      var gap = (spec.gaps || []).find(function (g) { return q >= g.min && q <= g.max; });
      return {
        ok: true, quote: true, gap: true, exact: false, qty: q, size: 'Custom quantity (quote)',
        unit: null, lineTotal: 0,
        unitText: 'No published rate',
        totalText: 'Quote required',
        rangeText: '',
        detail: (gap && gap.note ? gap.note + ' ' : '') + 'Quantity ' + q + ' stays quote-required. No price is estimated for this gap.'
      };
    }
    if (typeof tier.exactUnit === 'number') {
      var line = round2(tier.exactUnit * q);
      return {
        ok: true, quote: false, gap: false, exact: true, qty: q, size: tier.size,
        unit: tier.exactUnit, lineTotal: line,
        unitText: money(tier.exactUnit) + ' per flyer',
        totalText: money(line),
        rangeText: '',
        detail: ''
      };
    }
    var low = round2(tier.unitLow * q), high = round2(tier.unitHigh * q);
    return {
      ok: true, quote: true, gap: false, exact: false, qty: q, size: tier.size,
      unit: null, lineTotal: 0, unitLow: tier.unitLow, unitHigh: tier.unitHigh,
      unitText: money(tier.unitLow) + '–' + money(tier.unitHigh) + ' per flyer',
      totalText: money(low) + '–' + money(high),
      rangeText: 'Published range for ' + q + ' flyers: ' + money(low) + '–' + money(high) + '. Quote required — this range is not charged until you approve the exact total.',
      detail: ''
    };
  }
  function priceOrderItem(input) {
    var src = input || {};
    var finish = String(src.finish || '');
    var prices = getPrices();
    var spec = prices[finish];
    if (!spec || !spec.sizes) return { ok: false, error: 'Invalid size/finish' };
    if (finish === 'flyers' || spec.product === 'flyers') {
      var flyer = describeFlyer(src.qty);
      if (!flyer.ok) return flyer;
      return {
        ok: true, finish: finish, size: flyer.size, qty: flyer.qty,
        unit: flyer.exact ? flyer.unit : null,
        lineTotal: flyer.exact ? flyer.lineTotal : 0,
        priceTBD: !flyer.exact, quote: !flyer.exact, gap: !!flyer.gap,
        unitText: flyer.unitText, totalText: flyer.totalText, rangeText: flyer.rangeText || '', detail: flyer.detail || ''
      };
    }
    var qty = whole(src.qty);
    if (qty == null || qty < 1 || qty > 999) return { ok: false, error: 'Quantity must be a whole number from 1 to 999.' };
    var size = src.size;
    if (typeof size !== 'string' || !Object.prototype.hasOwnProperty.call(spec.sizes, size)) return { ok: false, error: 'Invalid size/finish' };
    var unit = spec.sizes[size];
    if (unit == null) {
      return { ok: true, finish: finish, size: size, qty: qty, unit: null, lineTotal: 0, priceTBD: true, quote: true, gap: false, unitText: 'Quote', totalText: 'Quote required', rangeText: '', detail: '' };
    }
    var lineTotal = round2(unit * qty);
    return { ok: true, finish: finish, size: size, qty: qty, unit: unit, lineTotal: lineTotal, priceTBD: false, quote: false, gap: false, unitText: money(unit) + ' each', totalText: money(lineTotal), rangeText: '', detail: '' };
  }
  return { money: money, describeFlyer: describeFlyer, priceOrderItem: priceOrderItem };
});
