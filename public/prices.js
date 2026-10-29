/* ===== LUMA PRINTS PRICE LIST — edit prices here (one place) =====
   Set a number (e.g. 1.25) to enable a price. null = "[SET PRICE]" placeholder:
   still selectable, but the order is saved as a price-to-be-confirmed inquiry (no online charge). */
var LUMA_PRICES = {
  standard: { label: "Standard prints", desc: "Matte finish photo paper.", sizes: { "3x5": 0.45, "4x4": 0.50, "4x6": 0.69, "5x7": 0.75, "8x8": 3.00, "8x10": 4.00, "8x12": 5.00, "8x24": 11.00, "10x20": 11.00, "11x14": 9.00, "11x17": 10.00, "12x12": 8.00, "12x16": 11.00, "12x18": 12.00, "12x24": 16.00, "12x36": 24.00, "13x19": 14.00, "14x18": 14.00, "16x16": 14.00, "16x20": 18.00, "16x24": 21.00 } },
  glossy:   { label: "Glossy finish",   desc: "Same price as standard — just choose glossy instead of matte.", sizes: null }, // uses standard prices
};
LUMA_PRICES.glossy.sizes = LUMA_PRICES.standard.sizes; // glossy = standard price
if (typeof module !== "undefined") module.exports = LUMA_PRICES;
