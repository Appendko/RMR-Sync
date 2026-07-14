const GENERIC_ICON = "assets/x.png";

// Sprite-sliced icon source (primary icon path — see getSpritePositionForId below).
// Ported from pages/tracker/icon_audit.js's proven, owner-approved implementation.
const SPRITE_SHEET_FILE = "assets/item_icon_sheet.png";
const SPRITE_TILE_PX = 16;
const SPRITE_SHEET_NATIVE_W = 128;
const SPRITE_SHEET_NATIVE_H = 896;

// Reverse lookup (string code -> numeric id), used to resolve "M"-prefixed codes
// (this project's own "shared/either-game" bank, ids ~768-883, which have no slot
// of their own in the sprite sheet) to their "1"-prefixed sprite-sheet equivalent.
const CODE_TO_ID = {};
for (const idStr of Object.keys(ITEM_ID_MAP)) {
  const id = Number(idStr);
  CODE_TO_ID[ITEM_ID_MAP[id]] = id;
}

// Verified against ref/multiworld/lua/itemName.lua's English boss names.
// The id-map's 2-letter codes come from the Japanese name romanizations,
// which is why some diverge from the English-name asset filename codes
// (X1: BN->fm, IP->cp; X2: WH->ws, MH->mc, CM->cs, SO->oo, WA->wg;
// X3: EH->bh, FB->bb, AS->ts, EN->vc, SS->cc, SM->tr, ST->nt).
const BOSS_CODE_MAP = {
  1: { LO: "lo", SC: "sc", AA: "aa", BN: "fm", SE: "se", SM: "sm", BK: "bk", IP: "cp" },
  2: { MM: "mm", WH: "ws", BC: "bc", FS: "fs", MH: "mc", CM: "cs", SO: "oo", WA: "wg" },
  3: { EH: "bh", FB: "bb", GB: "gb", AS: "ts", EN: "vc", SS: "cc", SM: "tr", ST: "nt" },
};

const PART_ASSET_NAMES = { Head: "head", Arm: "arm", Body: "body", Foot: "foot" };
const RIDE_ARMOR_ASSET_LETTERS = { N: "n", K: "k", H: "h", F: "f" };

const SIMPLE_RULES = [
  { pattern: /^[123M]?ItLifeUp/, file: "assets/heart.png" },
  { pattern: /^[123M]?ItEnergyUp/, file: "assets/energy.png" },
  { pattern: /^[123M]?ItSubtank/, file: "assets/etank.png" },
  { pattern: /^[123M]?ItBuster/, file: "assets/buster.png" },
  { pattern: /^[123M]?ItCharge/, file: "assets/buster.png" },
  { pattern: /^ItLife[SL]$/, file: "assets/heart.png" },
  { pattern: /^ItWeapon[SL]$/, file: "assets/energy.png" },
  { pattern: /^ItFullRecover$/, file: "assets/heart.png" },
  { pattern: /^[1M]ItHadouken$/, file: "assets/x1_x_hadouken.png" },
  { pattern: /^2ItShoryuken$/, file: "assets/x2_x_shoryuken.png" },
  { pattern: /^3ItSaber$/, file: "assets/x3_x_saber.png" },
  { pattern: /^[123M]ItKeyS\d+$/, file: "assets/sigma.png" },
  { pattern: /^3ItKeyVavaStage$/, file: "assets/vava.png" },
  { pattern: /^3ItKeyVajurila$/, file: "assets/bit.png" },
  { pattern: /^3ItKeyMandarela$/, file: "assets/byte.png" },
  { pattern: /^3ItKeyVava$/, file: "assets/vava.png" },
];

