// One-off generator for pages/tracker/item_names_en.js. Run with:
//   node scripts/generate_item_names_en.js
// from the repo root. Regenerate only if ref/multiworld/lua/itemName.lua ever changes.
//
// ref/AutoTracker's own data files give us ready-made Japanese (data/itemNames.js)
// and Traditional Chinese (data_log/itemNames.js) name tables, but no English one --
// ref/multiworld/lua/itemName.lua is the only source with English names, and it only
// spells each one out once per game block, then fills in numbered variants (LifeUp2,
// LifeUp3, ...) via a small Lua loop at the bottom of the file. This script parses the
// literal table and replays that same duplication logic in JS so the numbered variants
// don't have to be hand-copied.
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const luaPath = path.join(repoRoot, "ref/multiworld/lua/itemName.lua");
const outPath = path.join(repoRoot, "pages/tracker/item_names_en.js");

const src = fs.readFileSync(luaPath, "utf8");

const entries = {};
const re = /\[0x([0-9A-Fa-f]+)\]\s*=\s*"((?:[^"\\]|\\.)*)"/g;
let m;
while ((m = re.exec(src))) {
  entries[parseInt(m[1], 16)] = m[2];
}

function copy(dest, source) {
  if (entries[dest] === undefined && entries[source] !== undefined) {
    entries[dest] = entries[source];
  }
}

// Mirrors itemName.lua's own duplication loop, for game blocks 1-3 only (t=0,1,2).
// t=3 is itemName.lua's "*" kana-placeholder block -- its numeric range (0x300-0x373)
// happens to coincide with RMR's own "M" (shared/either-game) bank ids (768-883), but
// the *meaning* is different (kana-placeholder wildcard vs. RMR's "same as game 1"
// bank), so it's intentionally skipped here. RMR's M-bank names are resolved at
// lookup time by cross-referencing to the "1"-prefixed equivalent id instead (see
// getItemNameForId in pages/tracker/icon_map.js), the same pattern already used for icons.
for (let t = 0; t <= 2; t++) {
  const base = t * 0x100;
  for (let i = 1; i <= 0xd; i++) {
    copy(base + i + 0x00, base + 0x00);
    copy(base + i + 0x10, base + 0x10);
  }
  for (let i = 1; i <= 0xc; i++) copy(base + i + 0x40, base + 0x40);
  for (let i = 1; i <= 0x3; i++) copy(base + i + 0x24, base + 0x24);
  copy(base + 0x59, base + 0x58);
  copy(base + 0x5b, base + 0x5a);
  copy(base + 0x5d, base + 0x5c);
  copy(base + 0x5f, base + 0x5e);
  for (let i = 1; i <= 0x4; i++) copy(base + i + 0x60, base + 0x60);
  copy(base + 0x66, base + 0x65);
  for (let i = 1; i <= 0x5; i++) copy(base + i + 0x68, base + 0x68);
  copy(base + 0x6f, base + 0x6e);
  for (let i = 1; i <= 0x3; i++) copy(base + i + 0x70, base + 0x70);
}

const englishNames = {};
for (const idStr of Object.keys(entries)) {
  const id = Number(idStr);
  if (id >= 0x300) continue; // drop the "*" block -- see comment above
  const firstLine = entries[id].split("\\n")[0]; // literal "\n" escape in the Lua source
  englishNames[id] = firstLine.replace(/^\[[123*]\]/, "").trim();
}

const sortedIds = Object.keys(englishNames).map(Number).sort((a, b) => a - b);

const lines = [
  "// English item names, derived from ref/multiworld/lua/itemName.lua (the original",
  "// game/multiworld script's bilingual EN+JA name table) by replaying its own",
  "// in-file duplication loop in JS -- see scripts/generate_item_names_en.js if this",
  "// ever needs regenerating from an updated itemName.lua.",
  "//",
  "// A handful of ids have no entry in itemName.lua at all -- ItLifeS/L, ItWeaponS/L,",
  "// and ItFullRecover are enemy drop items AutoTracker/itemName.lua never tracked",
  "// (they only track story/check items, not every enemy drop), and 3ItKeyS14 is a",
  "// 14th Sigma key slot that exists in RMR's own id map but not in the source data",
  "// (which only ever defined 13 Sigma keys per game). These are hand-translated",
  "// below to match the style of their nearest real counterpart.",
  "const ITEM_NAMES_EN = {",
];
let lineBuf = [];
function pushEntry(id, name) {
  const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  lineBuf.push(`${id}: "${escaped}"`);
  if (lineBuf.length === 4) {
    lines.push("  " + lineBuf.join(", ") + ",");
    lineBuf = [];
  }
}
for (const id of sortedIds) pushEntry(id, englishNames[id]);
if (lineBuf.length) {
  lines.push("  " + lineBuf.join(", ") + ",");
  lineBuf = [];
}
lines.push("");
lines.push("  // Hand-translated gap fills (see header comment).");
pushEntry(120, "Small Health Energy");
pushEntry(121, "Large Health Energy");
pushEntry(122, "Small Weapon Energy");
pushEntry(123, "Large Weapon Energy");
pushEntry(124, "Full Energy Refill");
pushEntry(589, "Key : Sigma");
pushEntry(255, "(Empty)");
if (lineBuf.length) lines.push("  " + lineBuf.join(", ") + ",");
lines.push("};");

fs.writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`Wrote ${outPath} (${sortedIds.length + 7} entries)`);
