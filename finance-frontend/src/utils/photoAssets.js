/**
 * Photography shared between Home.jsx and Services.jsx — extracted so both
 * pages that sell the same products (loans, leasing) use one visual
 * language instead of two pages independently re-deriving the same gradient.
 *
 * Pexels License (free for commercial use, no attribution required).
 * Recorded here anyway: these are hotlinked rather than bundled, so the next
 * person to touch this file needs to know where they came from and how to
 * swap one out.
 *
 *   hero      "Hands on a Laptop" — Alesia Kozik
 *             https://www.pexels.com/photo/6772076/
 *   loans     "A Person Signing a Document" — Mikhail Nilov
 *             https://www.pexels.com/photo/8730987/
 *   leasing   "Hand holding car keys in a vehicle interior" — P G
 *             https://www.pexels.com/photo/29217852/
 *   currency  "International banknotes pile" — Valmir Zanellato
 *             https://www.pexels.com/photo/29769669/
 *
 * Loaded at Pexels' own resized widths (?w=) rather than the full-resolution
 * originals — this is background art, not a gallery.
 */
export const IMAGES = {
  hero: "https://images.pexels.com/photos/6772076/pexels-photo-6772076.jpeg?auto=compress&cs=tinysrgb&w=1600",
  loans: "https://images.pexels.com/photos/8730987/pexels-photo-8730987.jpeg?auto=compress&cs=tinysrgb&w=800",
  leasing: "https://images.pexels.com/photos/29217852/pexels-photo-29217852.jpeg?auto=compress&cs=tinysrgb&w=1600",
  currency: "https://images.pexels.com/photos/29769669/pexels-photo-29769669.jpeg?auto=compress&cs=tinysrgb&w=800",
};

/**
 * The navy scrim shared by every photo across the site — the thing that
 * makes photos from several different photographers read as one system
 * instead of a stock-photo collage.
 */
export const NAVY_SCRIM =
  "linear-gradient(115deg, rgba(7,27,47,0.94) 0%, rgba(7,27,47,0.86) 45%, rgba(7,27,47,0.74) 100%)";