function getIconInfo(idString) {
  const label = labelFor(idString);

  for (const rule of SIMPLE_RULES) {
    if (rule.pattern.test(idString)) {
      return { file: rule.file, label };
    }
  }

  const partMatch = idString.match(/^([123M])It(Head|Arm|Body|Foot)(?:Part|Chip)$/);
  if (partMatch) {
    const game = partMatch[1] === "M" ? "1" : partMatch[1];
    const part = PART_ASSET_NAMES[partMatch[2]];
    return { file: `assets/x${game}_x_${part}.png`, label };
  }

  const rideArmorMatch = idString.match(/^3ItRideArmor([NKHF])$/);
  if (rideArmorMatch) {
    const letter = RIDE_ARMOR_ASSET_LETTERS[rideArmorMatch[1]];
    return { file: `assets/x3_ridearmor_${letter}.png`, label };
  }

  const bossMatch = idString.match(/^([123M])It(?:Weapon|Key)([A-Z]{2})$/);
  if (bossMatch) {
    const game = bossMatch[1] === "M" ? "1" : bossMatch[1];
    const assetCode = BOSS_CODE_MAP[game][bossMatch[2]];
    if (assetCode) {
      return { file: `assets/x${game}_weapon_${assetCode}.png`, label };
    }
  }

  const stageVariedMatch = idString.match(/^([123M])ItStageVaried([A-Z]{2})$/);
  if (stageVariedMatch) {
    const game = stageVariedMatch[1] === "M" ? "1" : stageVariedMatch[1];
    const assetCode = BOSS_CODE_MAP[game][stageVariedMatch[2]];
    if (assetCode) {
      return { file: `assets/x${game}_weapon_${assetCode}.png`, label };
    }
  }

  const zeroPartMatch = idString.match(/^2ItZero(Head|FHead|Body|Foot)$/);
  if (zeroPartMatch) {
    const part = zeroPartMatch[1] === "FHead" ? "head" : zeroPartMatch[1].toLowerCase();
    return { file: `assets/x2_zero_${part}.ico`, label };
  }

  return { file: GENERIC_ICON, label };
}

function labelFor(idString) {
  const match = idString.match(/^[123M]?It(.+)$/);
  return match ? match[1] : idString;
}

function getIconInfoForId(numericId) {
  const idString = ITEM_ID_MAP[numericId];
  if (!idString) {
    return { file: GENERIC_ICON, label: String(numericId) };
  }
  return getIconInfo(idString);
}

function computeSpritePosition(id) {
  const sx = (id % 8) * 16;
  const sy = Math.floor(id / 256) * 256 + Math.floor((id % 256) / 8) * 16 + 128;
  return { sx, sy };
}

// Returns {sx, sy, label} for the given numeric item id, or null if there is no
// usable sprite slot (id not in ITEM_ID_MAP at all, or an "M"-prefixed code with
// no "1"-prefixed equivalent to borrow a sprite position from).
function getSpritePositionForId(numericId) {
  const code = ITEM_ID_MAP[numericId];
  if (!code) {
    return null;
  }
  let spriteId = numericId;
  if (code.startsWith("M")) {
    const equivalentCode = "1" + code.slice(1);
    const equivalentId = CODE_TO_ID[equivalentCode];
    if (equivalentId === undefined) {
      return null;
    }
    spriteId = equivalentId;
  }
  const { sx, sy } = computeSpritePosition(spriteId);
  return { sx, sy, label: labelFor(code) };
}

// Localized item names, ported/derived from the original game's own name tables
// (see pages/tracker/item_names_en.js / item_names_ja.js / item_names_zhtw.js for
// provenance). SUPPORTED_LANGS order also drives the settings-panel dropdown in
// event_feed.js.
const ITEM_NAME_TABLES = { en: ITEM_NAMES_EN, ja: ITEM_NAMES_JA, "zh-TW": ITEM_NAMES_ZHTW };
const SUPPORTED_LANGS = ["en", "ja", "zh-TW"];
const DEFAULT_LANG = "en";

