// Extracts the randomizer's unique Base64 seed value from a full Option
// string, so the room key stays short and stable even when boot.lua's own
// 128-byte ROM-read cap truncates sessionSave.param on the Lua side for an
// unusually long Option string (many non-default settings). Falls back to
// the original string unchanged if the expected "S<base64>" segment isn't
// found, so an unexpected format degrades gracefully.
//
// Must stay in sync with ShareLogic.extractSeedKey in lua/share_logic.lua --
// the admin page (this file, reading the full Option string pasted from
// spoiler.txt) and the player's Lua script (reading the possibly-truncated
// sessionSave.param) must derive the same room key from either input.
function extractSeedKey(optionString) {
  for (const segment of optionString.split("#")) {
    const match = segment.match(/^S([A-Za-z0-9+/]+)$/);
    if (match) return match[1];
  }
  return optionString;
}
