/* ===== LUMA PRINTS PRICE LIST — edit prices here (one place) =====
   Each key is a product+finish. sizes: { "Size label": unit price } — unit price is per print (photos) or per pack (invitations).
   null = price confirmed by quote before payment (order is sent as an inquiry, no online charge). */
var LUMA_PRICES = {
  standard: { label: "Photo Print (Matte)", product: "photo", finish: "Matte", desc: "Professional matte photo paper.", sizes: { "3x5": 0.45, "4x4": 0.50, "4x6": 0.69, "5x7": 0.75, "8x8": 3.00, "8x10": 4.00, "8x12": 5.00, "8x24": 11.00, "10x20": 11.00, "11x14": 9.00, "11x17": 10.00, "12x12": 8.00, "12x16": 11.00, "12x18": 12.00, "12x24": 16.00, "12x36": 24.00, "13x19": 14.00, "14x18": 14.00, "16x16": 14.00, "16x20": 18.00, "16x24": 21.00 } },
  glossy:   { label: "Photo Print (Glossy)", product: "photo", finish: "Glossy", desc: "Same price as matte — just choose glossy.", sizes: null },
  invitations_matte:  { label: "Invitations & Announcements (Matte)", product: "invitations", finish: "Matte", pack: true, desc: "Printed in packs. Upload your design (JPG, PNG or PDF).", sizes: { "4x6 (Pack of 25)": 17.00, "5x7 (Pack of 25)": 18.00, "5x7 (Pack of 50)": 36.00, "5x7 (Pack of 75)": 54.00, "5x7 (Pack of 100)": 72.00, "4x8 (Pack of 25)": 18.00, "4x8 (Pack of 50)": 36.00, "4x8 (Pack of 75)": 54.00, "4x8 (Pack of 100)": 72.00 } },
  invitations_glossy: { label: "Invitations & Announcements (Glossy)", product: "invitations", finish: "Glossy", pack: true, desc: "Same price as matte.", sizes: null },
  flyers: { label: "Flyers", product: "flyers", finish: null, pack: true, quote: true, desc: "Batch pricing — we confirm your exact total by email before you pay.",
    sizes: { "Small batch (25 flyers)": null, "Small batch (50 flyers)": null, "Medium batch (100 flyers)": null, "Medium batch (250 flyers)": null, "Medium batch (500 flyers)": null, "Large bulk (1,000+ flyers)": null },
    displayRates: { "Small batch (25 flyers)": "$0.80–$1.12/flyer (quote)", "Small batch (50 flyers)": "$0.80–$1.12/flyer (quote)", "Medium batch (100 flyers)": "$0.28–$0.65/flyer (quote)", "Medium batch (250 flyers)": "$0.28–$0.65/flyer (quote)", "Medium batch (500 flyers)": "$0.28–$0.65/flyer (quote)", "Large bulk (1,000+ flyers)": "$0.04–$0.16/flyer (quote)" } }
};
LUMA_PRICES.glossy.sizes = LUMA_PRICES.standard.sizes; // glossy = matte price
LUMA_PRICES.invitations_glossy.sizes = LUMA_PRICES.invitations_matte.sizes;
var LUMA_PRODUCTS = {
  photo: { label: "Photo Prints", keys: { Matte: "standard", Glossy: "glossy" } },
  invitations: { label: "Invitations & Announcements", keys: { Matte: "invitations_matte", Glossy: "invitations_glossy" } },
  flyers: { label: "Flyers", keys: { Standard: "flyers" } }
};
if (typeof module !== "undefined") module.exports = LUMA_PRICES;