// Classifies a code into one of the item categories ref/aaa/boot.lua's own
// mergeItems logic can share across all 3 games for a seed (see the shareXxx
// bitfield it decodes from ROM), based on the same offset ranges boot.lua uses.
// Boss weapons/keys and stage-varied codes are intentionally excluded: boot.lua
// defines bits for those (shareSpecialWeapon/shareStageKey) but leaves them
// commented out/unused, so they're never actually shared in this ROM regardless
// of seed settings. RideArmor/ZeroParts/Vava-family and the numbered Sigma-key
// suffix on top of a plain digit prefix are also excluded for the same reason
// (boot.lua's ranges treat them as title-specific, not shareable). Returns null
// for anything not in a shareable category.
function shareCategoryFor(code) {
  if (!code) return null;
  const suffix = code.replace(/^[123M]/, "");
  if (/^ItLifeUp/.test(suffix)) return "lifeUp";
  if (/^ItEnergyUp/.test(suffix)) return "energyUp";
  if (/^ItSubtank/.test(suffix)) return "subTank";
  if (/^ItKeyS\d+$/.test(suffix)) return "sigmaKey";
  if (/^It(Hadouken|Shoryuken|Saber)$/.test(suffix)) return "finalWeapon";
  if (/^It(Head|Arm|Body|Foot)(Part|Chip)$/.test(suffix)) return "armor";
  if (/^It(Buster|Charge)/.test(suffix)) return "upgradeItem";
  return null;
}

// Prefixes a name with its game tag, e.g. "[1] " for a "1ItXxx" code, matching the
// "[1]Weapon : ..." style ref/multiworld/lua/itemName.lua itself uses. If this
// item's category is configured as shared across all 3 games for this seed
// (shareFlags, read from ROM by lua/share_info.lua and broadcast per room -- see
// shareCategoryFor above), the tag is "[*] " instead, regardless of which game it
// was actually picked up in. "M"-prefixed codes (this project's own
// "shared/either-game" bank) get "[M]" rather than being relabeled as game 1 --
// they borrow game 1's name/icon data, but aren't actually game-1-specific, so
// tagging them as game 1 would misattribute them. Codes with no leading game
// digit at all (ItLifeS, ItWeaponS, ItFullRecover, ItEmpty -- enemy drops and the
// empty sentinel, which apply the same way regardless of game) get no tag.
function gameTagFor(code, shareFlags) {
  if (!code) return "";
  const category = shareCategoryFor(code);
  if (category && shareFlags && shareFlags[category]) {
    return "[*] ";
  }
  const match = code.match(/^([123M])/);
  return match ? `[${match[1]}] ` : "";
}

// Returns the localized display name for a numeric item id, prefixed with its game
// tag (see gameTagFor; shareFlags is optional and only affects that tag). "M"-
// prefixed codes (this project's own "shared/either-game" bank) have no entry of
// their own in any name table -- same as the sprite sheet, they're resolved by
// cross-referencing to their "1"-prefixed equivalent id instead (see
// getSpritePositionForId above). Falls back to English if the requested language
// has no entry for this id (covers the ids intentionally left blank in one
// language's data), and finally to the mechanical code-derived label if no real
// translation exists anywhere.
function getItemNameForId(numericId, lang, shareFlags) {
  const code = ITEM_ID_MAP[numericId];
  let lookupId = numericId;
  if (code && code.startsWith("M")) {
    const equivalentId = CODE_TO_ID["1" + code.slice(1)];
    if (equivalentId !== undefined) {
      lookupId = equivalentId;
    }
  }

  const table = ITEM_NAME_TABLES[lang];
  let name;
  if (table && table[lookupId] !== undefined) {
    name = table[lookupId];
  } else {
    const englishTable = ITEM_NAME_TABLES[DEFAULT_LANG];
    name = englishTable && englishTable[lookupId] !== undefined ? englishTable[lookupId] : getIconInfoForId(numericId).label;
  }
  return gameTagFor(code, shareFlags) + name;
}
