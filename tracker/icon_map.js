const GENERIC_ICON = "assets/x.png";

// Sprite-sliced icon source (primary icon path — see getSpritePositionForId below).
// Ported from tracker/icon_audit.js's proven, owner-approved implementation.
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
    const part = zeroPartMatch[1] === "FHead" ? "head" : PART_ASSET_NAMES[zeroPartMatch[1]] || zeroPartMatch[1].toLowerCase();
    return { file: `assets/x2_x_${part}.png`, label };
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
