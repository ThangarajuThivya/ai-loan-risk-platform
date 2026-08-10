import { NAVY_SCRIM } from "../utils/photoAssets";

/**
 * A full-bleed photo with the shared navy scrim (see utils/photoAssets.js).
 * Used on both Home and Services so the two pages selling the same products
 * share one photo-treatment implementation rather than drifting apart.
 */
export default function PhotoBackdrop({ src, position = "center" }) {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <img
        src={src}
        alt=""
        loading="lazy"
        className="w-full h-full object-cover"
        style={{ objectPosition: position, filter: "saturate(0.85) contrast(1.05)" }}
      />
      <div className="absolute inset-0" style={{ background: NAVY_SCRIM }} />
    </div>
  );
}
