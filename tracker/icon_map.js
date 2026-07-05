const GENERIC_ICON = "assets/x.png";

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
  { pattern: /^1ItHadouken$/, file: "assets/x1_x_hadouken.png" },
  { pattern: /^2ItShoryuken$/, file: "assets/x2_x_shoryuken.png" },
  { pattern: /^3ItSaber$/, file: "assets/x3_x_saber.png" },
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

  const bossMatch = idString.match(/^([123])It(?:Weapon|Key)([A-Z]{2})$/);
  if (bossMatch) {
    const game = bossMatch[1];
    const assetCode = BOSS_CODE_MAP[game][bossMatch[2]];
    if (assetCode) {
      return { file: `assets/x${game}_weapon_${assetCode}.png`, label };
    }
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
