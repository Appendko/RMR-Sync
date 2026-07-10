const VALID_MODES = ["checksSeen", "checksSeen+item"];
const CHECKS_SEEN_LENGTH = 96;
const SHARE_FLAG_KEYS = ["lifeUp", "energyUp", "armor", "subTank", "finalWeapon", "sigmaKey", "upgradeItem"];

export function isValidMode(mode) {
  return VALID_MODES.includes(mode);
}

export function isValidChecksSeenArray(arr) {
  if (!Array.isArray(arr) || arr.length !== CHECKS_SEEN_LENGTH) return false;
  return arr.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
}

export function validateEventBody(body) {
  if (typeof body !== "object" || body === null) {
    return "body must be an object";
  }
  if (typeof body.player !== "string" || body.player.trim().length === 0 || body.player.length > 32) {
    return "player must be a non-empty string up to 32 characters";
  }
  if (!Number.isInteger(body.game) || body.game < 1 || body.game > 3) {
    return "game must be an integer between 1 and 3";
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 20) {
    return "items must be a non-empty array of up to 20 entries";
  }
  if (!body.items.every((item) => Number.isInteger(item) && item >= 0 && item <= 767)) {
    return "each item must be an integer item ID between 0 and 767";
  }
  return null;
}

export function isValidAdminSecret(secret) {
  return typeof secret === "string" && secret.length > 0 && secret.length <= 100;
}

export function isValidEpoch(value) {
  return Number.isInteger(value) && value >= 0;
}

// Optional field on the /sync body -- which item categories this seed's own
// generated settings configured as shared across all 3 games (read from ROM by
// lua/share_info.lua, static for the whole session). Older Lua clients that
// predate this field simply omit it, so `undefined` is valid too.
export function isValidShareFlags(value) {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => SHARE_FLAG_KEYS.includes(key) && typeof value[key] === "boolean");
}
