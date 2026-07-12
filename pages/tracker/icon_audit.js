// RMR Sync — Icon Audit (diagnostic tool, not part of the shipped player-facing UI).
//
// Renders one row per ITEM_ID_MAP entry, side by side comparing:
//   - the CURRENTLY-shipped icon (via getIconInfoForId from icon_map.js)
//   - a candidate icon sliced directly out of the original AutoTracker sprite sheet
//     (ref/AutoTracker/ItemIcon.png, copied to assets/item_icon_sheet.png), using the
//     item's own numeric ID and the slicing formula confirmed by reading AutoTracker's
//     own covertIcon() function:
//       sx = (id % 8) * 16
//       sy = Math.floor(id / 256) * 256 + Math.floor((id % 256) / 8) * 16 + 128
//
// "M"-prefixed codes (this project's own "shared/either-game" bank, ids ~768-883) have no
// slot of their own in the sprite sheet. For those, we look up the id whose string code is
// identical but with the leading "M" replaced by "1", and slice using THAT id instead. If no
// such "1"-equivalent exists in ITEM_ID_MAP, we show a "no sprite mapping" placeholder rather
// than guessing.

// SPRITE_SHEET_FILE / SPRITE_TILE_PX / SPRITE_SHEET_NATIVE_W / SPRITE_SHEET_NATIVE_H /
// CODE_TO_ID / computeSpritePosition are now defined once in icon_map.js (the shared
// source of truth), along with getSpritePositionForId which combines them with the
// M-prefix cross-reference fallback. This file only adds its own display-scale constant
// and the DOM-styling wrapper around that shared function.
const DISPLAY_PX = 48; // CSS box size for both icon columns
const SCALE = DISPLAY_PX / SPRITE_TILE_PX; // uniform upscale factor, kept proportional

// Regex for the already-reported reused-icon bug this tool is meant to surface clearly:
// ItLifeS/ItLifeL wrongly reuse ItLifeUp's icon; ItWeaponS/ItWeaponL wrongly reuse
// ItEnergyUp's icon; ItFullRecover also reuses ItLifeUp's icon. See pages/tracker/icon_map.js
// SIMPLE_RULES for the current (buggy) rules.
const KNOWN_BUG_PATTERN = /^ItLife[SL]$|^ItWeapon[SL]$|^ItFullRecover$/;

// Languages shown as extra name columns, keyed by ITEM_NAME_TABLES' own keys (icon_map.js).
const AUDIT_LANGS = SUPPORTED_LANGS;

// Same lookup order as getItemNameForId (icon_map.js), including its "[1]"/"[M]"
// game tag prefix (so this audit shows exactly what players will see), but also
// reports whether the result came from a real per-language translation or fell back
// to English / the mechanical code-derived label -- used here to flag translation
// gaps that getItemNameForId itself intentionally papers over for player-facing
// display.
function nameInfo(id, lang) {
  const code = ITEM_ID_MAP[id];
  let lookupId = id;
  if (code && code.startsWith("M")) {
    const equivalentId = CODE_TO_ID["1" + code.slice(1)];
    if (equivalentId !== undefined) {
      lookupId = equivalentId;
    }
  }
  const tag = gameTagFor(code);
  const table = ITEM_NAME_TABLES[lang];
  if (table && table[lookupId] !== undefined) {
    return { name: tag + table[lookupId], fallback: null };
  }
  const englishTable = ITEM_NAME_TABLES[DEFAULT_LANG];
  if (lang !== DEFAULT_LANG && englishTable && englishTable[lookupId] !== undefined) {
    return { name: tag + englishTable[lookupId], fallback: "english" };
  }
  return { name: tag + getIconInfoForId(id).label, fallback: "mechanical" };
}

function spriteBoxStyle({ sx, sy }) {
  const bgWidth = SPRITE_SHEET_NATIVE_W * SCALE;
  const bgHeight = SPRITE_SHEET_NATIVE_H * SCALE;
  const posX = -(sx * SCALE);
  const posY = -(sy * SCALE);
  return (
    `width:${DISPLAY_PX}px;height:${DISPLAY_PX}px;` +
    `background-image:url(${JSON.stringify(SPRITE_SHEET_FILE)});` +
    `background-repeat:no-repeat;` +
    `background-size:${bgWidth}px ${bgHeight}px;` +
    `background-position:${posX}px ${posY}px;` +
    `image-rendering:pixelated;`
  );
}

