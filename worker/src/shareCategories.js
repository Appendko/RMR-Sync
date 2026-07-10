// Mirrors ref/aaa/boot.lua's own altItemNo range boundaries (the same ones
// tracker/icon_map.js's shareCategoryFor uses, re-derived here from the
// numeric id directly since the Worker has no access to the browser-only
// ITEM_ID_MAP string codes). Boss weapons/keys, stage-varied, Vava-family,
// Ride Armor, Zero parts, and the ungated recovery-item codes are
// deliberately excluded -- boot.lua never actually shares those either.
export function shareCategoryForId(id) {
  const altItemNo = id % 256;
  if (altItemNo <= 0x0f) return "lifeUp";
  if (altItemNo <= 0x1f) return "energyUp";
  if (altItemNo >= 0x24 && altItemNo <= 0x27) return "subTank";
  if (altItemNo >= 0x40 && altItemNo <= 0x4f) return "sigmaKey";
  if (altItemNo === 0x50) return "finalWeapon";
  if (altItemNo >= 0x58 && altItemNo <= 0x5f) return "armor";
  if (altItemNo >= 0x60 && altItemNo <= 0x73) return "upgradeItem";
  return null;
}

// The three sibling ids representing "the same slot" across all 3 titles --
// each title's own item block is exactly 256 ids wide.
export function itemMergeSiblings(id) {
  const slot = id % 256;
  return [slot, slot + 256, slot + 512];
}
