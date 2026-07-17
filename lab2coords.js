// Lab 2 diagram label COORDINATES (baked, shared to all profiles).
// Shape: LBL_COORDS = { "<image filename>": { "<num>": [xPct, yPct], ... }, ... }
// xPct/yPct are 0..1 fractions of the image width/height (the drop hotspot center).
// These are filled in via the in-app "Tag Diagram Spots" tool → "Copy coordinates",
// then pasted here and committed so everyone gets auto-graded on-image labeling.
// Any spots a user tags locally are stored in localStorage and OVERRIDE/extend this.
const LBL_COORDS = {};
if (typeof module !== "undefined" && module.exports) module.exports = LBL_COORDS;