function buildRow(id, code) {
  const tr = document.createElement("tr");
  tr.dataset.code = code;

  const isFlagged = KNOWN_BUG_PATTERN.test(code);
  if (isFlagged) {
    tr.classList.add("flagged");
  }

  const idTd = document.createElement("td");
  idTd.className = "id-cell";
  idTd.textContent = String(id);
  tr.appendChild(idTd);

  const codeTd = document.createElement("td");
  codeTd.className = "code-cell";
  codeTd.textContent = code;
  if (isFlagged) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "known bug";
    codeTd.appendChild(badge);
  }
  tr.appendChild(codeTd);

  const currentTd = document.createElement("td");
  currentTd.className = "icon-cell";
  const currentInfo = getIconInfoForId(id);
  const img = document.createElement("img");
  img.className = "icon-box";
  img.src = currentInfo.file;
  img.alt = currentInfo.label;
  img.title = `${currentInfo.file} (${currentInfo.label})`;
  currentTd.appendChild(img);
  tr.appendChild(currentTd);

  const spriteTd = document.createElement("td");
  spriteTd.className = "icon-cell sprite-cell";
  const spritePos = getSpritePositionForId(id);
  if (spritePos === null) {
    tr.classList.add("no-mapping");
    const placeholder = document.createElement("div");
    placeholder.className = "no-mapping-placeholder";
    placeholder.textContent = "no sprite mapping";
    spriteTd.appendChild(placeholder);
  } else {
    const div = document.createElement("div");
    div.setAttribute("style", spriteBoxStyle(spritePos));
    // CODE_TO_ID is icon_map.js's canonical reverse lookup, used here only to surface
    // which numeric id's sprite slot was actually used (for the M->1 cross-reference note).
    const spriteId = code.startsWith("M") ? CODE_TO_ID["1" + code.slice(1)] : id;
    div.title = `sprite id ${spriteId}${spriteId !== id ? ` (via M->1 cross-reference from id ${id})` : ""}`;
    spriteTd.appendChild(div);
  }
  tr.appendChild(spriteTd);

  let hasNameFallback = false;
  for (const lang of AUDIT_LANGS) {
    const nameTd = document.createElement("td");
    nameTd.className = "name-cell";
    const info = nameInfo(id, lang);
    nameTd.textContent = info.name;
    if (info.fallback) {
      hasNameFallback = true;
      nameTd.classList.add("name-fallback");
      nameTd.title = info.fallback === "english" ? "no entry for this language -- showing English" : "no translation anywhere -- showing mechanical code-derived label";
    }
    tr.appendChild(nameTd);
  }
  if (hasNameFallback) {
    tr.classList.add("has-name-fallback");
  }

  return tr;
}

function render() {
  const rowsEl = document.getElementById("rows");
  const statsEl = document.getElementById("stats");
  rowsEl.innerHTML = "";

  const entries = Object.keys(ITEM_ID_MAP)
    .map((idStr) => Number(idStr))
    .sort((a, b) => a - b)
    .map((id) => ({ id, code: ITEM_ID_MAP[id] }));

  let noMappingCount = 0;
  const nameFallbackCounts = Object.fromEntries(AUDIT_LANGS.map((lang) => [lang, 0]));
  for (const entry of entries) {
    if (entry.code.startsWith("M") && getSpritePositionForId(entry.id) === null) {
      noMappingCount++;
    }
    for (const lang of AUDIT_LANGS) {
      if (nameInfo(entry.id, lang).fallback) {
        nameFallbackCounts[lang]++;
      }
    }
  }

  const fallbackSummary = AUDIT_LANGS.map((lang) => `${lang}: ${nameFallbackCounts[lang]}`).join(", ");
  statsEl.textContent =
    `${entries.length} entries total. ` +
    `${noMappingCount} M-prefixed entr${noMappingCount === 1 ? "y" : "ies"} with no 1-prefixed sprite equivalent. ` +
    `Name fallbacks (not a real per-language translation) -- ${fallbackSummary}.`;

  const frag = document.createDocumentFragment();
  for (const entry of entries) {
    frag.appendChild(buildRow(entry.id, entry.code));
  }
  rowsEl.appendChild(frag);
}

function applyFilterAndSort() {
  const filterText = document.getElementById("filterInput").value.trim().toLowerCase();
  const flaggedOnly = document.getElementById("flaggedOnly").checked;
  const flaggedFirst = document.getElementById("flaggedFirst").checked;
  const rowsEl = document.getElementById("rows");

  const rows = Array.from(rowsEl.children);

  for (const row of rows) {
    const code = row.dataset.code.toLowerCase();
    const matchesFilter = !filterText || code.includes(filterText);
    const matchesFlagged = !flaggedOnly || row.classList.contains("flagged");
    row.classList.toggle("hidden", !(matchesFilter && matchesFlagged));
  }

  if (flaggedFirst) {
    const sorted = rows.slice().sort((a, b) => {
      const aFlagged = a.classList.contains("flagged") ? 0 : 1;
      const bFlagged = b.classList.contains("flagged") ? 0 : 1;
      return aFlagged - bFlagged;
    });
    for (const row of sorted) {
      rowsEl.appendChild(row);
    }
  } else {
    const sorted = rows.slice().sort((a, b) => Number(a.querySelector(".id-cell").textContent) - Number(b.querySelector(".id-cell").textContent));
    for (const row of sorted) {
      rowsEl.appendChild(row);
    }
  }
}

function init() {
  render();
  document.getElementById("filterInput").addEventListener("input", applyFilterAndSort);
  document.getElementById("flaggedOnly").addEventListener("change", applyFilterAndSort);
  document.getElementById("flaggedFirst").addEventListener("change", applyFilterAndSort);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

// Exposed for headless verification (e.g. `node --check` plus manual spot-checks); harmless
// in the browser since nothing else references a global `module`. The sprite-slicing logic
// itself (computeSpritePosition/getSpritePositionForId/CODE_TO_ID) now lives solely in
// icon_map.js and is covered by pages/tracker/icon_map.test.mjs.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { KNOWN_BUG_PATTERN };
}
