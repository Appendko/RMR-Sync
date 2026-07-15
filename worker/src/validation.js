const VALID_MODES = ["checksSeen", "checksSeen+shared", "checksSeen+items"];
const CHECKS_SEEN_LENGTH = 96;
const ITEMS_LENGTH = 96;
const SHARE_FLAG_KEYS = ["lifeUp", "energyUp", "armor", "subTank", "finalWeapon", "sigmaKey", "upgradeItem"];

export function isValidMode(mode) {
  return VALID_MODES.includes(mode);
}

// checksSeen and items are both 96-byte arrays, one bit per id (byte
// Math.floor(id/8), bit id % 8) -- shared validator, exposed under two
// names so each call site stays self-documenting.
function isValidByteArray(arr, length) {
  if (!Array.isArray(arr) || arr.length !== length) return false;
  return arr.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
}

export function isValidChecksSeenArray(arr) {
  return isValidByteArray(arr, CHECKS_SEEN_LENGTH);
}

// The client's full 96-byte item-ownership snapshot (lua/share_info.lua's
// readItems(), reading addrItems directly -- already flat/all-3-titles, no
// per-title slicing needed), sent on every /sync alongside checksSeen so
// room.js's handleSync can OR-merge it across players into mergedItems.
export function isValidItemsArray(arr) {
  return isValidByteArray(arr, ITEMS_LENGTH);
}

// Upper bound is 999, not 767: real item/check ids top out at 767, but
// tracker/check_id_map.js also defines a handful of synthetic ids at 900+
// (e.g. 900/901/902 for "title fully cleared", reported through this same
// `checks` field -- see lua/share_info.lua's checkForNewGameClear) that
// aren't real bit positions in any 96-byte array, just event-feed display
// ids. Headroom is intentional for future milestone ids in that same band.
function isValidIdArray(arr) {
  return Array.isArray(arr) && arr.length > 0 && arr.length <= 20 && arr.every((id) => Number.isInteger(id) && id >= 0 && id <= 999);
}

// Companion to the synthetic "all 3 titles cleared" check id (903) --
// lua/share_logic.lua's ShareLogic.formatClearTime's "H:MM:SS" output,
// carried alongside so pages/tracker/event_feed.js can substitute it into
// that id's translated "{time}" placeholder. Loosely format-checked (not
// just "any string") since it ends up broadcast to every connected tracker.
const GAME_CLEAR_TIME_PATTERN = /^\d{1,3}:\d{2}:\d{2}$/;
export function isValidGameClearTime(value) {
  return value === undefined || (typeof value === "string" && GAME_CLEAR_TIME_PATTERN.test(value));
}

// Death/IFG-use counts: always additive and always real (share_info.lua only
// reports when the underlying RAM counter increases -- see design spec
// decision 3), so unlike items/checks there's no dedup concern here. The
// upper bound guards against a garbled client claiming an implausible single
// jump, not against legitimate repeated small deltas.
function isValidPositiveDelta(value) {
  return value === undefined || (Number.isInteger(value) && value >= 1 && value <= 50);
}
export function isValidDeathDelta(value) {
  return isValidPositiveDelta(value);
}
export function isValidIfgDelta(value) {
  return isValidPositiveDelta(value);
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
  const hasItems = body.items !== undefined;
  const hasChecks = body.checks !== undefined;
  const hasDeathDelta = body.deathDelta !== undefined;
  const hasIfgDelta = body.ifgDelta !== undefined;
  if (!hasItems && !hasChecks && !hasDeathDelta && !hasIfgDelta) {
    return "body must include at least one of items, checks, deathDelta, or ifgDelta";
  }
  if (hasItems && !isValidIdArray(body.items)) {
    return "items must be a non-empty array of up to 20 integer ids between 0 and 999";
  }
  if (hasChecks && !isValidIdArray(body.checks)) {
    return "checks must be a non-empty array of up to 20 integer ids between 0 and 999";
  }
  if (!isValidGameClearTime(body.gameClearTime)) {
    return "gameClearTime must be an H:MM:SS string";
  }
  if (!isValidDeathDelta(body.deathDelta)) {
    return "deathDelta must be an integer between 1 and 50";
  }
  if (!isValidIfgDelta(body.ifgDelta)) {
    return "ifgDelta must be an integer between 1 and 50";
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

// Optional field on the /sync body -- which of the 3 titles this seed
// actually randomizes (read from ROM by lua/share_info.lua's
// readRandomizedGames, static for the whole session), used by the
// team-progress tracker to hide a title's panel entirely when it isn't
// part of the seed. Older Lua clients that predate this field simply omit
// it, so `undefined` is valid too -- same pattern as isValidShareFlags.
export function isValidRandomizedGames(value) {
  if (value === undefined) return true;
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === "boolean");
}
