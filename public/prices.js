/* ===== LUMA PRINTS PRICE LIST — edit prices here (one place) =====
   Each key is a product+finish. sizes: { "Size label": unit price } — unit price is per print (photos) or per pack (invitations).
   null = price confirmed by quote before payment (order is sent as an inquiry, no online charge). */
var LUMA_PRICES = {
  standard: { label: "Photo Print (Matte)", product: "photo", finish: "Matte", desc: "Professional matte photo paper.", sizes: { "3x5": 0.45, "4x4": 0.50, "4x6": 0.69, "5x7": 0.75, "8x8": 3.00, "8x10": 4.00, "8x12": 5.00, "8x24": 11.00, "10x20": 11.00, "11x14": 9.00, "11x17": 10.00, "12x12": 8.00, "12x16": 11.00, "12x18": 12.00, "12x24": 16.00, "12x36": 24.00, "13x19": 14.00, "14x18": 14.00, "16x16": 14.00, "16x20": 18.00, "16x24": 21.00 } },
  glossy:   { label: "Photo Print (Glossy)", product: "photo", finish: "Glossy", desc: "Same price as matte — just choose glossy.", sizes: null },
  invitations_matte:  { label: "Invitations & Announcements (Matte)", product: "invitations", finish: "Matte", pack: true, desc: "Printed in packs. Upload your design (JPG, PNG or PDF).", sizes: { "4x6 (Pack of 25)": 17.00, "5x7 (Pack of 25)": 18.00, "5x7 (Pack of 50)": 36.00, "5x7 (Pack of 75)": 54.00, "5x7 (Pack of 100)": 72.00, "4x8 (Pack of 25)": 18.00, "4x8 (Pack of 50)": 36.00, "4x8 (Pack of 75)": 54.00, "4x8 (Pack of 100)": 72.00 } },
  invitations_glossy: { label: "Invitations & Announcements (Glossy)", product: "invitations", finish: "Glossy", pack: true, desc: "Same price as matte.", sizes: null },
  /* Flyer size values stay null on purpose. The site only publishes per-flyer ranges
     (see tiers.unitLow/unitHigh, copied from the existing rate card). exactUnit is null
     for every tier — do not charge a midpoint or an endpoint. Gaps have no published rate. */
  flyers: { label: "Flyers", product: "flyers", finish: null, quote: true, minQty: 25, maxQty: 20000,
    desc: "Minimum 25 flyers. Published rates are per-flyer ranges, not exact prices. We confirm the exact total before you pay.",
    sizes: { "Small batch": null, "Medium batch": null, "Large bulk": null, "Custom quantity (quote)": null },
    tiers: [
      { size: "Small batch", min: 25, max: 50, rangeLabel: "25 – 50", unitLow: 0.80, unitHigh: 1.12, exactUnit: null },
      { size: "Medium batch", min: 100, max: 500, rangeLabel: "100 – 500", unitLow: 0.28, unitHigh: 0.65, exactUnit: null },
      { size: "Large bulk", min: 1000, max: null, rangeLabel: "1,000 – 5,000+", unitLow: 0.04, unitHigh: 0.16, exactUnit: null }
    ],
    gaps: [
      { min: 51, max: 99, note: "No published rate between the small batch (25–50) and the medium batch (100–500)." },
      { min: 501, max: 999, note: "No published rate between the medium batch (100–500) and large bulk (1,000+)." }
    ],
    displayRates: {
      "Small batch": "$0.80–$1.12/flyer (quote) · 25–50",
      "Medium batch": "$0.28–$0.65/flyer (quote) · 100–500",
      "Large bulk": "$0.04–$0.16/flyer (quote) · 1,000–5,000+",
      "Custom quantity (quote)": "No published rate — quote required"
    } }
};
LUMA_PRICES.glossy.sizes = LUMA_PRICES.standard.sizes; // glossy = matte price
LUMA_PRICES.invitations_glossy.sizes = LUMA_PRICES.invitations_matte.sizes;
var LUMA_PRODUCTS = {
  photo: { label: "Photo Prints", keys: { Matte: "standard", Glossy: "glossy" } },
  invitations: { label: "Invitations & Announcements", keys: { Matte: "invitations_matte", Glossy: "invitations_glossy" } },
  flyers: { label: "Flyers", keys: { Standard: "flyers" } }
};
if (typeof module !== "undefined") module.exports = LUMA_PRICES;
